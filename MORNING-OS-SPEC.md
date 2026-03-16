# Morning OS — Implementation Spec v4.0
> Prepared for Claude Code. Implement all sections in order. Do not skip steps. Ask no clarifying questions — all decisions are documented here.

---

## 0. Context & Constraints

**What this is:** A personal AI-powered daily briefing system (PWA) for a Dubai-based Pre-Sales Leader / AI practitioner / investor. Runs fully automated via GitHub Actions daily at 05:30 Dubai time.

**Current state:** Work in Progress. Core architecture exists but has critical bugs and quality gaps. This spec defines a targeted upgrade — not a full rewrite.

**Operator profile:**
- Non-developer. Claude Code implements everything.
- Domains: D1=Professional/AI/FDE, D2=Wealth/Crypto/DeFi, D3=Geopolitics/Gulf, D4=Personal Growth/Habitus
- Location: Dubai, UAE
- Style preference: Hybrid output — short sharp summary + structured drilldown detail

**Guiding principles for this upgrade:**
1. Fix what's broken before adding new
2. Never break existing working functionality
3. Prefer minimal diffs over rewrites
4. Every change must be testable in isolation

---

## 1. Existing Architecture (Do Not Change Unless Specified)

```
GitHub Actions Cron (05:30 Dubai / 01:30 UTC)
│
├─ fetch-transcripts.js     → yt-dlp podcast captions
├─ generate.js              → main orchestration (Gmail + Calendar + Claude + Notion)
└─ git commit → Netlify auto-deploy

Frontend: index.html (single-file PWA)
└─ Fetches briefing.json → renders Today / Podcasts / Grow / Saved / Settings tabs
```

**File structure (current):**
```
morning-os/
├── index.html
├── briefing.json
├── manifest.json
├── scripts/
│   ├── generate.js
│   └── fetch-transcripts.js
├── .github/workflows/
│   ├── daily-briefing.yml
│   └── deploy-app.yml
└── package.json
```

**File structure (after this spec):**
```
morning-os/
├── index.html                    # MODIFIED: bug fixes + UI + Intelligence Chat + Podcast UI
├── briefing.json                 # AUTO-GENERATED: schema extended incl. rich podcast data
├── manifest.json                 # unchanged
├── scripts/
│   ├── generate.js               # MODIFIED: auto-discovery + better prompts + podcast intelligence
│   ├── fetch-transcripts.js      # MODIFIED: speaker detection + web search for guest profiles
│   └── weekly-synthesis.js       # NEW: weekly intelligence compound
├── knowledge/
│   ├── user-profile.md           # NEW: rich user context for Claude
│   ├── domains.md                # NEW: D1-D4 taxonomy detail
│   └── user-model.md             # NEW: evolving user belief model
├── archive/                      # NEW: daily briefing archive (90 days rolling)
├── netlify/functions/
│   └── chat.js                   # NEW: Claude API proxy
├── netlify.toml                  # NEW: Netlify function routing
├── .github/workflows/
│   ├── daily-briefing.yml        # unchanged
│   ├── deploy-app.yml            # unchanged
│   └── weekly-synthesis.yml      # NEW: Sunday synthesis workflow
└── package.json                  # unchanged
```

---

## 2. Phase A — Frontend Bug Fixes (index.html)

Fix all 6 known bugs. Make surgical edits only — do not restructure or rewrite the file.

### Bug 1 — Small Talk Bridge never renders
**Root cause:** `renderGrow()` checks `g.small_talk` but backend generates `g.small_talk_bridge`
**Fix:** In `renderGrow()`, change every reference from `g.small_talk` → `g.small_talk_bridge`
**Verify:** After fix, the Small Talk Bridge card should render when `briefing.grow.small_talk_bridge` exists in JSON

### Bug 2 — Newsletter Layer2 clips long content
**Root cause:** `.layer2-panel.open { max-height: 900px }` truncates long newsletters
**Fix:** Replace `max-height: 900px` with `max-height: none` on `.layer2-panel.open`
**Note:** The expand animation still works via `overflow: hidden` on the closed state — only the open state needs this change

### Bug 3 — Podcast Layer2 clips long content
**Root cause:** `.pl2-panel.open { max-height: 1200px }` same issue
**Fix:** Replace `max-height: 1200px` with `max-height: none` on `.pl2-panel.open`

### Bug 4 — Text overflow on cards
**Root cause:** Several card types lack `overflow-wrap: break-word`
**Fix:** Add to the global card CSS rule:
```css
.card, .newsletter-card, .podcast-card, .grow-card {
  overflow-wrap: break-word;
  word-break: break-word;
}
```

### Bug 5 — Save has no visual feedback
**Root cause:** "Save to thesis" button fires but shows no confirmation
**Fix:** After the save action fires, show a toast notification:
```javascript
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('visible'), 10);
  setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 300); }, 2500);
}
```
Add CSS:
```css
.toast {
  position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
  background: #1a1a1a; color: #fff; padding: 10px 20px; border-radius: 20px;
  font-size: 14px; opacity: 0; transition: opacity 0.3s; z-index: 9999;
  pointer-events: none;
}
.toast.visible { opacity: 1; }
```
Call `showToast('Saved ✓')` after every successful save action.

### Bug 6 — No delete button for saved items
**Root cause:** `renderSaved()` renders items but has no remove action
**Fix:** In `renderSaved()`, add a delete button to each saved item:
```javascript
// Add to each saved item's rendered HTML:
`<button class="remove-saved" onclick="removeSavedItem(${index})" aria-label="Remove">✕</button>`

// Add function:
function removeSavedItem(index) {
  STATE.savedItems.splice(index, 1);
  localStorage.setItem('savedItems', JSON.stringify(STATE.savedItems));
  renderSaved();
  showToast('Removed');
}
```

---

## 3. Phase B — Backend Quality Upgrade (generate.js)

### B1 — Increase Newsletter Body Limit
**Current:** `body (max 8KB)`
**Change:** Increase to `25KB` (25000 chars)
**Where:** In `fetchNewsletter()`, find the body truncation line and update the slice value from `8000` to `25000`
**Why:** Long-form newsletters (a16z, Bankless) were being truncated, producing shallow summaries

### B2 — Gmail Auto-Discovery (replaces hardcoded list)

**Current problem:** `ALL_NEWSLETTERS` is hardcoded. New newsletters in Gmail are never processed.

**New approach:** At runtime, scan Gmail for recent newsletter senders and process all of them dynamically.

**Implement `discoverNewsletters()` function:**

```javascript
async function discoverNewsletters(accessToken) {
  // 1. Search Gmail for emails received in last 24h
  //    Query: "newer_than:1d -from:me -category:social -category:promotions"
  //    BUT also include category:promotions since newsletters often land there
  //    Use two queries: "newer_than:1d category:updates" + "newer_than:1d category:promotions"
  
  // 2. For each message, extract:
  //    - sender email (from header)
  //    - sender display name
  //    - subject line
  //    - List-Unsubscribe header (presence = strong newsletter signal)
  
  // 3. Filter: keep only senders with List-Unsubscribe header present
  //    This reliably identifies newsletters vs personal emails
  
  // 4. Dedup by sender email domain
  
  // 5. Cap at 15 newsletters max (cost control)
  
  // 6. For each discovered sender, fetch their latest email body (max 25KB)
  
  // 7. Return array: [{ id, name, sender, subject, body, domain }]
  //    - id: slugify sender name (e.g. "morning-brew")
  //    - name: sender display name
  //    - domain: classify using simple keyword matching against D1-D4 keywords
  //      D1 keywords: ai, tech, software, saas, enterprise, startup, product
  //      D2 keywords: crypto, bitcoin, defi, finance, investing, markets, macro
  //      D3 keywords: geopolitics, global, policy, middle east, gulf, iran, war
  //      D4 keywords: growth, habits, mindset, health, learning, philosophy
  //      Default: D1 if no match
}
```

**Migration:** Keep `ALL_NEWSLETTERS` array as a fallback. If `discoverNewsletters()` returns 0 results (API error), fall back to the hardcoded list. Log which mode is active.

**In `generate.js` main flow:**
```javascript
// Replace: const newsletters = ALL_NEWSLETTERS.filter(...)
// With:
const newsletters = await discoverNewsletters(accessToken);
console.log(`[Discovery] Found ${newsletters.length} newsletters`);
```

### B3 — Knowledge Files Integration

Create two new markdown files in `knowledge/` and load them into Claude API calls.

