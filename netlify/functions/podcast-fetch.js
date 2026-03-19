// Retry helper for Claude API rate limits (429)
// Netlify Function timeout is 26s — max 3 retries with short delays (2s, 4s, 8s = 14s total)
async function fetchWithRetry(url, options, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, options);
    if (res.status !== 429) return res;
    if (attempt < maxRetries) {
      const delay = 2000 * Math.pow(2, attempt - 1); // 2s → 4s → 8s
      console.log(`[podcast-fetch] Rate limited (429), retry ${attempt}/${maxRetries} in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('Claude API rate limit: max retries exceeded');
}
// Notion block helpers (same pattern as generate.js)
const rt = (text, opts = {}) => ({
  type: 'text',
  text: { content: String(text || '').slice(0, 2000) },
  annotations: { bold: opts.bold || false, italic: opts.italic || false, color: opts.color || 'default' },
});
const h3 = t => ({ object: 'block', type: 'heading_3', heading_3: { rich_text: [rt(t)] } });
const para = (t, o = {}) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: [rt(t, o)] } });
const bul = (t, o = {}) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [rt(t, o)] } });
const divider = () => ({ object: 'block', type: 'divider', divider: {} });
const callout = (t, e = '📌') => ({ object: 'block', type: 'callout', callout: { rich_text: [rt(t)], icon: { type: 'emoji', emoji: e }, color: 'gray_background' } });
const quote = t => ({ object: 'block', type: 'quote', quote: { rich_text: [rt(t, { italic: true })] } });

function buildPodcastBlocks(pod) {
  const blocks = [];
  const l1 = pod.layer1 || {};
  const l2 = pod.layer2 || {};
  const speakers = pod.speakers || [];
  const recs = pod.recommendations || {};

  // Header
  const domain = (l1.domain_tags || []).join(' · ');
  blocks.push(h3(`${pod.name}${domain ? '  ·  ' + domain : ''}`));

  // Episode info
  if (pod.episode_title) {
    blocks.push(para(`${pod.episode_title}${pod.published_date ? '  ·  ' + pod.published_date : ''}`, { italic: true, color: 'gray' }));
  }

  // Guest
  if (l1.guest_in_one_line) {
    blocks.push(para(`Guest: ${l1.guest_in_one_line}`, { color: 'blue' }));
  }

  // Summary
  if (l1.summary) blocks.push(para(l1.summary, { bold: true }));

  // Triage + signal
  if (l1.triage) {
    blocks.push(para(`${l1.triage}${l1.signal_strength ? '  ·  ' + l1.signal_strength + ' signal' : ''}`, { color: l1.triage === 'Must Listen' ? 'green' : 'gray' }));
  }

  // Key statements
  if (l1.key_statements && l1.key_statements.length) {
    blocks.push(para('Key Statements:', { bold: true }));
    l1.key_statements.forEach(s => blocks.push(bul(s)));
  }

  // Speakers
  if (speakers.length) {
    speakers.filter(s => s.role === 'guest' && s.profile).forEach(s => {
      blocks.push(callout(`${s.name}: ${s.profile}`, '👤'));
    });
  }

  // Topics
  if (l2.topics && l2.topics.length) {
    l2.topics.forEach(t => {
      blocks.push(para(t.title, { bold: true }));
      if (t.summary) blocks.push(para(t.summary));
      (t.insights || []).forEach(i => blocks.push(bul(i)));
      (t.quotes || []).forEach(q => {
        blocks.push(quote(`"${q.text}"${q.speaker ? ' — ' + q.speaker : ''}`));
      });
    });
  }

  // Hypotheses
  if (l2.hypotheses && l2.hypotheses.length) {
    blocks.push(para('Hypotheses & Bold Claims:', { bold: true }));
    l2.hypotheses.forEach(h => {
      blocks.push(bul(`⚡ ${h.statement}${h.speaker ? ' — ' + h.speaker : ''}${h.evidence ? ' (Evidence: ' + h.evidence + ')' : ''}`));
    });
  }

  // Recommendations
  const emojiMap = { books: '📚', podcasts: '🎙', tools: '🛠', people: '👤', articles_links: '🔗', music: '🎵' };
  const recEntries = Object.entries(recs).filter(([, v]) => Array.isArray(v) && v.length > 0 && v.some(item => (item.title || item.name || '').trim()));
  if (recEntries.length) {
    blocks.push(para('Recommendations:', { bold: true }));
    recEntries.forEach(([cat, items]) => {
      items.filter(item => (item.title || item.name || '').trim()).forEach(item => {
        const label = item.title || item.name;
        const author = item.author ? ` by ${item.author}` : '';
        const via = item.mentioned_by ? ` (via ${item.mentioned_by})` : '';
        blocks.push(bul(`${emojiMap[cat] || '•'} ${label}${author}${via}`));
      });
    });
  }

  // Reflection
  if (l2.reflection) blocks.push(callout(l2.reflection, '🤔'));

  blocks.push(divider());
  return blocks;
}

async function writePodcastToNotion(podcast) {
  const NOTION_KEY = process.env.NOTION_API_KEY;
  const NOTION_DB_ID = process.env.NOTION_DATABASE_ID;

  if (!NOTION_KEY || !NOTION_DB_ID) {
    console.log('Notion credentials not configured — skipping Notion write');
    return null;
  }

  const notionHeaders = {
    'Authorization': `Bearer ${NOTION_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  const today = new Date().toISOString().slice(0, 10);
  const pageTitle = `Podcasts · ${today}`;

  try {
    // Check for existing Podcasts page today
    const queryResp = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        filter: {
          and: [
            { property: 'Date', date: { equals: today } },
            { property: 'Name', title: { starts_with: 'Podcasts' } },
          ],
        },
        page_size: 1,
      }),
    });

    const blocks = buildPodcastBlocks(podcast);

    if (queryResp.ok) {
      const existing = await queryResp.json();
      if (existing.results && existing.results.length > 0) {
        // Append to existing page
        const pageId = existing.results[0].id;
        const appendResp = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
          method: 'PATCH',
          headers: notionHeaders,
          body: JSON.stringify({ children: blocks }),
        });
        if (appendResp.ok) {
          console.log(`Appended ${podcast.name} to existing Notion page ${pageId}`);
          return pageId;
        }
        console.log(`Notion append failed: HTTP ${appendResp.status}`);
        return null;
      }
    }

    // Create new page
    const createResp = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({
        parent: { database_id: NOTION_DB_ID },
        properties: {
          Name: { title: [{ type: 'text', text: { content: pageTitle } }] },
          Date: { date: { start: today } },
        },
        children: [
          { object: 'block', type: 'heading_2', heading_2: { rich_text: [rt('🎙 Podcasts', { bold: true })] } },
          ...blocks,
        ].slice(0, 100),
      }),
    });

    if (createResp.ok) {
      const page = await createResp.json();
      console.log(`Created Notion podcast page: ${page.id}`);
      return page.id;
    }
    console.log(`Notion create failed: HTTP ${createResp.status}`);
    return null;
  } catch (err) {
    console.error('Notion write error:', err.message);
    return null;
  }
}

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

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { podcast_name } = body;
  if (!podcast_name || typeof podcast_name !== 'string') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'podcast_name required' }) };
  }

  const systemPrompt = `You are a podcast analyst. Find and analyze the most recent episode of the given podcast.
Use web search to find the latest episode details, show notes, and any available discussion or reviews.
Return ONLY valid JSON matching the exact schema provided. No preamble, no markdown fences.
Preserve ALL quotes verbatim where possible.
For recommendations: only include items explicitly mentioned in the episode.
If you cannot find a recent episode, return JSON with the podcast name and a summary explaining that no recent episode was found.`;

  const userPrompt = `Find and analyze the MOST RECENT episode of: "${podcast_name}"

Search for: latest episode title, guest name, key topics discussed, notable quotes, and any show notes or reviews.

Return a JSON object matching this EXACT schema:

{
  "id": "slug-from-podcast-name",
  "name": "${podcast_name}",
  "episode_title": "Full episode title",
  "episode_url": "URL to episode if found",
  "published_date": "YYYY-MM-DD",

  "speakers": [
    {
      "name": "Speaker name",
      "role": "host|guest",
      "profile": "For guests: 2-3 sentence profile. Empty for hosts.",
      "profile_source": "web_search"
    }
  ],

  "layer1": {
    "summary": "3-4 sentences. What was this episode about? Lead with the most surprising or valuable idea.",
    "guest_in_one_line": "Guest name + why this conversation matters. Empty string if host-only.",
    "key_statements": ["3-5 standalone statements worth remembering independently"],
    "domain_tags": [],
    "signal_strength": "high|medium|low",
    "triage": "Must Listen|Worth Skimming|Skip"
  },

  "layer2": {
    "topics": [
      {
        "title": "Topic title",
        "summary": "2-3 sentences on what was discussed",
        "insights": ["insight 1", "insight 2"],
        "quotes": [
          {
            "speaker": "Name",
            "text": "Verbatim quote if available",
            "context": "Why this quote matters"
          }
        ]
      }
    ],
    "hypotheses": [
      {
        "statement": "Bold claim or prediction made in the episode",
        "speaker": "Who made it",
        "evidence": "Their reasoning",
        "domain": ""
      }
    ],
    "domain_connections": {},
    "reflection": "One sharp question for the listener"
  },

  "recommendations": {
    "books": [],
    "podcasts": [],
    "tools": [],
    "people": [],
    "articles_links": [],
    "music": []
  }
}

Rules:
- topics: group by theme, minimum 2 topics, maximum 6.
- quotes: verbatim only from available sources. Omit rather than paraphrase.
- hypotheses: only bold claims/predictions, not factual statements.
- recommendations: only items explicitly mentioned. Empty arrays for categories with nothing.
- key_statements: quotable standalone formulations, not summaries.`;

  try {
    const response = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        system: systemPrompt,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', errText);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Claude API error', detail: errText }) };
    }

    const data = await response.json();

    // Extract text from response content blocks
    let textContent = '';
    for (const block of (data.content || [])) {
      if (block.type === 'text') {
        textContent += block.text;
      }
    }

    if (!textContent) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'No text in Claude response' }) };
    }

    // Parse JSON from response (strip markdown fences if present)
    let cleaned = textContent.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let podcast;
    try {
      podcast = JSON.parse(cleaned);
    } catch (parseErr) {
      podcast = {
        id: podcast_name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: podcast_name,
        episode_title: 'Latest Episode',
        published_date: new Date().toISOString().slice(0, 10),
        speakers: [],
        layer1: {
          summary: cleaned.slice(0, 500),
          guest_in_one_line: '',
          key_statements: [],
          domain_tags: [],
          signal_strength: 'medium',
          triage: 'Worth Skimming',
        },
        layer2: { topics: [], hypotheses: [], domain_connections: {}, reflection: '' },
        recommendations: { books: [], podcasts: [], tools: [], people: [], articles_links: [], music: [] },
      };
    }

    // Write to Notion (non-blocking — don't fail the response if Notion fails)
    writePodcastToNotion(podcast).catch(err => {
      console.error('Background Notion write failed:', err.message);
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(podcast),
    };
  } catch (err) {
    console.error('podcast-fetch error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
