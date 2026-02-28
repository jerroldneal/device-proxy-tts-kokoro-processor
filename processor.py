"""
CONFIDENTIAL & PROPRIETARY
Copyright (c) 2025 Jerrold Neal. All Rights Reserved.

NOTICE: This software contains proprietary information and trade secrets of Jerrold Neal.
Use, disclosure, or reproduction is prohibited without the prior express written permission of Jerrold Neal.
PATENT PENDING
"""

import time
import os
import shutil
import subprocess
import soundfile as sf
import numpy as np
import torch
from kokoro import KPipeline
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import threading
import queue
import re
import sys
import json
import socket

# Configuration
DATA_DIR = "/app/data"
TODO_DIR = os.path.join(DATA_DIR, "todo")
WORKING_DIR = os.path.join(DATA_DIR, "working")
DONE_DIR = os.path.join(DATA_DIR, "done")
MP3_DIR = os.path.join(DATA_DIR, "mp3")
POLL_INTERVAL = 0.1
DEFAULT_VOICE = os.getenv('KOKORO_VOICE', 'af_heart')
LANG_CODE = 'a'

# Valid Voices
VALID_VOICES = {
    'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_sky',
    'am_adam', 'am_michael',
    'bf_emma', 'bf_isabella', 'bm_george', 'bm_lewis'
}

# Global Pipeline
pipeline = None

# Queues
# task_queue holds either file paths (str) or dicts (memory tasks)
task_queue = queue.Queue()
audio_queue = queue.Queue()

# Event to wake up the file watcher
fs_event = threading.Event()

# Playback control state
playback_state = {
    'paused': False,
    'stopped': False,
    'skip_current': False,
    'restart_current': False,
}
pause_event = threading.Event()
pause_event.set()  # Start unpaused

# Completed task history for previous/next navigation
completed_tasks = []
current_task_index = -1

class AudioChunk:
    def __init__(self, audio_data, sample_rate, volume, source_id, is_end_of_file=False, mp3_info=None):
        self.audio_data = audio_data
        self.sample_rate = sample_rate
        self.volume = volume
        self.source_id = source_id
        self.is_end_of_file = is_end_of_file
        self.mp3_info = mp3_info  # Dict with mp3_path and accumulated audio

class TCPPlayer:
    def __init__(self, host="host.docker.internal", port=3007, sample_rate=24000, target_rate=48000):
        self.host = host
        self.port = port
        self.sample_rate = sample_rate
        self.target_rate = target_rate
        self.socket = None

    def connect_socket(self):
        if self.socket:
            try:
                self.socket.close()
            except:
                pass
            self.socket = None

        try:
            print(f"TCPPlayer: Connecting to {self.host}:{self.port}...")
            self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.socket.connect((self.host, self.port))
            print("TCPPlayer: Connected.")
            return True
        except Exception as e:
            print(f"TCPPlayer: Failed to connect: {e}")
            self.socket = None
            return False

    def play_chunk(self, audio_data, volume=100):
        if self.socket is None:
            if not self.connect_socket():
                time.sleep(0.1)
                return

        # Resample 24k -> 48k
        if self.target_rate == 48000 and self.sample_rate == 24000:
            x = np.arange(len(audio_data))
            x_new = np.arange(0, len(audio_data), 0.5)
            audio_data = np.interp(x_new, x, audio_data)

        # Apply volume
        audio_data = audio_data * (volume / 100.0)

        # Clip
        audio_data = np.clip(audio_data, -1.0, 1.0)

        # Convert to Int16
        audio_int16 = (audio_data * 32767).astype(np.int16)

        try:
            self.socket.sendall(audio_int16.tobytes())
        except (BrokenPipeError, ConnectionResetError, OSError) as e:
            print(f"TCPPlayer: Connection lost ({e}). Reconnecting...")
            self.connect_socket()
        except Exception as e:
            print(f"TCPPlayer: Send error: {e}")
            self.connect_socket()

class QueueHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory:
            fs_event.set()

    def on_moved(self, event):
        if not event.is_directory:
            fs_event.set()

