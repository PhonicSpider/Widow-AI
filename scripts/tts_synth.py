#!/usr/bin/env python3
"""
tts_synth.py -- Synthesis daemon.
Reads text lines from stdin, synthesises each with edge-tts,
writes the MP3 to a temp file, then prints READY:<path>.
Runs as a persistent process; exits cleanly on EXIT or EOF.
"""
import sys
import asyncio
import tempfile
import os
import edge_tts

# ============================================================
# CONFIGURATION
# ============================================================

VOICE  = "en-US-AriaNeural"  # edge-tts voice name
RATE   = "+0%"               # speech rate delta  e.g. "+10%" faster, "-5%" slower
PITCH  = "+0Hz"              # pitch delta        e.g. "+50Hz" higher, "-25Hz" lower
VOLUME = "+0%"               # volume delta       e.g. "+20%" louder


async def synth(text: str) -> str:
    """Synthesise *text* and return the absolute path to the temp MP3 file."""
    fd, path = tempfile.mkstemp(suffix='.mp3')
    os.close(fd)  # close OS fd so other processes can open the file
    communicate = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH, volume=VOLUME)
    mp3 = b""
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            mp3 += chunk["data"]
    with open(path, 'wb') as f:
        f.write(mp3)
    return path


def main():
    for raw_line in sys.stdin.buffer:
        text = raw_line.decode('utf-8', errors='ignore').strip()
        if not text or text == 'EXIT':
            break
        try:
            path = asyncio.run(synth(text))
            sys.stdout.write(f'READY:{path}\n')
        except Exception as e:
            print(f'[synth] error: {e}', file=sys.stderr)
            sys.stdout.write('ERROR\n')
        sys.stdout.flush()


if __name__ == '__main__':
    main()
