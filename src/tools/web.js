const https = require('https');
const http  = require('http');
const { URL } = require('url');

// ============================================================
// WEB SEARCH — Brave Search API (primary) + DDG fallback
// Brave: https://brave.com/search/api/ — free tier, 2k/month
// Set BRAVE_SEARCH_API_KEY in .env to enable
// ============================================================

async function webSearch(query) {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  return braveKey ? braveSearch(query, braveKey) : ddgSearch(query);
}

function braveSearch(query, apiKey) {
  return new Promise((resolve) => {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6&search_lang=en`;

    const req = https.get(url, {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept':               'application/json',
        'User-Agent':           'Widow/1.0',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return resolve({ error: `Brave API returned ${res.statusCode}`, raw: data.slice(0, 200) });
        }
        try {
          const json    = JSON.parse(data);
          const results = (json.web?.results || []).map(r => ({
            title:       r.title,
            url:         r.url,
            description: r.description,
          }));
          const infobox = json.infobox?.results?.[0];
          return resolve({
            query,
            results,
            ...(infobox && { infobox: { title: infobox.title, description: infobox.long_desc } }),
          });
        } catch (err) {
          resolve({ error: err.message });
        }
      });
    });

    req.on('error', err => resolve({ error: err.message }));
    req.setTimeout(10_000, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

// Fallback: DDG instant-answer API (limited but no key required)
async function ddgSearch(query) {
  try {
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const raw    = await httpGet(apiUrl);
    const json   = JSON.parse(raw);
    const result = {};
    if (json.Answer)       result.answer      = json.Answer;
    if (json.AbstractText) result.abstract    = json.AbstractText;
    if (json.AbstractURL)  result.abstractURL = json.AbstractURL;
    if (json.Definition)   result.definition  = json.Definition;
    const topics = (json.RelatedTopics || []).filter(t => t.Text).slice(0, 6)
      .map(t => ({ text: t.Text, url: t.FirstURL }));
    if (topics.length) result.relatedTopics = topics;
    if (Object.keys(result).length === 0)
      result.note = 'No instant-answer results. Consider setting BRAVE_SEARCH_API_KEY for full web search.';
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

// ============================================================
// HTTP REQUEST — raw GET/POST/PUT/DELETE to any URL or local API
// ============================================================

function httpRequest(method, url, headers = {}, body = null, timeoutMs = 15_000) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); }
    catch (e) { return resolve({ error: `Invalid URL: ${e.message}` }); }

    const lib     = parsed.protocol === 'https:' ? https : http;
    const bodyStr = body == null
      ? null
      : typeof body === 'string' ? body : JSON.stringify(body);

    const reqHeaders = { 'User-Agent': 'Widow/1.0', ...headers };
    if (bodyStr && !reqHeaders['Content-Type'])  reqHeaders['Content-Type']    = 'application/json';
    if (bodyStr)                                 reqHeaders['Content-Length']  = Buffer.byteLength(bodyStr);

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   method.toUpperCase(),
      headers:  reqHeaders,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsedBody;
        try { parsedBody = JSON.parse(data); } catch { parsedBody = data; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsedBody });
      });
    });

    const timer = setTimeout(() => { req.destroy(); resolve({ error: `timeout after ${timeoutMs}ms` }); }, timeoutMs);
    req.on('close',  () => clearTimeout(timer));
    req.on('error',  err => { clearTimeout(timer); resolve({ error: err.message }); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ============================================================
// IMAGE GENERATION — Hugging Face Inference API (free tier)
// Set HF_API_KEY in .env — free account at huggingface.co
// Model: FLUX.1-schnell (Apache 2.0, fast, high quality)
// Falls back to Pollinations.ai if no key is set
// ============================================================

const HF_MODELS = {
  'flux':         'black-forest-labs/FLUX.1-schnell',
  'flux-schnell': 'black-forest-labs/FLUX.1-schnell',
  'flux-dev':     'black-forest-labs/FLUX.1-schnell',  // dev requires HF Pro; schnell is free
  'sdxl':         'stabilityai/stable-diffusion-xl-base-1.0',
  'flux-realism': 'black-forest-labs/FLUX.1-schnell',  // schnell handles realism well with prompting
  'flux-anime':   'black-forest-labs/FLUX.1-schnell',
  'flux-3d':      'black-forest-labs/FLUX.1-schnell',
};

async function generateImage(prompt, { model = 'flux', width = 1024, height = 1024, seed = null } = {}) {
  const hfKey = process.env.HF_API_KEY;
  if (!hfKey) return generateImagePollinations(prompt, { model, width, height, seed });
  return generateImageHF(prompt, { model, width, height, seed }, hfKey);
}

async function generateImageHF(prompt, { model, width, height, seed }, apiKey) {
  const hfModel = HF_MODELS[model] || HF_MODELS['flux'];
  const apiUrl  = `https://router.huggingface.co/hf-inference/models/${hfModel}`;

  const bodyObj = {
    inputs:     prompt,
    parameters: { width, height, ...(seed != null && { seed }) },
  };

  // HF cold-starts models — retry on 503 up to 3 times
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await new Promise((resolve) => {
      const bodyStr = JSON.stringify(bodyObj);
      const req     = https.request(apiUrl, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type':  'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'], data: Buffer.concat(chunks) }));
      });

      req.on('error', err => resolve({ error: err.message }));
      req.setTimeout(60_000, () => { req.destroy(); resolve({ error: 'timeout after 60s' }); });
      req.write(bodyStr);
      req.end();
    });

    if (result.error) return { error: result.error };

    // 503 = model loading — wait and retry
    if (result.status === 503) {
      let waitSec = 20;
      try {
        const errJson = JSON.parse(result.data.toString('utf8'));
        waitSec = Math.min(errJson.estimated_time || 20, 60);
      } catch { /* ignore */ }
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      return { error: `Model still loading after ${attempt + 1} attempts. Try again in a moment.` };
    }

    // Non-image response = error JSON
    if (!result.contentType?.startsWith('image/')) {
      let msg = `HF API returned ${result.status}`;
      try { msg = JSON.parse(result.data.toString('utf8')).error || msg; } catch { /* ignore */ }
      return { error: msg };
    }

    // Success — embed as base64 data URL so renderer can display without file I/O
    const mime    = result.contentType.split(';')[0].trim();
    const dataUrl = `data:${mime};base64,${result.data.toString('base64')}`;

    const panelHtml = buildPanelHtml(dataUrl, prompt);
    return { url: dataUrl, prompt, width, height, model, panelHtml };
  }
}