**Create `knowledge/user-profile.md`:**
```markdown
# User Profile

## Identity
- Name: [USER_NAME from env]
- Location: Dubai, UAE (UTC+4)
- Background: German, based in MENA region

## Professional Role
Pre-Sales Leader at a large AI platform company (~700 employees EMEA).
Strategic focus: evolving Pre-Sales toward a Forward Deployed Engineer (FDE) model — 
consultants who shift from advisors to hybrid engineer/architect/project managers 
who build solutions alongside customers.

## Domain Priorities
- **D1 — Professional/AI/FDE**: AI platform sales, pre-sales strategy, FDE evolution, 
  ServiceNow ecosystem, enterprise AI adoption, solutions architecture, LLMs in enterprise
- **D2 — Wealth/Crypto/DeFi**: Bitcoin, DeFi protocols, macro finance, crypto market structure,
  institutional crypto adoption, tokenomics
- **D3 — Geopolitics/Gulf**: UAE/GCC dynamics, Iran-US-Israel tensions, Gulf economic strategy,
  global power shifts, MENA tech ecosystem
- **D4 — Personal Growth/Habitus**: Dubai social scene, Arabic language, consciousness and 
  philosophy, content creation, personal knowledge management (Notion, second brain)

## Reading Style
Hybrid: short executive summary first, then structured detail on demand.
Wants: specific numbers, named sources, concrete implications — not generic observations.
Hates: vague summaries, filler phrases, obvious statements.

## Current Focus Areas (2025)
1. Building AI-augmented Pre-Sales organization
2. DeFi portfolio management and macro positioning  
3. UAE/Gulf geopolitical intelligence
4. Personal brand and content creation on AI transformation
```

**Create `knowledge/domains.md`:**
```markdown
# Domain Taxonomy — Signal Classification Guide

## D1 — Professional / AI / FDE
**Core themes:** Enterprise AI deployment, pre-sales evolution, FDE model, LLMs in business,
AI agents, ServiceNow, Salesforce, solutions architecture, customer success, EMEA tech market

**High-value signals:**
- New AI capabilities with direct enterprise sales implications
- FDE/solutions engineering role evolution at major AI companies
- Enterprise AI adoption rates and blockers
- Pre-sales methodology shifts driven by AI
- AI platform competitive landscape (OpenAI, Anthropic, Google, Microsoft)

**Weak signals to flag:**
- AI startups entering enterprise space
- New LLM capabilities that could change demo/POC dynamics

## D2 — Wealth / Crypto / DeFi
**Core themes:** Bitcoin, Ethereum, DeFi protocols (Aave, Uniswap, etc.), macro finance,
Fed policy, institutional crypto, tokenomics, on-chain data, yield strategies

**High-value signals:**
- Fed/ECB rate decisions and macro implications for crypto
- Institutional BTC/ETH flows
- New DeFi protocol launches or significant TVL shifts
- Regulatory developments (SEC, MiCA, UAE crypto regulation)
- Bitcoin on-chain metrics (hash rate, supply on exchanges)

**Weak signals to flag:**
- Altcoin narratives gaining traction
- Macro data that typically leads crypto moves

## D3 — Geopolitics / Gulf
**Core themes:** UAE foreign policy, Iran-US-Israel dynamics, Gulf Cooperation Council,
Saudi Vision 2030, MENA tech investment, global trade disruption, energy markets

**High-value signals:**
- Iran nuclear negotiations or military escalation
- UAE-Israel-US triangular relations
- Gulf sovereign wealth fund strategic moves
- MENA AI and tech investment announcements
- Oil price drivers and OPEC+ decisions

**Weak signals to flag:**
- Regional political shifts that affect UAE business climate
- Global events with specific Gulf exposure

## D4 — Personal Growth / Habitus
**Core themes:** Dubai lifestyle, Arabic language and culture, Emirati customs,
consciousness/philosophy, productivity systems, content creation, social intelligence

**High-value signals:**
- Specific Dubai venue/experience recommendations with insider context
- Arabic word/phrase with genuine cultural depth (not tourist phrases)
- Concepts from philosophy or psychology with practical application
- Social skills and conversation techniques applicable in Dubai business context
```

**Load knowledge files in `generate.js`:**
```javascript
// At top of generate.js, after imports:
const fs = require('fs');

function loadKnowledge() {
  const userProfile = fs.existsSync('knowledge/user-profile.md') 
    ? fs.readFileSync('knowledge/user-profile.md', 'utf8') 
    : '';
  const domains = fs.existsSync('knowledge/domains.md')
    ? fs.readFileSync('knowledge/domains.md', 'utf8')
    : '';
  return { userProfile, domains };
}

const KNOWLEDGE = loadKnowledge();
```

**Update `BASE_SYSTEM` prompt in `generate.js`:**
```javascript
// Replace current BASE_SYSTEM with:
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
```

### B4 — Upgraded Newsletter Analysis Prompt

**Current prompt (weak):** `"Digest this newsletter into Layer1 + Layer2"`

**Replace with this prompt in `fetchNewsletter()`:**

```javascript
const newsletterPrompt = `Analyze this newsletter edition for ${USER_NAME}.

NEWSLETTER: ${newsletter.name}
SENDER: ${newsletter.sender}  
SUBJECT: ${newsletter.subject}
DATE: ${newsletter.date}

CONTENT:
${newsletter.body}

Return a JSON object with this exact structure:
{
  "id": "${newsletter.id}",
  "name": "${newsletter.name}",
  "has_new_edition": true,
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
- If no new content (e.g. weekend digest, repeated content), set has_new_edition: false and return minimal layer1 only.`;
```

### B5 — Add Retry Logic to Notion Integration

**Current problem:** If Notion API returns 5xx, the briefing page for that day is lost. No retry.

**Fix:** Wrap `writeToNotion()` in a simple retry wrapper:

```javascript
async function withRetry(fn, maxAttempts = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      console.log(`[Retry] Attempt ${attempt} failed: ${err.message}. Retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs * attempt)); // exponential backoff
    }
  }
}

// Usage:
await withRetry(() => writeToNotion(briefingData));
```

---

## 4. briefing.json Schema Changes

The existing schema is extended, not replaced. All existing fields remain. New fields added:

```json
{
  "_meta": {
    "generated_at": "ISO timestamp",
    "newsletter_count": 7,
    "discovery_mode": "auto|fallback",
    "version": "2.0"
  },
  "newsletters": [...],   // existing, unchanged structure
  "podcasts": [...],      // existing, unchanged structure  
  "calendar": [...],      // existing, unchanged structure
  "grow": {              // existing, field name bug now fixed
    "small_talk_bridge": { ... },   // was: small_talk (bug fixed in frontend)
    "arabic": { ... },
    "habitus": { ... },
    "mini_concept": { ... }
  }
}
```

---

## 5. Implementation Order

Claude Code must implement in this exact order. Each step is independently testable.

**Step 1 — Frontend bugs (index.html)**
- Fix bugs 1-6 as specified in Phase A
- Test: Open index.html with existing briefing.json — all cards render, save shows toast, delete button exists

**Step 2 — Knowledge files**
- Create `knowledge/user-profile.md` with content from B3
- Create `knowledge/domains.md` with content from B3
- No code changes yet — just file creation

**Step 3 — Knowledge integration in generate.js**
- Add `loadKnowledge()` function
- Update `BASE_SYSTEM` to include knowledge content
- Test: Run `node scripts/generate.js --dry-run` (if dry-run flag exists) and verify system prompt includes knowledge content in logs

**Step 4 — Newsletter body limit increase**
- Change 8000 → 25000 in `fetchNewsletter()` body truncation
- Single line change

**Step 5 — Upgraded newsletter prompt**
- Replace newsletter analysis prompt in `fetchNewsletter()` with B4 version
- Test: Run against a single newsletter and inspect JSON output quality

**Step 6 — Gmail Auto-Discovery**
- Implement `discoverNewsletters()` as specified in B2
- Keep `ALL_NEWSLETTERS` as fallback
- Test: Log discovered senders before processing — verify List-Unsubscribe filter works correctly

**Step 7 — Notion retry logic**
- Add `withRetry()` wrapper as specified in B5
- Wrap `writeToNotion()` call

**Step 8 — Final integration test**
- Run full `generate.js` manually
- Verify `briefing.json` includes `_meta` field
- Verify Notion page is created successfully
- Verify frontend renders all sections correctly

---

## 6. Testing Checklist

Before marking complete, verify each item:

**Frontend:**
- [ ] Small Talk Bridge card renders (was broken)
- [ ] Newsletter Layer2 expands fully without clipping
- [ ] Podcast Layer2 expands fully without clipping  
- [ ] Long URLs/words don't overflow card boundaries
- [ ] Saving an item shows "Saved ✓" toast
- [ ] Saved items have delete button (✕) that removes them with "Removed" toast
- [ ] All 5 tabs render without JS errors

**Backend:**
- [ ] `discoverNewsletters()` returns 6-10 senders from inbox
- [ ] Only senders with List-Unsubscribe header are included
- [ ] Falls back to `ALL_NEWSLETTERS` if discovery fails
- [ ] Newsletter body is captured up to 25KB (not 8KB)
- [ ] `knowledge/user-profile.md` content appears in Claude API calls (check logs)
- [ ] Newsletter JSON output includes `data_points` array with actual numbers
- [ ] Newsletter JSON output includes `questions` array (new field)
- [ ] Notion write succeeds or retries up to 3 times
- [ ] `briefing.json` includes `_meta.discovery_mode` field

---

## 7. What Is NOT In This Spec (Future Phase)

Do not implement these. They are documented here so Claude Code doesn't add them speculatively:

- AI MBA Section (planned Phase 3)
- Weekly Pattern Report / Cross-newsletter synthesis
- Knowledge persistence / signals.json archive
- Podcast cross-device sync via briefing.json config
- iTunes podcast search in Settings
- Any changes to `fetch-transcripts.js`
- Any changes to GitHub Actions workflow files
- Any changes to `manifest.json` or `package.json`

---

## 8. Environment Variables Reference

These exist as GitHub Actions secrets/variables. Do not hardcode values. Reference via `process.env.*`:

```
ANTHROPIC_API_KEY
NOTION_API_KEY
NOTION_DATABASE_ID
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_CALENDAR_ID
USER_NAME
USER_PROFILE          # Legacy — still used as fallback if knowledge files missing
USER_CITY
USER_TIMEZONE
ACTIVE_NEWSLETTERS    # Comma-separated IDs — now used only as fallback
ACTIVE_PODCASTS       # Comma-separated IDs — unchanged
```

---

---

## 9. Phase C — Intelligence Chat Layer

This transforms Morning OS from a read-only briefing into an interactive Intelligence OS. The user can ask Claude questions about the current briefing, get deep dives on any topic, and have Claude reason with full knowledge of their profile and domains.

### C1 — Architecture Decision

**API Key security:** Use a Netlify Serverless Function as a proxy. The `ANTHROPIC_API_KEY` is stored as a Netlify environment variable (never in the browser). The frontend calls `/.netlify/functions/chat` — a server-side function that forwards to the Anthropic API and streams the response back.

**Why not direct browser → Anthropic API:** API key would be visible in browser DevTools to anyone who opens the app. Since this is a personal tool on a public Netlify URL, the proxy is the right default.

**Performance:** Streaming responses via Server-Sent Events (SSE). Text appears token by token — no waiting for full response. This solves the latency problem experienced previously.

**Context loading:** On drawer open, the frontend fetches `briefing.json` (already in memory) and `knowledge/user-profile.md` (fetched once, cached). These are injected as the system prompt. No Notion API call on open — keeps it fast.

### C2 — Netlify Function: `netlify/functions/chat.js`

Create this file. It is the secure Claude API proxy.

```javascript
// netlify/functions/chat.js
const fetch = require('node-fetch');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { messages, system } = body;

  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'messages array required' }) };
  }

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
        max_tokens: 1024,
        system: system || '',
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return { statusCode: response.status, body: err };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
```

**Important notes for Claude Code:**
- `node-fetch` is already in `package.json` — no new dependency needed
- This function does NOT stream (streaming via Netlify Functions requires background functions on paid plan). Instead: response returns in full, but fast enough for chat UX (~1-2s for typical responses)
- The function receives `{ messages, system }` and returns `{ text }`

### C3 — Netlify Configuration: `netlify.toml`

Create this file in the repo root:

```toml
[build]
  publish = "."
  functions = "netlify/functions"

