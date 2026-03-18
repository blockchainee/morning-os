/**
 * Morning OS — Cloud Generator v2
 * Uses Google OAuth directly (no MCP needed).
 * Runs in GitHub Actions, writes to Notion.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const LOGS_DIR = join(ROOT, 'logs');
const TRANSCRIPTS_DIR = join(ROOT, 'transcripts');
mkdirSync(LOGS_DIR, { recursive: true });

const LOG_FILE = join(LOGS_DIR, 'generate.log');
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch (e) { console.error('Log write failed:', e.message); }
}

// ── Environment ────────────────────────────────────────────────
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const NOTION_KEY      = process.env.NOTION_API_KEY;
const NOTION_DB_ID    = process.env.NOTION_DATABASE_ID;
const GOOGLE_CLIENT_ID     = process.env['GOOGLE_CLIENT_ID'];
const GOOGLE_CLIENT_SECRET = process.env['GOOGLE_CLIENT_SECRET'];
const GOOGLE_REFRESH_TOKEN = process.env['GOOGLE_REFRESH_TOKEN'];
const GOOGLE_ENABLED = !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN);
if (!ANTHROPIC_KEY)        { log('FATAL: ANTHROPIC_API_KEY not set'); process.exit(1); }
if (!NOTION_KEY)           { log('FATAL: NOTION_API_KEY not set'); process.exit(1); }
if (!NOTION_DB_ID)         { log('FATAL: NOTION_DATABASE_ID not set'); process.exit(1); }
if (!GOOGLE_ENABLED)       { log('WARN: Google OAuth not configured — calendar and newsletters will be skipped'); }

// ── Retry wrapper for external API calls ─────────────────────
async function fetchWithRetry(url, opts, { retries = 3, label = 'fetch' } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, opts);
      if (resp.ok || resp.status < 500 && resp.status !== 429) return resp;
      log(`${label} attempt ${attempt}/${retries} — HTTP ${resp.status}`);
    } catch (err) {
      log(`${label} attempt ${attempt}/${retries} — ${err.message}`);
      if (attempt === retries) throw err;
    }
    if (attempt < retries) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
  }
  // Final attempt — let errors propagate
  return fetch(url, opts);
}

// ── Google OAuth Token Refresh ────────────────────────────────
let googleAccessToken = null;
let tokenRefreshPromise = null;

async function getGoogleAccessToken() {
  if (!GOOGLE_ENABLED) throw new Error('Google OAuth not configured');
  if (googleAccessToken) return googleAccessToken;
  // Prevent parallel calls from each triggering a separate refresh
  if (tokenRefreshPromise) return tokenRefreshPromise;
  tokenRefreshPromise = (async () => {
    log('Refreshing Google access token...');
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID     || '',
        client_secret: GOOGLE_CLIENT_SECRET || '',
        refresh_token: GOOGLE_REFRESH_TOKEN,
        grant_type:    'refresh_token',
      }),
    });
    const data = await resp.json();
    if (!data.access_token) {
      throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    }
    googleAccessToken = data.access_token;
    log('Google access token obtained');
    return googleAccessToken;
  })();
  try { return await tokenRefreshPromise; }
  finally { tokenRefreshPromise = null; }
}

// ── Gmail API ─────────────────────────────────────────────────
async function gmailSearch(query) {
  const token = await getGoogleAccessToken();
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=1`;
  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Gmail search failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.messages || !data.messages.length) return null;

  // Get full message
  const msgId = data.messages[0].id;
  const msgResp = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!msgResp.ok) return null;
  const msg = await msgResp.json();

  // Extract text body
  function extractBody(payload) {
    if (!payload) return '';
    if (payload.body && payload.body.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf8');
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
          const text = extractBody(part);
          if (text) return text;
        }
      }
      for (const part of payload.parts) {
        const text = extractBody(part);
        if (text) return text;
      }
    }
    return '';
  }

  const rawBody = extractBody(msg.payload);
  // Strip HTML tags for cleaner processing
  const cleanBody = rawBody
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 25000); // Limit to 25KB

  const subject = msg.payload.headers?.find(h => h.name === 'Subject')?.value || '';
  const date    = msg.payload.headers?.find(h => h.name === 'Date')?.value || '';

  return { subject, date, body: cleanBody };
}

// ── Gmail Auto-Discovery ─────────────────────────────────────
async function discoverNewsletters() {
  if (!GOOGLE_ENABLED) {
    log('[Discovery] Skipped — Google OAuth not configured');
    return [];
  }
  const token = await getGoogleAccessToken();

  // Domain classification keywords
  const D_KEYWORDS = {
    D1: /ai|tech|software|saas|enterprise|startup|product/i,
    D2: /crypto|bitcoin|defi|finance|investing|markets|macro/i,
    D3: /geopolitics|global|policy|middle.east|gulf|iran|war/i,
    D4: /growth|habits|mindset|health|learning|philosophy/i,
  };
  function classifyDomain(text) {
    for (const [domain, re] of Object.entries(D_KEYWORDS)) {
      if (re.test(text)) return domain;
    }
    return 'D1';
  }
  function slugify(str) {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  try {
    // Search two Gmail categories for newsletters from last 24h
    const queries = [
      'newer_than:1d category:updates',
      'newer_than:1d category:promotions',
    ];

    const allMessageIds = [];
    for (const q of queries) {
      const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=30`;
      const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (!resp.ok) { log(`[Discovery] Gmail search failed for "${q}": ${resp.status}`); continue; }
      const data = await resp.json();
      if (data.messages) allMessageIds.push(...data.messages.map(m => m.id));
    }

    // Dedup message IDs
    const uniqueIds = [...new Set(allMessageIds)];
    log(`[Discovery] Found ${uniqueIds.length} candidate messages`);

    // Fetch headers for each message to check List-Unsubscribe
    const senderMap = new Map(); // keyed by sender email domain
    for (const msgId of uniqueIds) {
      try {
        const msgResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        if (!msgResp.ok) continue;
        const msg = await msgResp.json();
        const headers = msg.payload?.headers || [];
        const from = headers.find(h => h.name === 'From')?.value || '';
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const listUnsub = headers.find(h => h.name === 'List-Unsubscribe')?.value || '';

        // Only keep messages with List-Unsubscribe header (newsletter signal)
        if (!listUnsub) continue;

        // Extract sender email and display name
        const emailMatch = from.match(/<([^>]+)>/);
        const senderEmail = emailMatch ? emailMatch[1] : from;
        const senderDomain = senderEmail.split('@')[1] || senderEmail;
        const displayName = from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || senderEmail;

        // Dedup by sender email domain
        if (senderMap.has(senderDomain)) continue;
        senderMap.set(senderDomain, {
          msgId,
          sender: senderEmail,
          name: displayName,
          subject,
          domain: classifyDomain(displayName + ' ' + subject),
        });
      } catch (err) {
        log(`[Discovery] Error fetching message ${msgId}: ${err.message}`);
      }
    }

    // Cap at 15 newsletters
    const discovered = [...senderMap.values()].slice(0, 15);
    log(`[Discovery] ${discovered.length} newsletters after List-Unsubscribe filter`);

    // Fetch full body for each discovered newsletter
    const results = [];
    for (const nl of discovered) {
      try {
        const msgResp = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${nl.msgId}?format=full`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        if (!msgResp.ok) continue;
        const msg = await msgResp.json();

        function extractBody(payload) {
          if (!payload) return '';
          if (payload.body && payload.body.data) {
            return Buffer.from(payload.body.data, 'base64').toString('utf8');
          }
          if (payload.parts) {
            for (const part of payload.parts) {
              if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
                const text = extractBody(part);
                if (text) return text;
              }
            }
            for (const part of payload.parts) {
              const text = extractBody(part);
              if (text) return text;
            }
          }
          return '';
        }

        const rawBody = extractBody(msg.payload);
        const cleanBody = rawBody
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 25000);

        const date = msg.payload.headers?.find(h => h.name === 'Date')?.value || '';

        results.push({
          id: slugify(nl.name),
          name: nl.name,
          sender: nl.sender,
          subject: nl.subject,
          body: cleanBody,
          domain: nl.domain,
          date,
        });
      } catch (err) {
        log(`[Discovery] Error fetching body for ${nl.name}: ${err.message}`);
      }
    }

    log(`[Discovery] Returning ${results.length} newsletters with bodies`);
    return results;
  } catch (err) {
    log(`[Discovery] Fatal error: ${err.message}`);
    return [];
  }
}

// ── Google Calendar API ───────────────────────────────────────

// Fetch all user-visible calendar IDs via CalendarList API
async function fetchCalendarIds() {
  const token = await getGoogleAccessToken();
  try {
    const resp = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!resp.ok) {
      log(`CalendarList failed (${resp.status}), falling back to primary`);
      return ['primary'];
    }
    const data = await resp.json();
    // Include all non-hidden, non-birthday calendars (birthdays handled separately)
    const ids = (data.items || [])
      .filter(c => !c.hidden && !c.deleted && c.id !== 'contacts@gmail.com')
      .map(c => c.id);
    log(`CalendarList: found ${ids.length} calendars: ${ids.join(', ')}`);
    return ids.length ? ids : ['primary'];
  } catch (err) {
    log(`CalendarList error: ${err.message}, falling back to primary`);
    return ['primary'];
  }
}

async function fetchCalendarEvents() {
  const token = await getGoogleAccessToken();
  const calendarIds = await fetchCalendarIds();

  const dubaiNow = new Date(new Date().toLocaleString('en-US', { timeZone: USER_TIMEZONE }));
  const startOfDay = new Date(dubaiNow);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(dubaiNow);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const timeMin = startOfDay.toISOString();
  const timeMax = endOfWeek.toISOString();

  // Fetch events from all calendars in parallel
  const results = await Promise.allSettled(calendarIds.map(async (calId) => {
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?` +
      `timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=50`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!resp.ok) {
      log(`Calendar ${calId} failed: ${resp.status}`);
      return [];
    }
    const data = await resp.json();
    return data.items || [];
  }));

  // Merge all events, dedupe by event ID, sort by start time
  const allEvents = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value);
  const seen = new Set();
  const unique = allEvents.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  unique.sort((a, b) => {
    const ta = a.start?.dateTime || a.start?.date || '';
    const tb = b.start?.dateTime || b.start?.date || '';
    return ta.localeCompare(tb);
  });
  log(`Calendar: ${unique.length} events from ${calendarIds.length} calendars`);
  return unique;
}

async function fetchBirthdays() {
  const token = await getGoogleAccessToken();
  // Check contacts/birthday calendar
  const dubaiNow = new Date(new Date().toLocaleString('en-US', { timeZone: USER_TIMEZONE }));
  const startOfDay = new Date(dubaiNow); startOfDay.setHours(0,0,0,0);
  const endOfDay   = new Date(dubaiNow); endOfDay.setHours(23,59,59,999);

  try {
    const url = `https://www.googleapis.com/calendar/v3/calendars/contacts%40gmail.com/events?` +
      `timeMin=${startOfDay.toISOString()}&timeMax=${endOfDay.toISOString()}&singleEvents=true`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.items || []).map(e => ({ name: e.summary?.replace("'s Birthday", '') || '', note: 'Birthday today' }));
  } catch (err) { log(`Birthdays fetch error: ${err.message}`); return []; }
}

// ── Dubai helpers ──────────────────────────────────────────────
function dubaiNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: USER_TIMEZONE }));
}
function dubaiDateStr() {
  return dubaiNow().toLocaleDateString('en-GB', {
    weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone: USER_TIMEZONE
  });
}
function dubaiDateShort() {
  return dubaiNow().toLocaleDateString('en-GB', {
    day:'numeric', month:'short', year:'numeric', timeZone: USER_TIMEZONE
  });
}
function dayOfWeek() {
  return dubaiNow().toLocaleDateString('en-US', { weekday:'long', timeZone: USER_TIMEZONE });
}
function todayISODate() {
  return dubaiNow().toISOString().slice(0,10);
}

// ── Knowledge Files ───────────────────────────────────────────
function loadKnowledge() {
  const userProfile = existsSync(join(ROOT, 'knowledge/user-profile.md'))
    ? readFileSync(join(ROOT, 'knowledge/user-profile.md'), 'utf8')
    : '';
  const domains = existsSync(join(ROOT, 'knowledge/domains.md'))
    ? readFileSync(join(ROOT, 'knowledge/domains.md'), 'utf8')
    : '';
  return { userProfile, domains };
}

const KNOWLEDGE = loadKnowledge();

// ── Claude API ────────────────────────────────────────────────
const USER_PROFILE = process.env.USER_PROFILE || 'the user';
const USER_NAME = process.env.USER_NAME || 'User';
const USER_CITY = process.env.USER_CITY || 'Dubai';
const USER_TIMEZONE = process.env.USER_TIMEZONE || 'Asia/Dubai';
const BASE_SYSTEM = `You are ${USER_NAME}'s personal intelligence officer.

## User Profile
${KNOWLEDGE.userProfile}

## Domain Signal Guide
${KNOWLEDGE.domains}

## Output Rules
- Be direct, sharp, and substantive. No filler phrases.
- Preserve ALL specific data verbatim: numbers, names, dates, percentages.
- Every insight must connect to at least one of D1-D4.
- Return ONLY valid JSON. No preamble. No markdown fences.`;

async function claudeCall(userContent, maxTokens = 2000) {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: BASE_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  };
  // Retry with exponential backoff on rate limits (429)
  for (let attempt = 1; attempt <= 5; attempt++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (resp.status === 429) {
      const retryAfter = resp.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(2000 * Math.pow(2, attempt - 1), 60000);
      log(`[Claude] Rate limited (429). Waiting ${Math.round(waitMs/1000)}s before retry ${attempt}/5...`);
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    if (!resp.ok) throw new Error(`Claude API ${resp.status}: ${(await resp.text()).slice(0,200)}`);
    const data = await resp.json();
    const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = text.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
    try { return JSON.parse(clean); }
    catch {
      const match = clean.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
      throw new Error(`JSON parse failed: ${clean.slice(0,300)}`);
    }
  }
  throw new Error('Claude API rate limit: exhausted 5 retries');
}

// ── Newsletter config ─────────────────────────────────────────
const ALL_NEWSLETTERS = [
  { id:'a16z',     name:'a16z',              domain:'D1', query:'from:@a16z.com newer_than:3d' },
  { id:'bankless', name:'Bankless',           domain:'D2', query:'from:@bankless.com newer_than:2d' },
  { id:'pomp',     name:'The Pomp Letter',   domain:'D2', query:'from:pomp@pomp.com newer_than:2d' },
  { id:'tldr',     name:'TLDR',              domain:'D1', query:'from:@tldr.tech newer_than:2d' },
  { id:'semafor',  name:'Semafor',           domain:'D3', query:'from:@semafor.com newer_than:2d' },
  { id:'intrigue', name:'Intl Intrigue',     domain:'D3', query:'from:@internationalintrigue.io newer_than:3d' },
  { id:'lenny',    name:"Lenny's Newsletter",domain:'D1', query:'from:@substack.com subject:lenny newer_than:7d' },
  { id:'chamath',  name:'Chamath',           domain:'D2', query:'from:chamath@socialcapital.com newer_than:7d' },
  { id:'timeout',  name:'Time Out Dubai',    domain:'D4', query:'from:@timeout.com newer_than:7d' },
];

const PODCAST_DIRECTORY = {
  'bankless':          { name:'Bankless',               domain:'D2' },
  'lex-fridman':       { name:'Lex Fridman Podcast',    domain:'D1' },
  'my-first-million':  { name:'My First Million',       domain:'D2' },
  'knowledge-project': { name:'The Knowledge Project',  domain:'D1' },
  'tim-ferriss':       { name:'The Tim Ferriss Show',   domain:'D4' },
  'all-in':            { name:'All-In Podcast',         domain:'D2' },
  'huberman':          { name:'Huberman Lab',           domain:'D4' },
  'invest-like-best':  { name:'Invest Like the Best',  domain:'D2' },
  'acquired':          { name:'Acquired',               domain:'D1' },
  'diary-of-ceo':      { name:'The Diary of a CEO',     domain:'D4' },
};

// ═══════════════════════════════════════════════════════════════
// MODULES
// ═══════════════════════════════════════════════════════════════

async function fetchCalendar() {
  if (!GOOGLE_ENABLED) {
    log('Calendar: skipped (Google OAuth not configured)');
    return { today: [], focus_window: null, birthdays: [] };
  }
  log('Fetching calendar...');
  try {
    const [events, birthdays] = await Promise.all([fetchCalendarEvents(), fetchBirthdays()]);

    const dubaiNow2 = dubaiNow();
    const todayEvents = events.filter(e => {
      const start = e.start?.dateTime || e.start?.date;
      if (!start) return false;
      const eventDate = new Date(start);
      return eventDate.toDateString() === dubaiNow2.toDateString();
    });

    const today = todayEvents.map(e => {
      const start = e.start?.dateTime;
      const time = start ? new Date(start).toLocaleTimeString('en-GB', {
        hour:'2-digit', minute:'2-digit', timeZone: USER_TIMEZONE
      }) : 'All day';
      const isExternal = e.attendees && e.attendees.length > 1;
      return {
        time,
        title: e.summary || 'Untitled',
        type: isExternal ? 'external' : 'internal',
        prep: isExternal ? `Prepare for ${e.summary}` : null,
        note: e.description ? e.description.slice(0,100) : null,
      };
    });

    // Find focus window (90+ min gap between meetings)
    let focusWindow = null;
    if (today.length >= 2) {
      for (let i = 0; i < today.length - 1; i++) {
        const endTime = today[i].time;
        const startNext = today[i+1].time;
        focusWindow = `${endTime}–${startNext}`;
        break;
      }
    } else if (today.length === 0) {
      focusWindow = 'Full day free';
    }

    log(`Calendar: ${today.length} events today, ${birthdays.length} birthdays`);
    return { today, focus_window: focusWindow, birthdays };
  } catch (err) {
    log(`Calendar ERROR: ${err.message}`);
    return { today: [], focus_window: null, birthdays: [] };
  }
}

async function fetchNewsletter(nl) {
  if (!GOOGLE_ENABLED) {
    log(`${nl.name}: skipped (Google OAuth not configured)`);
    return { id: nl.id, has_new_edition: false };
  }
  log(`Fetching newsletter: ${nl.name}...`);
  try {
    // Auto-discovered newsletters already have body/subject/date
    // Fallback (hardcoded) newsletters need Gmail search
    let emailBody, emailSubject, emailDate, emailSender;
    if (nl.body) {
      emailBody = nl.body;
      emailSubject = nl.subject || '';
      emailDate = nl.date || '';
      emailSender = nl.sender || '';
    } else {
      const email = await gmailSearch(nl.query);
      if (!email) {
        log(`${nl.name}: no recent edition found`);
        return { id: nl.id, has_new_edition: false };
      }
      emailBody = email.body;
      emailSubject = email.subject;
      emailDate = email.date;
      emailSender = nl.sender || '';
    }

    log(`${nl.name}: found "${emailSubject}" — processing with Claude...`);
    const result = await claudeCall(
      `Analyze this newsletter edition for ${USER_NAME}.

NEWSLETTER: ${nl.name}
SENDER: ${emailSender}
SUBJECT: ${emailSubject}
DATE: ${emailDate}

CONTENT:
${emailBody}

Return a JSON object with this exact structure:
{
  "id": "${nl.id}",
  "name": "${nl.name}",
  "has_new_edition": true,
  "domain": "${nl.domain}",
  "layer1": {
    "summary": "2-3 sentences. What happened. Most important fact first.",
    "signals": [
      { "text": "Specific signal in one sentence with data if available", "domain": "D1|D2|D3|D4", "strength": "high|medium|low" }
    ],
    "relevance": "One sentence: why this edition matters for ${USER_NAME}'s specific domains.",
    "triage_suggestion": "Read|Skim|Skip",
    "triage_reason": "One sentence justifying the triage call."
  },
  "layer2": {
    "framing": "How does this newsletter frame the story? What lens are they using?",
    "stories": [
      { "headline": "Story headline", "content": "Full story detail with all numbers preserved verbatim" }
    ],
    "data_points": ["Every specific number, percentage, date, or named entity from the edition"],
    "implications": "2-3 sentences: concrete implications for ${USER_NAME}'s work, portfolio, or context.",
    "questions": ["1-2 sharp questions this edition raises that ${USER_NAME} should think about"],
    "reflection": "One genuinely useful question for ${USER_NAME} to reflect on — not generic."
  }
}

Rules:
- signals array: minimum 2, maximum 5. Only include genuinely signal-worthy items.
- data_points: extract EVERY number, stat, or named entity. Never paraphrase numbers.
- stories: include all major stories from the edition, not just one.
- If no new content (e.g. weekend digest, repeated content), set has_new_edition: false and return minimal layer1 only.`, 2500);
    log(`${nl.name}: processed successfully`);
    return result;
  } catch (err) {
    log(`${nl.name} ERROR: ${err.message}`);
    return { id: nl.id, has_new_edition: false, error: err.message };
  }
}

// ── Podcast Intelligence (Phase E) ────────────────────────────
function extractGuestHint(description, transcriptOpening) {
  const patterns = [
    /\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
    /\bfeat(?:uring)?\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
    /\bguest[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i,
    /\bjoined by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
  ];
  const text = `${description} ${transcriptOpening}`;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function searchGuestProfile(guestName) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
          messages: [{
            role: 'user',
            content: `Search for "${guestName}" and return a 2-3 sentence factual profile: who they are, what they're known for, their most notable work or role. Be concise and direct.`
          }]
        }),
      });
      if (resp.status === 429) {
        const waitMs = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        log(`[Guest Profile] Rate limited. Waiting ${Math.round(waitMs/1000)}s...`);
        await new Promise(r => setTimeout(r, waitMs));
        continue;
      }
      const data = await resp.json();
      const textBlock = data.content?.find(b => b.type === 'text');
      return textBlock?.text || '';
    } catch (err) {
      log(`[Guest Profile] Web search failed for ${guestName}: ${err.message}`);
      return '';
    }
  }
  log(`[Guest Profile] Rate limit exhausted for ${guestName}`);
  return '';
}

async function claudePodcastAnalysis(podcastName, podcastId, transcript, meta, guestWebProfile, primaryDomain) {
  const system = `You are analyzing a podcast episode for ${USER_NAME}.

## User Profile
${KNOWLEDGE.userProfile}

## Domain Guide
${KNOWLEDGE.domains}

Return ONLY valid JSON. No preamble. No markdown fences.
Preserve ALL quotes verbatim — exact words, never paraphrased.
For recommendations: only include items explicitly mentioned by name in the transcript.`;

  const prompt = `Analyze this podcast episode.

PODCAST: ${podcastName}
EPISODE: ${meta.episode_title}
DATE: ${meta.published_date}
URL: ${meta.url}
PRIMARY DOMAIN: ${primaryDomain}

${guestWebProfile ? `GUEST PROFILE (from web search):\n${guestWebProfile}\n` : ''}

EPISODE DESCRIPTION:
${meta.description}

TRANSCRIPT (up to 20,000 chars):
${transcript}

Return a JSON object matching this exact schema:

{
  "id": "${podcastId}",
  "name": "${podcastName}",
  "episode_title": "${meta.episode_title}",
  "episode_url": "${meta.url}",
  "published_date": "${meta.published_date}",

  "speakers": [
    {
      "name": "Host or Guest name — extract from transcript introduction",
      "role": "host|guest",
      "profile": "For guests only: 2-3 sentence profile. Use web search data if provided above. Extract from transcript introduction if not. Empty string for known hosts.",
      "profile_source": "transcript|web_search|both"
    }
  ],

  "layer1": {
    "summary": "3-4 sentences. What was this episode about? Lead with the most surprising or valuable idea.",
    "guest_in_one_line": "Guest name + why this conversation matters. Empty string if host-only.",
    "key_statements": ["3-5 standalone statements worth remembering independently"],
    "domain_tags": ["D1", "D2"],
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
            "text": "Verbatim quote — exact words from transcript",
            "context": "Why this quote matters"
          }
        ]
      }
    ],
    "hypotheses": [
      {
        "statement": "Bold claim or prediction made in the episode",
        "speaker": "Who made it",
        "evidence": "Their supporting reasoning or data",
        "domain": "D1|D2|D3|D4"
      }
    ],
    "domain_connections": {
      "D1": "Connection to Professional/AI/FDE or empty string",
      "D2": "Connection to Wealth/Crypto/DeFi or empty string",
      "D3": "Connection to Geopolitics/Gulf or empty string",
      "D4": "Connection to Personal Growth/Habitus or empty string"
    },
    "reflection": "One sharp question for the listener"
  },

  "recommendations": {
    "books": [{ "title": "", "author": "", "mentioned_by": "", "context": "" }],
    "podcasts": [{ "name": "", "mentioned_by": "", "context": "" }],
    "tools": [{ "name": "", "mentioned_by": "", "context": "" }],
    "people": [{ "name": "", "mentioned_by": "", "context": "" }],
    "articles_links": [{ "title": "", "mentioned_by": "", "context": "" }],
    "music": [{ "title": "", "mentioned_by": "", "context": "" }]
  }
}

Rules:
- topics: group by theme, minimum 2 topics, maximum 6.
- quotes: verbatim only. If you cannot find an exact quote, omit it rather than paraphrase.
- hypotheses: only include bold claims/predictions, not factual statements.
- recommendations: only items explicitly named in the transcript. Empty arrays for categories with nothing.
- key_statements: these should be quotable standalone — not summaries, but memorable formulations.`;

  const raw = await claudeCall(prompt, 4000);
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    log(`[Podcast] JSON parse failed for ${podcastName}: ${e.message}`);
    return null;
  }
}

async function processPodcast(podId, podInfo) {
  const today = todayISODate();
  const yesterday = new Date(dubaiNow());
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0,10);

  const candidateFiles = [
    join(TRANSCRIPTS_DIR, `${podId}-${today}.txt`),
    join(TRANSCRIPTS_DIR, `${podId}-${yesterdayStr}.txt`),
  ];

  const transcriptFile = candidateFiles.find(f => existsSync(f));
  if (!transcriptFile) { log(`${podInfo.name}: no transcript found`); return null; }

  // Determine which date's files to use
  const fileDate = transcriptFile.includes(today) ? today : yesterdayStr;

  log(`${podInfo.name}: processing transcript (Phase E intelligence)...`);
  const transcript = readFileSync(transcriptFile, 'utf8').slice(0, 20000);

  // Load metadata if available
  const metaPath = join(TRANSCRIPTS_DIR, `${podId}-${fileDate}-meta.json`);
  const meta = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : { episode_title: '', published_date: fileDate, description: '', url: '' };

  // Identify guest from description + transcript opening
  const guestHint = extractGuestHint(meta.description, transcript.slice(0, 3000));
  log(`${podInfo.name}: guest hint = ${guestHint || 'none (host-only)'}`);

  // Web search for guest profile if guest detected
  let guestWebProfile = '';
  if (guestHint) {
    log(`${podInfo.name}: searching web for guest profile: ${guestHint}...`);
    guestWebProfile = await searchGuestProfile(guestHint);
    if (guestWebProfile) log(`${podInfo.name}: guest profile obtained (${guestWebProfile.length} chars)`);
  }

  // Full podcast intelligence analysis
  return await claudePodcastAnalysis(podInfo.name, podId, transcript, meta, guestWebProfile, podInfo.domain);
}

async function fetchGrowth() {
  log('Generating growth layer...');
  const dow = dayOfWeek();
  const domains = {
    Monday:'Business & Strategy', Tuesday:'Finance & Investing',
    Wednesday:'Technology & AI', Thursday:'Leadership & Psychology',
    Friday:'Geopolitics & History', Saturday:'Innovation & Entrepreneurship',
    Sunday:'Wildcard',
  };
  return claudeCall(
    `Generate today's Growth Layer for ${USER_NAME}. Today: ${dow}, ${dubaiDateStr()}.

Return JSON:
{
  "small_talk_bridge":{
    "topic_hook":"Current hot topic (AI/crypto/Gulf/geopolitics)",
    "bridge":"Casual bridge phrase, max 2 sentences, zero jargon, usable at a ${USER_CITY} dinner party",
    "when_to_use":"Practical social context in ${USER_CITY}"
  },
  "arabic":{
    "word":"Arabic script","transliteration":"phonetic","pronunciation":"syllable guide e.g. mab-ROOK",
    "literal_meaning":"direct translation",
    "cultural_story":"2-3 sentences: real UAE street/social usage",
    "practice_sentence":"One sentence ${USER_NAME} could say this week"
  },
  "habitus":{
    "category":"the_activity|the_reference|network_insight|investment_lens|life_architecture",
    "title":"3-6 word title",
    "content":"3-4 sentences: SPECIFIC with real ${USER_CITY} place names, prices, events. Actionable within 30 days.",
    "why_it_matters":"One sentence: connection to ${USER_NAME}'s investor/entrepreneur/network goals"
  },
  "mini_concept":{
    "domain":"${domains[dow]||'Finance & Investing'}",
    "concept_name":"The concept",
    "five_sentences":["What it is","Where it comes from","Real example","Connection to ${USER_NAME}'s world","Open question"]
  }
}`, 1500);
}

// ═══════════════════════════════════════════════════════════════
// NOTION WRITER
// ═══════════════════════════════════════════════════════════════
function buildNotionBlocks(briefing) {
  const blocks = [];
  const cal     = briefing.calendar || {};
  const bdays   = briefing.birthdays || [];
  const growth  = briefing.growth || {};

  const rt = (text, opts={}) => ({
    type:'text', text:{ content: String(text||'') },
    annotations:{ bold:opts.bold||false, italic:opts.italic||false, color:opts.color||'default' },
  });
  const h2     = t => ({ object:'block', type:'heading_2',   heading_2:   { rich_text:[rt(t,{bold:true})] } });
  const h3     = t => ({ object:'block', type:'heading_3',   heading_3:   { rich_text:[rt(t)] } });
  const para   = (t,o={}) => ({ object:'block', type:'paragraph',  paragraph:  { rich_text:[rt(t,o)] } });
  const bul    = (t,o={}) => ({ object:'block', type:'bulleted_list_item', bulleted_list_item:{ rich_text:[rt(t,o)] } });
  const div    = ()       => ({ object:'block', type:'divider',    divider:{} });
  const callout = (t,e='📌') => ({ object:'block', type:'callout', callout:{ rich_text:[rt(t)], icon:{type:'emoji',emoji:e}, color:'gray_background' } });
  const quote  = t => ({ object:'block', type:'quote', quote:{ rich_text:[rt(t,{italic:true})] } });

  // Calendar
  blocks.push(h2('📅 Calendar'));
  bdays.forEach(b => blocks.push(callout(`${b.name} — ${b.note||'birthday today'}`, '🎂')));
  if (cal.focus_window) blocks.push(callout(`Focus window: ${cal.focus_window}`, '🎯'));
  (cal.today||[]).forEach(ev => {
    blocks.push(bul(`${ev.time} · ${ev.title}${ev.prep?' · Prep: '+ev.prep:''}`));
  });
  blocks.push(div());

  // Newsletters
  blocks.push(h2('📰 Newsletters'));
  const withEdition = (briefing.newsletters||[]).filter(n => n.has_new_edition);
  const noEdition   = (briefing.newsletters||[]).filter(n => !n.has_new_edition);

  withEdition.forEach(nl => {
    const l1 = nl.layer1||{}, l2 = nl.layer2||{};
    blocks.push(h3(`${nl.name||nl.id}  ·  ${nl.domain||''}`));
    if (l1.summary)  blocks.push(para(l1.summary, {bold:true}));
    if (l1.signals?.length) blocks.push(para('Signals: '+l1.signals.join(' · '), {color:'gray'}));
    if (l1.relevance) blocks.push(para(`→ ${l1.relevance}`, {italic:true, color:'green'}));
    if (l2.framing)  blocks.push(para(l2.framing));
    (l2.stories||[]).forEach(s => blocks.push(bul(`${s.title}: ${s.content}`)));
    if (l2.data_points?.length) blocks.push(para('Data: '+l2.data_points.join(' · '), {color:'gray'}));
    if (l2.notable_quotes?.length) blocks.push(quote(l2.notable_quotes[0]));
    (l2.implications_for_patrik||[]).forEach(i => blocks.push(bul(i, {color:'green'})));
    if (l2.reflection_question) blocks.push(callout(l2.reflection_question, '🤔'));
    blocks.push(div());
  });
  if (noEdition.length) {
    blocks.push(para(`No new edition: ${noEdition.map(n=>n.id).join(', ')}`, {color:'gray',italic:true}));
    blocks.push(div());
  }

  // Podcasts (Phase E: layer1/layer2 format)
  if (briefing.podcasts?.length) {
    blocks.push(h2('🎙 Podcasts'));
    briefing.podcasts.forEach(pod => {
      if (!pod) return;
      const l1 = pod.layer1||{}, l2 = pod.layer2||{}, speakers = pod.speakers||[], recs = pod.recommendations||{};
      const domain = (l1.domain_tags||[]).join(' · ');
      blocks.push(h3(`${pod.name}${domain ? '  ·  '+domain : ''}`));
      if (pod.episode_title) blocks.push(para(`${pod.episode_title}${pod.published_date ? '  ·  '+pod.published_date : ''}`, {italic:true, color:'gray'}));
      if (l1.guest_in_one_line) blocks.push(para(`Guest: ${l1.guest_in_one_line}`, {color:'blue'}));
      if (l1.summary) blocks.push(para(l1.summary, {bold:true}));
      if (l1.triage) blocks.push(para(`${l1.triage}${l1.signal_strength ? '  ·  '+l1.signal_strength+' signal' : ''}`, {color: l1.triage==='Must Listen' ? 'green' : 'gray'}));
      if (l1.key_statements?.length) {
        blocks.push(para('Key Statements:', {bold:true}));
        l1.key_statements.forEach(s => blocks.push(bul(s)));
      }
      speakers.filter(s => s.role==='guest' && s.profile).forEach(s => {
        blocks.push(callout(`${s.name}: ${s.profile}`, '👤'));
      });
      (l2.topics||[]).forEach(t => {
        blocks.push(para(t.title, {bold:true}));
        if (t.summary) blocks.push(para(t.summary));
        (t.insights||[]).forEach(i => blocks.push(bul(i)));
        (t.quotes||[]).forEach(q => blocks.push(quote(`"${q.text}"${q.speaker ? ' — '+q.speaker : ''}`)));
      });
      if (l2.hypotheses?.length) {
        blocks.push(para('Hypotheses & Bold Claims:', {bold:true}));
        l2.hypotheses.forEach(h => blocks.push(bul(`⚡ ${h.statement}${h.speaker ? ' — '+h.speaker : ''}${h.evidence ? ' ('+h.evidence+')' : ''}`)));
      }
      const emojiMap = {books:'📚',podcasts:'🎙',tools:'🛠',people:'👤',articles_links:'🔗',music:'🎵'};
      const recEntries = Object.entries(recs).filter(([,v]) => Array.isArray(v) && v.length && v.some(item => (item.title||item.name||'').trim()));
      if (recEntries.length) {
        blocks.push(para('Recommendations:', {bold:true}));
        recEntries.forEach(([cat, items]) => {
          items.filter(item => (item.title||item.name||'').trim()).forEach(item => {
            const label = item.title||item.name;
            const author = item.author ? ` by ${item.author}` : '';
            const via = item.mentioned_by ? ` (via ${item.mentioned_by})` : '';
            blocks.push(bul(`${emojiMap[cat]||'•'} ${label}${author}${via}`));
          });
        });
      }
      if (l2.reflection) blocks.push(callout(l2.reflection, '🤔'));
      blocks.push(div());
    });
    // Machine-readable JSON code block for podcast-read.js
    const podcastJson = JSON.stringify(briefing.podcasts);
    // Notion code block content max 2000 chars per rich_text — split if needed
    const chunks = [];
    for (let i = 0; i < podcastJson.length; i += 2000) chunks.push(podcastJson.slice(i, i+2000));
    blocks.push({ object:'block', type:'code', code: {
      rich_text: chunks.map(c => rt(c)),
      language: 'json',
      caption: [rt('<!-- PODCAST_JSON -->')]
    }});
  }

  // Grow
  blocks.push(h2('🌱 Grow'));
  if (growth.small_talk_bridge) {
    const sb = growth.small_talk_bridge;
    blocks.push(h3('Small Talk Bridge'));
    blocks.push(para(`Hook: ${sb.topic_hook}`, {italic:true}));
    blocks.push(para(`"${sb.bridge}"`, {bold:true}));
    if (sb.when_to_use) blocks.push(para(sb.when_to_use, {color:'gray'}));
  }
  if (growth.arabic) {
    const ar = growth.arabic;
    blocks.push(h3('Arabic · كلمة اليوم'));
    blocks.push(para(`${ar.word} — ${ar.transliteration} (${ar.pronunciation})`, {bold:true}));
    blocks.push(para(ar.cultural_story));
    if (ar.practice_sentence) blocks.push(callout(ar.practice_sentence, '🗣'));
  }
  if (growth.habitus) {
    const h = growth.habitus;
    blocks.push(h3(`Habitus · ${h.category||'inspiration'}`));
    blocks.push(para(h.title, {bold:true}));
    blocks.push(para(h.content));
    if (h.why_it_matters) blocks.push(para(h.why_it_matters, {italic:true, color:'green'}));
  }
  if (growth.mini_concept) {
    const mc = growth.mini_concept;
    blocks.push(h3(`Mini-Concept · ${mc.domain}`));
    blocks.push(para(mc.concept_name, {bold:true}));
    (mc.five_sentences||[]).forEach(s => blocks.push(para(s)));
  }

  return blocks;
}

async function withRetry(fn, maxAttempts = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      log(`[Retry] Attempt ${attempt} failed: ${err.message}. Retrying in ${delayMs * attempt}ms...`);
      await new Promise(r => setTimeout(r, delayMs * attempt));
    }
  }
}

async function writeToNotion(briefing) {
  log('Writing to Notion...');

  // Check for existing briefing today to prevent duplicates
  const today = todayISODate();
  try {
    const checkResp = await fetchWithRetry(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        filter: { property: 'Date', date: { equals: today } },
        page_size: 1,
      }),
    }, { label: 'Notion dedup query' });
    if (checkResp.ok) {
      const existing = await checkResp.json();
      if (existing.results && existing.results.length > 0) {
        const existingId = existing.results[0].id;
        log(`Duplicate detected for ${today} — archiving old page ${existingId}`);
        await fetchWithRetry(`https://api.notion.com/v1/pages/${existingId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${NOTION_KEY}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28',
          },
          body: JSON.stringify({ archived: true }),
        }, { label: 'Notion archive old page' });
      }
    }
  } catch (err) {
    log(`Dedup check failed (non-fatal): ${err.message}`);
  }

  const bdays = briefing.birthdays||[];
  const bdayNote = bdays.length ? ` 🎂 ${bdays.map(b=>b.name.split(' ')[0]).join(', ')}` : '';
  const pageTitle = `Morning OS · ${dayOfWeek()}, ${dubaiDateShort()}${bdayNote}`;

  const allBlocks = buildNotionBlocks(briefing);

  const createResp = await fetchWithRetry('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_KEY}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_DB_ID },
      properties: {
        Name: { title: [{ type:'text', text:{ content: pageTitle } }] },
        Date: { date: { start: todayISODate() } },
      },
      children: allBlocks.slice(0, 100),
    }),
  }, { label: 'Notion create page' });

  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Notion failed: ${createResp.status} — ${err.slice(0,300)}`);
  }

  const page = await createResp.json();
  const pageId = page.id;

  // Append remaining blocks if > 100
  for (let i = 100; i < allBlocks.length; i += 100) {
    const batchNum = Math.floor(i/100) + 1;
    const appendResp = await fetchWithRetry(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ children: allBlocks.slice(i, i+100) }),
    }, { label: `Notion append blocks batch ${batchNum}` });
    if (!appendResp.ok) {
      log(`Warning: block append batch ${batchNum} failed (HTTP ${appendResp.status}) — page may be incomplete`);
    }
  }

  return `https://notion.so/${pageId.replace(/-/g,'')}`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  log(`=== Morning OS v2 Started — ${dubaiDateStr()} ===`);

  // Gmail auto-discovery with fallback to hardcoded list
  let activeNewsletters;
  let discoveryMode = 'fallback';
  try {
    const discovered = await discoverNewsletters();
    if (discovered.length > 0) {
      activeNewsletters = discovered;
      discoveryMode = 'auto';
      log(`[Discovery] Using auto-discovery mode: ${discovered.length} newsletters`);
    } else {
      throw new Error('No newsletters discovered');
    }
  } catch (err) {
    log(`[Discovery] Falling back to hardcoded list: ${err.message}`);
    activeNewsletters = (process.env.ACTIVE_NEWSLETTERS||'a16z,bankless,pomp,tldr,semafor,intrigue,lenny,chamath,timeout')
      .split(',').map(s=>s.trim()).filter(Boolean)
      .map(id => ALL_NEWSLETTERS.find(n=>n.id===id)).filter(Boolean);
  }

  // Load active podcasts from config.json (PWA settings) or env var fallback
  let activePodcasts = [];
  const configPath = join(ROOT, 'config.json');
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      if (Array.isArray(cfg.active_podcasts) && cfg.active_podcasts.length > 0) {
        activePodcasts = cfg.active_podcasts;
        log(`Loaded ${activePodcasts.length} podcasts from config.json`);
      }
    } catch (e) { log(`config.json parse error: ${e.message}`); }
  }
  if (!activePodcasts.length) {
    activePodcasts = (process.env.ACTIVE_PODCASTS||'')
      .split(',').map(s=>s.trim()).filter(Boolean);
  }

  log(`Newsletters (${discoveryMode}): ${activeNewsletters.map(n=>n.name).join(', ')}`);

  // Calendar + Growth in parallel (no Claude API calls)
  const [calResult, growthResult] = await Promise.allSettled([
    fetchCalendar(),
    fetchGrowth(),
  ]);

  // Newsletters sequentially to respect Claude API rate limits (30k tokens/min)
  const nlResults = [];
  for (const nl of activeNewsletters) {
    try {
      const result = await fetchNewsletter(nl);
      nlResults.push({ status: 'fulfilled', value: result });
    } catch (err) {
      log(`Newsletter ${nl.name} ERROR: ${err.message}`);
      nlResults.push({ status: 'rejected', reason: err });
    }
  }

  // Podcasts sequential
  const podcasts = [];
  for (const podId of activePodcasts) {
    const podInfo = PODCAST_DIRECTORY[podId];
    if (!podInfo) continue;
    try {
      const result = await processPodcast(podId, podInfo);
      if (result) podcasts.push(result);
    } catch(err) { log(`Podcast ${podId} ERROR: ${err.message}`); }
  }

  const calData = calResult.status==='fulfilled' ? calResult.value : {};
  const nlProcessed = nlResults.map((r,i) =>
    r.status==='fulfilled' ? r.value : { id: activeNewsletters[i].id, has_new_edition:false }
  );
  // Generate opening statement for v2 frontend
  let opening = null;
  try {
    const highSignalNLs = nlProcessed
      .filter(n => n.has_new_edition)
      .map(n => ({ name: n.id, summary: n.layer1?.summary, signals: n.layer1?.signals, domain: n.domain }));
    if (highSignalNLs.length > 0) {
      log('[Opening] Generating opening statement...');
      opening = await claudeCall(`Based on today's processed intelligence, write the opening statement for ${USER_NAME}'s morning briefing.

Processed newsletters today:
${JSON.stringify(highSignalNLs, null, 2)}

Return JSON:
{
  "headline": "Single most important sentence from today. Max 18 words. Present tense. Specific. Not generic.",
  "context": "Exactly 2 sentences. Why this matters specifically for ${USER_NAME}'s domains.",
  "signal_pills": [{ "label": "2-3 word topic", "domain": "D1|D2|D3|D4" }]
}

Rules:
- headline: must be about a SPECIFIC story/signal, not a category
- signal_pills: maximum 3, only genuinely high-signal topics from today
- If today is low-signal, say so honestly`, 500);
      log('[Opening] Done.');
    }
  } catch (err) {
    log(`[Opening] Failed (non-fatal): ${err.message}`);
    opening = { headline: "Today's intelligence briefing is ready.", context: "Review the signals below.", signal_pills: [] };
  }

  const briefing = {
    _meta: {
      generated_at: new Date().toISOString(),
      newsletter_count: nlProcessed.filter(n => n.has_new_edition).length,
      discovery_mode: discoveryMode,
      version: '2.0',
    },
    generated_at: new Date().toISOString(),
    _opening: opening,
    calendar:  calData.today ? { today: calData.today, focus_window: calData.focus_window } : null,
    birthdays: calData.birthdays || [],
    growth:    growthResult.status==='fulfilled' ? growthResult.value : null,
    newsletters: nlProcessed,
    podcasts,
  };

  try {
    const url = await withRetry(() => writeToNotion(briefing));
    log(`✅ Notion page: ${url}`);
  } catch(err) {
    log(`Notion FAILED (after retries): ${err.message}`);
  }

  // Always write static briefing.json for the frontend app (avoids CORS issues with Notion API)
  const staticPath = join(ROOT, 'briefing.json');
  writeFileSync(staticPath, JSON.stringify(briefing, null, 2));
  log(`Static briefing written to ${staticPath}`);

  // Archive today's briefing (Phase D — daily archive for weekly synthesis)
  const archiveDir = join(ROOT, 'archive');
  mkdirSync(archiveDir, { recursive: true });
  const archiveFile = join(archiveDir, `${todayISODate()}.json`);
  writeFileSync(archiveFile, JSON.stringify(briefing, null, 2));
  log(`[Archive] Saved briefing to archive/${todayISODate()}.json`);

  // Cap archive at 90 days
  const archiveFiles = readdirSync(archiveDir).filter(f => f.endsWith('.json')).sort();
  if (archiveFiles.length > 90) {
    archiveFiles.slice(0, archiveFiles.length - 90).forEach(f => {
      unlinkSync(join(archiveDir, f));
      log(`[Archive] Pruned old file: ${f}`);
    });
  }

  const nlSuccess = briefing.newsletters.filter(n=>n.has_new_edition).length;
  log(`=== Done in ${((Date.now()-t0)/1000).toFixed(1)}s · ${nlSuccess}/${activeNewsletters.length} newsletters · ${podcasts.length} podcasts ===`);
}

main().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
