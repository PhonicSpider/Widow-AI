require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { WIDOW_PERSONALITY } = require('./personality');
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
        model:      process.env.WIDOW_MODEL || 'claude-sonnet-4-6',
        max_tokens: 8192,
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

    formatToolResult(id, content, name) {
      // Vision — embed the screenshot image directly so the model can see what's on screen.
      if (name === 'take_screenshot' && content?.path && !content?.error) {
        try {
          const imageData = fs.readFileSync(content.path);
          const base64    = imageData.toString('base64');
          return {
            type:        'tool_result',
            tool_use_id: id,
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64 } },
              { type: 'text',  text: JSON.stringify({ path: content.path, width: content.width, height: content.height, note: 'Screenshot shown above — you can see it directly.' }) },
            ],
          };
        } catch (err) {
          console.warn('[Vision] Could not embed screenshot:', err.message);
        }
      }
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
              name:     c.tool_name || c.tool_use_id,
              response: { result: c.content },
            },
          }))
        : [{ text: m.content }],
    }));
  }

  return {
    async *stream(messages, system, tools) {
      const model = genAI.getGenerativeModel({
        model:             process.env.WIDOW_MODEL || 'gemini-2.5-flash',
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

    formatToolResult(id, content, name) {
      return { type: 'tool_result', tool_use_id: id, tool_name: name, content: JSON.stringify(content) };
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
        model:    process.env.WIDOW_MODEL || 'llama3.1:70b',
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

      const baseUrl = process.env.WIDOW_PROVIDER === 'deepseek'
        ? (process.env.DEEPSEEK_URL || 'https://api.deepseek.com/v1')
        : OLLAMA_URL;

      const headers = { 'Content-Type': 'application/json' };
      if (process.env.WIDOW_PROVIDER === 'deepseek' && process.env.DEEPSEEK_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.DEEPSEEK_API_KEY}`;
        body.model = process.env.WIDOW_MODEL || 'deepseek-chat';
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

    formatToolResult(id, content, _name) {
      return { type: 'tool_result', tool_use_id: id, content: JSON.stringify(content) };
    },
  };
}

function getAdapter() {
  const provider = (process.env.WIDOW_PROVIDER || 'anthropic').toLowerCase();
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
// MEMORY
// ============================================================

const MEMORY_DIR   = path.join(__dirname, '../../memory');
const HISTORY_FILE = path.join(MEMORY_DIR, 'history.json');
const SUMMARY_FILE = path.join(MEMORY_DIR, 'summary.json');
const MAX_HISTORY  = 60;

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function loadHistory() {
  ensureMemoryDir();
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      const clean = stripOrphanedToolResults(data);
      console.log(`[Memory] Loaded ${clean.length} messages from history`);
      return clean;
    }
  } catch (err) { console.error('[Memory] Failed to load history:', err.message); }
  return [];
}

// Drop any leading tool_result user messages that have no preceding tool_use
// (can appear if a previous run trimmed at the wrong boundary).
function stripOrphanedToolResults(history) {
  while (history.length > 0) {
    const first = history[0];
    if (first.role === 'user' && Array.isArray(first.content) &&
        first.content.some(b => b.type === 'tool_result')) {
      history = history.slice(1);
    } else {
      break;
    }
  }
  return history;
}

// Find a safe point to splice history: advance past any tool_use/tool_result
// pairs at the boundary so we never start history with an orphaned tool_result.
function safeSpliceCount(history, minCount) {
  let n = minCount;
  while (n < history.length) {
    const m = history[n];
    // tool_result user message — must keep its preceding tool_use too, skip it
    const isToolResult = m.role === 'user' && Array.isArray(m.content) &&
      m.content.some(b => b.type === 'tool_result');
    // tool_use assistant message — its tool_result immediately follows, skip both
    const isToolUse = m.role === 'assistant' && Array.isArray(m.content) &&
      m.content.some(b => b.type === 'tool_use');
    if (isToolResult || isToolUse) { n++; } else { break; }
  }
  return n;
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

// Truncate tool_result content before storing in conversationHistory so large
// file reads or search dumps don't blow the context window on future turns.
const HISTORY_RESULT_LIMIT = 20000;

function truncateForHistory(messages) {
  return messages.map(m => {
    if (m.role !== 'user' || !Array.isArray(m.content)) return m;
    return {
      ...m,
      content: m.content.map(b => {
        if (b.type !== 'tool_result') return b;
        const raw = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
        if (raw.length <= HISTORY_RESULT_LIMIT) return b;
        return { ...b, content: raw.slice(0, HISTORY_RESULT_LIMIT) + '\n…[truncated for memory]' };
      }),
    };
  });
}

let conversationHistory = loadHistory();
let longTermSummary     = loadSummary();

async function summarizeOldHistory(oldMessages) {
  try {
    const adapter = getAdapter();

    // Messages may include tool_use / tool_result blocks — extract only text content
    const transcript = oldMessages
      .filter(m => {
        if (typeof m.content === 'string') return m.content.trim().length > 0;
        if (Array.isArray(m.content)) return m.content.some(b => b.type === 'text');
        return false;
      })
      .map(m => {
        const who = m.role === 'user' ? 'Phonic' : 'Widow';
        if (typeof m.content === 'string') return `${who}: ${m.content}`;
        const text = m.content.filter(b => b.type === 'text').map(b => b.text).join(' ');
        return `${who}: ${text}`;
      })
      .join('\n');

    const summaryMessages = [{
      role:    'user',
      content: `Summarize this conversation between Phonic and Widow concisely. Focus on: key topics discussed, decisions made, things Widow learned about Phonic, ongoing projects mentioned. Be specific and factual. No preamble.\n\n${transcript}`,
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
// SYSTEM PROMPT + SENTENCE EXTRACTION
// ============================================================

const WIDOW_ROOT = path.resolve(__dirname, '../..');

function buildSystemPrompt() {
  let prompt = WIDOW_PERSONALITY.replace('{WIDOW_ROOT}', WIDOW_ROOT);
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
// onPanel:       fires when a tool opens the side panel
// onSentence:    fires for each complete sentence during the final response
// onConsoleLog:  fires before/after each tool with a status line (drives sys-console + electron orbs)
// onStateChange: fires on WORKING / THINKING transitions (drives UI state)
// ============================================================

// Brief human-readable narration emitted to the transcript before each tool runs.
// Uses » prefix so the renderer routes it to the transcript, not just the console.
function toolNarration(name, input) {
  const b = (p) => path.basename(String(p || ''));
  switch (name) {
    case 'read_file':         return `Reading ${b(input.path)}`;
    case 'read_file_range':   return `Reading lines ${input.startLine}–${input.endLine || 'end'} of ${b(input.path)}`;
    case 'str_replace':       return `Editing ${b(input.path)}`;
    case 'write_file':        return `Writing ${b(input.path)}`;
    case 'list_directory':    return `Listing ${b(input.path) || input.path}`;
    case 'search_path':       return `Searching for "${input.name}"${input.roots ? ` in ${input.roots.join(', ')}` : ''}`;
    case 'move_file':         return `Moving ${b(input.from)} to ${b(input.to)}`;
    case 'copy_file':         return `Copying ${b(input.from)}`;
    case 'delete_file':       return `Deleting ${b(input.path)}`;
    case 'web_search':        return `Searching — "${(input.query || '').slice(0, 60)}"`;
    case 'open_url':          return `Opening ${input.title || b(input.url)}`;
    case 'shell_exec':        return `Running: ${(input.command || '').slice(0, 80)}`;
    case 'take_screenshot':   return `Taking a screenshot`;
    case 'mouse_click':       return `Clicking at ${input.x}, ${input.y}`;
    case 'mouse_scroll':      return `Scrolling`;
    case 'type_text':         return `Typing — "${(input.text || '').slice(0, 50)}"`;
    case 'key_press':         return `Pressing ${input.keys}`;
    case 'click_ui_control':  return `Clicking "${input.control}" in ${input.window}`;
    case 'calculate':         return `Calculating — ${(input.expression || '').slice(0, 60)}`;
    case 'get_time':          return `Checking the time`;
    case 'get_clipboard':     return `Reading clipboard`;
    case 'get_system_info':   return `Checking system stats`;
    case 'move_widow':        return `Moving to monitor ${input.monitor}`;
    case 'move_window':       return `Moving "${input.window_title}" to monitor ${input.monitor}`;
    case 'open_app':          return `Opening ${input.name}`;
    case 'github_search':     return `Searching GitHub — "${(input.query || '').slice(0, 60)}"`;
    case 'github_get_file':   return `Reading ${input.owner}/${input.repo}/${input.path}`;
    case 'github_create_issue': return `Creating issue on ${input.owner}/${input.repo}`;
    case 'github_list_issues':  return `Listing issues for ${input.owner}/${input.repo}`;
    case 'set_clipboard':     return `Writing to clipboard`;
    case 'send_notification': return `Sending notification — "${input.title}"`;
    case 'media_control':     return `Media: ${(input.action || '').replace(/_/g, ' ')}`;
    case 'get_volume':        return `Checking volume`;
    case 'set_volume':        return `Setting volume to ${input.level}%`;
    case 'get_window_list':   return `Listing open windows`;
    case 'http_request':      return `${(input.method || 'GET').toUpperCase()} ${input.url}`;
    case 'delegate_to_agent': return `Calling in the ${input.agent} agent — ${(input.task || '').slice(0, 70)}`;
    case 'restart_widow':     return `Restarting Widow`;
    case 'reload_renderer':   return `Reloading the UI`;
    default:                  return `Using ${name}`;
  }
}

function resultPreview(name, result) {
  if (result?.error)  return `ERROR: ${String(result.error).slice(0, 120)}`;
  if (name === 'delegate_to_agent') {
    const summary = result?.result || result?.error || '';
    return String(summary).slice(0, 140);
  }
  const str = JSON.stringify(result);
  return str.length > 120 ? str.slice(0, 120) + '…' : str;
}

async function chat(userMessage, { onPanel, onSentence, onConsoleLog, onStateChange } = {}) {
  // Track where this turn starts in history so we can sync the full
  // tool-call / tool-result chain back after the turn completes.
  const historyStart = conversationHistory.length;

  conversationHistory.push({ role: 'user', content: userMessage });

  const messages = conversationHistory.map(m => ({ ...m }));
  const adapter  = getAdapter();
  let finalResponse = '';

  while (true) {
    let sentenceBuffer = '';
    let fullText       = '';
    let doneEvent      = null;

    // Retry loop — handles 429 rate limits. A 429 fires before any text streams,
    // so resetting accumulated text and retrying is safe (no double-emit risk).
    for (let attempt = 0; ; attempt++) {
      try {
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
        break; // success — exit retry loop
      } catch (err) {
        if (err.status === 429 && attempt < 3) {
          const wait = parseInt(err.headers?.['retry-after'] || '60', 10);
          console.warn(`[Harness] 429 rate limit — waiting ${wait}s (retry ${attempt + 1}/3)`);
          onConsoleLog?.(`⏳ rate limit — waiting ${wait}s before retry...`);
          sentenceBuffer = '';
          fullText       = '';
          doneEvent      = null;
          await new Promise(r => setTimeout(r, wait * 1000));
          continue;
        }
        throw err;
      }
    }

    // Flush any trailing fragment that didn't end with punctuation
    if (!doneEvent?.containsToolUse && sentenceBuffer.trim().length >= 3) {
      onSentence?.(sentenceBuffer.trim());
    }

    const response = doneEvent.message;

    if (response.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: response.content });

      // Signal renderer: tools are about to run
      onStateChange?.('WORKING');

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults   = await Promise.all(
        toolUseBlocks.map(async (block) => {
          const inputPreview = JSON.stringify(block.input).slice(0, 80);
          console.log(`[Tool] ${block.name}`, block.input);
          onConsoleLog?.(`» ${toolNarration(block.name, block.input)}`);
          onConsoleLog?.(`▸ ${block.name} — ${inputPreview}`);

          const result = await executeTool(block.name, block.input, onPanel, onConsoleLog);

          console.log(`[Tool] ${block.name} result:`, result);
          const prefix = result?.error ? '✗' : '✓';
          onConsoleLog?.(`${prefix} ${block.name} — ${resultPreview(block.name, result)}`);

          return adapter.formatToolResult(block.id, result, block.name);
        })
      );

      messages.push({ role: 'user', content: toolResults });

      // Stay in WORKING for the full tool-use loop — don't revert to THINKING
      // between iterations. WORKING clears naturally when TTS starts (SPEAKING)
      // or when no tools are used and Widow speaks directly.
      continue;
    }

    finalResponse = fullText || response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    // Push final assistant text to messages so the sync below captures it
    messages.push({ role: 'assistant', content: finalResponse });
    break;
  }

  // Sync the full turn — including all tool_use / tool_result pairs — back to
  // conversationHistory so Widow has memory of what each tool returned.
  // Tool result content is truncated to avoid token explosion on future turns.
  const newTurnMessages = messages.slice(historyStart);
  conversationHistory.splice(
    historyStart,
    conversationHistory.length - historyStart,
    ...truncateForHistory(newTurnMessages),
  );

  if (conversationHistory.length > MAX_HISTORY) {
    const spliceCount = safeSpliceCount(conversationHistory, 20);
    const oldMessages = conversationHistory.splice(0, spliceCount);
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
