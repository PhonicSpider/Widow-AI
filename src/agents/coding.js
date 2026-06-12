require('dotenv').config();

const fs          = require('fs');
const path        = require('path');
const { spawn }   = require('child_process');
const { readFile, writeFile, listDirectory, readFileRange, strReplace, appendFile } = require('../tools/files');
const { createSubagentAdapter } = require('../lib/subagent');

// ============================================================
// CONFIGURATION
// ============================================================

const CFG = {
  shellTimeoutMs: 30_000,

  // Context compaction — keeps the last N tool-result batches at full size;
  // older ones are trimmed to stay under the 30k input tokens/min rate limit.
  compactKeepRecent: 2,   // only the 2 most recent results stay full — older get compacted
  compactMaxChars:   600, // matches harness history limit; enough to know what happened
};

const WIDOW_ROOT  = path.resolve(__dirname, '../..');
const BACKUP_DIR  = path.join(WIDOW_ROOT, '.widow-backups'); // single folder, no scatter

// Files that must be backed up before overwriting
const CORE_FILES = new Set([
  'main.js',
  'preload.js',
  'src/agents/harness.js',
  'src/agents/coding.js',
  'src/agents/personality.js',
  'src/tools/index.js',
  'src/tools/system.js',
  'src/tools/web.js',
  'src/tools/files.js',
  'renderer/js/main.js',
  'renderer/index.html',
  'renderer/css/main.css',
]);

function isCoreFile(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(WIDOW_ROOT, filePath);
  const rel = path.relative(WIDOW_ROOT, abs).replace(/\\/g, '/');
  return CORE_FILES.has(rel);
}

function backupPath(filePath) {
  // Mirror the relative path inside .widow-backups/ so structure is preserved.
  // e.g. src/agents/harness.js → .widow-backups/src/agents/harness.js
  // One backup per file (same path = always overwrites the previous one).
  const abs = path.isAbsolute(filePath) ? filePath : path.join(WIDOW_ROOT, filePath);
  const rel = path.relative(WIDOW_ROOT, abs);
  return path.join(BACKUP_DIR, rel);
}

// ============================================================
// TOOL DEFINITIONS (coding-agent scope only)
// ============================================================

const CODING_TOOL_DEFINITIONS = [
  {
    name: 'read_file',
    description: 'Read the full contents of a file. Always read a Widow core file before editing it.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite a file. For any Widow core file a backup is automatically created at References\\filename.backup.ext before saving. Creates parent directories if original file had it as needed.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Absolute path to write to' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'str_replace',
    description: 'The PRIMARY editing tool. Makes a surgical replacement in a file — finds oldStr and replaces it with newStr. oldStr must match exactly once in the file. Always prefer this over write_file when editing existing code — only rewrite the section that changes, not the whole file. Read the file first so your oldStr matches exactly.',
    input_schema: {
      type: 'object',
      properties: {
        path:   { type: 'string', description: 'Absolute path to the file' },
        oldStr: { type: 'string', description: 'The exact string to find and replace. Must be unique in the file. Include enough surrounding context (function signature, nearby lines) to make it unique.' },
        newStr: { type: 'string', description: 'The replacement string. Can be empty string to delete.' },
      },
      required: ['path', 'oldStr', 'newStr'],
    },
  },
  {
    name: 'read_file_range',
    description: 'Read only a range of lines from a file. Use when a file is large (over 300 lines) and you only need a specific section. Returns line numbers so you can navigate the file in chunks.',
    input_schema: {
      type: 'object',
      properties: {
        path:      { type: 'string', description: 'Absolute path to the file' },
        startLine: { type: 'integer', description: 'First line to read (1-indexed)' },
        endLine:   { type: 'integer', description: 'Last line to read (inclusive). Omit to read to end of file.' },
      },
      required: ['path', 'startLine'],
    },
  },
  {
    name: 'append_file',
    description: 'Append content to the end of an existing file without overwriting it. Use for the second and subsequent chunks when writing a large new file — write the first chunk with write_file, then append the rest.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Absolute path to append to' },
        content: { type: 'string', description: 'Content to append' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory' },
      },
      required: ['path'],
    },
  },
  {
    name: 'shell_exec',
    description: 'Run a PowerShell command. Use for running scripts, installing npm packages, checking git status, running tests, etc. 30-second timeout.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'PowerShell command to execute' },
        cwd:     { type: 'string', description: 'Working directory (defaults to Widow root)' },
      },
      required: ['command'],
    },
  },
];

// ============================================================
// SHELL EXEC — spawns powershell.exe with -NoProfile so the
// user's restricted profile script does not block execution.
// ============================================================