def get_device():
    """Detect and return the best available device for inference."""
    use_gpu = os.getenv('USE_GPU', 'true').lower() == 'true'

    if not use_gpu:
        print("GPU disabled via USE_GPU=false")
        return 'cpu'

    if torch.cuda.is_available():
        device = 'cuda'
        print(f"CUDA available: {torch.cuda.get_device_name(0)}")
        print(f"CUDA version: {torch.version.cuda}")
        return device
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        print("MPS (Apple Silicon) available")
        return 'mps'
    else:
        print("No GPU available, falling back to CPU")
        return 'cpu'

def initialize_pipeline():
    global pipeline
    print("Initializing Kokoro Pipeline...")

    device = get_device()
    print(f"Using device: {device}")

    # Initialize pipeline
    pipeline = KPipeline(lang_code=LANG_CODE)

    # Move model to GPU if available
    if device == 'cuda':
        try:
            pipeline.model = pipeline.model.cuda()
            print("Model successfully moved to CUDA")
            # Print GPU memory info
            if torch.cuda.is_available():
                print(f"GPU Memory Allocated: {torch.cuda.memory_allocated(0) / 1024**2:.2f} MB")
                print(f"GPU Memory Reserved: {torch.cuda.memory_reserved(0) / 1024**2:.2f} MB")
        except Exception as e:
            print(f"Warning: Failed to move model to CUDA: {e}")
            print("Falling back to CPU")
    elif device == 'mps':
        try:
            pipeline.model = pipeline.model.to(torch.device('mps'))
            print("Model successfully moved to MPS")
        except Exception as e:
            print(f"Warning: Failed to move model to MPS: {e}")
            print("Falling back to CPU")

    print("Kokoro Pipeline Initialized.")

def parse_segments(text):
    parts = re.split(r'(\{[a-zA-Z]+:[^}]+\})', text)
    segments = []
    for part in parts:
        if not part:
            continue
        match = re.match(r'\{([a-zA-Z]+):([^}]+)\}', part)
        if match:
            key = match.group(1).lower()
            value = match.group(2).strip()
            segments.append({'type': 'command', 'key': key, 'value': value})
        else:
            segments.append({'type': 'text', 'content': part})
    return segments

def get_oldest_file(directory):
    try:
        files = [f for f in os.listdir(directory) if os.path.isfile(os.path.join(directory, f))]
        if not files:
            return None
        files.sort(key=lambda x: os.path.getmtime(os.path.join(directory, x)))
        return files[0]
    except Exception:
        return None

def emit_status(state, text="", extra=None):
    msg = {"type": "status", "state": state}
    if text:
        msg["text"] = text
    if extra:
        msg.update(extra)
    print(json.dumps(msg), flush=True)

def emit_progress(job_id, percent, phase="generating", detail=""):
    msg = {"type": "progress", "jobId": job_id, "percent": percent, "phase": phase, "detail": detail}
    print(json.dumps(msg), flush=True)

def emit_mp3_complete(job_id):
    msg = {"type": "mp3_complete", "jobId": job_id}
    print(json.dumps(msg), flush=True)

def check_paused():
    """Block if playback is paused. Returns False if stopped."""
    while playback_state['paused'] and not playback_state['stopped']:
        pause_event.wait(timeout=0.2)
    return not playback_state['stopped']