// Fallback: Pollinations.ai (no key, adds watermark, may have 402 on paid params)
function generateImagePollinations(prompt, { model = 'flux', width = 1024, height = 1024, seed = null } = {}) {
  try {
    const params = new URLSearchParams({ width: String(width), height: String(height), model });
    if (seed != null) params.set('seed', String(seed));
    const url       = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?${params}`;
    const panelHtml = buildPanelHtml(url, prompt);
    return { url, prompt, width, height, model, panelHtml };
  } catch (err) {
    return { error: err.message };
  }
}

function buildPanelHtml(src, prompt) {
  return `
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;background:#0a0a0a;padding:16px;box-sizing:border-box">
  <img src="${src}"
       style="max-width:100%;max-height:calc(100% - 48px);border-radius:6px;box-shadow:0 0 40px rgba(232,72,0,0.25);object-fit:contain"
       onerror="this.style.display='none';document.getElementById('img-err').style.display='block'" />
  <div id="img-err" style="display:none;color:#f07000;font-family:monospace;font-size:13px;margin-top:12px">Image generation failed — try a different prompt or model.</div>
  <div style="margin-top:12px;color:#555;font-family:monospace;font-size:11px;text-align:center;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${prompt}</div>
</div>`.trim();
}

// ── internal helper ───────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Widow/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

module.exports = { webSearch, httpRequest, generateImage };
