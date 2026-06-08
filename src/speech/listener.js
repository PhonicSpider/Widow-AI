const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');

class SpeechListener extends EventEmitter {
  constructor() {
    super();
    this._proc = null;
  }

  start() {
    const script = path.join(__dirname, '../../scripts/speech_recognizer.py');
    this._proc = spawn('D:\\Python\\python.exe', ['-u', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let buf = '';
    this._proc.stdout.on('data', chunk => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if      (line === 'READY')             { console.log('[Speech] ready'); }
        else if (line === 'WAKE:')             { this.emit('wake'); }
        else if (line === 'SPEECH_START:')     { this.emit('active'); }
        else if (line === 'SPEECH_CANCELLED:') { this.emit('cancel'); }
        else if (line === 'SLEEP:')            { this.emit('sleep'); }
        else if (line === 'TIMEOUT:')          { this.emit('timeout'); }
        else if (line.startsWith('TRANSCRIPT:')) {
          const text = line.slice('TRANSCRIPT:'.length).trim();
          if (text) this.emit('command', text);
        }
      }
    });

    this._proc.stderr.on('data', d => {
      d.toString().split('\n').forEach(line => {
        const msg = line.trim();
        if (msg) console.error('[Speech] STDERR:', msg);
      });
    });

    this._proc.on('exit', (code, signal) => {
      console.warn(`[Speech] process exited — code: ${code}, signal: ${signal}`);
      this._proc = null;
    });

    console.log('[Speech] spawning Python Vosk recognizer...');
  }

  stop() {
    if (this._proc) {
      this._proc.kill();
      this._proc = null;
    }
  }
}

module.exports = new SpeechListener();
