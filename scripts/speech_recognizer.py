#!/usr/bin/env python3
import sys
import os
import re
import json
import collections
import numpy as np
import sounddevice as sd
import vosk
from faster_whisper import WhisperModel

DEVICE_INDEX       = 6        # Voicemeeter Out B1 (sounddevice/MME index)
CAPTURE_RATE       = 48000    # Voicemeeter native rate
VOSK_RATE          = 16000    # Vosk expects 16kHz
CHANNELS           = 2        # stereo from Voicemeeter
CHUNK_FRAMES       = 4800     # 100ms at 48kHz

ENERGY_THRESHOLD   = 400      # RMS above this = speech (int16 scale)
SPEECH_ON_CHUNKS   = 3        # consecutive loud chunks to start capture (300ms)
SILENCE_END_CHUNKS = 15       # consecutive quiet chunks to end utterance (1.5s)
PRE_ROLL_CHUNKS    = 5        # chunks to prepend before speech start (500ms)

WHISPER_MODEL      = "base.en"   # downloads ~74MB on first run; try "small.en" for more accuracy

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR  = os.path.join(SCRIPT_DIR, '..', 'models')

WAKE_GRAMMAR  = '["recluse", "hey recluse", "[unk]"]'
SLEEP_PHRASES = ['goodnight recluse', 'good night recluse', 'goodbye recluse']

def downsample(data):
    arr  = np.frombuffer(data, dtype=np.int16).reshape(-1, 2)
    mono = ((arr[:, 0].astype(np.int32) + arr[:, 1].astype(np.int32)) >> 1).astype(np.int16)
    return mono[::3]

def make_wake_rec(model):
    return vosk.KaldiRecognizer(model, VOSK_RATE, WAKE_GRAMMAR)

def main():
    vosk.SetLogLevel(-1)

    # Vosk — wake word only
    vosk_candidates = ['vosk-model-en-us-0.22-lgraph', 'vosk-model-small-en-us-0.15']
    vosk_path = next(
        (os.path.join(MODELS_DIR, m) for m in vosk_candidates
         if os.path.isdir(os.path.join(MODELS_DIR, m))), None
    )
    if vosk_path is None:
        print("ERROR: No Vosk model found in models/", file=sys.stderr)
        sys.exit(1)
    vosk_model = vosk.Model(vosk_path)
    wake_rec   = make_wake_rec(vosk_model)
    print(f"Wake model: {os.path.basename(vosk_path)}", file=sys.stderr, flush=True)

    # faster-whisper — command transcription
    print(f"Loading Whisper ({WHISPER_MODEL})...", file=sys.stderr, flush=True)
    whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    print("Whisper ready.", file=sys.stderr, flush=True)

    mode = 'passive'

    # Session VAD state
    pre_roll      = collections.deque(maxlen=PRE_ROLL_CHUNKS)
    speech_buf    = []
    above_count   = 0
    silence_count = 0
    capturing     = False
    notified      = False   # whether SPEECH_START: has been sent for current utterance

    print("READY", flush=True)

    try:
        with sd.RawInputStream(
            device=DEVICE_INDEX,
            samplerate=CAPTURE_RATE,
            channels=CHANNELS,
            dtype='int16',
            blocksize=CHUNK_FRAMES,
        ) as stream:
            while True:
                raw, _ = stream.read(CHUNK_FRAMES)
                mono16k = downsample(bytes(raw))   # int16 ndarray at 16kHz mono

                if mode == 'passive':
                    # Grammar-constrained Vosk: lightweight, accurate for "recluse"
                    if wake_rec.AcceptWaveform(mono16k.tobytes()):
                        result = json.loads(wake_rec.Result())
                        if 'recluse' in result.get('text', ''):
                            print("WAKE:", flush=True)
                            mode = 'session'
                            pre_roll.clear()
                            speech_buf    = []
                            above_count   = 0
                            silence_count = 0
                            capturing     = False
                            notified      = False

                elif mode == 'session':
                    rms = np.sqrt(np.mean(mono16k.astype(np.float32) ** 2))

                    if rms > ENERGY_THRESHOLD:
                        above_count   += 1
                        silence_count  = 0

                        if not capturing:
                            if above_count >= SPEECH_ON_CHUNKS:
                                # Speech confirmed — start buffering with pre-roll
                                capturing  = True
                                speech_buf = list(pre_roll)
                                if not notified:
                                    notified = True
                                    print("SPEECH_START:", flush=True)
                            else:
                                pre_roll.append(mono16k)

                        if capturing:
                            speech_buf.append(mono16k)

                    else:
                        above_count = 0

                        if capturing:
                            silence_count += 1
                            speech_buf.append(mono16k)

                            if silence_count >= SILENCE_END_CHUNKS:
                                # Utterance ended — transcribe with Whisper
                                capturing     = False
                                notified      = False
                                silence_count = 0

                                audio = np.concatenate(speech_buf).astype(np.float32) / 32768.0
                                speech_buf = []

                                segments, _ = whisper.transcribe(
                                    audio, language="en", beam_size=5, vad_filter=True
                                )
                                text = ' '.join(s.text for s in segments).strip().lower()
                                # Strip punctuation for reliable keyword matching
                                text_clean = re.sub(r'[^\w\s]', '', text)

                                if text_clean:
                                    is_sleep = (
                                        'recluse' in text_clean and
                                        any(w in text_clean for w in ['goodnight', 'good night', 'goodbye', 'good bye'])
                                    )
                                    if is_sleep:
                                        print("SLEEP:", flush=True)
                                        mode     = 'passive'
                                        wake_rec = make_wake_rec(vosk_model)
                                    else:
                                        print(f"TRANSCRIPT:{text}", flush=True)
                                else:
                                    # Energy trigger but no speech found — reset UI
                                    print("SPEECH_CANCELLED:", flush=True)
                        else:
                            pre_roll.append(mono16k)

    except KeyboardInterrupt:
        pass

if __name__ == '__main__':
    main()
