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

async function withRetry(fn, onProgress, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (err.status === 429 && attempt < maxRetries) {
        const wait = parseInt(err.headers?.['retry-after'] || '60', 10);
        console.warn(`[Research agent] 429 rate limit — waiting ${wait}s (retry ${attempt + 1}/${maxRetries})`);
        onProgress?.(`⏳ rate limit hit — waiting ${wait}s before retry...`);
        await new Promise(r => setTimeout(r, wait * 1000));
        continue;
      }
      throw err;
    }
  }
}

async function run(task, context, onProgress) {
  const messages = [];
  let userContent = `Research task: ${task}`;
  if (context) userContent += `\n\nContext: ${context}`;
  messages.push({ role: 'user', content: userContent });

  let finalResponse = '';
  const MAX_ITERATIONS = 20;
  let iterations = 0;

  try {
    while (iterations++ < MAX_ITERATIONS) {
      const response = await withRetry(
        () => client.messages.create({
          model:      CFG.model,
          max_tokens: CFG.maxTokens,
          system:     SYSTEM_PROMPT,
          tools:      RESEARCH_TOOLS,
          messages,
        }),
        onProgress,
      );

      if (response.stop_reason === 'tool_use') {
        const narration = response.content
          .filter(b => b.type === 'text').map(b => b.text).join('').trim();
        if (narration) onProgress?.(`» ${narration}`);

        messages.push({ role: 'assistant', content: response.content });

        const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
        const toolResults   = [];

        for (const block of toolUseBlocks) {
          console.log(`[Research tool] ${block.name}: ${block.input.query}`);
          onProgress?.(`▸ research: searching "${block.input.query}"`);

          const result = block.name === 'web_search'
            ? await webSearch(block.input.query)
            : { error: `Unknown tool: ${block.name}` };

          onProgress?.(`✓ research: search done`);
          toolResults.push({
            type:        'tool_result',
            tool_use_id: block.id,
            content:     JSON.stringify(result),
          });
        }

        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      finalResponse = response.content
        .filter(b => b.type === 'text')
        .map(b => b.text)
        .join('')
        .trim();

      if (!finalResponse) {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Please provide your research summary now.' }] });
        continue;
      }

      break;
    }

    if (!finalResponse) finalResponse = 'Research completed but no summary was produced.';
    return { success: true, result: finalResponse };

  } catch (err) {
    console.error('[Research agent] Error:', err);
    return { success: false, error: err.message };
  }
}

module.exports = { run };
