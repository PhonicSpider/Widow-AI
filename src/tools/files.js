const fs   = require('fs');
const path = require('path');

const READ_MAX_BYTES = 80_000; // ~20k tokens — keeps single reads under the rate-limit budget

function readFile(filePath) {
  try {
    const stat    = fs.statSync(filePath);
    const raw     = fs.readFileSync(filePath, 'utf8');
    const lines   = raw.split('\n').length;

    if (Buffer.byteLength(raw, 'utf8') > READ_MAX_BYTES) {
      const truncated = Buffer.from(raw).slice(0, READ_MAX_BYTES).toString('utf8');
      return {
        path:      filePath,
        content:   truncated,
        lines,
        truncated: true,
        totalBytes: stat.size,
        note: `File truncated to ${READ_MAX_BYTES} bytes (${stat.size} total). Read in chunks if you need the rest.`,
      };
    }

    return { path: filePath, content: raw, lines };
  } catch (err) {
    return { error: err.message, path: filePath };
  }
}

function writeFile(filePath, content) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    return { success: true, path: filePath, bytes: Buffer.byteLength(content, 'utf8') };
  } catch (err) {
    return { error: err.message, path: filePath };
  }
}

function listDirectory(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return {
      path: dirPath,
      entries: entries.map(e => ({
        name:      e.name,
        type:      e.isDirectory() ? 'dir' : 'file',
        size:      e.isFile() ? fs.statSync(path.join(dirPath, e.name)).size : undefined,
      })),
    };
  } catch (err) {
    console.error(`[listDirectory] ${err.code} — ${dirPath}: ${err.message}`);
    const hint =
      err.code === 'EACCES'  ? 'Access denied — Widow needs admin rights to read this folder. Try running Widow.exe as Administrator.' :
      err.code === 'ENOENT'  ? 'Folder not found — double-check the path is correct.' :
      err.code === 'ENOTDIR' ? 'That path is a file, not a folder.' :
      err.code === 'EPERM'   ? 'Operation not permitted — this folder is protected by Windows.' :
      null;
    return { error: `${err.code}: ${err.message}`, path: dirPath, ...(hint && { hint }) };
  }
}

function moveFile(fromPath, toPath) {
  try {
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.renameSync(fromPath, toPath);
    return { success: true, from: fromPath, to: toPath };
  } catch (err) {
    // renameSync fails across drives — fall back to copy+delete
    try {
      fs.copyFileSync(fromPath, toPath);
      fs.unlinkSync(fromPath);
      return { success: true, from: fromPath, to: toPath, method: 'copy+delete' };
    } catch (err2) {
      return { error: err2.message };
    }
  }
}

function copyFile(fromPath, toPath) {
  try {
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.copyFileSync(fromPath, toPath);
    return { success: true, from: fromPath, to: toPath };
  } catch (err) {
    return { error: err.message };
  }
}

function deleteFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
    return { success: true, deleted: filePath };
  } catch (err) {
    return { error: err.message, path: filePath };
  }
}

function readFileRange(filePath, startLine, endLine) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines   = content.split('\n');
    const total   = lines.length;
    const start   = Math.max(1, startLine || 1);
    const end     = Math.min(total, endLine || total);
    const slice   = lines.slice(start - 1, end).join('\n');
    return {
      path:       filePath,
      content:    slice,
      startLine:  start,
      endLine:    end,
      totalLines: total,
      note: end < total ? `Showing lines ${start}-${end} of ${total}. Use read_file_range with startLine=${end + 1} to read more.` : undefined,
    };
  } catch (err) {
    return { error: err.message, path: filePath };
  }
}

function strReplace(filePath, oldStr, newStr) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const count   = content.split(oldStr).length - 1;
    if (count === 0) return { error: 'oldStr not found in file. Check spacing, indentation, and line endings.', path: filePath };
    if (count > 1)  return { error: `oldStr found ${count} times — must be unique. Add more surrounding context to make it unique.`, path: filePath };
    const updated = content.replace(oldStr, newStr);
    fs.writeFileSync(filePath, updated, 'utf8');
    return { success: true, path: filePath, replacements: 1 };
  } catch (err) {
    return { error: err.message, path: filePath };
  }
}

