const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Recluse/1.0' } }, (res) => {
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

module.exports = { webSearch };
