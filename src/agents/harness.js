// harness.js — Recluse's central orchestrator
// All requests flow through here. The harness decides which agents to invoke.

const Anthropic = require('@anthropic-ai/sdk');
const { RECLUSE_PERSONALITY } = require('./personality');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Conversation history (in-memory for now, will persist later)
let conversationHistory = [];

/**
 * Send a message to the harness and get a response.
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function chat(userMessage) {
  conversationHistory.push({
    role: 'user',
    content: userMessage,
  });

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: RECLUSE_PERSONALITY,
    messages: conversationHistory,
  });

  const assistantMessage = response.content[0].text;

  conversationHistory.push({
    role: 'assistant',
    content: assistantMessage,
  });

  return assistantMessage;
}

/**
 * Clear conversation history (new session)
 */
function clearHistory() {
  conversationHistory = [];
}

module.exports = { chat, clearHistory };
