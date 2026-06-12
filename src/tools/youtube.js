const https = require('https');

// ============================================================
// YouTube Data API v3
// Free tier: 10,000 quota units/day (search costs 100 units, reads cost 1).
// Get a key at: https://console.cloud.google.com → APIs → YouTube Data API v3
// Set YOUTUBE_API_KEY in .env.
// ============================================================

const YT_BASE = 'www.googleapis.com';

function ytGet(endpoint, params) {
  return new Promise((resolve) => {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return resolve({ error: 'YOUTUBE_API_KEY not set in .env' });

    const qs  = new URLSearchParams({ ...params, key }).toString();
    const req = https.get(
      { hostname: YT_BASE, path: `/youtube/v3/${endpoint}?${qs}`, headers: { 'User-Agent': 'Widow/1.0' } },
      (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return resolve({ error: parsed.error.message || 'YouTube API error', status: parsed.error.code });
            resolve(parsed);
          } catch {
            resolve({ error: 'Invalid response', raw: data.slice(0, 200) });
          }
        });
      }
    );
    req.on('error', err => resolve({ error: err.message }));
    req.setTimeout(10_000, () => { req.destroy(); resolve({ error: 'timeout' }); });
  });
}

// ── Search ────────────────────────────────────────────────────────────────────

async function searchVideos(query, { maxResults = 8, order = 'relevance' } = {}) {
  const data = await ytGet('search', {
    part:       'snippet',
    q:          query,
    type:       'video',
    maxResults: Math.min(25, maxResults),
    order,
  });
  if (data.error) return data;
  return (data.items || []).map(item => ({
    id:          item.id.videoId,
    title:       item.snippet.title,
    channel:     item.snippet.channelTitle,
    channelId:   item.snippet.channelId,
    published:   item.snippet.publishedAt?.slice(0, 10),
    description: item.snippet.description?.slice(0, 200) || '',
    thumbnail:   item.snippet.thumbnails?.medium?.url || null,
    url:         `https://youtube.com/watch?v=${item.id.videoId}`,
  }));
}

async function searchChannels(query, maxResults = 5) {
  const data = await ytGet('search', {
    part:       'snippet',
    q:          query,
    type:       'channel',
    maxResults: Math.min(10, maxResults),
  });
  if (data.error) return data;
  return (data.items || []).map(item => ({
    id:          item.snippet.channelId,
    name:        item.snippet.channelTitle,
    description: item.snippet.description?.slice(0, 200) || '',
    thumbnail:   item.snippet.thumbnails?.medium?.url || null,
    url:         `https://youtube.com/channel/${item.snippet.channelId}`,
  }));
}

// ── Video details ─────────────────────────────────────────────────────────────

async function getVideo(videoId) {
  const data = await ytGet('videos', { part: 'snippet,statistics,contentDetails', id: videoId });
  if (data.error) return data;
  const v = data.items?.[0];
  if (!v) return { error: `Video "${videoId}" not found` };
  return {
    id:          v.id,
    title:       v.snippet.title,
    channel:     v.snippet.channelTitle,
    channelId:   v.snippet.channelId,
    published:   v.snippet.publishedAt?.slice(0, 10),
    description: v.snippet.description?.slice(0, 500) || '',
    tags:        v.snippet.tags?.slice(0, 10) || [],
    views:       Number(v.statistics?.viewCount  || 0),
    likes:       Number(v.statistics?.likeCount  || 0),
    comments:    Number(v.statistics?.commentCount || 0),
    duration:    parseDuration(v.contentDetails?.duration),
    url:         `https://youtube.com/watch?v=${v.id}`,
  };
}

// ── Channel details ───────────────────────────────────────────────────────────

async function getChannel(channelId) {
  // Accept both channel IDs (UCxxx) and handles (@handle)
  const params = channelId.startsWith('UC')
    ? { part: 'snippet,statistics', id: channelId }
    : { part: 'snippet,statistics', forHandle: channelId.replace(/^@/, '') };

  const data = await ytGet('channels', params);
  if (data.error) return data;
  const c = data.items?.[0];
  if (!c) return { error: `Channel "${channelId}" not found` };
  return {
    id:          c.id,
    name:        c.snippet.title,
    handle:      c.snippet.customUrl || null,
    description: c.snippet.description?.slice(0, 300) || '',
    country:     c.snippet.country || null,
    created:     c.snippet.publishedAt?.slice(0, 10),
    subscribers: Number(c.statistics?.subscriberCount || 0),
    videos:      Number(c.statistics?.videoCount      || 0),
    totalViews:  Number(c.statistics?.viewCount       || 0),
    url:         `https://youtube.com/channel/${c.id}`,
  };
}

// ── Recent uploads ────────────────────────────────────────────────────────────

async function getRecentUploads(channelId, maxResults = 5) {
  // Get uploads playlist ID first
  const chanData = await ytGet('channels', { part: 'contentDetails', id: channelId });
  if (chanData.error) return chanData;
  const playlistId = chanData.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!playlistId) return { error: 'Could not find uploads playlist' };

  const data = await ytGet('playlistItems', {
    part:       'snippet',
    playlistId,
    maxResults: Math.min(25, maxResults),
  });
  if (data.error) return data;
  return (data.items || []).map(item => ({
    id:        item.snippet.resourceId.videoId,
    title:     item.snippet.title,
    published: item.snippet.publishedAt?.slice(0, 10),
    url:       `https://youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDuration(iso) {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return iso;
  const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0), s = parseInt(m[3] || 0);
  if (h) return `${h}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${min}:${String(s).padStart(2, '0')}`;
}

module.exports = { searchVideos, searchChannels, getVideo, getChannel, getRecentUploads };
