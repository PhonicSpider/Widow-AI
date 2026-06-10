const { spawn } = require('child_process');
const path      = require('path');

const PYTHON = 'D:\\Python\\python.exe';
const SCRIPT = path.join(__dirname, '../../scripts/desktop_control.py');
const TIMEOUT_MS = 15_000;

function run(...args) {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON, [SCRIPT, ...args.map(String)], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ ok: false, error: 'timeout' });
    }, TIMEOUT_MS);

    proc.on('exit', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(out.trim()));
      } catch {
        resolve({ ok: false, error: err.trim() || out.trim() || 'unknown error' });
      }
    });
  });
}

const click      = (x, y, button = 'left', clicks = 1) => run('click',    x, y, button, clicks);
const dblClick   = (x, y)                               => run('dblclick', x, y);
const rClick     = (x, y)                               => run('rclick',   x, y);
const moveMouse  = (x, y)                               => run('move',     x, y);
const scroll     = (x, y, amount)                       => run('scroll',   x, y, amount);
const drag       = (x1, y1, x2, y2)                     => run('drag',     x1, y1, x2, y2);
const typeText   = (text)                               => run('type',     text);
const keyPress   = (keys)                               => run('key',      keys);
const getCursor  = ()                                   => run('pos');
const screenshot = (region) => region
  ? run('screenshot', region.x, region.y, region.width, region.height)
  : run('screenshot');
const findClick  = (windowPattern, controlText)          => run('find_click', windowPattern, controlText);

module.exports = { click, dblClick, rClick, moveMouse, scroll, drag, typeText, keyPress, getCursor, screenshot, findClick };
