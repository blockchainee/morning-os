/**
 * Morning OS — Cloud Podcast Transcript Fetcher
 * Runs inside GitHub Actions. Uses yt-dlp to fetch YouTube transcripts.
 * Saves transcripts to ./transcripts/ for use by generate.js
 */

import { execSync, spawnSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

function cleanVtt(vttContent) {
  // Remove WEBVTT header and metadata
  let text = vttContent
    .replace(/^WEBVTT.*$/m, '')
    .replace(/^NOTE.*$/gm, '')
    .replace(/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}.*$/gm, '')
    .replace(/^\d+\s*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

  // Remove duplicate adjacent lines (VTT rolling captions repeat)
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);
  const deduped = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === 0 || lines[i] !== lines[i - 1]) {
      deduped.push(lines[i]);
    }
  }

  // Join and clean whitespace
  let clean = deduped.join(' ').replace(/\s+/g, ' ').trim();

  // Break into paragraphs at sentence boundaries ~every 600 chars
  const paragraphs = [];
  while (clean.length > 600) {
    let split = clean.lastIndexOf('. ', 600);
    if (split === -1) split = clean.lastIndexOf(' ', 600);
    if (split === -1) split = 600;
    else split += 1;
    paragraphs.push(clean.slice(0, split).trim());
    clean = clean.slice(split).trim();
  }
  if (clean) paragraphs.push(clean);

  return paragraphs.join('\n\n');
}

// ── Episode Metadata Extraction (Phase E2) ────────────────────
async function extractEpisodeMetadata(podId, pod, tmpDir) {
  const metaFile = join(TRANSCRIPTS_DIR, `${podId}-${dubaiDate()}-meta.json`);
  if (existsSync(metaFile)) return; // already extracted

  try {
    const result = spawnSync('yt-dlp', [
      '--dump-json',
      '--no-download',
      '--playlist-items', '1',
      `https://www.youtube.com/${pod.channel}/`,
    ], { timeout: 60000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });

    if (result.stdout) {
      const data = JSON.parse(result.stdout);
      const meta = {
        episode_title: data.title || '',
        published_date: data.upload_date
          ? `${data.upload_date.slice(0,4)}-${data.upload_date.slice(4,6)}-${data.upload_date.slice(6,8)}`
          : dubaiDate(),
        description: (data.description || '').slice(0, 2000),
        url: data.webpage_url || '',
      };
      writeFileSync(metaFile, JSON.stringify(meta, null, 2));
      log(`${pod.name}: metadata saved (${meta.episode_title.slice(0, 60)}...)`);
    }
  } catch (err) {
    log(`${pod.name}: metadata extraction failed — ${err.message}`);
  }
}

async function fetchTranscript(podId) {
  const pod = PODCAST_DIRECTORY[podId];
  if (!pod) {
    log(`SKIP: unknown podcast ID: ${podId}`);
    return false;
  }

  const today = dubaiDate();
  const outputFile = join(TRANSCRIPTS_DIR, `${podId}-${today}.txt`);

  if (existsSync(outputFile)) {
    log(`${pod.name}: transcript already exists for ${today}`);
    // Still extract metadata if missing
    await extractEpisodeMetadata(podId, pod, null);
    return true;
  }

  log(`${pod.name}: fetching from YouTube ${pod.channel}...`);

  // Use a temp directory in /tmp for cloud runner
  const tmpDir = `/tmp/yt-${podId}-${Date.now()}`;
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Try auto-subtitles first, then manual captions
    for (const subArg of ['--write-auto-subs', '--write-subs']) {
      const result = spawnSync('yt-dlp', [
        subArg,
        '--sub-lang', 'en',
        '--sub-format', 'vtt',
        '--skip-download',
        '--playlist-items', '1',
        '--output', `${tmpDir}/%(title)s.%(ext)s`,
        `https://www.youtube.com/${pod.channel}/`,
      ], { timeout: 60000, encoding: 'utf8' });

      if (result.stderr) log(`${pod.name} [${subArg}]: ${result.stderr.trim().split('\n')[0]}`);

      // Find VTT file
      let vttFile = null;
      try {
        const files = execSync(`find ${tmpDir} -name "*.vtt" 2>/dev/null`).toString().trim().split('\n');
        vttFile = files.find(f => f.endsWith('.vtt'));
      } catch (err) { log(`${pod.name}: VTT file search error: ${err.message}`); }

      if (vttFile && existsSync(vttFile)) {
        const vttContent = readFileSync(vttFile, 'utf8');
        const cleanText = cleanVtt(vttContent);
        if (cleanText.length > 200) {
          writeFileSync(outputFile, cleanText);
          const wordCount = cleanText.split(/\s+/).length;
          log(`${pod.name}: transcript saved (${wordCount} words)`);
          // Extract episode metadata alongside transcript (Phase E2)
          await extractEpisodeMetadata(podId, pod, tmpDir);
          return true;
        }
      }
    }

    log(`${pod.name}: no transcript available on YouTube — saving metadata for fallback`);
    // Still extract metadata so generate.js can use the description as fallback
    await extractEpisodeMetadata(podId, pod, tmpDir);
    return false;
  } catch (err) {
    log(`${pod.name}: error — ${err.message}`);
    return false;
  } finally {
    // Cleanup temp dir
    try { execSync(`rm -rf ${tmpDir}`); } catch (err) { log(`Cleanup failed for ${tmpDir}: ${err.message}`); }
  }
}

// ── Load config ─────────────────────────────────────────────────
function loadActivePodcasts() {
  // 1. Try config.json (set by the PWA settings UI)
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
  // 2. Fallback to env var
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

// Fetch all transcripts in parallel (yt-dlp calls are independent, each has 60s timeout)
const results = await Promise.allSettled(activePodcasts.map(podId => fetchTranscript(podId)));
let success = 0, failed = 0;
results.forEach((r, i) => {
  if (r.status === 'fulfilled' && r.value) success++;
  else {
    failed++;
    if (r.status === 'rejected') log(`${activePodcasts[i]}: ${r.reason?.message || 'unknown error'}`);
  }
});

log(`=== Done. Success: ${success}, Failed: ${failed} ===`);
