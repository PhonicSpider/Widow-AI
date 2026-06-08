require('dotenv').config();

const Anthropic   = require('@anthropic-ai/sdk');
const path        = require('path');
const { exec }    = require('child_process');
const { promisify } = require('util');
const { readFile, writeFile, listDirectory } = require('../tools/files');

const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const execAsync = promisify(exec);

const RECLUSE_ROOT = path.resolve(__dirname, '../..');

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
  const abs = path.isAbsolute(filePath) ? filePath : path.join(RECLUSE_ROOT, filePath);
  const rel = path.relative(RECLUSE_ROOT, abs).replace(/\\/g, '/');
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
    description: 'Read the full contents of a file. Always read a Recluse core file before editing it.',
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
    description: 'Write or overwrite a file. For any Recluse core file a backup is automatically created at filename.backup.ext before saving. Creates parent directories if needed.',
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
        cwd:     { type: 'string', description: 'Working directory (defaults to Recluse root)' },
      },
      required: ['command'],
    },
  },
];

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
      const cwd = input.cwd || RECLUSE_ROOT;
      try {
        const { stdout, stderr } = await execAsync(input.command, {
          cwd,
          timeout: 30000,
          shell:   'powershell.exe',
        });
        return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
      } catch (err) {
        return { success: false, error: err.message, stdout: (err.stdout || '').trim(), stderr: (err.stderr || '').trim() };
      }
    }

    default:
      return { error: `Unknown coding tool: ${name}` };
  }
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt(rootStructure) {
  return `You are a coding specialist agent running inside Recluse — a Jarvis-style AI companion built with Electron, Node.js, and the Claude API. You were delegated this task by Recluse's main harness.

Stack: Electron v29, Node.js (CommonJS), Anthropic SDK, Three.js (orb), edge-tts + faster-whisper (Python), Win32 ctypes (window management), PowerShell on Windows 11.

Recluse root: ${RECLUSE_ROOT}

Key source files:
  main.js                   — Electron main process, window creation, IPC handlers
  preload.js                — contextBridge exposing APIs to renderer
  src/agents/harness.js     — main Claude harness, conversation history, tool-use loop
  src/agents/personality.js — Recluse's personality / system prompt
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

For general coding tasks (scripts, tools, utilities) unrelated to Recluse: help freely, write clean code, use the user's existing stack where relevant.
Only read RSM or other external project files if explicitly asked.

Return a clear, concise summary of what you did. Recluse's harness will speak this response aloud, so keep it natural-language friendly — no raw JSON dumps, no excessive markdown headers.

Current Recluse directory:
${JSON.stringify(rootStructure, null, 2)}`;
}

// ============================================================
// MAIN ENTRY — called by delegate_to_agent in tools/index.js
// ============================================================

async function run(task, context) {
  const rootStructure = listDirectory(RECLUSE_ROOT);

  const messages = [];
  let userContent = `Task: ${task}`;
  if (context) userContent += `\n\nContext: ${context}`;
  messages.push({ role: 'user', content: userContent });

  let finalResponse = '';

  try {
    while (true) {
      const response = await client.messages.create({
        model:      'claude-sonnet-4-6',
        max_tokens: 4096,
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