[[redirects]]
  from = "/.netlify/functions/*"
  to = "/.netlify/functions/:splat"
  status = 200
```

**Also:** Add `ANTHROPIC_API_KEY` to Netlify environment variables:
- Netlify dashboard → Site settings → Environment variables → Add variable
- Key: `ANTHROPIC_API_KEY`
- Value: same key used in GitHub Actions secrets
- This is documented in the README, not hardcoded anywhere

### C4 — Intelligence Chat UI in `index.html`

#### Chat Trigger: "Ask Claude" button on every card

Add an "Ask Claude →" button to each newsletter card, podcast card, and grow card. When clicked, it opens the Intelligence Drawer with a pre-filled prompt based on that card's content.

```javascript
// Add to each card's rendered HTML:
`<button class="ask-claude-btn" onclick="openIntelligenceChat('${cardId}', '${cardType}')">
  Ask Claude →
</button>`
```

Also add a global floating button (bottom-right corner) to open a blank chat:
```html
<button id="intelligence-btn" onclick="openIntelligenceChat(null, null)" 
  title="Ask Claude about today's briefing">
  ✦ Ask
</button>
```

#### Chat Drawer HTML

Add this to `index.html` body (before closing `</body>`):

```html
<div id="intelligence-drawer" class="drawer closed">
  <div class="drawer-header">
    <span class="drawer-title">✦ Intelligence</span>
    <button class="drawer-close" onclick="closeIntelligenceChat()">✕</button>
  </div>
  <div id="chat-messages" class="chat-messages"></div>
  <div class="chat-input-row">
    <textarea id="chat-input" placeholder="Ask about today's briefing..." 
      rows="2" onkeydown="handleChatKey(event)"></textarea>
    <button id="chat-send" onclick="sendChatMessage()">↑</button>
  </div>
</div>
<div id="drawer-backdrop" class="drawer-backdrop" onclick="closeIntelligenceChat()"></div>
```

#### Chat Drawer CSS

Add to `<style>` section:

```css
/* Intelligence Drawer */
.drawer {
  position: fixed;
  bottom: 0; right: 0;
  width: 100%; max-width: 480px;
  height: 70vh;
  background: var(--card-bg, #1a1a1a);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -4px 40px rgba(0,0,0,0.4);
  display: flex; flex-direction: column;
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  z-index: 1000;
  overflow: hidden;
}
.drawer.closed { transform: translateY(100%); }
.drawer-backdrop {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 999;
  opacity: 0; pointer-events: none;
  transition: opacity 0.3s;
}
.drawer-backdrop.visible { opacity: 1; pointer-events: all; }
.drawer-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
}
.drawer-title { font-weight: 600; font-size: 15px; letter-spacing: 0.02em; }
.drawer-close {
  background: none; border: none; color: inherit;
  font-size: 18px; cursor: pointer; padding: 4px 8px; opacity: 0.6;
}
.chat-messages {
  flex: 1; overflow-y: auto;
  padding: 16px 20px;
  display: flex; flex-direction: column; gap: 12px;
}
.chat-msg { max-width: 85%; line-height: 1.5; font-size: 14px; }
.chat-msg.user {
  align-self: flex-end;
  background: var(--accent, #4f46e5);
  color: white; padding: 10px 14px; border-radius: 16px 16px 4px 16px;
}
.chat-msg.assistant {
  align-self: flex-start;
  background: rgba(255,255,255,0.06);
  padding: 10px 14px; border-radius: 16px 16px 16px 4px;
}
.chat-msg.thinking { opacity: 0.5; font-style: italic; }
.chat-input-row {
  display: flex; gap: 8px; padding: 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
  flex-shrink: 0;
}
#chat-input {
  flex: 1; background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 12px; color: inherit;
  padding: 10px 14px; font-size: 14px; resize: none;
  font-family: inherit; line-height: 1.4;
}
#chat-input:focus { outline: none; border-color: var(--accent, #4f46e5); }
#chat-send {
  background: var(--accent, #4f46e5); color: white;
  border: none; border-radius: 12px;
  width: 44px; height: 44px; font-size: 18px;
  cursor: pointer; flex-shrink: 0; align-self: flex-end;
}
#chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
.ask-claude-btn {
  background: none; border: 1px solid rgba(255,255,255,0.15);
  color: inherit; border-radius: 8px;
  padding: 4px 10px; font-size: 12px; cursor: pointer;
  opacity: 0.7; transition: opacity 0.2s;
  margin-top: 8px;
}
.ask-claude-btn:hover { opacity: 1; }
#intelligence-btn {
  position: fixed; bottom: 80px; right: 20px;
  background: var(--accent, #4f46e5); color: white;
  border: none; border-radius: 24px;
  padding: 10px 18px; font-size: 14px; font-weight: 600;
  cursor: pointer; box-shadow: 0 4px 20px rgba(79,70,229,0.4);
  z-index: 998; letter-spacing: 0.02em;
}
```

#### Chat JavaScript Logic

Add these functions to the `<script>` section of `index.html`:

```javascript
// ─── Intelligence Chat ────────────────────────────────────

const CHAT_STATE = {
  messages: [],          // conversation history for Claude API
  systemPrompt: null,    // built once on first open
  isLoading: false,
};

async function buildSystemPrompt() {
  if (CHAT_STATE.systemPrompt) return CHAT_STATE.systemPrompt; // cached

  // Load user profile from knowledge file
  let userProfile = '';
  try {
    const res = await fetch('/knowledge/user-profile.md');
    if (res.ok) userProfile = await res.text();
  } catch {}

  // Summarize today's briefing as context
  const briefing = STATE.briefing;
  let briefingContext = '';
  if (briefing) {
    const newsletterSummaries = (briefing.newsletters || [])
      .filter(n => n.has_new_edition)
      .map(n => `- ${n.name}: ${n.layer1?.summary || ''}`)
      .join('\n');
    const calendarItems = (briefing.calendar || [])
      .map(e => `- ${e.title || e.summary} (${e.start || ''})`)
      .join('\n');
    briefingContext = `
## Today's Briefing Summary
Date: ${briefing._meta?.generated_at || new Date().toDateString()}

### Newsletters processed today:
${newsletterSummaries || 'None'}

### Calendar (next 7 days):
${calendarItems || 'None'}
`.trim();
  }

  CHAT_STATE.systemPrompt = `You are a personal intelligence assistant for the user of Morning OS.

${userProfile}

${briefingContext}

## Your Role
Answer questions about today's briefing, explain signals and stories in depth, 
connect information to the user's specific domains (D1-D4), and provide sharp 
analysis when asked. You have full context of today's briefing above.

When the user asks to "deep dive" on a topic, search your knowledge and provide 
the most current and relevant analysis you can — go beyond what's in the briefing.

Be direct. No filler. Every sentence must add value.`;

  return CHAT_STATE.systemPrompt;
}

