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
file_queue = queue.Queue()
audio_queue = queue.Queue()

# Event to wake up the file watcher
fs_event = threading.Event()

class AudioChunk:
    def __init__(self, audio_data, sample_rate, volume, source_file, is_end_of_file=False):
        self.audio_data = audio_data
        self.sample_rate = sample_rate
        self.volume = volume
        self.source_file = source_file
        self.is_end_of_file = is_end_of_file

class StreamPlayer:
    def __init__(self, sample_rate=24000):
        self.sample_rate = sample_rate
        self.process = None
        self.start_process()

    def start_process(self):
        if self.process:
            self.stop_process()

        # MPV command to read raw PCM float32 from stdin
        cmd = [
            "mpv",
            "--no-video",
            "--no-cache",
            "--no-terminal",
            "--demuxer=rawaudio",
            f"--demuxer-rawaudio-rate={self.sample_rate}",
            "--demuxer-rawaudio-channels=1",
            "--demuxer-rawaudio-format=floatle",
            # Loudnorm removed to reduce buffering latency
            # "--af=loudnorm=I=-16:TP=-1.5:LRA=11",
            "-"
        ]
        print("StreamPlayer: Starting MPV process...")
        try:
            self.process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        except Exception as e:
            print(f"StreamPlayer: Failed to start MPV: {e}")

    def stop_process(self):
        if self.process:
            try:
                self.process.stdin.close()
                self.process.terminate()
                self.process.wait(timeout=2)
            except:
                pass
            self.process = None

    def play_chunk(self, audio_data, volume=100):
        if not self.process or self.process.poll() is not None:
            print("StreamPlayer: MPV died, restarting...")
            self.start_process()

        try:
            # Apply volume scaling (0.0 to 1.0+)
            vol_factor = volume / 100.0
            scaled_data = audio_data * vol_factor

            # Ensure float32
            if scaled_data.dtype != np.float32:
                scaled_data = scaled_data.astype(np.float32)

            self.process.stdin.write(scaled_data.tobytes())
            self.process.stdin.flush()
        except BrokenPipeError:
            print("StreamPlayer: Broken pipe, restarting...")
            self.start_process()
        except Exception as e:
            print(f"StreamPlayer: Error writing to MPV: {e}")

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
            file_path = file_queue.get()

            if not os.path.exists(file_path):
                print(f"Generator: File {file_path} not found. Skipping.")
                file_queue.task_done()
                continue

            print(f"Generator: Processing {file_path}")

            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    text = f.read().strip()
            except Exception as e:
                print(f"Generator: Error reading file: {e}")
                file_queue.task_done()
                continue

            if not text:
                audio_queue.put(AudioChunk(None, 0, 0, file_path, is_end_of_file=True))
                file_queue.task_done()
                continue

            current_voice = DEFAULT_VOICE
            current_speed = 1.0
            current_volume = 100

            segments = parse_segments(text)
            split_pattern = r'(?<=[\.\?\!])\s+|\n+'

            for seg in segments:
                if not os.path.exists(file_path):
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
                            if not os.path.exists(file_path):
                                break

                            # Convert Tensor to Numpy if needed
                            if hasattr(audio, 'numpy'):
                                audio = audio.numpy()

                            audio_queue.put(AudioChunk(audio, 24000, current_volume, file_path))
                    except Exception as e:
                        print(f"Generator: Error in pipeline: {e}")

            if os.path.exists(file_path):
                audio_queue.put(AudioChunk(None, 0, 0, file_path, is_end_of_file=True))

            file_queue.task_done()
            print(f"Generator: Finished generating {file_path}")

        except Exception as e:
            print(f"Generator: Critical Error: {e}")
            time.sleep(1)

def player_worker():
    player = StreamPlayer()

    while True:
        try:
            chunk = audio_queue.get()

            if not os.path.exists(chunk.source_file):
                print(f"Player: File {chunk.source_file} removed. Discarding chunk.")
                # If we are skipping a file, we might want to restart the player to clear buffer
                # But for now, let's just drain the queue.
                audio_queue.task_done()
                continue

            if chunk.is_end_of_file:
                filename = os.path.basename(chunk.source_file)
                done_path = os.path.join(DONE_DIR, filename)
                try:
                    if os.path.exists(chunk.source_file):
                        shutil.move(chunk.source_file, done_path)
                        print(f"Player: Finished {filename} (Moved to DONE)")
                except Exception as e:
                    print(f"Player: Error moving file: {e}")

                audio_queue.task_done()
                continue

            # Play Audio via Stream
            if chunk.audio_data is not None:
                player.play_chunk(chunk.audio_data, chunk.volume)

            audio_queue.task_done()

        except Exception as e:
            print(f"Player: Critical Error: {e}")
            time.sleep(1)

def main():
    print("Starting TTS Kokoro Processor (Expert Stream Mode)...")

    os.makedirs(TODO_DIR, exist_ok=True)
    os.makedirs(WORKING_DIR, exist_ok=True)
    os.makedirs(DONE_DIR, exist_ok=True)

    initialize_pipeline()

    threading.Thread(target=generator_worker, daemon=True).start()
    threading.Thread(target=player_worker, daemon=True).start()

    event_handler = QueueHandler()
    observer = Observer()
    observer.schedule(event_handler, TODO_DIR, recursive=False)
    observer.start()
    print(f"Monitoring {TODO_DIR}...")

    # Recover files
    for f in sorted(os.listdir(WORKING_DIR), key=lambda x: os.path.getmtime(os.path.join(WORKING_DIR, x))):
        path = os.path.join(WORKING_DIR, f)
        if os.path.isfile(path):
            print(f"Recovering file from WORKING: {f}")
            file_queue.put(path)

    try:
        while True:
            todo_file = get_oldest_file(TODO_DIR)
            if todo_file:
                src = os.path.join(TODO_DIR, todo_file)
                dst = os.path.join(WORKING_DIR, todo_file)
                try:
                    print(f"Orchestrator: Moving {todo_file} to WORKING")
                    shutil.move(src, dst)
                    file_queue.put(dst)
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