function appendFile(filePath, content) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, content, 'utf8');
    return { success: true, path: filePath, appendedBytes: Buffer.byteLength(content, 'utf8') };
  } catch (err) {
    return { error: err.message, path: filePath };
  }
}

// Search for files or folders by name across one or more root paths.
// Uses PowerShell Get-ChildItem so it gracefully skips inaccessible folders
// instead of aborting on the first permission error.
function searchPath(name, { roots = ['C:\\', 'D:\\'], type = 'any', maxResults = 20 } = {}) {
  const { spawn } = require('child_process');

  const typeFilter =
    type === 'file'   ? ' -File'      :
    type === 'folder' ? ' -Directory' : '';

  const rootList = roots.map(r => `'${r.replace(/'/g, "''")}'`).join(',');

  const script = `
$roots   = @(${rootList})
$results = @()
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  $found = Get-ChildItem -Path $root -Recurse${typeFilter} -Filter '${name.replace(/'/g, "''")}' \`
             -ErrorAction SilentlyContinue |
           Select-Object -ExpandProperty FullName -First ${maxResults}
  if ($found) { $results += $found }
  if ($results.Count -ge ${maxResults}) { break }
}
$results | Select-Object -First ${maxResults} | ConvertTo-Json -Compress
`;

  return new Promise((resolve) => {
    const proc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ error: 'timeout', matches: [] });
    }, 30_000);

    proc.on('close', () => {
      clearTimeout(timer);
      try {
        const raw = out.trim();
        if (!raw) return resolve({ matches: [], note: `No matches found for "${name}" in ${roots.join(', ')}` });
        const parsed = JSON.parse(raw);
        const matches = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
        resolve({ matches, searched: roots });
      } catch (err) {
        resolve({ error: err.message, matches: [] });
      }
    });
    proc.on('error', err => {
      clearTimeout(timer);
      resolve({ error: err.message, matches: [] });
    });
  });
}

// Download a file from a URL or save a data URL (base64) to disk.
// Handles http, https, and data: URLs. Follows redirects automatically.
async function downloadFile(url, destPath, { timeoutMs = 60_000 } = {}) {
  try {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });

    // data: URL — decode base64 and write binary directly
    if (url.startsWith('data:')) {
      const match = url.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) return { error: 'Invalid data URL format' };
      const buffer = Buffer.from(match[2], 'base64');
      fs.writeFileSync(destPath, buffer);
      return { success: true, path: destPath, bytes: buffer.length, mimeType: match[1] };
    }

    // http/https URL — stream to file with redirect following (up to 5 hops)
    return new Promise((resolve) => {
      let hops = 0;

      function fetch(currentUrl) {
        const lib = currentUrl.startsWith('https') ? require('https') : require('http');
        const req = lib.get(currentUrl, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            if (++hops > 5) return resolve({ error: 'Too many redirects' });
            return fetch(res.headers.location);
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            res.resume();
            return resolve({ error: `HTTP ${res.statusCode}` });
          }
          const stream = fs.createWriteStream(destPath);
          res.pipe(stream);
          stream.on('finish', () => {
            const bytes = fs.statSync(destPath).size;
            resolve({ success: true, path: destPath, bytes, status: res.statusCode });
          });
          stream.on('error', err => resolve({ error: err.message }));
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ error: `timeout after ${timeoutMs}ms` }); });
        req.on('error', err => resolve({ error: err.message }));
      }

      fetch(url);
    });

  } catch (err) {
    return { error: err.message, path: destPath };
  }
}

module.exports = { readFile, writeFile, downloadFile, listDirectory, moveFile, copyFile, deleteFile, readFileRange, strReplace, appendFile, searchPath };