def generator_worker():
    while True:
        try:
            task = task_queue.get()

            # Reset control state for new task
            playback_state['skip_current'] = False
            playback_state['restart_current'] = False
            playback_state['stopped'] = False

            # Determine if task is file path or memory object
            is_file = isinstance(task, str)
            source_id = task if is_file else "memory_task"
            text = ""
            mp3_mode = False
            mp3_path = None
            mp3_announce = False
            accumulated_audio = []

            if is_file:
                file_path = task
                if not os.path.exists(file_path):
                    print(f"Generator: File {file_path} not found. Skipping.")
                    task_queue.task_done()
                    continue

                print(f"Generator: Processing file {file_path}")
                try:
                    with open(file_path, 'r', encoding='utf-8') as f:
                        text = f.read().strip()
                except Exception as e:
                    print(f"Generator: Error reading file: {e}")
                    task_queue.task_done()
                    continue
            else:
                # Memory task
                print("Generator: Processing memory task")
                text = task.get('text', '')
                mp3_mode = task.get('mp3', False)
                mp3_path = task.get('mp3_path')
                mp3_announce = task.get('mp3announce', False)
                # Auto-generate mp3_path if mp3 mode but no path provided
                if mp3_mode and not mp3_path:
                    import datetime
                    ts = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
                    mp3_path = os.path.join(MP3_DIR, f'tts-{ts}.mp3')
                print(f"Generator: mp3_mode={mp3_mode}, mp3_path={mp3_path}, mp3_announce={mp3_announce}")
                # Prepend voice/speed tags if present in task object
                voice = task.get('voice')
                speed = task.get('speed')
                prefix = ""
                if voice: prefix += "{{voice:{}}} ".format(voice)
                if speed: prefix += "{{speed:{}}} ".format(speed)
                text = prefix + text

            if not text:
                mp3_info = {'path': mp3_path, 'audio': accumulated_audio, 'announce': mp3_announce} if mp3_mode else None
                audio_queue.put(AudioChunk(None, 0, 0, source_id, is_end_of_file=True, mp3_info=mp3_info))
                task_queue.task_done()
                continue

            current_voice = DEFAULT_VOICE
            current_speed = 1.0
            current_volume = 100

            segments = parse_segments(text)
            split_pattern = r'(?<=[\.\?\!])\s+|\n+'

            for seg in segments:
                if is_file and not os.path.exists(file_path):
                    print(f"Generator: File {file_path} removed. Stopping generation.")
                    break

                if seg['type'] == 'command':
                    k = seg['key']
                    v = seg['value']
                    if k == 'voice' and v in VALID_VOICES:
                        current_voice = v
                    elif k == 'speed':
                        try:
                            current_speed = float(v)
                        except: pass
                    elif k == 'volume':
                        try:
                            current_volume = int(v)
                        except: pass

                elif seg['type'] == 'text':
                    content = seg['content'].strip()
                    if not content: continue

                    try:
                        generator = pipeline(content, voice=current_voice, speed=current_speed, split_pattern=split_pattern)
                        for i, (gs, ps, audio) in enumerate(generator):
                            if is_file and not os.path.exists(file_path):
                                break
                            # Check playback controls
                            if playback_state['stopped'] or playback_state['skip_current']:
                                break
                            if not check_paused():
                                break

                            # Convert Tensor to Numpy if needed
                            if hasattr(audio, 'numpy'):
                                audio = audio.numpy()

                            if mp3_mode:
                                # Accumulate audio for MP3 file
                                accumulated_audio.append(audio)
                            else:
                                # Send to player for immediate playback
                                audio_queue.put(AudioChunk(audio, 24000, current_volume, source_id))
                    except Exception as e:
                        print(f"Generator: Error in pipeline: {e}")

            if is_file and os.path.exists(file_path):
                job_id = None  # file tasks don't have jobId
                mp3_info = {'path': mp3_path, 'audio': accumulated_audio, 'announce': mp3_announce} if mp3_mode else None
                audio_queue.put(AudioChunk(None, 0, 0, source_id, is_end_of_file=True, mp3_info=mp3_info))
            elif not is_file:
                job_id = task.get('jobId') if not is_file else None
                mp3_info = {'path': mp3_path, 'audio': accumulated_audio, 'announce': mp3_announce, 'jobId': job_id} if mp3_mode else None
                audio_queue.put(AudioChunk(None, 0, 0, source_id, is_end_of_file=True, mp3_info=mp3_info))

            # Track completed task for previous/next navigation
            completed_tasks.append(task)
            if len(completed_tasks) > 100:
                completed_tasks.pop(0)

            task_queue.task_done()
            print(f"Generator: Finished generating {source_id}")

            # Clean up GPU memory if using CUDA
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

        except Exception as e:
            print(f"Generator: Critical Error: {e}")
            time.sleep(1)

