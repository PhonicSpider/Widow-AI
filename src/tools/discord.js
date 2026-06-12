const https = require('https');

const DISCORD_API = 'discord.com';
const API_BASE    = '/api/v10';

// ── Internal request helper ───────────────────────────────────────────────────

function request(method, path, body = null) {
  return new Promise((resolve) => {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) return resolve({ error: 'DISCORD_BOT_TOKEN not set in .env' });

    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      'Authorization': `Bot ${token}`,
      'User-Agent':    'WidowBot (Widow, 1.0)',
      'Accept':        'application/json',
    };
    if (payload) {
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request({
      hostname: DISCORD_API,
      path:     API_BASE + path,
      method,
      headers,
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 204) return resolve({ success: true });
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            resolve({ error: parsed.message || `HTTP ${res.statusCode}`, code: parsed.code });
          } else {
            resolve(parsed);
          }
        } catch {
          resolve({ error: 'Invalid response', raw: data.slice(0, 200) });
        }
      });
    });

    req.on('error', err => resolve({ error: err.message }));
    req.setTimeout(10_000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

async function getMessages(channelId, limit = 20) {
  const n    = Math.max(1, Math.min(100, limit));
  const data = await request('GET', `/channels/${channelId}/messages?limit=${n}`);
  if (data.error || !Array.isArray(data)) return data;
  return data.map(m => ({
    id:          m.id,
    author:      m.author?.username,
    content:     m.content,
    timestamp:   m.timestamp,
    edited:      m.edited_timestamp || null,
    attachments: m.attachments?.map(a => a.url) || [],
    embeds:      m.embeds?.length || 0,
  }));
}

async function sendMessage(channelId, content) {
  const data = await request('POST', `/channels/${channelId}/messages`, { content });
  if (data.error) return data;
  return { id: data.id, channelId, content, timestamp: data.timestamp };
}

async function listChannels(guildId) {
  const data = await request('GET', `/guilds/${guildId}/channels`);
  if (data.error || !Array.isArray(data)) return data;
  const TEXT_TYPES = new Set([0, 5, 15]); // text, announcement, forum
  const typeLabel  = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum' };
  return data
    .filter(c => TEXT_TYPES.has(c.type))
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map(c => ({ id: c.id, name: c.name, type: typeLabel[c.type] || String(c.type), topic: c.topic || null }));
}

async function listServers() {
  const data = await request('GET', '/users/@me/guilds');
  if (data.error || !Array.isArray(data)) return data;
  return data.map(g => ({ id: g.id, name: g.name }));
}

async function getChannel(channelId) {
  const data = await request('GET', `/channels/${channelId}`);
  if (data.error) return data;
  return { id: data.id, name: data.name, type: data.type, topic: data.topic || null, guildId: data.guild_id };
}

module.exports = { getMessages, sendMessage, listChannels, listServers, getChannel };