async function openIntelligenceChat(cardId, cardType) {
  const drawer = document.getElementById('intelligence-drawer');
  const backdrop = document.getElementById('drawer-backdrop');
  drawer.classList.remove('closed');
  backdrop.classList.add('visible');
  document.getElementById('chat-input').focus();

  // If opened from a card, pre-fill a contextual starter
  if (cardId && cardType) {
    let starter = '';
    if (cardType === 'newsletter') {
      const nl = (STATE.briefing?.newsletters || []).find(n => n.id === cardId);
      if (nl) starter = `Tell me more about the key signals from ${nl.name} today. What are the deeper implications for my work and portfolio?`;
    } else if (cardType === 'podcast') {
      const pod = (STATE.briefing?.podcasts || []).find(p => p.id === cardId);
      if (pod) starter = `Deep dive on the main ideas from ${pod.name} — ${pod.episode_title || 'latest episode'}. What should I take away?`;
    } else if (cardType === 'grow') {
      starter = `Expand on today's growth content. Give me more depth on the small talk technique and mini concept.`;
    }
    if (starter) {
      document.getElementById('chat-input').value = starter;
    }
  }
}

function closeIntelligenceChat() {
  document.getElementById('intelligence-drawer').classList.add('closed');
  document.getElementById('drawer-backdrop').classList.remove('visible');
}

function handleChatKey(e) {
  // Send on Enter (not Shift+Enter)
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
}

async function sendChatMessage() {
  if (CHAT_STATE.isLoading) return;
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  input.value = '';
  CHAT_STATE.isLoading = true;
  document.getElementById('chat-send').disabled = true;

  // Add user message to UI
  appendChatMessage('user', text);
  CHAT_STATE.messages.push({ role: 'user', content: text });

  // Show thinking indicator
  const thinkingEl = appendChatMessage('assistant thinking', '...');

  try {
    const systemPrompt = await buildSystemPrompt();

    const response = await fetch('/.netlify/functions/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: systemPrompt,
        messages: CHAT_STATE.messages,
      }),
    });

    if (!response.ok) throw new Error(`API error ${response.status}`);
    const data = await response.json();
    const reply = data.text || 'No response received.';

    // Replace thinking with actual response
    thinkingEl.textContent = reply;
    thinkingEl.classList.remove('thinking');

    CHAT_STATE.messages.push({ role: 'assistant', content: reply });

  } catch (err) {
    thinkingEl.textContent = `Error: ${err.message}. Check that ANTHROPIC_API_KEY is set in Netlify.`;
    thinkingEl.classList.remove('thinking');
  } finally {
    CHAT_STATE.isLoading = false;
    document.getElementById('chat-send').disabled = false;
  }
}

function appendChatMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  el.textContent = text;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}
```

### C5 — Setup Instructions for Netlify Environment Variable

Add this section to `README.md` (append, do not replace existing content):

```markdown
## Setting up Intelligence Chat

The Intelligence Chat feature requires one additional setup step in Netlify:

1. Go to your Netlify site → **Site configuration → Environment variables**
2. Add variable: `ANTHROPIC_API_KEY` = your Anthropic API key
   (Same key used in GitHub Actions secrets)
3. Redeploy the site (or it auto-deploys on next git push)

The chat proxy runs as a Netlify Function — your API key never touches the browser.
```

---

## 10. Updated Implementation Order (Phases A + B + C)

Implement in this exact sequence:

1. **Frontend Bug Fixes** (Phase A — 6 bugs in index.html)
2. **Knowledge Files** (create `knowledge/user-profile.md` + `knowledge/domains.md`)
3. **Knowledge Integration in generate.js** (load files, update BASE_SYSTEM)
4. **Newsletter Body Limit** (8KB → 25KB)
5. **Upgraded Newsletter Prompt** (Phase B4)
6. **Gmail Auto-Discovery** (Phase B2)
7. **Notion Retry Logic** (Phase B5)
8. **Netlify Function** (create `netlify/functions/chat.js`)
9. **netlify.toml** (create in repo root)
10. **Intelligence Chat UI** (drawer HTML + CSS + JS in index.html)
11. **README update** (Netlify env var setup instructions)
12. **Full integration test** (checklist below)

---

## 11. Complete Testing Checklist

**Phase A — Frontend Bugs:**
- [ ] Small Talk Bridge card renders
- [ ] Newsletter Layer2 expands fully without clipping
- [ ] Podcast Layer2 expands fully without clipping
- [ ] Long words/URLs don't overflow card boundaries
- [ ] Saving an item shows "Saved ✓" toast
- [ ] Saved items have ✕ delete button with "Removed" toast

**Phase B — Backend Quality:**
- [ ] `discoverNewsletters()` returns 6-10 senders from inbox
- [ ] Only List-Unsubscribe senders included (no personal emails)
- [ ] Falls back to `ALL_NEWSLETTERS` if discovery fails
- [ ] Newsletter body captured up to 25KB
- [ ] `knowledge/user-profile.md` content appears in Claude API system prompt (check logs)
- [ ] Newsletter JSON includes `data_points` array with real numbers
- [ ] Newsletter JSON includes `questions` array (new field)
- [ ] Notion write retries up to 3x on failure
- [ ] `briefing.json` includes `_meta.discovery_mode` field

**Phase C — Intelligence Chat:**
- [ ] Floating "✦ Ask" button visible on all tabs
- [ ] Clicking button opens drawer from bottom with animation
- [ ] Clicking backdrop closes drawer
- [ ] "Ask Claude →" button appears on newsletter, podcast, and grow cards
- [ ] Clicking card button opens drawer with pre-filled contextual question
- [ ] Sending a message calls `/.netlify/functions/chat` (check Network tab)
- [ ] Response appears in drawer (not blank, not error)
- [ ] Multi-turn: follow-up question references previous answer
- [ ] Enter key sends message, Shift+Enter adds newline
- [ ] Send button disabled while waiting for response
- [ ] Error message shown if API key not configured

---

## 12. What Is NOT In This Spec

Do not implement. Documented here to prevent speculative additions:

- AI MBA Section (possible Phase 6)
- Podcast cross-device sync
- iTunes podcast search in Settings
- Chat history persistence across sessions
- Streaming SSE responses (requires Netlify paid plan)
- Spaced repetition / Anki integration for Arabic
- Any changes to `manifest.json` or `package.json`

---

## 13. Phase D — Intelligence Compound (Weekly Synthesis + User Model + Accountability)

This is the layer that makes the system compound over time. Daily briefings are inputs. Phase D generates outputs that accumulate — a growing model of the world and of you.

### D1 — Architecture Overview

```
New GitHub Actions workflow: weekly-synthesis.yml
Runs: Sunday 06:00 Dubai (02:00 UTC)

weekly-synthesis.js (new script)
│
├─ Reads archive/YYYY-MM-DD.json for last 7 days
├─ Reads knowledge/user-model.md (current state)
├─ Makes 2 Claude API calls:
│    Call 1: Weekly Synthesis → weekly-report.json
│    Call 2: User Model Update → updated user-model.md
├─ Writes weekly-report.json to repo (triggers Netlify deploy)
├─ Overwrites knowledge/user-model.md with updated version
├─ Writes rich Notion page to "Weekly Intelligence Reports" database
└─ Commits all changes to repo
```

**Cost impact:** 2 extra Claude API calls per week ≈ +$0.30/month. Negligible.

### D2 — Daily Archive (prerequisite, add to generate.js)

Before Phase D can synthesize, daily briefings must be preserved.

**Add to `generate.js` after writing `briefing.json`:**

```javascript
// Archive today's briefing
const archiveDir = 'archive';
if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
fs.writeFileSync(
  path.join(archiveDir, `${today}.json`),
  JSON.stringify(briefingData, null, 2)
);
console.log(`[Archive] Saved briefing to archive/${today}.json`);
```

**Add `archive/` to `.gitignore` exclusion** — it SHOULD be committed (it's the memory store).
Cap at 90 days: in generate.js, after archiving, delete files older than 90 days:

```javascript
const files = fs.readdirSync(archiveDir).sort();
if (files.length > 90) {
  files.slice(0, files.length - 90).forEach(f => 
    fs.unlinkSync(path.join(archiveDir, f))
  );
}
```

### D3 — User Model: `knowledge/user-model.md`

Create this file. It starts as a seed and gets updated weekly by the synthesis agent. Claude Code should create it with this initial content, filling in placeholders from `user-profile.md`:

```markdown
# User Model — Living Intelligence Document
_Auto-updated weekly by Morning OS Synthesis Agent_
_Last updated: [date of first run]_
_Version: 1_

---

## Current Beliefs & Theses

### D1 — Professional / AI / FDE
- **FDE Evolution**: Pre-Sales is shifting from advisory to build — SEs who can't code will be displaced within 3 years [High confidence]
- **AI in Enterprise**: Adoption is blocked by integration complexity, not capability gaps [High confidence]
- **Open question**: At what team size does the FDE model break down?

### D2 — Wealth / Crypto / DeFi  
- **Bitcoin**: Institutional flows are the dominant price driver in this cycle [High confidence]
- **DeFi**: Real yield protocols will outperform governance-token speculation in 2025 [Medium confidence]
- **Open question**: How does MiCA regulation affect UAE-based DeFi participation?

