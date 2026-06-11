'use strict';

const { spawn }      = require('child_process');
const path           = require('path');
const EventEmitter   = require('events');

// ============================================================
// CONFIGURATION
// ============================================================

const CFG = {
  python:      'D:\\Python\\python.exe',
  synthScript: path.join(__dirname, '../../scripts/tts_synth_chatterbox.py'),
  playScript:  path.join(__dirname, '../../scripts/tts_play.py'),
};

// ── Sentence extraction ────────────────────────────────────────────────────────
// Called from harness as tokens stream in. Returns complete sentences found in
// the buffer plus the leftover fragment that hasn't ended yet.
function extractSentences(buf) {
  const sentences = [];
  // Match the shortest sequence ending in .!? that is followed by whitespace or end.
  // The lookahead prevents splitting decimal numbers ("3.14") since "1" isn't whitespace.
  const re = /[^]*?[.!?]+(?=\s|$)/g;
  let lastIdx = 0, m;
  while ((m = re.exec(buf)) !== null) {
    const s = m[0].trim();
    // Ignore very short matches — catches abbreviations like "Mr." or "Dr."
    if (s.length >= 8) {
      sentences.push(s);
      lastIdx = re.lastIndex;
      // Advance past trailing whitespace so the next sentence starts cleanly
      while (lastIdx < buf.length && buf[lastIdx] === ' ') lastIdx++;
      re.lastIndex = lastIdx;
    }
  }
  return { sentences, remainder: buf.slice(lastIdx) };
}

