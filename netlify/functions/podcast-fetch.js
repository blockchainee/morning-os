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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
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
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
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
      // Fallback: return raw text as summary
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