### D3 — Geopolitics / Gulf
- **UAE positioning**: UAE is successfully running a multi-alignment foreign policy — relationships with US, China, and Iran simultaneously [High confidence]
- **Gulf tech**: Saudi and UAE sovereign wealth will be the dominant AI infrastructure investors outside the US in 2025-2026 [Medium confidence]
- **Open question**: What is the realistic timeline for Iran nuclear deal resolution?

### D4 — Personal Growth / Habitus
- **Content creation**: Building a personal brand around AI transformation in Pre-Sales is the highest-leverage career move available [High confidence]
- **Open question**: Which platform — LinkedIn long-form or short video — has better ROI for this audience?

---

## Behavioral Patterns Observed
_Populated by synthesis agent after first weeks of data_

- [ ] To be populated after first weekly synthesis run

---

## Decisions Log
_Major decisions made, with context_

- [ ] To be populated as decisions are logged via Intelligence Chat

---

## Learning Velocity by Domain
_Which domains are getting attention vs being neglected_

- D1: — (no data yet)
- D2: — (no data yet)  
- D3: — (no data yet)
- D4: — (no data yet)

---

## Last 3 Weekly Challenges & Outcomes
_Set by synthesis agent, outcomes logged via chat_

- [ ] To be populated after first weekly run

---
_This file is injected into every Claude Intelligence Chat session and every weekly synthesis call._
_Do not manually edit the "Behavioral Patterns" or "Learning Velocity" sections — they are managed by the agent._
```

### D4 — New Script: `scripts/weekly-synthesis.js`

Create this file. It is the core of the Intelligence Compound.

```javascript
// scripts/weekly-synthesis.js
// Runs every Sunday via GitHub Actions
// Reads last 7 daily briefings → synthesizes → updates Notion + user-model.md

const fs = require('fs');
const path = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_WEEKLY_DATABASE_ID = process.env.NOTION_WEEKLY_DATABASE_ID;
const USER_NAME = process.env.USER_NAME || 'User';

// ─── Load Knowledge Files ────────────────────────────────────────────────────
function loadFile(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

// ─── Load Last 7 Briefings ───────────────────────────────────────────────────
function loadWeeklyArchive() {
  const archiveDir = 'archive';
  if (!fs.existsSync(archiveDir)) return [];

  const files = fs.readdirSync(archiveDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .slice(-7); // last 7 days

  return files.map(f => {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(archiveDir, f), 'utf8'));
      return { date: f.replace('.json', ''), ...data };
    } catch { return null; }
  }).filter(Boolean);
}

// ─── Claude API Call ─────────────────────────────────────────────────────────
async function claudeCall(system, user, maxTokens = 4000) {
  const { default: fetch } = await import('node-fetch');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data = await response.json();
  const text = data.content?.[0]?.text || '';
  // Strip markdown fences if present
  return text.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[Weekly Synthesis] Starting...');

  const weeklyBriefings = loadWeeklyArchive();
  if (weeklyBriefings.length === 0) {
    console.log('[Weekly Synthesis] No archive data found. Skipping.');
    return;
  }

  const userProfile = loadFile('knowledge/user-profile.md');
  const userModel = loadFile('knowledge/user-model.md');
  const domains = loadFile('knowledge/domains.md');

  console.log(`[Weekly Synthesis] Loaded ${weeklyBriefings.length} daily briefings`);

  // ── Compact briefings for prompt (extract layer1 only to save tokens) ──────
  const compactBriefings = weeklyBriefings.map(b => ({
    date: b.date,
    newsletters: (b.newsletters || []).filter(n => n.has_new_edition).map(n => ({
      name: n.name,
      domain: n.domain,
      summary: n.layer1?.summary,
      signals: n.layer1?.signals,
      triage: n.layer1?.triage_suggestion,
    })),
    podcasts: (b.podcasts || []).map(p => ({
      name: p.name,
      episode: p.episode_title,
      summary: p.digest?.summary,
      insights: p.digest?.insights,
    })),
    calendar: b.calendar || [],
  }));

  // ── CALL 1: Weekly Synthesis ──────────────────────────────────────────────
  console.log('[Weekly Synthesis] Calling Claude for synthesis...');

  const synthesisSystem = `You are ${USER_NAME}'s personal intelligence analyst producing a weekly synthesis report.

## User Profile
${userProfile}

## Domain Guide
${domains}

## Current User Model
${userModel}

Return ONLY valid JSON. No preamble. No markdown fences.`;

  const synthesisPrompt = `Synthesize this week's intelligence briefings for ${USER_NAME}.

## This Week's Daily Briefings (7 days):
${JSON.stringify(compactBriefings, null, 2)}

Return a JSON object with this exact structure:
{
  "week_of": "YYYY-MM-DD (Monday of this week)",
  "dominant_narrative": "1 paragraph: the single most important story/theme that ran through this week across all sources. Be specific — name the actual story, not a category.",
  "signal_tracker": [
    {
      "topic": "Specific topic name",
      "domain": "D1|D2|D3|D4",
      "appearances": 3,
      "trend": "accelerating|stable|fading",
      "one_line": "What's actually happening with this topic right now"
    }
  ],
  "domain_pulse": {
    "D1": "1-2 sentences: what moved in Professional/AI/FDE this week. Be specific.",
    "D2": "1-2 sentences: what moved in Wealth/Crypto/DeFi this week.",
    "D3": "1-2 sentences: what moved in Geopolitics/Gulf this week.",
    "D4": "1-2 sentences: what moved in Personal Growth/Habitus this week."
  },
  "source_conflicts": [
    {
      "topic": "Topic where sources disagreed",
      "position_a": "What source X argued",
      "position_b": "What source Y argued",
      "implication": "Why this disagreement matters for ${USER_NAME}"
    }
  ],
  "learning_gaps": [
    {
      "topic": "Topic that appeared repeatedly but likely needs deeper understanding",
      "why": "Why this gap matters",
      "suggested_action": "Specific thing to read/do to close this gap"
    }
  ],
  "reading_behavior": {
    "most_read_domain": "D1|D2|D3|D4",
    "skipped_most": "Which newsletter/domain was consistently skipped",
    "observation": "One honest observation about ${USER_NAME}'s reading patterns this week"
  },
  "weekly_challenges": [
    "Challenge 1: specific, behavioral, tied to this week's content — not generic advice",
    "Challenge 2: something that requires action, not just reading",
    "Challenge 3: a reflection question that connects to ${USER_NAME}'s current beliefs"
  ],
  "one_conviction": "The single most important thing ${USER_NAME} should update their worldview about based on this week's signals. Be bold. Don't hedge."
}

Rules:
- signal_tracker: minimum 3, maximum 8 topics. Only include topics that appeared 2+ times.
- source_conflicts: only include if genuine disagreement exists. Can be empty array.
- learning_gaps: maximum 3. Quality over quantity.
- weekly_challenges: exactly 3. Make them uncomfortable. Vague challenges are useless.
- one_conviction: this is the most important field. Make it sharp and specific.`;

  const synthesisRaw = await claudeCall(synthesisSystem, synthesisPrompt, 4000);
  let synthesis;
  try {
    synthesis = JSON.parse(synthesisRaw);
  } catch (e) {
    console.error('[Weekly Synthesis] Failed to parse synthesis JSON:', e.message);
    console.error(synthesisRaw.substring(0, 500));
    process.exit(1);
  }

  // ── CALL 2: Update User Model ─────────────────────────────────────────────
  console.log('[Weekly Synthesis] Calling Claude to update user model...');

  const modelUpdateSystem = `You are updating ${USER_NAME}'s intelligence user model based on a week of data.
Return ONLY the complete updated markdown file content. No preamble. No explanation.`;

  const modelUpdatePrompt = `Update the user model based on this week's synthesis.

## Current User Model:
${userModel}

## This Week's Synthesis:
${JSON.stringify(synthesis, null, 2)}

## Instructions:
1. Update "Learning Velocity by Domain" based on reading_behavior data
2. Add any new behavioral patterns observed to "Behavioral Patterns Observed"  
3. Update "Last 3 Weekly Challenges & Outcomes" — shift previous weeks down, add this week's new challenges
4. If synthesis reveals strong evidence that should update a belief in "Current Beliefs & Theses", update it with a note like "[Updated YYYY-MM-DD based on weekly synthesis]"
5. Update the "_Last updated_" timestamp at the top
6. Increment the version number

Return the COMPLETE updated user-model.md file content. Preserve all existing structure.
Do not remove any sections. Do not add new top-level sections.`;

  const updatedUserModel = await claudeCall(modelUpdateSystem, modelUpdatePrompt, 3000);

  // ── Save outputs ───────────────────────────────────────────────────────────
  fs.writeFileSync('weekly-report.json', JSON.stringify(synthesis, null, 2));
  console.log('[Weekly Synthesis] Wrote weekly-report.json');

  fs.writeFileSync('knowledge/user-model.md', updatedUserModel);
  console.log('[Weekly Synthesis] Updated knowledge/user-model.md');

  // ── Write to Notion ────────────────────────────────────────────────────────
  if (NOTION_API_KEY && NOTION_WEEKLY_DATABASE_ID) {
    await writeWeeklyToNotion(synthesis, updatedUserModel);
  } else {
    console.log('[Weekly Synthesis] Notion credentials missing — skipping Notion write');
  }

  console.log('[Weekly Synthesis] Complete.');
}