function shellExec(command, cwd, timeoutMs = CFG.shellTimeoutMs) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command', command,
    ], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: 'timeout after 30s', stdout: stdout.trim(), stderr: stderr.trim() });
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      // Treat exit code 0 as success; non-zero as failure but still return output
      if (code === 0) {
        resolve({ success: true, stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        resolve({ success: false, error: `exit code ${code}`, stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, error: err.message, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ============================================================
// TOOL EXECUTOR
// ============================================================

async function executeCodingTool(name, input) {
  switch (name) {

    case 'read_file':
      return readFile(input.path);

    case 'list_directory':
      return listDirectory(input.path);

    case 'write_file': {
      const abs = path.isAbsolute(input.path) ? input.path : path.join(WIDOW_ROOT, input.path);

      if (fs.existsSync(abs)) {
        const diskContent = fs.readFileSync(abs, 'utf8');
        const diskLen     = Buffer.byteLength(diskContent, 'utf8');
        const newLen      = Buffer.byteLength(input.content, 'utf8');

        // Truncation guard: if the proposed write would shrink the file by 40%+, the agent
        // is almost certainly working from a compacted/truncated memory stub. Block it.
        if (diskLen > 500 && newLen < diskLen * 0.6) {
          return {
            error:         'WRITE_BLOCKED',
            reason:        `Proposed content (${newLen} bytes) is less than 60% of the current file on disk (${diskLen} bytes). You are likely working from a stale or truncated version of this file in memory. Use read_file to fetch the current content, apply your edits to the full text, then write again.`,
            diskBytes:     diskLen,
            proposedBytes: newLen,
          };
        }

        // Core file: save a single backup (overwrites the previous backup each time)
        if (isCoreFile(input.path)) {
          const bak = backupPath(abs);
          writeFile(bak, diskContent);
          console.log(`[Coding] Backed up → ${bak}`);
        }
      }

      return writeFile(input.path, input.content);
    }

    case 'shell_exec': {
      const cwd = input.cwd || WIDOW_ROOT;
      return shellExec(input.command, cwd);
    }

    case 'str_replace':
      return strReplace(input.path, input.oldStr, input.newStr);

    case 'read_file_range':
      return readFileRange(input.path, input.startLine, input.endLine);

    case 'append_file':
      return appendFile(input.path, input.content);

    default:
      return { error: `Unknown coding tool: ${name}` };
  }
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt(rootStructure) {
  // Compact flat list — much cheaper than pretty-printed JSON
  const dirList = rootStructure.entries
    .map(e => `  ${e.type === 'dir' ? '[dir] ' : '[file]'} ${e.name}`)
    .join('\n');

  return `You are a coding specialist agent inside Widow — a Jarvis-style AI companion (Electron, Node.js, Claude API).

Root: ${WIDOW_ROOT}
Key files:
  main.js                  Electron main process, IPC handlers
  preload.js               contextBridge
  src/agents/harness.js    main Claude harness
  src/agents/personality.js Widow personality/system prompt
  src/agents/coding.js     you (this file)
  src/tools/index.js       tool router
  src/tools/files.js       file I/O (80 KB read cap)
  src/tools/web.js         web search
  renderer/js/main.js      UI state machine
  renderer/css/main.css    ember palette
  renderer/index.html      UI structure

FILE EDITING STRATEGY — follow this precisely:

READING FILES:
- Always read_file before editing any existing file. Never assume you know the current content.
- For files over 300 lines, use read_file_range to read in chunks (e.g. lines 1-150, then 151-300).
  The result tells you totalLines so you know how many chunks to read.
- After reading, note the exact indentation, quote style, and surrounding code before making changes.

EDITING EXISTING FILES — use str_replace (preferred):
- str_replace is your primary editing tool. It makes surgical replacements without touching anything else.
- oldStr must match exactly once — include enough surrounding lines (function signature, nearby comments)
  to make it unique. If the replacement fails with "found 0 times", your spacing or indentation is off —
  re-read that section of the file and copy exactly.
- Only fall back to write_file for existing files if you need to restructure more than 60% of the file.
- write_file is protected by a truncation guard: if your proposed content is less than 60% the size of
  the file on disk it returns WRITE_BLOCKED. Use read_file to get the full current content, apply your
  edits to the full text, then write again.

WRITING NEW FILES — use write_file + append_file for large files:
- Files under 250 lines: write in one write_file call.
- Files 250-600 lines: write first half with write_file, append second half with append_file.
- Files over 600 lines: write in three or more chunks — write_file for the first, append_file for each subsequent chunk.
- Always end each chunk at a logical boundary (end of a function, end of a block) — never mid-expression.

VERIFICATION — always verify after writing:
- After any write_file or append_file, call read_file_range on the last 20 lines to confirm the file
  ends correctly and is not truncated.
- After any str_replace, call read_file_range around the changed lines to confirm the replacement looks right.
- If the file ends abruptly or is missing closing braces, use append_file to add the missing content.

BACKUP:
- Core files are automatically backed up to .widow-backups/ before each overwrite (one backup per file).
- Never delete backup files.

NARRATION:
- Before each tool call write one short sentence (max 12 words) saying what you are about to do. Example: "Reading the harness to understand the current flow."
- End with a short plain-English summary (spoken aloud by Widow — no JSON or markdown headers).

Widow root contents:
${dirList}`;
}

// ============================================================
// CONTEXT COMPACTION
// Keeps the last N tool-result batches at full size; truncates
// older ones so the context window doesn't balloon with file dumps.
// ============================================================

function compactOldResults(messages) {
  const batchIndices = messages.reduce((acc, m, i) => {
    if (m.role === 'user' && Array.isArray(m.content) &&
        m.content.some(b => b.type === 'tool_result')) acc.push(i);
    return acc;
  }, []);

  if (batchIndices.length <= CFG.compactKeepRecent) return messages;

  const toCompact = new Set(batchIndices.slice(0, -CFG.compactKeepRecent));

  return messages.map((m, i) => {
    if (!toCompact.has(i)) return m;
    return {
      ...m,
      content: m.content.map(b => {
        if (b.type !== 'tool_result') return b;
        const raw = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        if (raw.length <= CFG.compactMaxChars) return b;
        return { ...b, content: raw.slice(0, CFG.compactMaxChars) + '\n[truncated — use read_file if you need the rest]' };
      }),
    };
  });
}

// ============================================================
// RATE LIMIT RETRY — waits for retry-after then retries up to 3x
// ============================================================

async function withRetry(fn, label, onProgress, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.status === 429 || err.message?.includes('429') || err.message?.includes('quota');
      if (isRateLimit && attempt < maxRetries) {
        const wait = parseInt(err.headers?.['retry-after'] || '60', 10);
        console.warn(`[Coding agent] rate limit — waiting ${wait}s (retry ${attempt + 1}/${maxRetries})`);
        onProgress?.(`⏳ rate limit hit — waiting ${wait}s before retry...`);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      throw err;
    }
  }
}

// ============================================================
// MAIN ENTRY — called by delegate_to_agent in tools/index.js
// ============================================================

async function run(task, context, onProgress) {
  const rootStructure = listDirectory(WIDOW_ROOT);

  const adapter     = createSubagentAdapter();
  const systemPrompt = buildSystemPrompt(rootStructure);

  const messages = [];
  let userContent = `Task: ${task}`;
  if (context) userContent += `\n\nContext: ${context}`;
  messages.push({ role: 'user', content: userContent });

  let finalResponse = '';
  const MAX_ITERATIONS = 15;
  let iterations = 0;

  try {
    while (iterations++ < MAX_ITERATIONS) {
      const response = await withRetry(
        () => adapter.complete(messages, systemPrompt, CODING_TOOL_DEFINITIONS),
        'coding', onProgress,
      );

      if (response.stop_reason === 'tool_use') {
        // Emit any narration text the model wrote before the tool calls
        const narration = response.content
          .filter(b => b.type === 'text').map(b => b.text).join('').trim();
        if (narration) onProgress?.(`» ${narration}`);

        messages.push({ role: 'assistant', content: response.content });

        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults   = [];

        for (const block of toolUseBlocks) {
          const preview = JSON.stringify(block.input).slice(0, 80);
          console.log(`[Coding tool] ${block.name}`, block.input);
          onProgress?.(`▸ coding: ${block.name} — ${preview}`);

          const result = await executeCodingTool(block.name, block.input);

          onProgress?.(`✓ coding: ${block.name} — done`);
          toolResults.push(adapter.toolResult(block.id, block.name, result));
        }

        messages.push({ role: 'user', content: toolResults });

        // Compact old tool results so the context window doesn't grow unboundedly
        const compacted = compactOldResults(messages);
        messages.splice(0, messages.length, ...compacted);

        continue;
      }

      finalResponse = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      // If the model ended without any summary text, ask it to provide one
      if (!finalResponse) {
        console.warn('[Coding agent] Empty final response — requesting summary');
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user',      content: [{ type: 'text', text: 'Please summarize what you just did in 1-3 sentences.' }] });
        continue;
      }

      break;
    }

    if (!finalResponse) {
      finalResponse = 'Task completed but I could not produce a summary.';
    }

    return { success: true, result: finalResponse };

  } catch (err) {
    console.error('[Coding agent] Error:', err);
    return { success: false, error: err.message };
  }
}

module.exports = { run };
