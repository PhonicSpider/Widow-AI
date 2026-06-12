require('dotenv').config();

const Anthropic = require('@anthropic-ai/sdk');
const { generateImage } = require('../tools/web');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Haiku is fast and cheap — perfect for prompt refinement with no tool loop
const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are an image generation specialist. Your ONLY job is to output a JSON object — nothing else.

Given a request, respond with EXACTLY this structure and nothing else:
{"prompt":"<detailed generation prompt>","model":"<model>","width":<width>,"height":<height>}

Model choices:
  "flux"          — FLUX.1-schnell, best general quality, fast (default)
  "flux-dev"      — FLUX.1-dev, highest quality, slower
  "sdxl"          — Stable Diffusion XL, painterly/artistic style
  For realism, anime, 3D — use "flux" with the right prompt styling

Prompt engineering rules:
  - Be extremely specific: describe subject, setting, lighting, mood, color palette, composition, camera angle, style, medium
  - For realism: include "photorealistic, high resolution, sharp focus, detailed"
  - For art: name the specific art style, medium, and any notable influences
  - Avoid vague terms like "nice", "cool", "good" — be concrete and visual

Dimensions:
  1024x1024 — default (square, most general)
  1920x1080 — wide landscapes, cinematic scenes
  1080x1920 — tall portraits, phone wallpapers
  768x768   — smaller square when fast is fine

Output ONLY raw JSON. No markdown. No code fences. No explanation. Just the JSON object on a single line.`;

async function run(task, context, onProgress, onPanel) {
  onProgress?.('» Crafting image prompt...');

  const userContent = context
    ? `Image request: ${task}\n\nContext: ${context}`
    : `Image request: ${task}`;

  let raw = '';
  try {
    const response = await client.messages.create({
      model:      MODEL,
      max_tokens: 512,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: userContent }],
    });

    raw = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim();

    // Strip any accidental markdown fences
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    const params = JSON.parse(raw);

    if (!params.prompt) throw new Error('Agent returned no prompt');

    onProgress?.(`▸ generate_image — model: ${params.model || 'flux'}, ${params.width || 1024}x${params.height || 1024}`);

    const result = await generateImage(params.prompt, {
      model:  params.model  || 'flux',
      width:  params.width  || 1024,
      height: params.height || 1024,
    });

    if (result.error) return { success: false, error: result.error };

    onProgress?.('✓ generate_image — image ready');

    // Show in Widow's side panel
    onPanel?.({
      title:   `IMAGE — ${task.slice(0, 40).toUpperCase()}`,
      content: result.panelHtml,
    });

    return {
      success: true,
      result:  `Image generated and shown in the panel. URL: ${result.url}`,
      url:     result.url,
      prompt:  result.prompt,
      model:   result.model,
    };

  } catch (err) {
    console.error('[Image agent] Error:', err.message, '| raw:', raw);
    return { success: false, error: err.message };
  }
}

module.exports = { run };
