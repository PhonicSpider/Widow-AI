require('dotenv').config();

const Anthropic   = require('@anthropic-ai/sdk');
const path        = require('path');
const { spawn }   = require('child_process');
const { readFile, writeFile, listDirectory } = require('../tools/files');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// CONFIGURATION
// ============================================================

const CFG = {
  // Model used for coding sub-agent turns
  model:          'claude-sonnet-4-6',
  maxTokens:      4096,

  // Shell execution timeout (ms) — applies to each shell_exec call
  shellTimeoutMs: 30_000,
};

const WIDOW_ROOT = path.resolve(__dirname, '../..');

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
  const ext  = path.extname(filePath);
  const base = filePath.slice(0, -ext.length);
  return `${base}.backup${ext}`;
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
    description: 'Write or overwrite a file. For any Widow core file a backup is automatically created at filename.backup.ext before saving. Creates parent directories if needed.',
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
      // Auto-backup before overwriting any core file
      if (isCoreFile(input.path)) {
        const existing = readFile(input.path);
        if (!existing.error) {
          const bak = backupPath(input.path);
          writeFile(bak, existing.content);
          console.log(`[Coding] Backed up ${input.path} → ${bak}`);
        }
      }
      return writeFile(input.path, input.content);
    }

    case 'shell_exec': {
      const cwd = input.cwd || WIDOW_ROOT;
      return shellExec(input.command, cwd);
    }

    default:
      return { error: `Unknown coding tool: ${name}` };
  }
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt(rootStructure) {
  return `You are a coding specialist agent running inside Widow — a Jarvis-style AI companion built with Electron, Node.js, and the Claude API. You were delegated this task by Widow's main harness.

Stack: Electron v29, Node.js (CommonJS), Anthropic SDK, Three.js (orb), edge-tts + faster-whisper (Python), Win32 ctypes (window management), PowerShell on Windows 11.

Widow root: ${WIDOW_ROOT}

Key source files:
  main.js                   — Electron main process, window creation, IPC handlers
  preload.js                — contextBridge exposing APIs to renderer
  src/agents/harness.js     — main Claude harness, conversation history, tool-use loop
  src/agents/personality.js — Widow's personality / system prompt
  src/agents/coding.js      — you (this file)
  src/tools/index.js        — TOOL_DEFINITIONS + executeTool router
  src/tools/system.js       — OS tools: monitors, window snapping, app launch
  src/tools/files.js        — file I/O helpers
  src/tools/web.js          — web search
  renderer/js/main.js       — UI state machine and IPC listeners
  renderer/css/main.css     — ember/orb palette styles
  renderer/index.html       — UI structure, side panel, webview
  scripts/window_place.py   — Win32 window snap helper (Python + ctypes)
  scripts/tts_speak.py      — persistent TTS daemon
  memory/                   — persisted conversation history + summary

SELF-EDITING RULES:
1. Always read_file before editing any existing file.
2. write_file automatically backs up core files to filename.backup.ext — do not do it manually.
3. Never delete backup files.
4. After editing, confirm exactly what changed and where.

For general coding tasks (scripts, tools, utilities) unrelated to Widow: help freely, write clean code, use the user's existing stack where relevant.
Only read RSM or other external project files if explicitly asked.

Return a clear, concise summary of what you did. Widow's harness will speak this response aloud, so keep it natural-language friendly — no raw JSON dumps, no excessive markdown headers.

Current Widow directory:
${JSON.stringify(rootStructure, null, 2)}`;
}

// ============================================================
// MAIN ENTRY — called by delegate_to_agent in tools/index.js
// ============================================================

async function run(task, context) {
  const rootStructure = listDirectory(WIDOW_ROOT);

  const messages = [];
  let userContent = `Task: ${task}`;
  if (context) userContent += `\n\nContext: ${context}`;
  messages.push({ role: 'user', content: userContent });

  let finalResponse = '';

  try {
    while (true) {
      const response = await client.messages.create({
        model:      CFG.model,
        max_tokens: CFG.maxTokens,
        system:     buildSystemPrompt(rootStructure),
        tools:      CODING_TOOL_DEFINITIONS,
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults   = await Promise.all(
          toolUseBlocks.map(async (block) => {
            console.log(`[Coding tool] ${block.name}`, block.input);
            const result = await executeCodingTool(block.name, block.input);
            return {
              type:        'tool_result',
              tool_use_id: block.id,
              content:     JSON.stringify(result),
            };
          })
        );

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      finalResponse = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('');
      break;
    }

    return { success: true, result: finalResponse };

  } catch (err) {
    console.error('[Coding agent] Error:', err);
    return { success: false, error: err.message };
  }
}

module.exports = { run };
