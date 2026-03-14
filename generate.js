/**
 * Morning OS — Cloud Generator
 * Runs inside GitHub Actions.
 * Fetches Gmail + Calendar via Claude MCP, processes podcasts,
 * generates growth layer, then writes everything to Notion.
 */

import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'fs';
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
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const NOTION_KEY    = process.env.NOTION_API_KEY;
const NOTION_DB_ID  = process.env.NOTION_DATABASE_ID;

if (!ANTHROPIC_KEY) { log('FATAL: ANTHROPIC_API_KEY not set'); process.exit(1); }
if (!NOTION_KEY)    { log('FATAL: NOTION_API_KEY not set'); process.exit(1); }
if (!NOTION_DB_ID)  { log('FATAL: NOTION_DATABASE_ID not set'); process.exit(1); }

// ── MCP Servers ────────────────────────────────────────────────
const MCP_GMAIL = { type: 'url', url: 'https://gmail.mcp.claude.com/mcp',  name: 'gmail' };
const MCP_GCAL  = { type: 'url', url: 'https://gcal.mcp.claude.com/mcp',   name: 'gcal'  };
const MCP_NOTION = { type: 'url', url: 'https://mcp.notion.com/mcp',       name: 'notion' };

// ── Helpers ────────────────────────────────────────────────────
function dubaiNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
}
function dubaiDateStr() {
  return dubaiNow().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai'
  });
}
function dubaiDateShort() {
  return dubaiNow().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Dubai'
  });
}
function dayOfWeek() {
  return dubaiNow().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dubai' });
}
function todayISODate() {
  return dubaiNow().toISOString().slice(0, 10);
}

// ── Claude API ─────────────────────────────────────────────────
const BASE_SYSTEM = `You are Patrik's personal intelligence officer.
Patrik: Pre-Sales Leader, 700-person AI platform company, Dubai-based.
Domains: D1=Professional/AI/FDE, D2=Wealth/Crypto/DeFi, D3=Geopolitics/Gulf, D4=Personal growth/Habitus.
Be direct, sharp, substantive. Preserve ALL specific data verbatim. Return ONLY valid JSON, no preamble, no fences.`;

