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
    return { error: err.message, path: dirPath };
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

module.exports = { readFile, writeFile, listDirectory, moveFile, copyFile, deleteFile, readFileRange, strReplace, appendFile };
