#!/usr/bin/env python3
"""
tts_play.py — Playback daemon.
Reads temp file paths from stdin, decodes each MP3 with PyAV,
plays it via sounddevice, deletes the file, then prints DONE.
Runs as a persistent process; exits cleanly on EXIT or EOF.
"""
import sys
import os
import io
import numpy as np
import sounddevice as sd
import av


def play(path: str) -> None:
    """Decode and play the MP3 at *path*, then delete it."""
    with open(path, 'rb') as f:
        data = f.read()

    container = av.open(io.BytesIO(data))
    audio_stream = next(s for s in container.streams if s.type == 'audio')
    rate = audio_stream.sample_rate

    frames = []
    for frame in container.decode(audio_stream):
        arr = frame.to_ndarray()
        if arr.dtype == np.int16:
            frames.append(arr.astype(np.float32) / 32768.0)
        elif arr.dtype == np.int32:
            frames.append(arr.astype(np.float32) / 2147483648.0)
        else:
            frames.append(arr.astype(np.float32))

    container.close()

    try:
        os.unlink(path)
    except OSError:
        pass

    if not frames:
        return

    audio = np.concatenate(frames, axis=1).T  # (samples, channels)
    sd.play(audio, rate)
    sd.wait()


def main():
    for raw_line in sys.stdin.buffer:
        path = raw_line.decode('utf-8', errors='ignore').strip()
        if not path or path == 'EXIT':
            break
        try:
            play(path)
        except Exception as e:
            print(f'[play] error: {e}', file=sys.stderr)
        sys.stdout.write('DONE\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
