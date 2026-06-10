# Recluse — Implementation Prompt for Claude Code
# Two features: model-agnostic harness + Chatterbox TTS
# Hand this entire file to Claude Code in VS Code.

---

## CONTEXT

Recluse is a Jarvis-style personal AI desktop assistant built with Electron and Node.js.
The AI core is Claude via the Anthropic API. The project lives at github.com/PhonicSpider/Recluse.

Two changes are being made in this session:

1. Make the AI harness model-agnostic (support Anthropic, Gemini, Ollama, DeepSeek)
2. Replace Edge TTS with local Chatterbox TTS for a natural-sounding voice

Do not change anything not explicitly listed below. Do not refactor unrelated files.

---

## CHANGE 1 — MODEL-AGNOSTIC HARNESS

### File to replace: `src/agents/harness.js`

The current harness is hardcoded to the Anthropic SDK. Replace it with the version below.
The external behaviour is identical — `chat(userMessage, { onPanel, onSentence })` and
`clearHistory()` are the only exports and their signatures do not change.

The only internal change is that the Anthropic SDK calls are replaced by a provider
adapter layer. Each adapter exposes:
  - `async *stream(messages, system, tools)` — async generator yielding
      `{ type: 'text', text }` during streaming and
      `{ type: 'done', message, containsToolUse }` at the end
  - `formatToolResult(id, content)` — returns a provider-shaped tool result object

Supported providers (set via RECLUSE_PROVIDER env var):
  - `anthropic` (default) — uses @anthropic-ai/sdk, existing behaviour preserved exactly
  - `gemini`              — uses @google/generative-ai
  - `ollama`              — uses Ollama's OpenAI-compatible local endpoint via fetch
  - `deepseek`            — reuses the Ollama adapter pointed at DeepSeek's endpoint

### Full replacement content for `src/agents/harness.js`:

```javascript
require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { RECLUSE_PERSONALITY } = require('./personality');
const { TOOL_DEFINITIONS, executeTool } = require('../tools');

// ============================================================
// PROVIDER ADAPTERS
// ============================================================

function makeAnthropicAdapter() {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  return {
    async *stream(messages, system, tools) {
      const s = client.messages.stream({
        model:      process.env.RECLUSE_MODEL || 'claude-sonnet-4-6',
        max_tokens: 2048,
        system,
        tools,
        messages,
      });

      let containsToolUse = false;

      for await (const evt of s) {
        if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
          containsToolUse = true;
        }
        if (!containsToolUse && evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
          yield { type: 'text', text: evt.delta.text };
        }
      }

      const final = await s.finalMessage();
      yield { type: 'done', message: final, containsToolUse };
    },

    formatToolResult(id, content) {
      return { type: 'tool_result', tool_use_id: id, content: JSON.stringify(content) };
    },
  };
}

function makeGeminiAdapter() {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  function convertTools(anthropicTools) {
    return [{
      functionDeclarations: anthropicTools.map(t => ({
        name:        t.name,
        description: t.description,
        parameters:  t.input_schema,
      })),
    }];
  }

  function convertMessages(messages) {
    return messages.map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: Array.isArray(m.content)
        ? m.content.map(c => ({
            functionResponse: {
              name:     c.tool_use_id,
              response: { result: c.content },
            },
          }))
        : [{ text: m.content }],
    }));
  }

  return {
    async *stream(messages, system, tools) {
      const model = genAI.getGenerativeModel({
        model:             process.env.RECLUSE_MODEL || 'gemini-2.5-flash',
        systemInstruction: system,
        tools:             convertTools(tools),
      });

      const result = await model.generateContentStream({
        contents: convertMessages(messages),
      });

      let fullText        = '';
      let containsToolUse = false;
      let toolCalls       = [];

      for await (const chunk of result.stream) {
        const candidate = chunk.candidates?.[0];
        if (!candidate) continue;

        for (const part of candidate.content?.parts || []) {
          if (part.text) {
            fullText += part.text;
            yield { type: 'text', text: part.text };
          }
          if (part.functionCall) {
            containsToolUse = true;
            toolCalls.push({
              id:    part.functionCall.name + '_' + Date.now(),
              name:  part.functionCall.name,
              input: part.functionCall.args,
            });
          }
        }
      }

      const content = containsToolUse
        ? toolCalls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input }))
        : [{ type: 'text', text: fullText }];

      yield {
        type: 'done',
        containsToolUse,
        message: { stop_reason: containsToolUse ? 'tool_use' : 'end_turn', content },
      };
    },

    formatToolResult(id, content) {
      return { type: 'tool_result', tool_use_id: id, content: JSON.stringify(content) };
    },
  };
}

function makeOllamaAdapter() {
  const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/v1';

  function convertTools(anthropicTools) {
    return anthropicTools.map(t => ({
      type:     'function',
      function: {
        name:        t.name,
        description: t.description,
        parameters:  t.input_schema,
      },
    }));
  }

  return {
    async *stream(messages, system, tools) {
      const body = {
        model:    process.env.RECLUSE_MODEL || 'llama3.1:70b',
        stream:   true,
        tools:    convertTools(tools),
        messages: [
          { role: 'system', content: system },
          ...messages.map(m => ({
            role:    m.role,
            content: Array.isArray(m.content) ? JSON.stringify(m.content) : m.content,
          })),
        ],
      };

      const baseUrl = process.env.RECLUSE_PROVIDER === 'deepseek'
        ? (process.env.DEEPSEEK_URL || 'https://api.deepseek.com/v1')
        : OLLAMA_URL;

      const headers = { 'Content-Type': 'application/json' };
      if (process.env.RECLUSE_PROVIDER === 'deepseek' && process.env.DEEPSEEK_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.DEEPSEEK_API_KEY}`;
        body.model = process.env.RECLUSE_MODEL || 'deepseek-v4-flash';
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify(body),
      });

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf             = '';
      let fullText        = '';
      let containsToolUse = false;
      let toolCalls       = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          const chunk = JSON.parse(line.slice(6));
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            fullText += delta.content;
            yield { type: 'text', text: delta.content };
          }
          if (delta.tool_calls) {
            containsToolUse = true;
            for (const tc of delta.tool_calls) {
              toolCalls.push({
                id:    tc.id,
                name:  tc.function.name,
                input: JSON.parse(tc.function.arguments || '{}'),
              });
            }
          }
        }
      }

      const content = containsToolUse
        ? toolCalls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input }))
        : [{ type: 'text', text: fullText }];

      yield {
        type: 'done',
        containsToolUse,
        message: { stop_reason: containsToolUse ? 'tool_use' : 'end_turn', content },
      };
    },

    formatToolResult(id, content) {
      return { type: 'tool_result', tool_use_id: id, content: JSON.stringify(content) };
    },
  };
}

