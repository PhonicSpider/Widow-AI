require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { RECLUSE_PERSONALITY } = require('./personality');
const { TOOL_DEFINITIONS, executeTool } = require('../tools');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ============================================================
// MEMORY PATHS
// ============================================================

const MEMORY_DIR   = path.join(__dirname, '../../memory');
const HISTORY_FILE = path.join(MEMORY_DIR, 'history.json');
const SUMMARY_FILE = path.join(MEMORY_DIR, 'summary.json');

const MAX_HISTORY = 40;

// ============================================================
// LOAD / SAVE
// ============================================================

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
  } catch (err) {
    console.error('[Memory] Failed to load history:', err.message);
  }
  return [];
}

function saveHistory(history) {
  ensureMemoryDir();
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('[Memory] Failed to save history:', err.message);
  }
}

function loadSummary() {
  ensureMemoryDir();
  try {
    if (fs.existsSync(SUMMARY_FILE)) {
      const data = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
      return data.summary || '';
    }
  } catch (err) {
    console.error('[Memory] Failed to load summary:', err.message);
  }
  return '';
}

function saveSummary(summary) {
  ensureMemoryDir();
  try {
    fs.writeFileSync(SUMMARY_FILE, JSON.stringify({ summary }, null, 2), 'utf8');
  } catch (err) {
    console.error('[Memory] Failed to save summary:', err.message);
  }
}

// ============================================================
// CONVERSATION HISTORY
// History only stores plain text messages so it replays cleanly.
// Tool-use exchanges happen in a local messages buffer per turn.
// ============================================================

let conversationHistory = loadHistory();
let longTermSummary     = loadSummary();

// ============================================================
// SUMMARIZE OLD HISTORY
// ============================================================

async function summarizeOldHistory(oldMessages) {
  try {
    const transcript = oldMessages
      .map(m => `${m.role === 'user' ? 'Phonic' : 'Recluse'}: ${m.content}`)
      .join('\n');

    const response = await client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 512,
      messages:   [{
        role:    'user',
        content: `Summarize this conversation between Phonic and Recluse concisely. Focus on: key topics discussed, decisions made, things Recluse learned about Phonic, ongoing projects mentioned. Be specific and factual. No preamble.\n\n${transcript}`,
      }],
    });

    return response.content[0].text;
  } catch (err) {
    console.error('[Memory] Summarization failed:', err.message);
    return longTermSummary;
  }
}

// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt() {
  let prompt = RECLUSE_PERSONALITY;

  if (longTermSummary) {
    prompt += `\n\n---\n\nLONG TERM MEMORY\n\nHere is a summary of your previous conversations with Phonic. Use this to maintain continuity and context:\n\n${longTermSummary}`;
  }

  return prompt;
}

// ============================================================
// SENTENCE EXTRACTION
// Called during streaming. Returns complete sentences from the buffer
// plus the trailing fragment that hasn't ended yet.
// ============================================================

function extractSentences(buf) {
  const sentences = [];
  const re = /[^]*?[.!?]+(?=\s|$)/g;
  let lastIdx = 0, m;
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
// CHAT — streaming with sentence-by-sentence TTS handoff
// onPanel:    fires immediately when a tool opens the side panel
// onSentence: fires for each complete sentence of the FINAL response
//             (not intermediate tool turns)
// ============================================================

async function chat(userMessage, { onPanel, onSentence } = {}) {
  conversationHistory.push({ role: 'user', content: userMessage });

  // Local message buffer for this turn — includes tool exchanges but not persisted
  const messages = conversationHistory.map(m => ({ ...m }));

  let finalResponse = '';

  while (true) {
    let containsToolUse = false;
    let sentenceBuffer  = '';
    let fullText        = '';

    // Use streaming so the first sentence reaches TTS before the full response is done
    const stream = client.messages.stream({
      model:      'claude-sonnet-4-6',
      max_tokens: 2048,
      system:     buildSystemPrompt(),
      tools:      TOOL_DEFINITIONS,
      messages,
    });

    stream.on('streamEvent', (evt) => {
      // Detect tool_use turns early — suppress TTS for those
      if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
        containsToolUse = true;
      }

      // Only pipe text to TTS on final (non-tool) turns
      if (!containsToolUse && evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        const token = evt.delta.text;
        fullText       += token;
        sentenceBuffer += token;

        const { sentences, remainder } = extractSentences(sentenceBuffer);
        sentenceBuffer = remainder;
        for (const s of sentences) onSentence?.(s);
      }
    });

    const response = await stream.finalMessage();

    // Flush any trailing fragment that didn't end with punctuation
    if (!containsToolUse && sentenceBuffer.trim().length >= 3) {
      onSentence?.(sentenceBuffer.trim());
    }

    if (response.stop_reason === 'tool_use') {
      // Add assistant turn (with tool_use blocks) to local buffer
      messages.push({ role: 'assistant', content: response.content });

      // Execute all tools in parallel — required for delegate_to_agent concurrency
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults   = await Promise.all(
        toolUseBlocks.map(async (block) => {
          console.log(`[Tool] ${block.name}`, block.input);
          const result = await executeTool(block.name, block.input, onPanel);
          console.log(`[Tool] ${block.name} result:`, result);
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

    // stop_reason === 'end_turn' — fullText was accumulated via stream events
    finalResponse = fullText || response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');
    break;
  }

  // Persist only plain text to conversation history
  conversationHistory.push({ role: 'assistant', content: finalResponse });

  // Trim if needed
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

// ============================================================
// CLEAR (for testing)
// ============================================================

function clearHistory() {
  conversationHistory = [];
  longTermSummary     = '';
  saveHistory([]);
  saveSummary('');
  console.log('[Memory] History cleared');
}

module.exports = { chat, clearHistory };