async function claudeCall(userContent, mcpServers = [], maxTokens = 2000) {
  const body = {
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: BASE_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
  };
  if (mcpServers.length) body.mcp_servers = mcpServers;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'mcp-client-2025-04-04',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`Claude API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);

  const data = await resp.json();
  const text = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  try { return JSON.parse(clean); }
  catch {
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`JSON parse failed: ${clean.slice(0, 300)}`);
  }
}

// ── Newsletter config ──────────────────────────────────────────
const ALL_NEWSLETTERS = [
  { id: 'a16z',     name: 'a16z',              query: 'from:@a16z.com newer_than:3d' },
  { id: 'bankless', name: 'Bankless',           query: 'from:@bankless.com newer_than:2d' },
  { id: 'pomp',     name: 'The Pomp Letter',    query: 'from:pomp@pomp.com newer_than:2d' },
  { id: 'tldr',     name: 'TLDR',               query: 'from:@tldr.tech newer_than:2d' },
  { id: 'semafor',  name: 'Semafor',            query: 'from:@semafor.com newer_than:2d' },
  { id: 'intrigue', name: 'Intl Intrigue',      query: 'from:@internationalintrigue.io newer_than:3d' },
  { id: 'lenny',    name: "Lenny's Newsletter", query: 'from:@substack.com subject:lenny newer_than:7d' },
  { id: 'chamath',  name: 'Chamath',            query: 'from:chamath@socialcapital.com newer_than:7d' },
  { id: 'timeout',  name: 'Time Out Dubai',     query: 'from:@timeout.com newer_than:7d' },
];

const PODCAST_DIRECTORY = {
  'bankless':          { name: 'Bankless',                domain: 'D2' },
  'lex-fridman':       { name: 'Lex Fridman Podcast',     domain: 'D1' },
  'my-first-million':  { name: 'My First Million',        domain: 'D2' },
  'knowledge-project': { name: 'The Knowledge Project',   domain: 'D1' },
  'tim-ferriss':       { name: 'The Tim Ferriss Show',    domain: 'D4' },
  'all-in':            { name: 'All-In Podcast',          domain: 'D2' },
  'huberman':          { name: 'Huberman Lab',            domain: 'D4' },
  'invest-like-best':  { name: 'Invest Like the Best',   domain: 'D2' },
  'acquired':          { name: 'Acquired',                domain: 'D1' },
  'diary-of-ceo':      { name: 'The Diary of a CEO',      domain: 'D4' },
};

// ═══════════════════════════════════════════════════════════════
// FETCH MODULES
// ═══════════════════════════════════════════════════════════════

async function fetchCalendar() {
  log('Fetching calendar + birthdays...');
  return claudeCall(
    `Use Google Calendar MCP to fetch today's events (${dubaiDateStr()}, timezone Asia/Dubai UTC+4).
Also check the Birthdays calendar for any birthdays today.
Identify focus windows (90+ min gaps between meetings).

Return JSON:
{
  "today": [{"time":"09:30","title":"Name","duration":"45min","type":"external","prep":"prep note if external","note":"context"}],
  "week_preview": [{"day":"Mon","count":3,"heavy":false}],
  "focus_window": "14:00–16:00",
  "birthdays": [{"name":"Full Name","relationship":"colleague","note":"context"}]
}`,
    [MCP_GCAL]
  );
}

async function fetchNewsletter(nl) {
  log(`Fetching newsletter: ${nl.name}...`);
  return claudeCall(
    `Use Gmail MCP: search for "${nl.query}". Read the most recent email found.
If nothing found in that timeframe: return {"id":"${nl.id}","has_new_edition":false}.

Return JSON:
{
  "id":"${nl.id}","has_new_edition":true,"date":"14 Mar","domain":"D1",
  "layer1":{
    "summary":"One sentence: what + why it matters to Patrik",
    "signals":["specific signal with number","signal 2","signal 3"],
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
}`,
    [MCP_GMAIL], 2500
  );
}

async function processPodcast(podId, podInfo) {
  const today = todayISODate();
  const yesterday = new Date(dubaiNow());
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const candidateFiles = [
    join(TRANSCRIPTS_DIR, `${podId}-${today}.txt`),
    join(TRANSCRIPTS_DIR, `${podId}-${yesterdayStr}.txt`),
  ];

  const transcriptFile = candidateFiles.find(f => existsSync(f));
  if (!transcriptFile) {
    log(`${podInfo.name}: no transcript found, skipping`);
    return null;
  }

  log(`${podInfo.name}: processing transcript...`);
  const transcript = readFileSync(transcriptFile, 'utf8').slice(0, 14000);

  return claudeCall(
    `Process this podcast transcript: "${podInfo.name}" (domain ${podInfo.domain}).

TRANSCRIPT:
${transcript}

Return JSON:
{
  "id":"${podId}","name":"${podInfo.name}","domain":"${podInfo.domain}",
  "episode":"title or episode number","duration":"duration if mentioned","date":"date if mentioned",
  "summary":"One sentence: core argument or most important insight",
  "digest":{
    "insights":[
      {"topic":"Topic category","points":["insight with data preserved","insight 2","insight 3"]}
    ],
    "quotes":[
      {"text":"Exact verbatim quote — sharpest lines only","speaker":"Name","context":"why it matters"}
    ],
    "recommendations":[
      {"type":"app|book|podcast|tool|person|source","name":"Name","note":"why recommended"}
    ],
    "implications_for_patrik":["Domain ${podInfo.domain} implication","Dubai/Pre-Sales/crypto connection"],
    "reflection_question":"Sharp question to apply this episode's insights"
  }
}`,
    [], 2500
  );
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
    "cultural_story":"2-3 sentences: real UAE street/social usage, not textbook",
    "practice_sentence":"One sentence Patrik could say this week"
  },
  "habitus":{
    "category":"the_activity|the_reference|network_insight|investment_lens|life_architecture",
    "title":"3-6 word title",
    "content":"3-4 sentences: SPECIFIC with real Dubai place names, real prices, real events. Must be actionable within 30 days.",
    "why_it_matters":"One sentence: connection to Patrik's investor/entrepreneur/network goals"
  },
  "mini_concept":{
    "domain":"${domains[dow] || 'Finance & Investing'}",
    "concept_name":"The concept",
    "five_sentences":["What it is","Where it comes from","Real example","Connection to Patrik's world","Open question"]
  }
}`,
    [], 1500
  );
}

