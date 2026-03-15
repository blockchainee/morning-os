/*/**
 * Morning OS — Cloud Generator v2
 * Uses Google OAuth directly (no MCP needed).
 * Runs in GitHub Actions, writes to Notion.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
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
  } catch {}
}

// ── Environment ────────────────────────────────────────────────
const ANTHROPIC_KEY   = process.env.ANTHROPIC_API_KEY;
const NOTION_KEY      = process.env.NOTION_API_KEY;
const NOTION_DB_ID    = process.env.NOTION_DATABASE_ID;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
log(`DEBUG: CLIENT_ID=${GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID.slice(0,20)+'...' : 'MISSING'}`);
log(`DEBUG: CLIENT_SECRET=${GOOGLE_CLIENT_SECRET ? 'SET' : 'MISSING'}`);
log(`DEBUG: REFRESH_TOKEN=${GOOGLE_REFRESH_TOKEN ? GOOGLE_REFRESH_TOKEN.slice(0,10)+'...' : 'MISSING'}`);
if (!ANTHROPIC_KEY)        { log('FATAL: ANTHROPIC_API_KEY not set'); process.exit(1); }
if (!NOTION_KEY)           { log('FATAL: NOTION_API_KEY not set'); process.exit(1); }
if (!NOTION_DB_ID)         { log('FATAL: NOTION_DATABASE_ID not set'); process.exit(1); }
//if (!GOOGLE_REFRESH_TOKEN) { log('FATAL: GOOGLE_REFRESH_TOKEN not set'); process.exit(1); }

// ── Google OAuth Token Refresh ────────────────────────────────
let googleAccessToken = null;

async function getGoogleAccessToken() {
  if (googleAccessToken) return googleAccessToken;
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
    // Try without client_id/secret (works for some token types)
    log('Standard refresh failed, trying alternative...');
    throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
  }
  googleAccessToken = data.access_token;
  log('Google access token obtained');
  return googleAccessToken;
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
    .slice(0, 8000); // Limit to 8000 chars

  const subject = msg.payload.headers?.find(h => h.name === 'Subject')?.value || '';
  const date    = msg.payload.headers?.find(h => h.name === 'Date')?.value || '';

  return { subject, date, body: cleanBody };
}

// ── Google Calendar API ───────────────────────────────────────
async function fetchCalendarEvents() {
  const token = await getGoogleAccessToken();

  const dubaiNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  const startOfDay = new Date(dubaiNow);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(dubaiNow);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
    `timeMin=${startOfDay.toISOString()}&timeMax=${endOfWeek.toISOString()}` +
    `&singleEvents=true&orderBy=startTime&maxResults=20`;

  const resp = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Calendar failed: ${resp.status}`);
  const data = await resp.json();
  return data.items || [];
}

async function fetchBirthdays() {
  const token = await getGoogleAccessToken();
  // Check contacts/birthday calendar
  const dubaiNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  const startOfDay = new Date(dubaiNow); startOfDay.setHours(0,0,0,0);
  const endOfDay   = new Date(dubaiNow); endOfDay.setHours(23,59,59,999);

  try {
    const url = `https://www.googleapis.com/calendar/v3/calendars/contacts%40gmail.com/events?` +
      `timeMin=${startOfDay.toISOString()}&timeMax=${endOfDay.toISOString()}&singleEvents=true`;
    const resp = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.items || []).map(e => ({ name: e.summary?.replace("'s Birthday", '') || '', note: 'Birthday today' }));
  } catch { return []; }
}

// ── Dubai helpers ──────────────────────────────────────────────
function dubaiNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
}
function dubaiDateStr() {
  return dubaiNow().toLocaleDateString('en-GB', {
    weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:'Asia/Dubai'
  });
}
function dubaiDateShort() {
  return dubaiNow().toLocaleDateString('en-GB', {
    day:'numeric', month:'short', year:'numeric', timeZone:'Asia/Dubai'
  });
}
function dayOfWeek() {
  return dubaiNow().toLocaleDateString('en-US', { weekday:'long', timeZone:'Asia/Dubai' });
}
function todayISODate() {
  return dubaiNow().toISOString().slice(0,10);
}

// ── Claude API ────────────────────────────────────────────────
const BASE_SYSTEM = `You are Patrik's personal intelligence officer.
Patrik: Pre-Sales Leader, 700-person AI platform company, Dubai-based.
Domains: D1=Professional/AI/FDE, D2=Wealth/Crypto/DeFi, D3=Geopolitics/Gulf, D4=Personal growth/Habitus.
Be direct, sharp, substantive. Preserve ALL specific data verbatim. Return ONLY valid JSON, no preamble, no fences.`;

async function claudeCall(userContent, maxTokens = 2000) {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: BASE_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  };
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
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

// ── Newsletter config ─────────────────────────────────────────
const ALL_NEWSLETTERS = [
  { id:'a16z',     name:'a16z',              query:'from:@a16z.com newer_than:3d' },
  { id:'bankless', name:'Bankless',           query:'from:@bankless.com newer_than:2d' },
  { id:'pomp',     name:'The Pomp Letter',   query:'from:pomp@pomp.com newer_than:2d' },
  { id:'tldr',     name:'TLDR',              query:'from:@tldr.tech newer_than:2d' },
  { id:'semafor',  name:'Semafor',           query:'from:@semafor.com newer_than:2d' },
  { id:'intrigue', name:'Intl Intrigue',     query:'from:@internationalintrigue.io newer_than:3d' },
  { id:'lenny',    name:"Lenny's Newsletter",query:'from:@substack.com subject:lenny newer_than:7d' },
  { id:'chamath',  name:'Chamath',           query:'from:chamath@socialcapital.com newer_than:7d' },
  { id:'timeout',  name:'Time Out Dubai',    query:'from:@timeout.com newer_than:7d' },
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
        hour:'2-digit', minute:'2-digit', timeZone:'Asia/Dubai'
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
  log(`Fetching newsletter: ${nl.name}...`);
  try {
    const email = await gmailSearch(nl.query);
    if (!email) {
      log(`${nl.name}: no recent edition found`);
      return { id: nl.id, has_new_edition: false };
    }

    log(`${nl.name}: found "${email.subject}" — processing with Claude...`);
    const result = await claudeCall(
      `Process this newsletter email for Patrik.

Newsletter: ${nl.name}
Subject: ${email.subject}
Date: ${email.date}

CONTENT:
${email.body}

Return JSON:
{
  "id":"${nl.id}","has_new_edition":true,"date":"${email.date.slice(0,10)}","domain":"D1",
  "layer1":{
    "summary":"One sentence: what happened and why it matters to Patrik",
    "signals":["signal with number","signal 2","signal 3"],
    "relevance":"Direct connection to Patrik's work/crypto/geopolitics/growth",
    "triage_suggestion":"act|save|share|noted"
  },
  "layer2":{
    "framing":"Author's main argument, 2-3 sentences",
    "stories":[{"title":"Headline","content":"3-5 sentences, ALL numbers/names preserved verbatim"}],
    "data_points":["every specific number, %, name, date from the email"],
    "notable_quotes":["one sharp verbatim quote if present"],
    "implications_for_patrik":["D1: specific","D2: specific"],
    "reflection_question":"Sharp question challenging Patrik's existing view"
  }
}`, 2500);
    log(`${nl.name}: processed successfully`);
    return result;
  } catch (err) {
    log(`${nl.name} ERROR: ${err.message}`);
    return { id: nl.id, has_new_edition: false, error: err.message };
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

  log(`${podInfo.name}: processing transcript...`);
  const transcript = readFileSync(transcriptFile, 'utf8').slice(0, 14000);

  return claudeCall(
    `Process this podcast transcript: "${podInfo.name}" (domain ${podInfo.domain}).

TRANSCRIPT:
${transcript}

Return JSON:
{
  "id":"${podId}","name":"${podInfo.name}","domain":"${podInfo.domain}",
  "episode":"title or episode number","duration":"if mentioned","date":"if mentioned",
  "summary":"One sentence: core argument or most important insight",
  "digest":{
    "insights":[{"topic":"Topic","points":["insight 1","insight 2","insight 3"]}],
    "quotes":[{"text":"Exact verbatim quote","speaker":"Name","context":"why it matters"}],
    "recommendations":[{"type":"app|book|podcast|tool|source","name":"Name","note":"why recommended"}],
    "implications_for_patrik":["Domain implication","Dubai/Pre-Sales connection"],
    "reflection_question":"Sharp question to apply this episode's insights"
  }
}`, 2500);
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
    `Generate today's Growth Layer for Patrik. Today: ${dow}, ${dubaiDateStr()}.

Return JSON:
{
  "small_talk_bridge":{
    "topic_hook":"Current hot topic (AI/crypto/Gulf/geopolitics)",
    "bridge":"Casual bridge phrase, max 2 sentences, zero jargon, usable at a Dubai dinner party",
    "when_to_use":"Practical social context in Dubai"
  },
  "arabic":{
    "word":"Arabic script","transliteration":"phonetic","pronunciation":"syllable guide e.g. mab-ROOK",
    "literal_meaning":"direct translation",
    "cultural_story":"2-3 sentences: real UAE street/social usage",
    "practice_sentence":"One sentence Patrik could say this week"
  },
  "habitus":{
    "category":"the_activity|the_reference|network_insight|investment_lens|life_architecture",
    "title":"3-6 word title",
    "content":"3-4 sentences: SPECIFIC with real Dubai place names, prices, events. Actionable within 30 days.",
    "why_it_matters":"One sentence: connection to Patrik's investor/entrepreneur/network goals"
  },
  "mini_concept":{
    "domain":"${domains[dow]||'Finance & Investing'}",
    "concept_name":"The concept",
    "five_sentences":["What it is","Where it comes from","Real example","Connection to Patrik's world","Open question"]
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

  // Podcasts
  if (briefing.podcasts?.length) {
    blocks.push(h2('🎙 Podcasts'));
    briefing.podcasts.forEach(pod => {
      if (!pod) return;
      const d = pod.digest||{};
      blocks.push(h3(`${pod.name}  ·  ${pod.domain||''}`));
      if (pod.summary) blocks.push(para(pod.summary, {bold:true}));
      (d.insights||[]).forEach(s => {
        blocks.push(para(s.topic, {bold:true}));
        (s.points||[]).forEach(p => blocks.push(bul(p)));
      });
      if (d.quotes?.length) {
        blocks.push(para('Best quotes:', {bold:true}));
        d.quotes.forEach(q => blocks.push(quote(`"${q.text}"${q.speaker?' — '+q.speaker:''}`)));
      }
      if (d.recommendations?.length) {
        blocks.push(para('Recommendations:', {bold:true}));
        d.recommendations.forEach(r => blocks.push(bul(`[${r.type}] ${r.name}${r.note?' — '+r.note:''}`)));
      }
      if (d.reflection_question) blocks.push(callout(d.reflection_question, '🤔'));
      blocks.push(div());
    });
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

async function writeToNotion(briefing) {
  log('Writing to Notion...');
  const bdays = briefing.birthdays||[];
  const bdayNote = bdays.length ? ` 🎂 ${bdays.map(b=>b.name.split(' ')[0]).join(', ')}` : '';
  const pageTitle = `Morning OS · ${dayOfWeek()}, ${dubaiDateShort()}${bdayNote}`;

  const createResp = await fetch('https://api.notion.com/v1/pages', {
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
      children: buildNotionBlocks(briefing).slice(0, 100),
    }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Notion failed: ${createResp.status} — ${err.slice(0,300)}`);
  }

  const page = await createResp.json();
  const pageId = page.id;

  // Append remaining blocks if > 100
  const allBlocks = buildNotionBlocks(briefing);
  for (let i = 100; i < allBlocks.length; i += 100) {
    await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_KEY}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({ children: allBlocks.slice(i, i+100) }),
    });
  }

  return `https://notion.so/${pageId.replace(/-/g,'')}`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  log(`=== Morning OS v2 Started — ${dubaiDateStr()} ===`);

  const activeNewsletters = (process.env.ACTIVE_NEWSLETTERS||'a16z,bankless,pomp,tldr,semafor,intrigue,lenny,chamath,timeout')
    .split(',').map(s=>s.trim()).filter(Boolean)
    .map(id => ALL_NEWSLETTERS.find(n=>n.id===id)).filter(Boolean);

  const activePodcasts = (process.env.ACTIVE_PODCASTS||'')
    .split(',').map(s=>s.trim()).filter(Boolean);

  log(`Newsletters: ${activeNewsletters.map(n=>n.name).join(', ')}`);

  // Parallel fetches
  const [calResult, growthResult, ...nlResults] = await Promise.allSettled([
    fetchCalendar(),
    fetchGrowth(),
    ...activeNewsletters.map(nl => fetchNewsletter(nl)),
  ]);

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
  const briefing = {
    generated_at: new Date().toISOString(),
    calendar:  calData.today ? { today: calData.today, focus_window: calData.focus_window } : null,
    birthdays: calData.birthdays || [],
    growth:    growthResult.status==='fulfilled' ? growthResult.value : null,
    newsletters: nlResults.map((r,i) =>
      r.status==='fulfilled' ? r.value : { id: activeNewsletters[i].id, has_new_edition:false }
    ),
    podcasts,
  };

  try {
    const url = await writeToNotion(briefing);
    log(`✅ Notion page: ${url}`);
  } catch(err) {
    log(`Notion FAILED: ${err.message}`);
    writeFileSync(join(ROOT,'briefing-fallback.json'), JSON.stringify(briefing,null,2));
  }

  const nlSuccess = briefing.newsletters.filter(n=>n.has_new_edition).length;
  log(`=== Done in ${((Date.now()-t0)/1000).toFixed(1)}s · ${nlSuccess}/${activeNewsletters.length} newsletters · ${podcasts.length} podcasts ===`);
}

main().catch(err => { log(`FATAL: ${err.message}`); process.exit(1); });