// ─── Notion Writer ───────────────────────────────────────────────────────────
async function writeWeeklyToNotion(synthesis, userModel) {
  const { default: fetch } = await import('node-fetch');

  const blocks = [];

  // Header callout
  blocks.push({
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji: '🧠' },
      rich_text: [{ type: 'text', text: { content: synthesis.dominant_narrative } }],
      color: 'blue_background',
    },
  });

  blocks.push({ type: 'divider', divider: {} });

  // Domain Pulse
  blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📡 Domain Pulse' } }] } });
  for (const [domain, pulse] of Object.entries(synthesis.domain_pulse)) {
    blocks.push({
      type: 'bulleted_list_item',
      bulleted_list_item: { rich_text: [{ type: 'text', text: { content: `${domain}: ${pulse}` } }] },
    });
  }

  blocks.push({ type: 'divider', divider: {} });

  // Signal Tracker
  blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📈 Signal Tracker' } }] } });
  for (const signal of (synthesis.signal_tracker || [])) {
    const trendEmoji = signal.trend === 'accelerating' ? '↑' : signal.trend === 'fading' ? '↓' : '→';
    blocks.push({
      type: 'bulleted_list_item',
      bulleted_list_item: {
        rich_text: [{ type: 'text', text: { content: `[${signal.domain}] ${signal.topic} ${trendEmoji} (${signal.appearances}x) — ${signal.one_line}` } }],
      },
    });
  }

  blocks.push({ type: 'divider', divider: {} });

  // One Conviction
  blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '💡 This Week\'s Conviction' } }] } });
  blocks.push({
    type: 'quote',
    quote: { rich_text: [{ type: 'text', text: { content: synthesis.one_conviction } }] },
  });

  blocks.push({ type: 'divider', divider: {} });

  // Learning Gaps
  if ((synthesis.learning_gaps || []).length > 0) {
    blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '🔍 Learning Gaps' } }] } });
    for (const gap of synthesis.learning_gaps) {
      blocks.push({
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: `${gap.topic}: ${gap.why} → ${gap.suggested_action}` } }] },
      });
    }
    blocks.push({ type: 'divider', divider: {} });
  }

  // Source Conflicts
  if ((synthesis.source_conflicts || []).length > 0) {
    blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '⚔️ Source Conflicts' } }] } });
    for (const conflict of synthesis.source_conflicts) {
      blocks.push({
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: `${conflict.topic}: ${conflict.position_a} vs ${conflict.position_b} — ${conflict.implication}` } }] },
      });
    }
    blocks.push({ type: 'divider', divider: {} });
  }

  // Weekly Challenges
  blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '🎯 Your 3 Challenges This Week' } }] } });
  for (const [i, challenge] of (synthesis.weekly_challenges || []).entries()) {
    blocks.push({
      type: 'numbered_list_item',
      numbered_list_item: { rich_text: [{ type: 'text', text: { content: challenge } }] },
    });
  }

  blocks.push({ type: 'divider', divider: {} });

  // Reading Behavior
  blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '🪞 Your Reading Patterns This Week' } }] } });
  const rb = synthesis.reading_behavior || {};
  blocks.push({
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: rb.observation || '' } }] },
  });
  blocks.push({
    type: 'callout',
    callout: {
      icon: { type: 'emoji', emoji: '📊' },
      rich_text: [{ type: 'text', text: { content: `Most engaged: ${rb.most_read_domain || '—'} | Most skipped: ${rb.skipped_most || '—'}` } }],
      color: 'gray_background',
    },
  });

  // Create Notion page
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      parent: { database_id: NOTION_WEEKLY_DATABASE_ID },
      properties: {
        Name: { title: [{ text: { content: `Weekly Intelligence Report — ${synthesis.week_of}` } }] },
        Date: { date: { start: synthesis.week_of } },
        Status: { select: { name: 'Generated' } },
      },
      children: blocks.slice(0, 100), // Notion block limit
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Notion write failed: ${err}`);
  }
  console.log('[Weekly Synthesis] Notion page created successfully');
}

main().catch(err => {
  console.error('[Weekly Synthesis] Fatal error:', err);
  process.exit(1);
});
```

### D5 — New GitHub Actions Workflow: `.github/workflows/weekly-synthesis.yml`

Create this file:

```yaml
name: Morning OS — Weekly Intelligence Synthesis

on:
  schedule:
    - cron: '0 2 * * 0'  # 02:00 UTC = 06:00 Dubai (UTC+4), every Sunday
  workflow_dispatch:       # Allow manual trigger for testing

jobs:
  synthesize:
    runs-on: ubuntu-latest
    permissions:
      contents: write      # Required to commit user-model.md back to repo

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          token: ${{ secrets.GITHUB_TOKEN }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'

      - name: Install dependencies
        run: npm install

      - name: Run weekly synthesis
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          NOTION_API_KEY: ${{ secrets.NOTION_API_KEY }}
          NOTION_WEEKLY_DATABASE_ID: ${{ secrets.NOTION_WEEKLY_DATABASE_ID }}
          USER_NAME: ${{ vars.USER_NAME }}
        run: node scripts/weekly-synthesis.js

      - name: Commit updated user model and weekly report
        run: |
          git config --local user.email "morning-os[bot]@users.noreply.github.com"
          git config --local user.name "Morning OS Bot"
          git add knowledge/user-model.md weekly-report.json
          git diff --staged --quiet || git commit -m "Weekly synthesis: $(date +%Y-%m-%d)"
          git push
```

**Important:** This workflow commits `user-model.md` back to the repo after updating it. This is how the memory persists — it's version-controlled, auditable, and never lost.

### D6 — New Notion Database: Weekly Intelligence Reports

**Add to `README.md` setup section:**

```markdown
## Setting up Weekly Intelligence Reports (Notion)

1. In Notion, create a new database: "Weekly Intelligence Reports"
2. Add properties:
   - `Name` (title) — already exists  
   - `Date` (date)
   - `Status` (select) — add options: "Generated", "Reviewed"
3. Connect your "Morning OS" integration to this database
4. Copy the database ID from the URL
5. Add to GitHub Actions Secrets:
   - Key: `NOTION_WEEKLY_DATABASE_ID`
   - Value: the 32-char database ID
```

### D7 — Intelligence Chat Enhancement: Weekly Report Access

**Update `buildSystemPrompt()` in `index.html`** to also load `weekly-report.json` if available:

```javascript
// Add to buildSystemPrompt(), after loading user-profile.md:
let weeklyReport = '';
try {
  const wrRes = await fetch('/weekly-report.json');
  if (wrRes.ok) {
    const wr = await wrRes.json();
    weeklyReport = `
## Last Weekly Synthesis (${wr.week_of})
Dominant narrative: ${wr.dominant_narrative}
This week's conviction: ${wr.one_conviction}
Your 3 challenges: ${(wr.weekly_challenges || []).join(' | ')}
`;
  }
} catch {}

// Add weeklyReport to the system prompt string
```

This means the Intelligence Chat knows not just today's briefing, but also what the synthesis said last Sunday — giving it genuine continuity.

### D8 — User Model Loading in Chat

**Update `buildSystemPrompt()` to also load `knowledge/user-model.md`:**

```javascript
// Add to buildSystemPrompt():
let userModel = '';
try {
  const umRes = await fetch('/knowledge/user-model.md');
  if (umRes.ok) userModel = await umRes.text();
} catch {}
```