// ═══════════════════════════════════════════════════════════════
// NOTION WRITER
// ═══════════════════════════════════════════════════════════════

// Convert briefing data into Notion blocks
function buildNotionBlocks(briefing) {
  const blocks = [];
  const cal = briefing.calendar || {};
  const bdays = briefing.birthdays || [];
  const growth = briefing.growth || {};

  // ── Helper: rich text ──
  const rt = (text, opts = {}) => ({
    type: 'text',
    text: { content: String(text || '') },
    annotations: {
      bold: opts.bold || false,
      italic: opts.italic || false,
      color: opts.color || 'default',
    },
  });

  const heading2 = (text) => ({
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [rt(text, { bold: true })] },
  });

  const heading3 = (text) => ({
    object: 'block', type: 'heading_3',
    heading_3: { rich_text: [rt(text)] },
  });

  const para = (text, opts = {}) => ({
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [rt(text, opts)] },
  });

  const bullet = (text, opts = {}) => ({
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [rt(text, opts)] },
  });

  const divider = () => ({ object: 'block', type: 'divider', divider: {} });

  const callout = (text, emoji = '📌') => ({
    object: 'block', type: 'callout',
    callout: {
      rich_text: [rt(text)],
      icon: { type: 'emoji', emoji },
      color: 'gray_background',
    },
  });

  // ── SECTION: Calendar ──────────────────────────────────────
  blocks.push(heading2('📅 Calendar'));

  if (bdays.length) {
    bdays.forEach(b => {
      blocks.push(callout(`🎂 ${b.name} — ${b.note || 'birthday today'}`, '🎂'));
    });
  }

  if (cal.focus_window) {
    blocks.push(callout(`Focus window: ${cal.focus_window} — no meetings, protect this time`, '🎯'));
  }

  (cal.today || []).forEach(ev => {
    const prepNote = ev.prep ? ` · Prep: ${ev.prep}` : '';
    const note = ev.note ? ` (${ev.note})` : '';
    blocks.push(bullet(`${ev.time} · ${ev.title}${note}${prepNote}`));
  });

  blocks.push(divider());

  // ── SECTION: Newsletters ──────────────────────────────────
  blocks.push(heading2('📰 Newsletters'));

  const newsWithEdition = (briefing.newsletters || []).filter(n => n.has_new_edition);
  const newsEmpty = (briefing.newsletters || []).filter(n => !n.has_new_edition);

  newsWithEdition.forEach(nl => {
    const l1 = nl.layer1 || {};
    const l2 = nl.layer2 || {};

    blocks.push(heading3(`${nl.name || nl.id}  ·  ${nl.domain || ''}`));
    if (l1.summary) blocks.push(para(l1.summary, { bold: true }));

    if (l1.signals && l1.signals.length) {
      blocks.push(para('Signals: ' + l1.signals.join(' · '), { color: 'gray' }));
    }

    if (l1.relevance) blocks.push(para(`→ ${l1.relevance}`, { italic: true, color: 'green' }));

    // Layer 2
    if (l2.framing) blocks.push(para(l2.framing));

    (l2.stories || []).forEach(s => {
      blocks.push(bullet(`${s.title}: ${s.content}`, {}));
    });

    if (l2.data_points && l2.data_points.length) {
      blocks.push(para('Data: ' + l2.data_points.join(' · '), { color: 'gray' }));
    }

    if (l2.notable_quotes && l2.notable_quotes.length) {
      blocks.push({
        object: 'block', type: 'quote',
        quote: { rich_text: [rt(l2.notable_quotes[0], { italic: true })] },
      });
    }

    (l2.implications_for_patrik || []).forEach(imp => {
      blocks.push(bullet(imp, { color: 'green' }));
    });

    if (l2.reflection_question) {
      blocks.push(callout(l2.reflection_question, '🤔'));
    }

    blocks.push(divider());
  });

  if (newsEmpty.length) {
    blocks.push(para(`No new edition today: ${newsEmpty.map(n => n.id).join(', ')}`, { color: 'gray', italic: true }));
    blocks.push(divider());
  }

  // ── SECTION: Podcasts ─────────────────────────────────────
  if (briefing.podcasts && briefing.podcasts.length) {
    blocks.push(heading2('🎙 Podcasts'));
    briefing.podcasts.forEach(pod => {
      if (!pod) return;
      const d = pod.digest || {};
      blocks.push(heading3(`${pod.name}  ·  ${pod.domain || ''}`));
      if (pod.summary) blocks.push(para(pod.summary, { bold: true }));
      if (pod.episode) blocks.push(para(pod.episode, { color: 'gray' }));

      (d.insights || []).forEach(section => {
        blocks.push(para(section.topic, { bold: true }));
        (section.points || []).forEach(p => blocks.push(bullet(p)));
      });

      if (d.quotes && d.quotes.length) {
        blocks.push(para('Best quotes:', { bold: true }));
        d.quotes.forEach(q => {
          blocks.push({
            object: 'block', type: 'quote',
            quote: { rich_text: [rt(`"${q.text}"${q.speaker ? ' — ' + q.speaker : ''}`, { italic: true })] },
          });
        });
      }

      if (d.recommendations && d.recommendations.length) {
        blocks.push(para('Recommendations:', { bold: true }));
        d.recommendations.forEach(r => {
          blocks.push(bullet(`[${r.type}] ${r.name}${r.note ? ' — ' + r.note : ''}`));
        });
      }

      if (d.reflection_question) blocks.push(callout(d.reflection_question, '🤔'));

      blocks.push(divider());
    });
  }

  // ── SECTION: Grow ─────────────────────────────────────────
  blocks.push(heading2('🌱 Grow'));

  if (growth.small_talk_bridge) {
    const sb = growth.small_talk_bridge;
    blocks.push(heading3('Small Talk Bridge'));
    blocks.push(para(`Hook: ${sb.topic_hook}`, { italic: true }));
    blocks.push(para(`"${sb.bridge}"`, { bold: true }));
    if (sb.when_to_use) blocks.push(para(sb.when_to_use, { color: 'gray' }));
  }

  if (growth.arabic) {
    const ar = growth.arabic;
    blocks.push(heading3('Arabic · كلمة اليوم'));
    blocks.push(para(`${ar.word} — ${ar.transliteration} (${ar.pronunciation})`, { bold: true }));
    blocks.push(para(ar.literal_meaning, { italic: true }));
    blocks.push(para(ar.cultural_story));
    if (ar.practice_sentence) blocks.push(callout(ar.practice_sentence, '🗣'));
  }

  if (growth.habitus) {
    const h = growth.habitus;
    blocks.push(heading3(`Habitus · ${h.category || 'inspiration'}`));
    blocks.push(para(h.title, { bold: true }));
    blocks.push(para(h.content));
    if (h.why_it_matters) blocks.push(para(h.why_it_matters, { italic: true, color: 'green' }));
  }

  if (growth.mini_concept) {
    const mc = growth.mini_concept;
    blocks.push(heading3(`Mini-Concept · ${mc.domain}`));
    blocks.push(para(mc.concept_name, { bold: true }));
    (mc.five_sentences || []).forEach((s, i) => blocks.push(para(s)));
  }

  return blocks;
}

