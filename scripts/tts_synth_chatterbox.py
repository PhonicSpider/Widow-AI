"""
tts_synth_chatterbox.py -- drop-in replacement for tts_synth.py
Replaces Edge TTS with local Chatterbox via Chatterbox TTS Server.

Uses the richer /tts endpoint (not the OpenAI-compat /v1/audio/speech) so
voice quality parameters (exaggeration, cfg_weight, temperature) are available.

Protocol (unchanged -- speaker.js expects exactly this):
  stdin:  one sentence per line
  stdout: READY:<filepath>  on success
          ERROR             on failure
"""

import sys
import os
import tempfile
import requests

# ============================================================
# CONFIGURATION
# ============================================================

CHATTERBOX_URL = os.environ.get('CHATTERBOX_URL', 'http://localhost:8004')
VOICE_FILE     = os.environ.get('CHATTERBOX_VOICE', 'widow.wav')
EXAGGERATION   = float(os.environ.get('CHATTERBOX_EXAGGERATION', '0.35'))
CFG_WEIGHT     = float(os.environ.get('CHATTERBOX_CFG_WEIGHT',   '0.6'))
TEMPERATURE    = float(os.environ.get('CHATTERBOX_TEMPERATURE',  '0.75'))
SPEED_FACTOR   = float(os.environ.get('CHATTERBOX_SPEED',        '1.0'))
TEMP_DIR       = tempfile.gettempdir()


def synthesise(text: str) -> str:
    payload = {
        'text':                text,
        'voice_mode':          'predefined',
        'predefined_voice_id': VOICE_FILE,
        'output_format':       'wav',
        'exaggeration':        EXAGGERATION,
        'cfg_weight':          CFG_WEIGHT,
        'temperature':         TEMPERATURE,
        'speed_factor':        SPEED_FACTOR,
        'split_text':          True,
    }

    response = requests.post(
        f'{CHATTERBOX_URL}/tts',
        json=payload,
        timeout=60,
    )
    response.raise_for_status()

    tmp = tempfile.NamedTemporaryFile(suffix='.wav', dir=TEMP_DIR, delete=False)
    tmp.write(response.content)
    tmp.close()
    return tmp.name


def main():
    sys.stdout.reconfigure(line_buffering=True)
    for line in sys.stdin:
        text = line.rstrip('\n').strip()
        if not text:
            continue
        try:
            path = synthesise(text)
            print(f'READY:{path}', flush=True)
        except Exception as e:
            print(f'[tts_synth_chatterbox] ERROR: {e}', file=sys.stderr, flush=True)
            print('ERROR', flush=True)


if __name__ == '__main__':
    main()
