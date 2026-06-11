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
        body.model = process.env.WIDOW_MODEL || 'deepseek-v4-flash';
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
      .map(m => `${m.role === 'user' ? 'Phonic' : 'Widow'}: ${m.content}`)
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

function buildSystemPrompt() {
  let prompt = WIDOW_PERSONALITY;
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

async function chat(userMessage, { onPanel, onSentence, onConsoleLog, onStateChange } = {}) {
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
          console.log(`[Tool] ${block.name}`, block.input);
          onConsoleLog?.(`▸ ${block.name} — ${JSON.stringify(block.input).slice(0, 80)}`);

          const result = await executeTool(block.name, block.input, onPanel, onConsoleLog);

          console.log(`[Tool] ${block.name} result:`, result);
          onConsoleLog?.(`✓ ${block.name} — done`);

          return adapter.formatToolResult(block.id, result);
        })
      );

      messages.push({ role: 'user', content: toolResults });

      // Signal renderer: back to thinking while the model processes results
      onStateChange?.('THINKING');

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