async function writeToNotion(briefing) {
  log('Writing to Notion...');
  const today = dubaiDateShort();
  const dow = dayOfWeek();
  const bdays = briefing.birthdays || [];
  const bdayNote = bdays.length ? ` 🎂 ${bdays.map(b => b.name.split(' ')[0]).join(', ')}` : '';
  const pageTitle = `Morning OS · ${dow}, ${today}${bdayNote}`;

  // Create the Notion page
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
        Name: {
          title: [{ type: 'text', text: { content: pageTitle } }],
        },
        Date: {
          date: { start: todayISODate() },
        },
        Status: {
          select: { name: 'Generated' },
        },
      },
      children: buildNotionBlocks(briefing).slice(0, 100), // Notion API limit: 100 blocks per request
    }),
  });

  if (!createResp.ok) {
    const err = await createResp.text();
    throw new Error(`Notion create page failed: ${createResp.status} — ${err.slice(0, 300)}`);
  }

  const page = await createResp.json();
  const pageId = page.id;
  log(`Notion page created: ${pageId}`);

  // Append remaining blocks if more than 100
  const allBlocks = buildNotionBlocks(briefing);
  if (allBlocks.length > 100) {
    for (let i = 100; i < allBlocks.length; i += 100) {
      const chunk = allBlocks.slice(i, i + 100);
      await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${NOTION_KEY}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify({ children: chunk }),
      });
    }
  }

  // Return the page URL for logging
  return `https://notion.so/${pageId.replace(/-/g, '')}`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  log(`=== Morning OS Generation Started — ${dubaiDateStr()} ===`);

  const activeNewsletters = (process.env.ACTIVE_NEWSLETTERS || 'a16z,bankless,pomp,tldr,semafor,intrigue,lenny,chamath,timeout')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(id => ALL_NEWSLETTERS.find(n => n.id === id))
    .filter(Boolean);

  const activePodcasts = (process.env.ACTIVE_PODCASTS || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  log(`Newsletters: ${activeNewsletters.map(n => n.name).join(', ')}`);
  log(`Podcasts: ${activePodcasts.join(', ') || 'none'}`);

  // Run all fetches in parallel
  const [calResult, growthResult, ...nlResults] = await Promise.allSettled([
    fetchCalendar(),
    fetchGrowth(),
    ...activeNewsletters.map(nl => fetchNewsletter(nl)),
  ]);

  // Process podcast transcripts (sequential to avoid rate limits)
  const podcasts = [];
  for (const podId of activePodcasts) {
    const podInfo = PODCAST_DIRECTORY[podId];
    if (!podInfo) continue;
    try {
      const result = await processPodcast(podId, podInfo);
      if (result) podcasts.push(result);
    } catch (err) {
      log(`Podcast ${podId} ERROR: ${err.message}`);
    }
  }

  // Assemble briefing
  const calData = calResult.status === 'fulfilled' ? calResult.value : {};
  const briefing = {
    generated_at: new Date().toISOString(),
    generated_at_dubai: dubaiDateStr(),
    calendar: calData.today ? calData : null,
    birthdays: calData.birthdays || [],
    growth: growthResult.status === 'fulfilled' ? growthResult.value : null,
    newsletters: nlResults.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { id: activeNewsletters[i].id, has_new_edition: false }
    ),
    podcasts,
  };

  // Write to Notion
  try {
    const notionUrl = await writeToNotion(briefing);
    log(`Notion page: ${notionUrl}`);
  } catch (err) {
    log(`Notion write FAILED: ${err.message}`);
    // Save locally as fallback
    writeFileSync(join(ROOT, 'briefing-fallback.json'), JSON.stringify(briefing, null, 2));
    log('Saved fallback to briefing-fallback.json');
  }

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  const nlSuccess = briefing.newsletters.filter(n => n.has_new_edition).length;
  log(`=== Done in ${dur}s · ${nlSuccess}/${activeNewsletters.length} newsletters · ${podcasts.length} podcasts ===`);
}

main().catch(err => {
  log(`FATAL: ${err.message}`);
  console.error(err);
  process.exit(1);
});
