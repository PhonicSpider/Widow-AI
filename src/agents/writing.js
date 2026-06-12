require('dotenv').config();

const { createSubagentAdapter } = require('../lib/subagent');
const { writeFile, readFile }    = require('../tools/files');

const adapter = createSubagentAdapter();

const WRITING_TOOLS = [
  {
    name: 'read_file',
    description: 'Read an existing document for context or to continue from where it left off.',
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
    description: 'Save finished writing to a file.',
    input_schema: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'Absolute path to save to' },
        content: { type: 'string', description: 'The writing to save' },
      },
      required: ['path', 'content'],
    },
  },
];

const SYSTEM_PROMPT = `You are a writing specialist working inside Widow, a personal AI assistant. You were delegated a writing task by Widow's main harness.

You help with all forms of writing:
- Creative fiction (stories, worldbuilding, characters, dialogue)
- Descriptions and product copy
- Documentation and technical writing
- Branding, taglines, names
- Game lore and narrative design
- Social content and posts
- Letters, scripts, pitches

Principles:
- Match the tone and voice the user specifies — if they don't, infer from context
- Write with natural human rhythm: varied sentence length, concrete details, no generic filler
- Avoid AI-sounding phrases ("Certainly!", "Absolutely!", "Delve into", "In conclusion")
- Be direct and vivid — cut anything that doesn't earn its place
- If writing fiction or creative content, lean into specificity over generality
- If asked for options/variations, give 3 distinctly different takes, not slight rephrases

If you save to a file, confirm the path.
Return just the writing itself as your response, not a cover explanation, unless asked.`;

async function withRetry(fn, onProgress, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimit = err.status === 429 || err.message?.includes('429') || err.message?.includes('quota');
      if (isRateLimit && attempt < maxRetries) {
        const wait = parseInt(err.headers?.['retry-after'] || '60', 10);
        console.warn(`[Writing agent] rate limit — waiting ${wait}s (retry ${attempt + 1}/${maxRetries})`);
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
  let userContent = `Writing task: ${task}`;
  if (context) userContent += `\n\nContext: ${context}`;
  messages.push({ role: 'user', content: userContent });

  let finalResponse = '';
  const MAX_ITERATIONS = 20;
  let iterations = 0;

  try {
    while (iterations++ < MAX_ITERATIONS) {
      const response = await withRetry(
        () => adapter.complete(messages, SYSTEM_PROMPT, WRITING_TOOLS),
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
          console.log(`[Writing tool] ${block.name}`);
          onProgress?.(`▸ writing: ${block.name}`);

          let result;
          if (block.name === 'read_file')       result = readFile(block.input.path);
          else if (block.name === 'write_file') result = writeFile(block.input.path, block.input.content);
          else                                  result = { error: `Unknown tool: ${block.name}` };

          onProgress?.(`✓ writing: ${block.name} — done`);
          toolResults.push(adapter.toolResult(block.id, block.name, result));
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
        messages.push({ role: 'user', content: [{ type: 'text', text: 'Please provide the finished writing now.' }] });
        continue;
      }

      break;
    }

    if (!finalResponse) finalResponse = 'Writing task completed but no content was returned.';
    return { success: true, result: finalResponse };

  } catch (err) {
    console.error('[Writing agent] Error:', err);
    return { success: false, error: err.message };
  }
}

module.exports = { run };