def player_worker():
    player = TCPPlayer()

    while True:
        try:
            chunk = audio_queue.get()

            # Check if source file still exists (only for file tasks)
            is_file = isinstance(chunk.source_id, str) and chunk.source_id.startswith("/")

            if is_file and not os.path.exists(chunk.source_id):
                print(f"Player: File {chunk.source_id} removed. Discarding chunk.")
                audio_queue.task_done()
                continue

            if chunk.is_end_of_file:
                # Handle MP3 file creation
                if chunk.mp3_info and chunk.mp3_info.get('path') and chunk.mp3_info.get('audio'):
                    mp3_path = chunk.mp3_info['path']
                    audio_list = chunk.mp3_info['audio']
                    job_id = chunk.mp3_info.get('jobId')

                    try:
                        # Ensure output directory exists
                        os.makedirs(os.path.dirname(mp3_path), exist_ok=True)

                        # Concatenate all audio chunks
                        full_audio = np.concatenate(audio_list)

                        # Save as WAV first, then convert to MP3
                        wav_path = mp3_path.replace('.mp3', '.wav') if mp3_path.endswith('.mp3') else mp3_path + '.wav'
                        sf.write(wav_path, full_audio, 24000)

                        # Convert WAV to MP3 using ffmpeg
                        try:
                            subprocess.run(['ffmpeg', '-y', '-i', wav_path, '-codec:a', 'libmp3lame', '-qscale:a', '2', mp3_path],
                                         check=True, capture_output=True)
                            os.remove(wav_path)  # Clean up WAV file
                            print(f"Player: MP3 file created at {mp3_path}")

                            # Signal MP3 completion for combine jobs
                            if job_id:
                                emit_mp3_complete(job_id)

                            # Announce file creation to speaker (only if mp3announce is True)
                            if chunk.mp3_info.get('announce', False):
                                announcement = f"MP3 file created at {os.path.basename(mp3_path)}"
                                announcement_task = {'text': announcement, 'voice': DEFAULT_VOICE, 'speed': 1.0, 'mp3': False}
                                task_queue.put(announcement_task)

                        except subprocess.CalledProcessError as e:
                            print(f"Player: Error converting to MP3: {e.stderr.decode()}")
                            # Fall back to WAV if MP3 conversion fails
                            print(f"Player: WAV file saved at {wav_path}")
                    except Exception as e:
                        print(f"Player: Error creating MP3 file: {e}")

                if is_file:
                    filename = os.path.basename(chunk.source_id)
                    done_path = os.path.join(DONE_DIR, filename)
                    try:
                        if os.path.exists(chunk.source_id):
                            shutil.move(chunk.source_id, done_path)
                            print(f"Player: Finished {filename} (Moved to DONE)")
                    except Exception as e:
                        print(f"Player: Error moving file: {e}")
                else:
                    print("Player: Finished memory task")

                audio_queue.task_done()
                continue

            # Play Audio via Stream
            if chunk.audio_data is not None:
                # Check playback controls before playing
                if playback_state['stopped'] or playback_state['skip_current']:
                    audio_queue.task_done()
                    continue
                if not check_paused():
                    audio_queue.task_done()
                    continue
                player.play_chunk(chunk.audio_data, chunk.volume)

            audio_queue.task_done()

        except Exception as e:
            print(f"Player: Critical Error: {e}")
            time.sleep(1)

def stdin_reader():
    print("Stdin Reader: Started")
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue

            try:
                data = json.loads(line)
                msg_type = data.get('type', '')

                if msg_type == 'control':
                    handle_control(data)
                elif msg_type == 'combine_mp3':
                    handle_combine_mp3(data)
                else:
                    # Regular speak task
                    print(f"Stdin Reader: Received task")
                    task_queue.put(data)
            except json.JSONDecodeError:
                print(f"Stdin Reader: Invalid JSON received: {line}")
        except Exception as e:
            print(f"Stdin Reader: Error: {e}")
            time.sleep(1)

