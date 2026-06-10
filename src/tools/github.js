const https = require('https');

const GITHUB_TOKEN   = process.env.GITHUB_TOKEN || '';
const GITHUB_API     = 'api.github.com';
const DEFAULT_ACCEPT = 'application/vnd.github+json';

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const headers = {
      'User-Agent':        'Widow/1.0',
      'Accept':            DEFAULT_ACCEPT,
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    if (body)         headers['Content-Type']  = 'application/json';

    const payload = body ? JSON.stringify(body) : null;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request({ hostname: GITHUB_API, path, method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) {
            resolve({ error: parsed.message || `HTTP ${res.statusCode}`, status: res.statusCode });
          } else {
            resolve(parsed);
          }
        } catch {
          resolve({ error: 'Invalid JSON response', raw: data.slice(0, 200) });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function searchGitHub(query, type = 'repositories') {
  const typeMap = { repositories: 'repositories', code: 'code', issues: 'issues', users: 'users' };
  const endpoint = typeMap[type] || 'repositories';
  const q = encodeURIComponent(query);
  const data = await request('GET', `/search/${endpoint}?q=${q}&per_page=10`);
  if (data.error) return data;

  // Return a trimmed, readable summary
  if (endpoint === 'repositories') {
    return (data.items || []).map(r => ({
      name:        r.full_name,
      description: r.description,
      stars:       r.stargazers_count,
      language:    r.language,
      url:         r.html_url,
      updated:     r.updated_at,
    }));
  }
  if (endpoint === 'code') {
    return (data.items || []).map(r => ({
      file:       r.name,
      path:       r.path,
      repo:       r.repository.full_name,
      url:        r.html_url,
    }));
  }
  if (endpoint === 'issues') {
    return (data.items || []).map(r => ({
      title:  r.title,
      state:  r.state,
      repo:   r.repository_url.replace('https://api.github.com/repos/', ''),
      number: r.number,
      url:    r.html_url,
    }));
  }
  return data.items || [];
}

async function getGitHubFile(owner, repo, filePath, ref) {
  let endpoint = `/repos/${owner}/${repo}/contents/${filePath}`;
  if (ref) endpoint += `?ref=${encodeURIComponent(ref)}`;
  const data = await request('GET', endpoint);
  if (data.error) return data;
  if (data.encoding === 'base64' && data.content) {
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return {
      path:    data.path,
      size:    data.size,
      sha:     data.sha,
      content,
    };
  }
  return { error: 'Non-text or too large to decode', type: data.type };
}

async function createGitHubIssue(owner, repo, title, body = '', labels = []) {
  const payload = { title, body };
  if (labels.length) payload.labels = labels;
  const data = await request('POST', `/repos/${owner}/${repo}/issues`, payload);
  if (data.error) return data;
  return { number: data.number, title: data.title, url: data.html_url, state: data.state };
}

async function getGitHubIssues(owner, repo, state = 'open', type = 'issues') {
  const endpoint = type === 'pulls'
    ? `/repos/${owner}/${repo}/pulls?state=${state}&per_page=20`
    : `/repos/${owner}/${repo}/issues?state=${state}&per_page=20&pulls=false`;
  const data = await request('GET', endpoint);
  if (data.error) return data;
  return (Array.isArray(data) ? data : []).map(i => ({
    number:  i.number,
    title:   i.title,
    state:   i.state,
    author:  i.user?.login,
    created: i.created_at,
    url:     i.html_url,
  }));
}

module.exports = { searchGitHub, getGitHubFile, createGitHubIssue, getGitHubIssues };
