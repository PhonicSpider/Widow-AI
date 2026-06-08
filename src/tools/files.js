const fs   = require('fs');
const path = require('path');

function readFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines   = content.split('\n').length;
    return { path: filePath, content, lines };
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

module.exports = { readFile, writeFile, listDirectory, moveFile, copyFile, deleteFile };