**Add to system prompt string:**
```javascript
`## Your Evolving User Model\n${userModel}`
```

Now when you chat with Intelligence, it knows your current beliefs, your open questions, your recent decisions, and your behavioral patterns. Every week that model gets sharper.

---

## 14. Updated Implementation Order (All Phases)

Implement in this exact sequence:

**Phase A — Frontend Bugs** (Steps 1-6 from Section 10)

**Phase B — Backend Quality** (Steps 7-11 from Section 10)

**Phase C — Intelligence Chat** (Steps 12-17 from Section 10)

**Phase D — Intelligence Compound:**

13. **Daily Archive** — add archive logic to `generate.js` (Section D2)
14. **User Model seed file** — create `knowledge/user-model.md` (Section D3)
15. **Weekly synthesis script** — create `scripts/weekly-synthesis.js` (Section D4)
16. **Weekly workflow** — create `.github/workflows/weekly-synthesis.yml` (Section D5)
17. **README update** — add Notion weekly database setup instructions (Section D6)
18. **Chat enhancement** — update `buildSystemPrompt()` to load weekly report + user model (Sections D7 + D8)
19. **Full integration test** — run `weekly-synthesis.js` manually, verify Notion page created, verify `user-model.md` updated in repo

---

## 15. Complete Testing Checklist (All Phases)

**Phase A — Frontend Bugs:**
- [ ] Small Talk Bridge card renders (was broken)
- [ ] Newsletter Layer2 expands fully without clipping
- [ ] Podcast Layer2 expands fully without clipping
- [ ] Long words/URLs don't overflow card boundaries
- [ ] Saving an item shows "Saved ✓" toast
- [ ] Saved items have ✕ delete button with "Removed" toast

**Phase B — Backend Quality:**
- [ ] `discoverNewsletters()` returns 6-10 senders from inbox
- [ ] Only List-Unsubscribe senders included (no personal emails)
- [ ] Falls back to `ALL_NEWSLETTERS` if discovery fails
- [ ] Newsletter body captured up to 25KB
- [ ] `knowledge/user-profile.md` content appears in Claude API system prompt (check logs)
- [ ] Newsletter JSON includes `data_points` array with real numbers
- [ ] Newsletter JSON includes `questions` array (new field)
- [ ] Notion write retries up to 3x on failure
- [ ] `briefing.json` includes `_meta.discovery_mode` field

**Phase C — Intelligence Chat:**
- [ ] Floating "✦ Ask" button visible on all tabs
- [ ] Clicking button opens drawer from bottom with animation
- [ ] Clicking backdrop closes drawer
- [ ] "Ask Claude →" button appears on newsletter, podcast, and grow cards
- [ ] Clicking card button opens drawer with pre-filled contextual question
- [ ] Sending a message calls `/.netlify/functions/chat` (check Network tab)
- [ ] Response appears in drawer (not blank, not error)
- [ ] Multi-turn: follow-up question references previous answer
- [ ] Enter key sends message, Shift+Enter adds newline
- [ ] Send button disabled while waiting for response
- [ ] Error message shown if API key not configured

**Phase D — Intelligence Compound:**
- [ ] `archive/YYYY-MM-DD.json` is created after each daily generate.js run
- [ ] Archive is capped at 90 files (old ones deleted)
- [ ] `knowledge/user-model.md` exists with seed content
- [ ] `scripts/weekly-synthesis.js` runs without errors (test with `node scripts/weekly-synthesis.js`)
- [ ] `weekly-report.json` is created after synthesis run
- [ ] `knowledge/user-model.md` is updated (version incremented, timestamps updated)
- [ ] Weekly Notion page created in "Weekly Intelligence Reports" database
- [ ] Notion page contains all sections: Domain Pulse, Signal Tracker, Conviction, Challenges, Reading Patterns
- [ ] GitHub Actions workflow commits updated `user-model.md` back to repo
- [ ] Intelligence Chat loads `weekly-report.json` and surfaces last week's conviction
- [ ] Intelligence Chat loads `knowledge/user-model.md` and references current beliefs

---

## 16. Environment Variables Reference (Complete)

```
# Existing — unchanged
ANTHROPIC_API_KEY
NOTION_API_KEY
NOTION_DATABASE_ID          # Daily briefings database
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
GOOGLE_CALENDAR_ID
USER_NAME
USER_PROFILE                # Legacy fallback
USER_CITY
USER_TIMEZONE
ACTIVE_NEWSLETTERS          # Fallback only (auto-discovery is primary)
ACTIVE_PODCASTS

# New — add to GitHub Actions Secrets
NOTION_WEEKLY_DATABASE_ID   # Weekly Intelligence Reports database

# New — add to Netlify Environment Variables
ANTHROPIC_API_KEY           # Same key — needed for Netlify chat function
```

---

## 17. Phase E — Podcast Intelligence Layer

The existing podcast processing (`fetch-transcripts.js` + `processPodcast()` in `generate.js`) is too shallow: one generic summary, a few bullet insights, done. This phase replaces it with a structured intelligence layer that separates host from guest, tracks who says what, surfaces recommendations, and feeds directly into the weekly synthesis.

### E1 — New Podcast JSON Schema

Replace the current flat podcast output with this richer structure in `briefing.json`:

```json
{
  "id": "podcast-slug",
  "name": "Podcast Name",
  "episode_title": "Full episode title",
  "episode_url": "YouTube URL",
  "published_date": "YYYY-MM-DD",

  "speakers": [
    {
      "name": "Speaker Name",
      "role": "host|guest",
      "profile": "Only for guests: 2-3 sentence profile — who they are, why they matter, what they're known for. Sourced from transcript introduction + web search if needed.",
      "profile_source": "transcript|web_search|both"
    }
  ],

  "layer1": {
    "summary": "3-4 sentences max. What was this episode actually about? Lead with the most surprising or valuable idea. No filler.",
    "guest_in_one_line": "If there's a guest: who they are and why this conversation matters. Empty string if host-only.",
    "key_statements": [
      "The 3-5 most important standalone statements from the episode — things worth remembering independently of context"
    ],
    "domain_tags": ["D1", "D2"],
    "signal_strength": "high|medium|low",
    "triage": "Must Listen|Worth Skimming|Skip"
  },

  "layer2": {
    "topics": [
      {
        "title": "Topic name",
        "summary": "2-3 sentences on what was said about this topic",
        "insights": ["Key insight 1", "Key insight 2"],
        "quotes": [
          {
            "speaker": "Name",
            "text": "Verbatim quote — exact words, not paraphrased",
            "context": "One sentence: why this quote matters"
          }
        ]
      }
    ],
    "hypotheses": [
      {
        "statement": "A bold claim or prediction made in the episode",
        "speaker": "Who made it",
        "evidence": "What reasoning or data they used to support it",
        "domain": "D1|D2|D3|D4"
      }
    ],
    "domain_connections": {
      "D1": "How this episode connects to Professional/AI/FDE — or empty string",
      "D2": "How this episode connects to Wealth/Crypto/DeFi — or empty string",
      "D3": "How this episode connects to Geopolitics/Gulf — or empty string",
      "D4": "How this episode connects to Personal Growth/Habitus — or empty string"
    },
    "reflection": "One sharp question for the listener to sit with"
  },

  "recommendations": {
    "books": [
      { "title": "Book Title", "author": "Author Name", "mentioned_by": "Speaker Name", "context": "Why they mentioned it" }
    ],
    "podcasts": [
      { "name": "Podcast Name", "mentioned_by": "Speaker Name", "context": "Why they mentioned it" }
    ],
    "tools": [
      { "name": "Tool/Software Name", "mentioned_by": "Speaker Name", "context": "What it does / why relevant" }
    ],
    "people": [
      { "name": "Person Name", "mentioned_by": "Speaker Name", "context": "Who they are / why worth following" }
    ],
    "articles_links": [
      { "title": "Article/Resource title", "mentioned_by": "Speaker Name", "context": "Why relevant" }
    ],
    "music": [
      { "title": "Track or Artist", "mentioned_by": "Speaker Name", "context": "Context of mention" }
    ]
  }
}
```

**Rule:** If a recommendations category is empty, include it as an empty array. Never omit the key.

### E2 — Updated `fetch-transcripts.js`: Speaker Detection

Modify `fetch-transcripts.js` to extract speaker metadata from the YouTube page in addition to downloading captions.

**Add `extractEpisodeMetadata()` function:**

```javascript
async function extractEpisodeMetadata(youtubeUrl) {
  // Use yt-dlp to get episode metadata (title, description, upload date)
  // Command: yt-dlp --dump-json --no-download {url}
  // Parse JSON output for:
  //   - title (episode title)
  //   - upload_date (YYYY-MM-DD)
  //   - description (first 2000 chars — often contains guest names)
  //   - webpage_url
  // Return: { title, date, description, url }
}
```

Save metadata alongside transcript:
- Transcript: `transcripts/{podId}-{DATE}.txt` (unchanged)
- Metadata: `transcripts/{podId}-{DATE}-meta.json` (new)

`-meta.json` format:
```json
{
  "episode_title": "...",
  "published_date": "YYYY-MM-DD",
  "description": "first 2000 chars of YouTube description",
  "url": "https://youtube.com/watch?v=..."
}
```

### E3 — Updated `generate.js`: `processPodcast()` Rewrite

Replace the current shallow `processPodcast()` function entirely.

**New flow:**

```javascript
async function processPodcast(podcastConfig) {
  const { id, name, domain, isKnownHost } = podcastConfig;
  const DATE = getTodayDate();

  // 1. Load transcript
  const transcriptPath = `transcripts/${id}-${DATE}.txt`;
  if (!fs.existsSync(transcriptPath)) {
    console.log(`[Podcast] No transcript for ${name} — skipping`);
    return null;
  }
  const transcript = fs.readFileSync(transcriptPath, 'utf8').slice(0, 20000); // 20KB max (up from 14KB)

  // 2. Load metadata if available
  const metaPath = `transcripts/${id}-${DATE}-meta.json`;
  const meta = fs.existsSync(metaPath)
    ? JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    : { episode_title: '', published_date: DATE, description: '', url: '' };

  // 3. Identify guest from description + transcript opening
  //    Check if description mentions a guest name
  //    If yes, flag for web search enrichment
  const guestHint = extractGuestHint(meta.description, transcript.slice(0, 3000));

  // 4. Web search for guest profile if needed
  let guestWebProfile = '';
  if (guestHint && guestHint !== isKnownHost) {
    guestWebProfile = await searchGuestProfile(guestHint);
  }

  // 5. Claude API call — full podcast intelligence
  return await claudePodcastAnalysis(name, id, transcript, meta, guestWebProfile, domain);
}
```

**`extractGuestHint()` function:**
```javascript
function extractGuestHint(description, transcriptOpening) {
  // Simple heuristic: look for patterns like "with [Name]", "feat. [Name]",
  // "guest: [Name]", "joined by [Name]" in description or transcript opening
  // Return the guest name string or null if host-only episode
  const patterns = [
    /\bwith\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
    /\bfeat(?:uring)?\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
    /\bguest[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
    /\bjoined by\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/,
  ];
  const text = `${description} ${transcriptOpening}`;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}
```

**`searchGuestProfile()` function — web search via Claude with web_search tool:**
```javascript
async function searchGuestProfile(guestName) {
  // Make a Claude API call WITH the web_search tool enabled
  // Prompt: "Search for [guestName] and return a 2-3 sentence profile:
  //          who they are, what they're known for, why they matter.
  //          Be factual and concise."
  // This uses Claude's built-in web search capability
  // Return the text response (2-3 sentences)

  const { default: fetch } = await import('node-fetch');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
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
  const data = await response.json();
  // Extract text from response (may contain tool_use blocks — find the text block)
  const textBlock = data.content?.find(b => b.type === 'text');
  return textBlock?.text || '';
}
```

**`claudePodcastAnalysis()` function:**
```javascript
async function claudePodcastAnalysis(podcastName, podcastId, transcript, meta, guestWebProfile, primaryDomain) {
  const userProfile = loadFile('knowledge/user-profile.md');
  const domains = loadFile('knowledge/domains.md');

  const system = `You are analyzing a podcast episode for ${process.env.USER_NAME}.

## User Profile
${userProfile}

## Domain Guide
${domains}

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

  const raw = await claudeCall(system, prompt, 4000);
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[Podcast] JSON parse failed for ${podcastName}:`, e.message);
    return null;
  }
}
```

### E4 — Frontend: Podcast Tab Redesign (`index.html`)

Replace the current podcast card rendering in `renderPodcasts()` with a two-layer card that matches the new schema.

**Layer 1 card (default visible):**
```
┌─────────────────────────────────────────────┐
│ 🎙 Podcast Name                    [domain] │
│ Episode Title                               │
│ Guest: [Name] — [guest_in_one_line]         │
│                                             │
│ [summary — 3-4 sentences]                  │
│                                             │
│ Key Statements:                             │
│ • Statement 1                               │
│ • Statement 2                               │
│ • Statement 3                               │
│                                             │
│ [Must Listen ●] [D1 D2]        [Deep Dive ↓]│
└─────────────────────────────────────────────┘
```

**Layer 2 expansion (click "Deep Dive ↓"):**
```
┌─────────────────────────────────────────────┐
│ SPEAKERS                                    │
│ 👤 Host Name (host)                         │
│ 👤 Guest Name — [profile if guest]          │
│                                             │
│ TOPICS                                      │
│ ▸ Topic 1                                   │
│   [summary]                                 │
│   • Insight 1                               │
│   • Insight 2                               │
│   💬 "Verbatim quote" — Speaker             │
│                                             │
│ ▸ Topic 2 ...                               │
│                                             │
│ HYPOTHESES                                  │
│ ⚡ [Bold claim] — Speaker                   │
│   Evidence: [reasoning]                     │
│                                             │
│ DOMAIN CONNECTIONS                          │
│ D1: [connection]                            │
│ D2: [connection]                            │
│                                             │
│ FOLLOW-UP RECOMMENDATIONS                   │
│ 📚 Books: [title] by [author]               │
│ 🎙 Podcasts: [name]                         │
│ 🛠 Tools: [name]                            │
│ 👤 People: [name]                           │
│                                             │
│ 💭 [reflection question]                    │
│                                   [Save ✦] │
└─────────────────────────────────────────────┘
```

**Implementation notes for Claude Code:**

- The "Deep Dive ↓" button toggles a `.pod-layer2` panel using the same CSS pattern as newsletter Layer2 (with `max-height: none` fix already applied in Phase A)
- Guest profile only renders if `speaker.role === 'guest'` AND `speaker.profile` is non-empty
- Recommendations section only renders categories that have at least 1 item
- Each recommendation item has a "Save ✦" button that saves it to `savedItems` with `showToast('Saved ✦')`
- Hypotheses render with a ⚡ icon and distinct visual treatment (e.g. left border accent)
- Domain connections: only render D1/D2/D3/D4 rows where the value is non-empty string
- Topics are collapsible individually — click topic title to expand/collapse that topic's detail

### E5 — Weekly Synthesis: Podcast Data Integration

Update `weekly-synthesis.js` to include podcast intelligence in the weekly synthesis input.

**In `loadWeeklyArchive()`, extend the compact briefing to include podcasts:**

```javascript
// Replace current podcast compact mapping:
podcasts: (b.podcasts || []).map(p => ({
  name: p.name,
  episode: p.episode_title,
  domain_tags: p.layer1?.domain_tags,
  summary: p.layer1?.summary,
  key_statements: p.layer1?.key_statements,
  hypotheses: p.layer2?.hypotheses,
  domain_connections: p.layer2?.domain_connections,
  signal_strength: p.layer1?.signal_strength,
  // Aggregate all recommendations across episodes
  recommendations: p.recommendations,
})),
```

**Add to the weekly synthesis prompt** (in `synthesisPrompt` in `weekly-synthesis.js`):

```
Podcast episodes this week are included above. For each:
- Include high-signal podcast insights in the signal_tracker if they appeared across multiple sources
- Include bold hypotheses from podcasts in the weekly synthesis if they connect to user domains
- Aggregate recommendations across all podcast episodes into a "week_recommendations" field

