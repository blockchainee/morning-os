/**
 * Morning OS — Cloud Podcast Transcript Fetcher
 * Runs inside GitHub Actions.
 * Step 1: yt-dlp --dump-json for episode metadata (title, description, video ID) — saves meta.json
 * Step 2: youtube-transcript npm package for actual captions (native YouTube API) — saves transcript.txt
 * If Step 2 fails: meta.json still exists → generate.js uses description as fallback
 */

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { YoutubeTranscript } from 'youtube-transcript/dist/youtube-transcript.esm.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TRANSCRIPTS_DIR = join(ROOT, 'transcripts');
const LOGS_DIR = join(ROOT, 'logs');

mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
mkdirSync(LOGS_DIR, { recursive: true });

const LOG_FILE = join(LOGS_DIR, 'transcripts.log');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const existing = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, 'utf8') : '';
    writeFileSync(LOG_FILE, existing + line + '\n');
  } catch (e) { console.error('Log write failed:', e.message); }
}

// Dubai date string
function dubaiDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }))
    .toISOString().slice(0, 10);
}

// ── Curated directory with verified YouTube channels ───────────
const PODCAST_DIRECTORY = {
  'bankless':          { name: 'Bankless',                  channel: '@Bankless' },
  'lex-fridman':       { name: 'Lex Fridman Podcast',       channel: '@lexfridman' },
  'my-first-million':  { name: 'My First Million',          channel: '@MyFirstMillionPod' },
  'knowledge-project': { name: 'The Knowledge Project',     channel: '@ShaneAParrish' },
  'tim-ferriss':       { name: 'The Tim Ferriss Show',      channel: '@TimFerriss' },
  'all-in':            { name: 'All-In Podcast',            channel: '@allinpodcast' },
  'huberman':          { name: 'Huberman Lab',              channel: '@hubermanlab' },
  'invest-like-best':  { name: 'Invest Like the Best',      channel: '@InvestLiketheBest' },
  'acquired':          { name: 'Acquired',                  channel: '@acquiredfm' },
  'diary-of-ceo':      { name: 'The Diary of a CEO',        channel: '@TheDiaryOfACEO' },
};

// Clean raw transcript segments into readable paragraphs
function cleanTranscriptSegments(segments) {
  const raw = segments
    .map(s => s.text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim())
    .filter(t => t)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  const paragraphs = [];
  let remaining = raw;
  while (remaining.length > 600) {
    let split = remaining.lastIndexOf('. ', 600);
    if (split === -1) split = remaining.lastIndexOf(' ', 600);
    if (split === -1) split = 600;
    else split += 1;
    paragraphs.push(remaining.slice(0, split).trim());
    remaining = remaining.slice(split).trim();
  }
  if (remaining) paragraphs.push(remaining);

  return paragraphs.join('\n\n');
}

