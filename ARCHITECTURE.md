# Morning OS — Architecture & Solution Design

## What This Is

Morning OS is a personal AI-powered daily briefing system for a Dubai-based tech investor and AI practitioner. It runs fully automated via GitHub Actions, processes Gmail newsletters + Google Calendar + podcast transcripts through Claude API, produces a `briefing.json` file, and serves it as a static PWA via Netlify.

---

## Current Architecture

```
GitHub Actions Cron (05:30 Dubai / 01:30 UTC daily)
│
├─ 1. fetch-transcripts.js
│     Uses yt-dlp to download YouTube auto-captions
│     Saves to: transcripts/{podcastId}-{DATE}.txt
│     (continue-on-error: true — non-blocking)
│
├─ 2. generate.js (main orchestration)
│     ├─ fetchCalendar()     → Google Calendar API (next 7 days)
│     ├─ fetchNewsletter()×N → Gmail API + Claude API (parallel)
│     ├─ processPodcast()×N  → Read transcript + Claude API (sequential)
│     ├─ fetchGrowth()       → Claude API (single call)
│     ├─ buildNotionBlocks() → Rich formatting for Notion
│     └─ writeToNotion()     → Notion API (archive old, create new)
│     Output: briefing.json committed to repo
│
└─ 3. Git commit & push
      Triggers Netlify auto-deploy

Frontend: index.html (single-file PWA, ~1671 lines)
├─ Fetches briefing.json as static file
├─ Renders: Today / Podcasts / Grow / Saved / Settings tabs
├─ User preferences in localStorage only
└─ No backend calls from browser (zero CORS issues)
```

---

## File Structure

```
morning-os/
├── index.html                          # Single-file PWA (HTML + CSS + JS)
├── briefing.json                       # Generated daily output (committed by Actions)
├── manifest.json                       # PWA manifest
├── scripts/
│   ├── generate.js                     # Main backend (718 lines, Node.js)
│   └── fetch-transcripts.js            # yt-dlp transcript fetcher (171 lines)
├── transcripts/                        # Temp: podcast transcripts (not committed)
├── .github/workflows/
│   ├── daily-briefing.yml              # Main cron workflow
│   └── deploy-app.yml                  # Netlify deploy workflow
├── package.json                        # Dependencies (only node-fetch)
└── README.md                           # Setup guide
```

---

## Data Flow: Newsletter Processing

```
Gmail API (search by sender query)
  → Extract: subject, date, sender, body (max 8KB)
  → Claude API call with:
      System: BASE_SYSTEM (user profile + domain taxonomy)
      User: "Digest this newsletter into Layer1 + Layer2"
  → Output per newsletter:
      {
        "id": "newsletter-slug",
        "name": "Newsletter Name",
        "has_new_edition": true,
        "layer1": {
          "summary": "2-3 sentence overview",
          "signals": [{ "text": "signal", "domain": "D1", "strength": "high" }],
          "relevance": "Why this matters to user",
          "triage_suggestion": "Read/Skim/Skip"
        },
        "layer2": {
          "framing": "How newsletter frames the topic",
          "stories": [{ "headline": "...", "content": "full verbatim text" }],
          "data_points": ["Specific numbers and facts"],
          "implications": "What this means for user's domains",
          "reflection": "Question for user to consider"
        }
      }
```

## Data Flow: Podcast Processing

```
yt-dlp (YouTube auto-captions)
  → VTT to clean text (dedup rolling captions, chunk paragraphs)
  → Save as transcripts/{podId}-{DATE}.txt
  → generate.js reads max 14,000 chars
  → Claude API call:
      System: BASE_SYSTEM
      User: "Analyze this transcript"
  → Output per podcast:
      {
        "id": "podcast-slug",
        "name": "Podcast Name",
        "episode_title": "...",
        "digest": {
          "summary": "Episode overview",
          "insights": ["Key insight 1", "Key insight 2"],
          "quotes": [{ "text": "verbatim quote", "speaker": "Name" }],
          "recommendations": ["Mentioned books/tools/resources"],
          "implications": "What this means for user",
          "reflection": "Question to consider"
        }
      }
```

## Data Flow: Growth Section