// ── TTS Sanitizer ─────────────────────────────────────────────────────────────
// Cleans Claude's raw response text before synthesis.
// Goal: produce natural spoken English with no symbol noise.
function sanitizeForTTS(text) {
  let t = text;

  // ── STEP 1: Markdown formatting — strip silently ──────────────────────────
  t = t.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
  t = t.replace(/_{1,2}([^_]+)_{1,2}/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/```[\s\S]*?```/g, '');
  t = t.replace(/~~([^~]+)~~/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/^[\-\*_]{3,}\s*$/gm, '');
  t = t.replace(/^>\s*/gm, '');
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  t = t.replace(/<[^>]+>/g, '');

  // ── STEP 2: Decorative arrows and symbols — strip or convert ─────────────
  t = t.replace(/→|←|↑|↓|↔|⇒|⇐|⇔|▸|▶|◀|►/g, '');
  t = t.replace(/^[\•\·\‣\⁃\-]\s+/gm, '');
  t = t.replace(/\[[ xX]\]\s*/g, '');
  t = t.replace(/…/g, ', ');
  t = t.replace(/—|–/g, ', ');
  t = t.replace(/\|/g, ' ');

  // ── STEP 3: Currency and units — convert to spoken form ──────────────────
  t = t.replace(/\$(\d+)\.(\d{2})\b/g, (_, dollars, cents) =>
    `${dollars} dollar${dollars === '1' ? '' : 's'} and ${cents} cents`
  );
  t = t.replace(/\$(\d{1,3}(?:,\d{3})*|\d+)([KkMmBb])?\b/g, (_, num, suffix) => {
    const clean = num.replace(/,/g, '');
    const suffixMap = { k: ' thousand', K: ' thousand', m: ' million', M: ' million', b: ' billion', B: ' billion' };
    const spoken = suffix ? clean + (suffixMap[suffix] || '') : clean;
    return `${spoken} dollar${clean === '1' && !suffix ? '' : 's'}`;
  });
  t = t.replace(/(\d+(?:\.\d+)?)\s*%/g, '$1 percent');
  t = t.replace(/(\d+(?:\.\d+)?)\s*°C/g, '$1 degrees Celsius');
  t = t.replace(/(\d+(?:\.\d+)?)\s*°F/g, '$1 degrees Fahrenheit');
  t = t.replace(/(\d+(?:\.\d+)?)\s*°/g, '$1 degrees');
  t = t.replace(/(\d+(?:\.\d+)?)\s*GB\b/gi, '$1 gigabytes');
  t = t.replace(/(\d+(?:\.\d+)?)\s*MB\b/gi, '$1 megabytes');
  t = t.replace(/(\d+(?:\.\d+)?)\s*KB\b/gi, '$1 kilobytes');

  // ── STEP 4: Number formatting — fix misread patterns ─────────────────────
  t = t.replace(/\b(\d{1,3}),(\d{3})\b/g, '$1$2');
  t = t.replace(/\b(\d{1,3}),(\d{3}),(\d{3})\b/g, '$1$2$3');
  t = t.replace(/\bv(\d+\.\d+(?:\.\d+)?)\b/g, 'version $1');

  // ── STEP 5: Common symbols to spoken equivalents ──────────────────────────
  t = t.replace(/\s&\s/g, ' and ');
  t = t.replace(/(\d)\s*\+\s*(\d)/g, '$1 plus $2');
  t = t.replace(/(\d)\s*[×\*]\s*(\d)/g, '$1 times $2');
  t = t.replace(/\*/g, '');
  t = t.replace(/#(\d+)/g, 'number $1');
  t = t.replace(/#/g, '');
  t = t.replace(/\s@\s/g, ' at ');
  t = t.replace(/(\w)\/(\w)/g, '$1 or $2');

  // ── STEP 6: Whitespace cleanup ────────────────────────────────────────────
  t = t.replace(/  +/g, ' ');
  t = t.replace(/[,\s]{2,},/g, ',');
  t = t.split('\n').map(l => l.trim()).filter(l => l.length > 0).join(' ');
  t = t.trim();

  return t;
}

// ── Speaker ───────────────────────────────────────────────────────────────────
//
// Events:
//   'start' — first sentence begins playing
//   'done'  — audio queue drained (all sentences finished)
//
// Architecture:
//   Two persistent Python daemons run in parallel:
//     tts_synth.py  — accepts text lines, outputs READY:<path>
//     tts_play.py   — accepts file paths, outputs DONE
//
//   _pumpSynth() and _pumpPlay() are concurrent async loops.
//   While the play loop is blocked waiting for DONE (audio playing),
//   the synth loop is already synthesising the next sentence.
//   This gives zero gap between sentences after the first.

class Speaker extends EventEmitter {
  constructor() {
    super();
    this._synth = null;   // synthesis daemon process
    this._play  = null;   // playback daemon process

    this._pendingQueue = [];  // [ string ]  sentences waiting for synthesis
    this._readyQueue   = [];  // [ string ]  file paths ready to play

    this._synthWaiter = null; // { resolve, reject } for active synthesis call
    this._playWaiter  = null; // { resolve }          for active playback call

    this._synthRunning = false;
    this._playRunning  = false;

    this._gen     = 0;     // incremented on cancel — invalidates in-flight operations
    this._started = false; // true once 'start' has been emitted for the current batch
  }

  // ── Daemon lifecycle ─────────────────────────────────────────────────────────

  _spawnSynth() {
    const proc = spawn(CFG.python, ['-u', CFG.synthScript], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('READY:') && this._synthWaiter) {
          const w = this._synthWaiter;
          this._synthWaiter = null;
          w.resolve(line.slice(6));
        } else if (line === 'ERROR' && this._synthWaiter) {
          const w = this._synthWaiter;
          this._synthWaiter = null;
          w.reject(new Error('synthesis failed'));
        }
      }
    });
    proc.stderr.on('data', d => process.stderr.write(d));
    proc.on('exit', () => {
      if (this._synthWaiter) {
        const w = this._synthWaiter;
        this._synthWaiter = null;
        w.reject(new Error('synth process exited unexpectedly'));
      }
    });
    return proc;
  }

  _spawnPlay() {
    const proc = spawn(CFG.python, ['-u', CFG.playScript], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === 'DONE' && this._playWaiter) {
          const w = this._playWaiter;
          this._playWaiter = null;
          w.resolve();
        }
      }
    });
    proc.stderr.on('data', d => process.stderr.write(d));
    proc.on('exit', () => {
      if (this._playWaiter) {
        const w = this._playWaiter;
        this._playWaiter = null;
        w.resolve(); // treat exit as end of playback to avoid hangs
      }
    });
    return proc;
  }

  _ensureSynth() {
    if (!this._synth || this._synth.exitCode !== null) {
      this._synth = this._spawnSynth();
    }
  }

  _ensurePlay() {
    if (!this._play || this._play.exitCode !== null) {
      this._play = this._spawnPlay();
    }
  }

  // ── Low-level daemon calls ───────────────────────────────────────────────────

  _doSynth(text) {
    return new Promise((resolve, reject) => {
      this._synthWaiter = { resolve, reject };
      this._synth.stdin.write(text + '\n', 'utf8');
    });
  }

  _doPlay(filePath) {
    return new Promise((resolve) => {
      this._playWaiter = { resolve };
      this._play.stdin.write(filePath + '\n', 'utf8');
    });
  }

  // ── Queue pumps ──────────────────────────────────────────────────────────────

  async _pumpSynth(gen) {
    if (this._synthRunning) return;
    this._synthRunning = true;

    while (this._pendingQueue.length > 0 && gen === this._gen) {
      const text = this._pendingQueue.shift();
      try {
        this._ensureSynth();
        const filePath = await this._doSynth(text);

        if (gen !== this._gen) break; // cancelled mid-synthesis

        this._readyQueue.push(filePath);

        // Start or kick the play pump
        if (!this._playRunning) {
          this._pumpPlay(gen); // intentionally not awaited — runs concurrently
        }
      } catch (err) {
        if (gen === this._gen) {
          console.error('[TTS] Synthesis error:', err.message);
        }
      }
    }

    this._synthRunning = false;
    this._checkDone(gen);
  }

  async _pumpPlay(gen) {
    if (this._playRunning) return;
    this._playRunning = true;

    if (!this._started) {
      this._started = true;
      this.emit('start');
    }

    while (gen === this._gen) {
      // If ready queue is empty, wait for synth to produce something
      if (this._readyQueue.length === 0) {
        if (!this._synthRunning && this._pendingQueue.length === 0) break;
        await new Promise(r => setTimeout(r, 20));
        continue;
      }

      const filePath = this._readyQueue.shift();
      try {
        this._ensurePlay();
        await this._doPlay(filePath);
      } catch (err) {
        if (gen === this._gen) {
          console.error('[TTS] Playback error:', err.message);
        }
      }
    }

    this._playRunning = false;
    this._checkDone(gen);
  }

  _checkDone(gen) {
    if (gen !== this._gen) return;
    if (this._synthRunning || this._playRunning) return;
    if (this._pendingQueue.length > 0 || this._readyQueue.length > 0) return;
    this.emit('done');
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  // Enqueue a sentence for synthesis and playback.
  enqueue(text) {
    const cleaned = sanitizeForTTS(text);
    const safe = cleaned
      .replace(/[\uD800-\uDFFF]/g, '')  // strip lone surrogates
      .replace(/\n/g, ' ')
      .trim();
    if (!safe) return;

    this._pendingQueue.push(safe);
    this._pumpSynth(this._gen); // no-op if already running
  }

  // Cancel everything immediately and stop audio.
  cancel() {
    this._gen++;
    this._pendingQueue = [];
    this._readyQueue   = [];
    this._started      = false;
    this._synthRunning = false;
    this._playRunning  = false;
    // Reject any in-flight waiter so its pump exits cleanly
    if (this._synthWaiter) {
      const w = this._synthWaiter;
      this._synthWaiter = null;
      w.reject(new Error('cancelled'));
    }
    if (this._playWaiter) {
      const w = this._playWaiter;
      this._playWaiter = null;
      w.resolve(); // resolve (not reject) so play pump exits without noise
    }
    // Kill play process to cut audio output instantly
    if (this._play && this._play.exitCode === null) {
      try { this._play.kill(); } catch {}
      this._play = null;
    }
  }

  // Speak a single string to completion — used for one-shot lines like "Goodnight."
  speak(text) {
    this.cancel();
    if (!text) return Promise.resolve();
    return new Promise(resolve => {
      this.once('done', resolve);
      this.enqueue(text);
    });
  }

  stop() { this.cancel(); }

  // True while any synthesis or playback is in progress.
  // Used by main.js to decide if DORMANT should fire immediately on harness exit.
  get busy() {
    return this._synthRunning || this._playRunning ||
           this._pendingQueue.length > 0 || this._readyQueue.length > 0;
  }
}

const speaker = new Speaker();
speaker.extractSentences = extractSentences;
speaker.sanitizeForTTS   = sanitizeForTTS;  // exported for testing

module.exports = speaker;
