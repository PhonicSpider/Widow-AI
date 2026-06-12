require('dotenv').config();

// ============================================================
// SUB-AGENT ADAPTER
// Provider-aware client factory for research/writing agents.
//
// Env vars:
//   WIDOW_SUBAGENT_PROVIDER  anthropic | gemini  (falls back to WIDOW_PROVIDER, then 'anthropic')
//   WIDOW_SUBAGENT_MODEL     model override       (falls back to WIDOW_MODEL, then provider default)
//
// Returns { complete(messages, system, tools), toolResult(id, name, content) }
//   complete() → { stop_reason: 'tool_use'|'end_turn', content: ContentBlock[] }
//   content blocks are always Anthropic-shaped: { type:'text', text } | { type:'tool_use', id, name, input }
//   toolResult() → a message block to push into the messages array as a tool response
// ============================================================

const PROVIDER = (
  process.env.WIDOW_SUBAGENT_PROVIDER ||
  process.env.WIDOW_PROVIDER ||
  'anthropic'
).toLowerCase();

// ── Anthropic adapter ──────────────────────────────────────────────────────────

function makeAnthropicAdapter() {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model     = process.env.WIDOW_SUBAGENT_MODEL ||
                    process.env.WIDOW_MODEL           ||
                    'claude-haiku-4-5-20251001';  // cheap default for sub-agents

  return {
    async complete(messages, system, tools) {
      const res = await client.messages.create({ model, max_tokens: 8192, system, tools, messages });
      return { stop_reason: res.stop_reason, content: res.content };
    },

    toolResult(id, _name, content) {
      return { type: 'tool_result', tool_use_id: id, content: JSON.stringify(content) };
    },
  };
}

// ── Gemini adapter ─────────────────────────────────────────────────────────────

function makeGeminiAdapter() {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model  = process.env.WIDOW_SUBAGENT_MODEL || 'gemini-2.5-flash';

  // Map tool_use id → function name so we can write proper functionResponse blocks.
  // Persists for the lifetime of this adapter instance (one per agent run).
  const idToName = {};

  function toGeminiTools(anthropicTools) {
    return [{
      functionDeclarations: anthropicTools.map(t => ({
        name:        t.name,
        description: t.description,
        parameters:  t.input_schema,
      })),
    }];
  }

  // Convert Anthropic-shaped message history → Gemini contents array.
  // Handles: plain text, tool_use (functionCall), tool_result (functionResponse).
  function toGeminiMessages(messages) {
    return messages.map(m => {
      const role  = m.role === 'assistant' ? 'model' : 'user';
      const parts = [];

      if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block.type === 'text') {
            parts.push({ text: block.text });
          } else if (block.type === 'tool_use') {
            parts.push({ functionCall: { name: block.name, args: block.input } });
          } else if (block.type === 'tool_result') {
            // _name is stashed by toolResult() below
            const name = block._name || idToName[block.tool_use_id] || block.tool_use_id;
            let responseValue;
            try   { responseValue = JSON.parse(block.content); }
            catch { responseValue = { result: block.content };  }
            parts.push({ functionResponse: { name, response: { result: responseValue } } });
          }
        }
      } else {
        parts.push({ text: m.content || '' });
      }

      return { role, parts };
    });
  }

  return {
    async complete(messages, system, tools) {
      const genModel = genAI.getGenerativeModel({
        model,
        systemInstruction: system,
        tools:             toGeminiTools(tools),
      });

      const result    = await genModel.generateContent({ contents: toGeminiMessages(messages) });
      const parts     = result.response.candidates?.[0]?.content?.parts || [];
      const content   = [];
      let   hasTools  = false;

      for (const part of parts) {
        if (part.text) {
          content.push({ type: 'text', text: part.text });
        }
        if (part.functionCall) {
          hasTools = true;
          // Stable ID: name + timestamp + random suffix (unique enough for a single turn)
          const id = `${part.functionCall.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          idToName[id] = part.functionCall.name;
          content.push({
            type:  'tool_use',
            id,
            name:  part.functionCall.name,
            input: part.functionCall.args || {},
          });
        }
      }

      return { stop_reason: hasTools ? 'tool_use' : 'end_turn', content };
    },

    toolResult(id, name, content) {
      // Stash _name so toGeminiMessages can write the correct functionResponse name.
      // The _name field is silently ignored when this block is later consumed by Anthropic
      // (if the user switches providers mid-session it won't cause an error).
      idToName[id] = name;
      return { type: 'tool_result', tool_use_id: id, _name: name, content: JSON.stringify(content) };
    },
  };
}

// ── Factory ────────────────────────────────────────────────────────────────────

function createSubagentAdapter() {
  switch (PROVIDER) {
    case 'gemini':    return makeGeminiAdapter();
    case 'anthropic':
    default:          return makeAnthropicAdapter();
  }
}

module.exports = { createSubagentAdapter, PROVIDER };