```
Claude API call (single, no external data):
  System: BASE_SYSTEM
  User: "Generate growth content for {dayOfWeek}"
  → Output:
      {
        "small_talk_bridge": {
          "topic_hook": "Casual conversation opener",
          "bridge": "How to transition to meaningful talk",
          "when_to_use": "Situation context"
        },
        "arabic": {
          "word": "Arabic word",
          "transliteration": "...",
          "pronunciation": "...",
          "cultural_story": "UAE context and usage"
        },
        "habitus": {
          "category": "Restaurant/Experience/Event",
          "name": "Specific Dubai venue",
          "insight": "Why and when to go",
          "action": "Specific thing to do/try"
        },
        "mini_concept": {
          "domain": "D1-D4 (rotates by weekday)",
          "concept": "Name of concept",
          "summary": "MBA-level explanation",
          "application": "How to apply today"
        }
      }
```

---

## Frontend Architecture (index.html)

### Tab Structure
- **Today**: Key takeaways + newsletter cards (Layer1 summary → click to expand Layer2)
- **Podcasts**: Podcast digest cards with expand/collapse
- **Grow**: Small Talk Bridge + Arabic + Habitus + Mini-Concept cards
- **Saved**: User-saved items from any section ("Save to thesis" button)
- **Settings**: Newsletter toggles, podcast management (iTunes search), preferences

### State Management
```javascript
STATE = {
  briefing: null,          // Loaded from briefing.json
  tab: 'today',            // Current active tab
  newsletters: [...],      // Toggle state per newsletter (localStorage)
  podcasts: [...],          // Active podcast list (localStorage)
  savedItems: [...],        // Saved thesis items (localStorage)
  settings: { theme, ... } // User preferences (localStorage)
}
```

### UI Pattern: Layer1 → Layer2 Expansion
- Cards show summary (Layer1) by default
- Click expands to full analysis (Layer2) with CSS max-height transition
- `.layer2-panel.open { max-height: 900px }` (BUG: clips long content)

---

## Known Bugs

1. **Small Talk Bridge never renders**: `renderGrow()` line 1320 checks `g.small_talk` but backend generates `g.small_talk_bridge`
2. **Newsletter Layer2 clips**: `.layer2-panel.open` max-height 900px cuts off long newsletters
3. **Podcast Layer2 clips**: `.pl2-panel.open` max-height 1200px same issue
4. **Text overflow**: Several card types lack `overflow-wrap: break-word`
5. **Save has no feedback**: "Save to thesis" works but shows no toast/confirmation
6. **No delete for saved items**: `renderSaved()` has no remove button
7. **Podcast settings don't sync**: localStorage only, different on phone vs desktop
8. **Frontend/backend podcast directory duplication**: Both define `PODCAST_DIRECTORY` separately

---

## Backend: Claude API Integration (generate.js)

### claudeCall() Implementation
```javascript
// Model: claude-sonnet-4-20250514
// Direct REST API (no SDK)
// POST https://api.anthropic.com/v1/messages
// Headers: x-api-key, anthropic-version: 2023-06-01
// JSON response parsing with regex fallback for markdown fences
```

### Current System Prompt (BASE_SYSTEM)
```
You are {USER_NAME}'s personal intelligence officer.
{USER_PROFILE}
Domains: D1=Professional/AI/FDE, D2=Wealth/Crypto/DeFi, D3=Geopolitics/Gulf, D4=Personal growth/Habitus.
Be direct, sharp, substantive. Preserve ALL specific data verbatim.
Return ONLY valid JSON, no preamble, no fences.
```

### Newsletter List (Currently Hardcoded)
```javascript
const ALL_NEWSLETTERS = [
  { id: 'morning-brew', name: 'Morning Brew', query: 'from:morningbrew', domain: 'D1' },
  { id: 'tldr', name: 'TLDR', query: 'from:tldr', domain: 'D1' },
  // ... 9 total newsletters
];
```

### Podcast Directory (Currently Hardcoded)
```javascript
const PODCAST_DIRECTORY = [
  { id: 'bankless', name: 'Bankless', domain: 'D2', channel: '@Bankless' },
  { id: 'lex-fridman', name: 'Lex Fridman', domain: 'D1', channel: '@lexfridman' },
  // ... 10 total podcasts
];
```

---

## Environment & Secrets (GitHub Actions)

