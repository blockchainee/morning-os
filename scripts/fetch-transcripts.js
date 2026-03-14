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
  } catch {}
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
        '--quiet',
        '--no-warnings',
        subArg,
        '--sub-lang', 'en',
        '--sub-format', 'vtt',
        '--skip-download',
        '--playlist-items', '1',
        '--output', `${tmpDir}/%(title)s.%(ext)s`,
        `https://www.youtube.com/${pod.channel}/`,
      ], { timeout: 60000, encoding: 'utf8' });

      // Find VTT file
      let vttFile = null;
      try {
        const files = execSync(`find ${tmpDir} -name "*.vtt" 2>/dev/null`).toString().trim().split('\n');
        vttFile = files.find(f => f.endsWith('.vtt'));
      } catch {}

      if (vttFile && existsSync(vttFile)) {
        const vttContent = readFileSync(vttFile, 'utf8');
        const cleanText = cleanVtt(vttContent);
        if (cleanText.length > 200) {
          writeFileSync(outputFile, cleanText);
          const wordCount = cleanText.split(/\s+/).length;
          log(`${pod.name}: transcript saved (${wordCount} words)`);
          return true;
        }
      }
    }

    log(`${pod.name}: no transcript available on YouTube`);
    return false;
  } catch (err) {
    log(`${pod.name}: error — ${err.message}`);
    return false;
  } finally {
    // Cleanup temp dir
    try { execSync(`rm -rf ${tmpDir}`); } catch {}
  }
}

// ── Main ───────────────────────────────────────────────────────
const activePodcasts = (process.env.ACTIVE_PODCASTS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!activePodcasts.length) {
  log('No active podcasts configured — skipping transcript fetch');
  process.exit(0);
}

log(`=== Transcript fetch started. Active: ${activePodcasts.join(', ')} ===`);

let success = 0, failed = 0;
for (const podId of activePodcasts) {
  const ok = await fetchTranscript(podId);
  if (ok) success++; else failed++;
}

log(`=== Done. Success: ${success}, Failed: ${failed} ===`);
