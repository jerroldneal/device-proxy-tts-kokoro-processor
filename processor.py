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
from kokoro import KPipeline
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
import threading
import queue
import re
import sys
import json

# Configuration
DATA_DIR = "/app/data"
TODO_DIR = os.path.join(DATA_DIR, "todo")
WORKING_DIR = os.path.join(DATA_DIR, "working")
DONE_DIR = os.path.join(DATA_DIR, "done")
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

class AudioChunk:
    def __init__(self, audio_data, sample_rate, volume, source_id, is_end_of_file=False, mp3_info=None):
        self.audio_data = audio_data
        self.sample_rate = sample_rate
        self.volume = volume
        self.source_id = source_id
        self.is_end_of_file = is_end_of_file
        self.mp3_info = mp3_info  # Dict with mp3_path and accumulated audio

class PipePlayer:
    def __init__(self, pipe_path="/tmp/audio_pipe", sample_rate=24000, target_rate=48000):
        self.pipe_path = pipe_path
        self.sample_rate = sample_rate
        self.target_rate = target_rate
        self.pipe = None
        # Don't block init, connect on first write

    def connect_pipe(self):
        if self.pipe:
            try: self.pipe.close()
            except: pass
            self.pipe = None

        if not os.path.exists(self.pipe_path):
            # Wait for proxy to create it
            return False

        try:
            # Open for writing. This blocks until a reader is connected.
            # Since we are in a worker thread, blocking is acceptable but we should timeout?
            # Python open() doesn't support timeout.
            # We rely on the proxy being up.
            print(f"PipePlayer: Opening {self.pipe_path}...")
            self.pipe = open(self.pipe_path, 'wb')
            print("PipePlayer: Connected.")
            return True
        except Exception as e:
            print(f"PipePlayer: Failed to open pipe: {e}")
            self.pipe = None
            return False

    def play_chunk(self, audio_data, volume=100):
        if self.pipe is None:
            if not self.connect_pipe():
                # If we can't connect, we drop the chunk to avoid hanging forever?
                # Or we retry?
                time.sleep(0.1)
                return

        # Resample 24k -> 48k
        if self.target_rate == 48000 and self.sample_rate == 24000:
            # Linear interpolation
            x = np.arange(len(audio_data))
            x_new = np.arange(0, len(audio_data), 0.5)
            # Note: x_new might be slightly larger/smaller depending on float precision,
            # but np.interp handles it.
            # Actually, x_new length should be exactly 2x.
            # Let's use linspace for exactness?
            # No, arange is fine.
            audio_data = np.interp(x_new, x, audio_data)

        # Apply volume
        audio_data = audio_data * (volume / 100.0)

        # Clip
        audio_data = np.clip(audio_data, -1.0, 1.0)

        # Convert to Int16
        audio_int16 = (audio_data * 32767).astype(np.int16)

        try:
            self.pipe.write(audio_int16.tobytes())
            self.pipe.flush()
        except BrokenPipeError:
            print("PipePlayer: Broken pipe. Reconnecting...")
            self.connect_pipe()
        except Exception as e:
            print(f"PipePlayer: Write error: {e}")
            self.connect_pipe()

class QueueHandler(FileSystemEventHandler):
    def on_created(self, event):
        if not event.is_directory:
            fs_event.set()

    def on_moved(self, event):
        if not event.is_directory:
            fs_event.set()

def initialize_pipeline():
    global pipeline
    print("Initializing Kokoro Pipeline...")
    pipeline = KPipeline(lang_code=LANG_CODE)
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

def generator_worker():
    while True:
        try:
            task = task_queue.get()

            # Determine if task is file path or memory object
            is_file = isinstance(task, str)
            source_id = task if is_file else "memory_task"
            text = ""
            mp3_mode = False
            mp3_path = None
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
                # Prepend voice/speed tags if present in task object
                voice = task.get('voice')
                speed = task.get('speed')
                prefix = ""
                if voice: prefix += "{{voice:{}}} ".format(voice)
                if speed: prefix += "{{speed:{}}} ".format(speed)
                text = prefix + text

            if not text:
                mp3_info = {'path': mp3_path, 'audio': accumulated_audio} if mp3_mode else None
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
                mp3_info = {'path': mp3_path, 'audio': accumulated_audio} if mp3_mode else None
                audio_queue.put(AudioChunk(None, 0, 0, source_id, is_end_of_file=True, mp3_info=mp3_info))
            elif not is_file:
                mp3_info = {'path': mp3_path, 'audio': accumulated_audio} if mp3_mode else None
                audio_queue.put(AudioChunk(None, 0, 0, source_id, is_end_of_file=True, mp3_info=mp3_info))

            task_queue.task_done()
            print(f"Generator: Finished generating {source_id}")

        except Exception as e:
            print(f"Generator: Critical Error: {e}")
            time.sleep(1)

def player_worker():
    player = PipePlayer()

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

                    try:
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

                            # Announce file creation to speaker
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
                print(f"Stdin Reader: Received task")
                task_queue.put(data)
            except json.JSONDecodeError:
                print(f"Stdin Reader: Invalid JSON received: {line}")
        except Exception as e:
            print(f"Stdin Reader: Error: {e}")
            time.sleep(1)

def main():
    print("Starting TTS Kokoro Processor (Hybrid Mode)...")

    os.makedirs(TODO_DIR, exist_ok=True)
    os.makedirs(WORKING_DIR, exist_ok=True)
    os.makedirs(DONE_DIR, exist_ok=True)

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
