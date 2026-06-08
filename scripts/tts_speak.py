#!/usr/bin/env python3
import sys
import asyncio
import io
import numpy as np
import sounddevice as sd
import av
import edge_tts

# Voice options -- swap VOICE to audition:
#   en-US-AriaNeural     expressive American female (most personality)
#   en-US-JennyNeural    friendly, clear American female
#   en-GB-LibbyNeural    British female, elegant AI feel
#   en-GB-MaisieNeural   younger British female
#   en-AU-NatashaNeural  Australian female, distinctive
#   en-US-AndrewNeural   younger American male
VOICE = "en-US-AriaNeural"

async def speak(text):
    communicate = edge_tts.Communicate(text, VOICE)
    mp3 = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3 += chunk["data"]

    if not mp3:
        return

    container = av.open(io.BytesIO(mp3))
    audio_stream = next(s for s in container.streams if s.type == 'audio')
    rate = audio_stream.sample_rate

    frames = []
    for frame in container.decode(audio_stream):
        arr = frame.to_ndarray()
        if arr.dtype == np.float32 or arr.dtype == np.float64:
            frames.append(arr.astype(np.float32))
        elif arr.dtype == np.int16:
            frames.append(arr.astype(np.float32) / 32768.0)
        elif arr.dtype == np.int32:
            frames.append(arr.astype(np.float32) / 2147483648.0)
        else:
            frames.append(arr.astype(np.float32))

    if not frames:
        return

    audio = np.concatenate(frames, axis=1).T  # (samples, channels)
    sd.play(audio, rate)
    sd.wait()

def main():
    # Persistent daemon: stay alive between calls so the next speak() skips spawn + import overhead.
    # Reads one text line per speak request, prints DONE when audio finishes.
    for raw_line in sys.stdin.buffer:
        text = raw_line.decode('utf-8', errors='ignore').strip()
        if not text or text == 'EXIT':
            break
        asyncio.run(speak(text))
        sys.stdout.write('DONE\n')
        sys.stdout.flush()

if __name__ == '__main__':
    main()
