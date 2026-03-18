// podcast-read.js — Reads podcast JSON from today's Notion briefing page
// Looks for the <!-- PODCAST_JSON --> code block written by generate.js

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const NOTION_KEY = process.env.NOTION_API_KEY;
  const NOTION_DB_ID = process.env.NOTION_DATABASE_ID;

  if (!NOTION_KEY || !NOTION_DB_ID) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Notion not configured' }) };
  }

  const notionHeaders = {
    'Authorization': `Bearer ${NOTION_KEY}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  };

  try {
    // Try today first, then yesterday
    const dates = [todayDubai(), yesterdayDubai()];

    for (const date of dates) {
      const pageId = await findBriefingPage(NOTION_DB_ID, date, notionHeaders);
      if (!pageId) continue;

      const podcasts = await extractPodcastJson(pageId, notionHeaders);
      if (podcasts && podcasts.length > 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ podcasts, date, source: 'notion' }),
        };
      }
    }

    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ error: 'No podcast data found', dates }),
    };
  } catch (err) {
    console.error('podcast-read error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};

function todayDubai() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
}

function yesterdayDubai() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
}

async function findBriefingPage(dbId, date, headers) {
  const resp = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filter: { property: 'Date', date: { equals: date } },
      page_size: 1,
    }),
  });

  if (!resp.ok) {
    console.error(`Notion query failed: ${resp.status}`);
    return null;
  }

  const data = await resp.json();
  return data.results?.[0]?.id || null;
}

async function extractPodcastJson(pageId, headers) {
  // Fetch all blocks from the page (paginated)
  let allBlocks = [];
  let cursor = undefined;

  do {
    const url = `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) break;

    const data = await resp.json();
    allBlocks = allBlocks.concat(data.results || []);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  // Find the code block with <!-- PODCAST_JSON --> caption
  for (const block of allBlocks) {
    if (block.type !== 'code') continue;

    const caption = (block.code.caption || []).map(t => t.plain_text || '').join('');
    if (!caption.includes('PODCAST_JSON')) continue;

    // Extract JSON from rich_text chunks
    const json = (block.code.rich_text || []).map(t => t.plain_text || '').join('');
    if (!json) continue;

    try {
      return JSON.parse(json);
    } catch (e) {
      console.error('Failed to parse podcast JSON from Notion:', e.message);
      return null;
    }
  }

  return null;
}
