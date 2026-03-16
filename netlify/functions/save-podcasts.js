const fetch = require('node-fetch');

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO; // e.g. "blockchainee/morning-os"

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'GitHub credentials not configured. Set GITHUB_TOKEN and GITHUB_REPO in Netlify env vars.' }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { active_podcasts } = body;
  if (!Array.isArray(active_podcasts)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'active_podcasts array required' }) };
  }

  // Validate: only allow known podcast ID patterns (alphanumeric, hyphens, underscores)
  const validId = /^[a-zA-Z0-9_-]+$/;
  const sanitized = active_podcasts.filter(id => typeof id === 'string' && validId.test(id));

  const configContent = JSON.stringify({ active_podcasts: sanitized }, null, 2) + '\n';
  const contentBase64 = Buffer.from(configContent).toString('base64');

  try {
    // Get current file SHA (required for updates)
    const getResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/config.json`, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    let sha = null;
    if (getResp.ok) {
      const existing = await getResp.json();
      sha = existing.sha;
    }

    // Commit updated config.json
    const putBody = {
      message: `Update podcast config (${sanitized.length} active)`,
      content: contentBase64,
      committer: {
        name: 'Morning OS App',
        email: 'morning-os[bot]@users.noreply.github.com',
      },
    };
    if (sha) putBody.sha = sha;

    const putResp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/config.json`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(putBody),
    });

    if (!putResp.ok) {
      const err = await putResp.text();
      console.error('GitHub API error:', err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Failed to save to GitHub', detail: err }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, saved: sanitized.length }),
    };
  } catch (err) {
    console.error('save-podcasts error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