def handle_control(data):
    command = data.get('command', '')
    print(f"Control: Received command '{command}'")

    if command == 'pause':
        playback_state['paused'] = True
        pause_event.clear()
        print("Control: Playback paused")
    elif command == 'resume':
        playback_state['paused'] = False
        pause_event.set()
        print("Control: Playback resumed")
    elif command == 'stop':
        playback_state['stopped'] = True
        playback_state['paused'] = False
        pause_event.set()  # Unblock if paused
        # Drain queues
        while not task_queue.empty():
            try:
                task_queue.get_nowait()
                task_queue.task_done()
            except queue.Empty:
                break
        while not audio_queue.empty():
            try:
                audio_queue.get_nowait()
                audio_queue.task_done()
            except queue.Empty:
                break
        print("Control: Playback stopped, queues cleared")
    elif command == 'restart':
        playback_state['restart_current'] = True
        playback_state['skip_current'] = True
        print("Control: Restarting current item")
    elif command == 'next':
        playback_state['skip_current'] = True
        print("Control: Skipping to next item")
    elif command == 'previous':
        if len(completed_tasks) >= 2:
            prev_task = completed_tasks[-2]
            task_queue.put(prev_task)
            playback_state['skip_current'] = True
            print("Control: Rewinding to previous item")
        else:
            print("Control: No previous item available")
    elif command == 'start_at':
        # This will be handled by the generator - set index for next generation
        idx = data.get('index', 0)
        print(f"Control: Start at sentence index {idx} (next task)")

def handle_combine_mp3(data):
    """Combine multiple MP3 part files into a single output MP3."""
    job_id = data.get('jobId', 'unknown')
    part_paths = data.get('partPaths', [])
    output_path = data.get('outputPath', '')
    cleanup = data.get('cleanupParts', True)

    print(f"Combine: Merging {len(part_paths)} parts into {output_path}")

    try:
        # Create ffmpeg concat list file
        concat_list_path = output_path.replace('.mp3', '_concat.txt')
        with open(concat_list_path, 'w') as f:
            for p in part_paths:
                f.write(f"file '{p}'\n")

        # Combine using ffmpeg concat demuxer
        subprocess.run(
            ['ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', concat_list_path, '-codec:a', 'copy', output_path],
            check=True, capture_output=True
        )
        os.remove(concat_list_path)

        # Clean up part files if requested
        if cleanup:
            for p in part_paths:
                if os.path.exists(p):
                    os.remove(p)

        print(f"Combine: Successfully created {output_path}")

        # Emit completion
        result = {"type": "status", "state": "combine_complete", "jobId": job_id, "outputPath": output_path}
        print(json.dumps(result), flush=True)

    except subprocess.CalledProcessError as e:
        print(f"Combine: ffmpeg error: {e.stderr.decode()}")
        error_msg = {"type": "error", "message": f"MP3 combine failed: {e.stderr.decode()}", "jobId": job_id}
        print(json.dumps(error_msg), flush=True)
    except Exception as e:
        print(f"Combine: Error: {e}")
        error_msg = {"type": "error", "message": f"MP3 combine failed: {str(e)}", "jobId": job_id}
        print(json.dumps(error_msg), flush=True)

def main():
    print("Starting TTS Kokoro Processor (Hybrid Mode)...")

    os.makedirs(TODO_DIR, exist_ok=True)
    os.makedirs(WORKING_DIR, exist_ok=True)
    os.makedirs(DONE_DIR, exist_ok=True)
    os.makedirs(MP3_DIR, exist_ok=True)

    initialize_pipeline()

    threading.Thread(target=generator_worker, daemon=True).start()
    threading.Thread(target=player_worker, daemon=True).start()
    threading.Thread(target=stdin_reader, daemon=True).start()

    event_handler = QueueHandler()
    observer = Observer()
    observer.schedule(event_handler, TODO_DIR, recursive=False)
    observer.start()
    print(f"Monitoring {TODO_DIR} and Stdin...")

    # Recover files
    for f in sorted(os.listdir(WORKING_DIR), key=lambda x: os.path.getmtime(os.path.join(WORKING_DIR, x))):
        path = os.path.join(WORKING_DIR, f)
        if os.path.isfile(path):
            print(f"Recovering file from WORKING: {f}")
            task_queue.put(path)

    try:
        while True:
            todo_file = get_oldest_file(TODO_DIR)
            if todo_file:
                src = os.path.join(TODO_DIR, todo_file)
                dst = os.path.join(WORKING_DIR, todo_file)
                try:
                    print(f"Orchestrator: Moving {todo_file} to WORKING")
                    shutil.move(src, dst)
                    task_queue.put(dst)
                    continue
                except Exception as e:
                    print(f"Error moving file: {e}")
                    time.sleep(1)

            fs_event.wait(timeout=1.0)
            fs_event.clear()

    except KeyboardInterrupt:
        print("Stopping...")
        observer.stop()
        observer.join()

if __name__ == "__main__":
    main()
