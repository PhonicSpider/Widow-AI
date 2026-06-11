const https = require('https');
const http  = require('http');
const { URL } = require('url');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Widow/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function webSearch(query) {
  try {
    const apiUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const raw = await get(apiUrl);
    const json = JSON.parse(raw);

    const result = {};

    if (json.Answer)       result.answer       = json.Answer;
    if (json.AbstractText) result.abstract     = json.AbstractText;
    if (json.AbstractURL)  result.abstractURL  = json.AbstractURL;
    if (json.Definition)   result.definition   = json.Definition;

    const topics = (json.RelatedTopics || [])
      .filter(t => t.Text)
      .slice(0, 6)
      .map(t => ({ text: t.Text, url: t.FirstURL }));
    if (topics.length) result.relatedTopics = topics;

    const results = (json.Results || [])
      .slice(0, 4)
      .map(r => ({ title: r.Text, url: r.FirstURL }));
    if (results.length) result.results = results;

    if (Object.keys(result).length === 0) {
      result.note = 'No instant-answer results — full search results are visible in the panel.';
    }

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
    if (bodyStr && !reqHeaders['Content-Type']) {
      reqHeaders['Content-Type'] = 'application/json';
    }
    if (bodyStr) reqHeaders['Content-Length'] = Buffer.byteLength(bodyStr);

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

    const timer = setTimeout(() => {
      req.destroy();
      resolve({ error: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    req.on('close',  () => clearTimeout(timer));
    req.on('error',  err => { clearTimeout(timer); resolve({ error: err.message }); });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

module.exports = { webSearch, httpRequest };