// ── Step 1: Episode Metadata via yt-dlp --dump-json ───────────
// Returns videoId if successful, null otherwise.
// Always writes meta.json when video info is available.
async function fetchMetadata(podId, pod) {
  const today = dubaiDate();
  const metaFile = join(TRANSCRIPTS_DIR, `${podId}-${today}-meta.json`);

  if (existsSync(metaFile)) {
    try {
      const existing = JSON.parse(readFileSync(metaFile, 'utf8'));
      log(`${pod.name}: meta already exists (${existing.episode_title?.slice(0, 60)})`);
      return existing._videoId || null;
    } catch (e) { /* re-fetch if corrupt */ }
  }

  try {
    const result = spawnSync('yt-dlp', [
      '--dump-json',
      '--no-download',
      '--playlist-items', '1',
      '--no-warnings',
      `https://www.youtube.com/${pod.channel}/`,
    ], { timeout: 45000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

    if (result.error) {
      log(`${pod.name}: yt-dlp spawn error — ${result.error.message}`);
      return null;
    }

    if (!result.stdout || !result.stdout.trim()) {
      const stderr = (result.stderr || '').trim().split('\n')[0];
      log(`${pod.name}: yt-dlp returned no output — ${stderr}`);
      return null;
    }

    const data = JSON.parse(result.stdout.trim().split('\n')[0]);
    const videoId = data.id;

    const meta = {
      episode_title: data.title || '',
      published_date: data.upload_date
        ? `${data.upload_date.slice(0,4)}-${data.upload_date.slice(4,6)}-${data.upload_date.slice(6,8)}`
        : today,
      description: (data.description || '').slice(0, 2000),
      url: data.webpage_url || `https://www.youtube.com/watch?v=${videoId}`,
      _videoId: videoId,
    };

    writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    log(`${pod.name}: meta saved — "${meta.episode_title.slice(0, 70)}" (${videoId})`);
    return videoId;

  } catch (err) {
    log(`${pod.name}: metadata fetch failed — ${err.message}`);
    return null;
  }
}

// ── Step 2: Transcript via youtube-transcript (native YouTube API) ──
async function fetchTranscriptByVideoId(podId, pod, videoId) {
  const today = dubaiDate();
  const outputFile = join(TRANSCRIPTS_DIR, `${podId}-${today}.txt`);

  if (existsSync(outputFile)) {
    log(`${pod.name}: transcript already exists for ${today}`);
    return true;
  }

  try {
    log(`${pod.name}: fetching transcript for video ${videoId}...`);
    const segments = await YoutubeTranscript.fetchTranscript(videoId, { lang: 'en' });

    if (!segments || segments.length === 0) {
      log(`${pod.name}: no transcript segments returned`);
      return false;
    }

    const cleaned = cleanTranscriptSegments(segments);

    if (cleaned.length < 200) {
      log(`${pod.name}: transcript too short (${cleaned.length} chars) — likely empty`);
      return false;
    }

    writeFileSync(outputFile, cleaned, 'utf8');
    const wordCount = cleaned.split(/\s+/).length;
    log(`${pod.name}: transcript saved — ${wordCount} words (${cleaned.length} chars)`);
    return true;

  } catch (err) {
    log(`${pod.name}: youtube-transcript failed (${err.message}) — description fallback will be used`);
    return false;
  }
}

// ── Main per-podcast fetch ─────────────────────────────────────
async function fetchPodcast(podId) {
  const pod = PODCAST_DIRECTORY[podId];
  if (!pod) {
    log(`SKIP: unknown podcast ID: ${podId}`);
    return false;
  }

  const videoId = await fetchMetadata(podId, pod);
  if (!videoId) {
    log(`${pod.name}: could not get video ID — skipping transcript fetch`);
    return false;
  }

  const hasTranscript = await fetchTranscriptByVideoId(podId, pod, videoId);
  return hasTranscript;
}

// ── Load config ─────────────────────────────────────────────────
function loadActivePodcasts() {
  const configPath = join(ROOT, 'config.json');
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      if (Array.isArray(cfg.active_podcasts) && cfg.active_podcasts.length > 0) {
        log(`Loaded ${cfg.active_podcasts.length} podcasts from config.json`);
        return cfg.active_podcasts;
      }
    } catch (e) { log(`config.json parse error: ${e.message}`); }
  }
  const fromEnv = (process.env.ACTIVE_PODCASTS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (fromEnv.length) log(`Loaded ${fromEnv.length} podcasts from ACTIVE_PODCASTS env var`);
  return fromEnv;
}

// ── Main ───────────────────────────────────────────────────────
const activePodcasts = loadActivePodcasts();

if (!activePodcasts.length) {
  log('No active podcasts configured — skipping transcript fetch');
  process.exit(0);
}

log(`=== Transcript fetch started. Active: ${activePodcasts.join(', ')} ===`);

const results = await Promise.allSettled(activePodcasts.map(podId => fetchPodcast(podId)));
let withTranscript = 0, withMeta = 0, failed = 0;

results.forEach((r, i) => {
  const podId = activePodcasts[i];
  const today = dubaiDate();
  const metaExists = existsSync(join(TRANSCRIPTS_DIR, `${podId}-${today}-meta.json`));
  const transcriptExists = existsSync(join(TRANSCRIPTS_DIR, `${podId}-${today}.txt`));

  if (transcriptExists) withTranscript++;
  else if (metaExists) withMeta++;
  else {
    failed++;
    if (r.status === 'rejected') log(`${podId}: ${r.reason?.message || 'unknown error'}`);
  }
});

log(`=== Done. With transcript: ${withTranscript}, Description fallback: ${withMeta}, Failed: ${failed} ===`);
