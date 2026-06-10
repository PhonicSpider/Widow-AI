require('dotenv').config();

const Anthropic  = require('@anthropic-ai/sdk');
const { webSearch } = require('../tools/web');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CFG = {
  model:     process.env.WIDOW_MODEL || 'claude-sonnet-4-6',
  maxTokens: 4096,
};

const RESEARCH_TOOLS = [
  {
    name: 'web_search',
    description: 'Search the web for current information. Run multiple targeted searches to gather diverse sources before synthesizing.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Specific search query' },
      },
      required: ['query'],
    },
  },
];

const SYSTEM_PROMPT = `You are a research specialist working inside Widow, a personal AI assistant. You were delegated a research task by Widow's main harness.

Your job: perform thorough, multi-source research on the given topic and return a clear, well-organized summary.

How to work:
- Run multiple web searches with different angle queries to get broad coverage
- Cross-reference information across sources
- Distinguish established facts from opinion or speculation
- Note where sources disagree
- If the topic is technical, explain it accessibly
- If the topic is about a person/project/product, cover: what it is, current status, key details, any recent developments

Output format:
- Write in plain prose, no excessive markdown headers
- Lead with the most important finding
- Keep it dense with facts, not padded with filler
- End with a one-sentence "confidence note" if sources were thin or conflicting
- The response is read aloud by Widow, so keep formatting voice-friendly`;

async function run(task, context) {
  const messages = [];
  let userContent = `Research task: ${task}`;
  if (context) userContent += `\n\nContext: ${context}`;
  messages.push({ role: 'user', content: userContent });

  let finalResponse = '';

  try {
    while (true) {
      const response = await client.messages.create({
        model:      CFG.model,
        max_tokens: CFG.maxTokens,
        system:     SYSTEM_PROMPT,
        tools:      RESEARCH_TOOLS,
        messages,
      });

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults   = await Promise.all(
          toolUseBlocks.map(async (block) => {
            console.log(`[Research tool] ${block.name}: ${block.input.query}`);
            const result = block.name === 'web_search'
              ? await webSearch(block.input.query)
              : { error: `Unknown tool: ${block.name}` };
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
    console.error('[Research agent] Error:', err);
    return { success: false, error: err.message };
  }
}

module.exports = { run };