### Secrets (encrypted)
- `ANTHROPIC_API_KEY` — Claude API
- `NOTION_API_KEY` + `NOTION_DATABASE_ID` — Notion integration
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN` — Gmail + Calendar
- `GOOGLE_CALENDAR_ID` — Specific calendar to read
- `USER_NAME`, `USER_PROFILE`, `USER_CITY`, `USER_TIMEZONE`

### Variables (visible)
- `ACTIVE_NEWSLETTERS` — Comma-separated newsletter IDs to process
- `ACTIVE_PODCASTS` — Comma-separated podcast IDs to fetch

---

## Notion Integration

- **Write-only from server** (never from browser)
- Archives previous day's page before creating new one
- Rich formatting: headings, callouts, quotes, bullets, dividers
- Handles Notion's 100-block limit with pagination
- Graceful degradation: if Notion fails, briefing.json still works
- No retry logic (known reliability gap)

---

## Proposed Improvement: Knowledge-Driven Agent System

### Problem
Claude currently gets minimal context — a short USER_PROFILE string and generic prompts. No memory, no expertise depth, no personalization beyond basics.

### Solution: Markdown Knowledge Files

Add structured markdown files to the repo that `generate.js` reads and injects into Claude API calls as rich context:

```
knowledge/
├── user-profile.md      # Detailed user profile, goals, preferences
├── domains.md           # D1-D4 taxonomy with specific examples & signals
├── small-talk-playbook.md  # Techniques from Van Edwards, Lowndes, Carnegie, Voss
└── ai-landscape.md      # AI tools, trends, learning resources

agents/
├── researcher.md        # System prompt: extract facts, preserve data verbatim
├── analyst.md           # System prompt: synthesize, connect to user's domains
├── growth-coach.md      # System prompt: social skills, Arabic, habitus, AI MBA
└── editor.md            # System prompt: quality check, trim fluff, verify JSON
```

### How It Works
```javascript
// generate.js loads markdown files and builds rich system prompts:
const agentPrompt = fs.readFileSync('agents/analyst.md', 'utf8');
const userProfile = fs.readFileSync('knowledge/user-profile.md', 'utf8');
const domains = fs.readFileSync('knowledge/domains.md', 'utf8');

const systemPrompt = `${agentPrompt}\n\n## User Profile\n${userProfile}\n\n## Domains\n${domains}`;
// Pass as system message to Claude API
```

### Cost Impact
- **Option A (recommended)**: Same number of API calls, just richer prompts. +~$0.50/month from extra input tokens.
- **Option B**: Multi-pass (Research → Analysis per newsletter). ~$8-10/month. Only if quality from Option A is insufficient.

---

## Planned Feature Additions

### 1. Auto-Discover Gmail Newsletters
Replace hardcoded list with Gmail inbox scanning. Group by sender, dedup, cap at 15, process all automatically.

### 2. Enhanced Small Talk Tip
Deeper daily tip with named technique, source, psychology, examples, Dubai context, and practice challenge. Powered by `small-talk-playbook.md` knowledge file.

### 3. AI MBA Section
Daily AI learning: trend spotlight, tool hack with steps, learning gap identification. Full version on Mondays, shorter daily. Powered by `ai-landscape.md` knowledge file.

### 4. Podcast Cross-Device Sync
Embed `_config` in briefing.json with active podcast list from GitHub Actions variables. Frontend adopts config on load unless locally overridden.

### 5. Richer Podcast Analysis
Topic-grouped digest with key statements, per-topic insights/quotes/actions, and reflection questions. Increase maxTokens from 2500 → 3000.

---

## Cost Model

| Component | Monthly Cost |
|-----------|-------------|
| Claude API (Sonnet, ~15 calls/day) | ~$3-4 |
| Gmail API | Free |
| Google Calendar API | Free |
| Notion API | Free |
| GitHub Actions | Free (public repo) |
| Netlify hosting | Free tier |
| **Total current** | **~$3-5/month** |
| With knowledge files (+input tokens) | +$0.50 |
| With AI MBA section (+1 call/day) | +$1.00 |
| **Total planned** | **~$4.50-6.50/month** |

---

## Tech Stack

- **Runtime**: Node.js 24 (GitHub Actions)
- **Frontend**: Vanilla HTML/CSS/JS (single file PWA)
- **APIs**: Claude (Anthropic), Gmail, Google Calendar, Notion, YouTube (yt-dlp)
- **Hosting**: Netlify (auto-deploy from repo)
- **CI/CD**: GitHub Actions (daily cron + deploy)
- **Dependencies**: node-fetch (only npm package)