function getAdapter() {
  const provider = (process.env.RECLUSE_PROVIDER || 'anthropic').toLowerCase();
  switch (provider) {
    case 'anthropic': return makeAnthropicAdapter();
    case 'gemini':    return makeGeminiAdapter();
    case 'ollama':    return makeOllamaAdapter();
    case 'deepseek':  return makeOllamaAdapter(); // reuses OpenAI-compat adapter
    default:
      throw new Error(`[Harness] Unknown provider: "${provider}". Use: anthropic | gemini | ollama | deepseek`);
  }
}

// ============================================================
// MEMORY — unchanged from original
// ============================================================

const MEMORY_DIR   = path.join(__dirname, '../../memory');
const HISTORY_FILE = path.join(MEMORY_DIR, 'history.json');
const SUMMARY_FILE = path.join(MEMORY_DIR, 'summary.json');
const MAX_HISTORY  = 40;

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function loadHistory() {
  ensureMemoryDir();
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      console.log(`[Memory] Loaded ${data.length} messages from history`);
      return data;
    }
  } catch (err) { console.error('[Memory] Failed to load history:', err.message); }
  return [];
}

function saveHistory(history) {
  ensureMemoryDir();
  try { fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8'); }
  catch (err) { console.error('[Memory] Failed to save history:', err.message); }
}

function loadSummary() {
  ensureMemoryDir();
  try {
    if (fs.existsSync(SUMMARY_FILE)) {
      const data = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
      return data.summary || '';
    }
  } catch (err) { console.error('[Memory] Failed to load summary:', err.message); }
  return '';
}

function saveSummary(summary) {
  ensureMemoryDir();
  try { fs.writeFileSync(SUMMARY_FILE, JSON.stringify({ summary }, null, 2), 'utf8'); }
  catch (err) { console.error('[Memory] Failed to save summary:', err.message); }
}

let conversationHistory = loadHistory();
let longTermSummary     = loadSummary();

async function summarizeOldHistory(oldMessages) {
  try {
    const adapter    = getAdapter();
    const transcript = oldMessages
      .map(m => `${m.role === 'user' ? 'Phonic' : 'Recluse'}: ${m.content}`)
      .join('\n');

    const summaryMessages = [{
      role:    'user',
      content: `Summarize this conversation between Phonic and Recluse concisely. Focus on: key topics discussed, decisions made, things Recluse learned about Phonic, ongoing projects mentioned. Be specific and factual. No preamble.\n\n${transcript}`,
    }];

    let summary = '';
    for await (const event of adapter.stream(summaryMessages, 'You are a concise summarizer.', [])) {
      if (event.type === 'text') summary += event.text;
    }
    return summary || longTermSummary;
  } catch (err) {
    console.error('[Memory] Summarization failed:', err.message);
    return longTermSummary;
  }
}

// ============================================================
// SYSTEM PROMPT + SENTENCE EXTRACTION — unchanged
// ============================================================

function buildSystemPrompt() {
  let prompt = RECLUSE_PERSONALITY;
  if (longTermSummary) {
    prompt += `\n\n---\n\nLONG TERM MEMORY\n\nHere is a summary of your previous conversations with Phonic. Use this to maintain continuity and context:\n\n${longTermSummary}`;
  }
  return prompt;
}

function extractSentences(buf) {
  const sentences = [];
  const re        = /[^]*?[.!?]+(?=\s|$)/g;
  let lastIdx     = 0, m;
  while ((m = re.exec(buf)) !== null) {
    const s = m[0].trim();
    if (s.length >= 8) {
      sentences.push(s);
      lastIdx = re.lastIndex;
      while (lastIdx < buf.length && buf[lastIdx] === ' ') lastIdx++;
      re.lastIndex = lastIdx;
    }
  }
  return { sentences, remainder: buf.slice(lastIdx) };
}

// ============================================================
// CHAT
// ============================================================

async function chat(userMessage, { onPanel, onSentence } = {}) {
  conversationHistory.push({ role: 'user', content: userMessage });

  const messages = conversationHistory.map(m => ({ ...m }));
  const adapter  = getAdapter();
  let finalResponse = '';

  while (true) {
    let sentenceBuffer = '';
    let fullText       = '';
    let doneEvent      = null;

    for await (const event of adapter.stream(messages, buildSystemPrompt(), TOOL_DEFINITIONS)) {
      if (event.type === 'text') {
        fullText       += event.text;
        sentenceBuffer += event.text;
        const { sentences, remainder } = extractSentences(sentenceBuffer);
        sentenceBuffer = remainder;
        for (const s of sentences) onSentence?.(s);
      }
      if (event.type === 'done') doneEvent = event;
    }

    if (!doneEvent?.containsToolUse && sentenceBuffer.trim().length >= 3) {
      onSentence?.(sentenceBuffer.trim());
    }

    const response = doneEvent.message;

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults   = await Promise.all(
        toolUseBlocks.map(async (block) => {
          console.log(`[Tool] ${block.name}`, block.input);
          const result = await executeTool(block.name, block.input, onPanel);
          console.log(`[Tool] ${block.name} result:`, result);
          return adapter.formatToolResult(block.id, result);
        })
      );

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    finalResponse = fullText || response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    break;
  }

  conversationHistory.push({ role: 'assistant', content: finalResponse });

  if (conversationHistory.length > MAX_HISTORY) {
    const oldMessages = conversationHistory.splice(0, 20);
    console.log('[Memory] Summarizing old history...');
    const newSummary = await summarizeOldHistory(oldMessages);
    longTermSummary  = longTermSummary ? `${longTermSummary}\n\n${newSummary}` : newSummary;
    saveSummary(longTermSummary);
  }

  saveHistory(conversationHistory);
  return finalResponse;
}

function clearHistory() {
  conversationHistory = [];
  longTermSummary     = '';
  saveHistory([]);
  saveSummary('');
  console.log('[Memory] History cleared');
}

module.exports = { chat, clearHistory };
```

---

## CHANGE 2 — CHATTERBOX TTS

### New file: `scripts/tts_synth_chatterbox.py`

Create this file. Do not modify `scripts/tts_synth.py` — leave it as a fallback.

```python
"""
tts_synth_chatterbox.py — drop-in replacement for tts_synth.py
Replaces Edge TTS with local Chatterbox via Chatterbox TTS Server.

Protocol (unchanged — speaker.js expects exactly this):
  stdin:  one sentence per line
  stdout: READY:<filepath>  on success
          ERROR             on failure
"""

import sys
import os
import tempfile
import requests

CHATTERBOX_URL = os.environ.get('CHATTERBOX_URL', 'http://localhost:8004')
VOICE_FILE     = os.environ.get('CHATTERBOX_VOICE', 'recluse')
EXAGGERATION   = float(os.environ.get('CHATTERBOX_EXAGGERATION', '0.5'))
CFG_WEIGHT     = float(os.environ.get('CHATTERBOX_CFG_WEIGHT',   '0.4'))
TEMPERATURE    = float(os.environ.get('CHATTERBOX_TEMPERATURE',  '0.7'))
TEMP_DIR       = tempfile.gettempdir()


def synthesise(text: str) -> str:
    payload = {
        'input':           text,
        'response_format': 'wav',
        'exaggeration':    EXAGGERATION,
        'cfg_weight':      CFG_WEIGHT,
        'temperature':     TEMPERATURE,
    }
    if VOICE_FILE:
        payload['voice'] = VOICE_FILE

    response = requests.post(
        f'{CHATTERBOX_URL}/v1/audio/speech',
        json=payload,
        timeout=30,
    )
    response.raise_for_status()

    tmp = tempfile.NamedTemporaryFile(suffix='.wav', dir=TEMP_DIR, delete=False)
    tmp.write(response.content)
    tmp.close()
    return tmp.name


def main():
    sys.stdout.reconfigure(line_buffering=True)
    for line in sys.stdin:
        text = line.rstrip('\n').strip()
        if not text:
            continue
        try:
            path = synthesise(text)
            print(f'READY:{path}', flush=True)
        except Exception as e:
            print(f'[tts_synth_chatterbox] ERROR: {e}', file=sys.stderr, flush=True)
            print('ERROR', flush=True)


if __name__ == '__main__':
    main()
```

### Edit: `src/tts/speaker.js`

Change the SYNTH_SCRIPT path from `tts_synth.py` to `tts_synth_chatterbox.py`:

```javascript
// BEFORE
const SYNTH_SCRIPT = path.join(__dirname, '../../scripts/tts_synth.py');

// AFTER
const SYNTH_SCRIPT = path.join(__dirname, '../../scripts/tts_synth_chatterbox.py');
```

No other changes to speaker.js.

---

## CHANGE 3 — ENVIRONMENT VARIABLES

### Edit: `.env` (add these keys — do not remove existing keys)

```
# ── Provider selection ──────────────────────────────────────
# anthropic | gemini | ollama | deepseek
RECLUSE_PROVIDER=anthropic

# Model override — leave blank to use each provider's default
# Defaults: anthropic=claude-sonnet-4-6, gemini=gemini-2.5-flash,
#           ollama=llama3.1:70b, deepseek=deepseek-v4-flash
RECLUSE_MODEL=

# ── Gemini (free tier) ──────────────────────────────────────
# Get key free at https://aistudio.google.com/app/apikey
GEMINI_API_KEY=

# ── Ollama (local, no key needed) ───────────────────────────
OLLAMA_URL=http://localhost:11434/v1

# ── DeepSeek ────────────────────────────────────────────────
DEEPSEEK_API_KEY=
DEEPSEEK_URL=https://api.deepseek.com/v1

# ── Chatterbox TTS ──────────────────────────────────────────
CHATTERBOX_URL=http://localhost:8004
CHATTERBOX_VOICE=recluse
CHATTERBOX_EXAGGERATION=0.5
CHATTERBOX_CFG_WEIGHT=0.4
CHATTERBOX_TEMPERATURE=0.7
```

### Edit: `.env.example` — add the same keys (without values) so new users know what to fill in.

---

## CHANGE 4 — DEPENDENCIES

Run the following after making the above changes:

```bash
# Gemini SDK (only needed if using Gemini provider)
npm install @google/generative-ai

# Python dependency for Chatterbox synth script
pip install requests
```

`@anthropic-ai/sdk` is already installed — no change needed for the default provider.

---

## CHATTERBOX SERVER SETUP (one-time, outside of code)

This is not a code change — document in README.md under a new "Voice Setup" section:

1. Clone Chatterbox TTS Server:
   `git clone https://github.com/devnen/Chatterbox-TTS-Server`
2. Run `start.bat` — handles all Python deps automatically
3. First launch downloads models from HuggingFace (~2GB, one time only)
4. Server runs on http://localhost:8004
5. (Optional) Voice cloning: record 10-30 seconds of any voice as a clean WAV,
   save as `recluse.wav` in the server's `voices/` folder.
   If no voice file is provided, Chatterbox uses its default voice.

---

## WHAT NOT TO CHANGE

- `scripts/tts_synth.py` — leave as-is, it's the Edge TTS fallback
- `scripts/tts_play.py` — unchanged
- `src/tts/speaker.js` — only the one SYNTH_SCRIPT line changes
- `src/agents/personality.js` — unchanged
- All other agent files — unchanged
- Memory file structure — unchanged
- IPC layer — unchanged