Add this field to the synthesis JSON output:
"week_recommendations": {
  "books": [...all books mentioned across all podcasts this week, deduped],
  "podcasts": [...],
  "tools": [...],
  "people": [...],
  "articles_links": [...],
  "music": [...]
}
```

**Add recommendations to the Notion weekly page** in `writeWeeklyToNotion()`:

```javascript
// Add after the Reading Behavior section:
if (synthesis.week_recommendations) {
  const rec = synthesis.week_recommendations;
  const hasRecs = Object.values(rec).some(arr => arr.length > 0);
  if (hasRecs) {
    blocks.push({ type: 'divider', divider: {} });
    blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '📚 This Week\'s Recommendations' } }] } });
    const emojiMap = { books: '📖', podcasts: '🎙', tools: '🛠', people: '👤', articles_links: '🔗', music: '🎵' };
    for (const [category, items] of Object.entries(rec)) {
      if (items.length === 0) continue;
      for (const item of items) {
        const label = item.title || item.name || '';
        const by = item.mentioned_by ? ` (via ${item.mentioned_by})` : '';
        const ctx = item.context ? ` — ${item.context}` : '';
        blocks.push({
          type: 'bulleted_list_item',
          bulleted_list_item: { rich_text: [{ type: 'text', text: { content: `${emojiMap[category] || '•'} ${label}${by}${ctx}` } }] },
        });
      }
    }
  }
}
```

### E6 — Updated Testing Checklist: Phase E

Add these items to Section 15 testing checklist:

**Phase E — Podcast Intelligence:**
- [ ] `fetch-transcripts.js` saves `-meta.json` alongside `.txt` transcript
- [ ] `extractGuestHint()` correctly identifies guest names from YouTube descriptions
- [ ] `searchGuestProfile()` returns a 2-3 sentence profile for known guests (test with a Lex Fridman episode with a named guest)
- [ ] `processPodcast()` returns full schema including `speakers`, `layer1`, `layer2`, `recommendations`
- [ ] `layer1.key_statements` contains 3-5 verbatim-style standalone statements
- [ ] `layer2.topics` contains 2-6 topic groups each with quotes
- [ ] `layer2.hypotheses` contains at least 1 bold claim when episode has predictions
- [ ] `recommendations` categories are present (empty arrays if nothing mentioned, never missing keys)
- [ ] Podcast card Layer1 renders: summary, key statements, guest line, triage badge, domain tags
- [ ] "Deep Dive ↓" expands Layer2 without clipping (max-height: none)
- [ ] Guest profile renders only for guests, not hosts
- [ ] Recommendations section renders only categories with items
- [ ] Recommendation items have "Save ✦" button that fires `showToast`
- [ ] Weekly synthesis includes `week_recommendations` field
- [ ] Notion weekly page includes "This Week's Recommendations" section

### E7 — Updated Implementation Order

Add these steps after Phase D in Section 14:

**Phase E — Podcast Intelligence:**

20. **`fetch-transcripts.js` metadata extraction** — add `extractEpisodeMetadata()`, save `-meta.json` (Section E2)
21. **`generate.js` podcast processing rewrite** — replace `processPodcast()` with full intelligence version including `extractGuestHint()`, `searchGuestProfile()`, `claudePodcastAnalysis()` (Section E3)
22. **Frontend podcast card redesign** — update `renderPodcasts()` in `index.html` with Layer1/Layer2 structure per Section E4
23. **Weekly synthesis podcast integration** — update compact briefing mapping and add `week_recommendations` to synthesis prompt and Notion writer (Section E5)
24. **Final integration test** — run daily workflow, verify podcast JSON matches new schema, verify frontend renders correctly, verify weekly synthesis includes podcast signals and recommendations

---

*Spec version: 4.0 | Prepared: March 2026 | For use with Claude Code*
