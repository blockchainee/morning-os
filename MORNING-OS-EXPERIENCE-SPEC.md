# Morning OS — Experience Spec v1.0
### The UI/UX Redesign: Building v2 in Parallel

> **Strategy:** v1 app continues running untouched. This spec defines `index-v2.html` — a complete frontend replacement that reads the same `briefing.json` and `weekly-report.json` as v1. Backend is unchanged. Only the experience changes.
>
> **For Claude Code:** Build `index-v2.html` as a standalone file. Do not touch `index.html`. When testing is complete and v2 is confirmed superior, rename `index-v2.html` → `index.html`. All decisions in this spec are final — no clarifying questions needed.

---

## 0. The Design Philosophy

### The Core Feeling
Morning OS v2 should feel like **a trusted advisor who was already awake and working while you slept.** Not a dashboard. Not a feed. A thinking partner that respects your time and earns your attention every single morning.

### Five Inviolable Design Principles

**1. One thought at a time.**
Never compete for attention. Every screen has a single primary focus. Everything else is subordinate. The eye always knows where to go.

**2. Intelligence through hierarchy, not metadata.**
The system's editorial judgment — signal strength, triage, domain relevance — must be visible in the *design itself*, not hidden in labels and badges. If something matters more, it looks more important. Fundamentally.

**3. Motion communicates meaning.**
Every transition tells a story. Deeper = unfolds downward. Forward = slides left. Back = slides right. Settling = fades in with slight upward drift. Motion is not decoration — it is navigation made physical.

**4. The product earns your time.**
Every screen must pass this test: *does this deserve 30 seconds of a busy person's morning?* If not, it doesn't exist.

**5. Personal feels personal.**
The user's name appears naturally. Their domains are woven into the visual language. Their weekly challenge greets them. The product should feel like it was built for exactly one person.

---

## 1. Visual Language

### Aesthetic Direction: **Editorial Intelligence**
The reference points: The Economist's discipline. Monocle's refinement. An intelligence briefing document. A letter from a very sharp advisor. Dark, precise, typographically dominant. Not a tech product — an instrument.

**What this is NOT:**
- Not a news app (no infinite scroll, no endless cards)
- Not a dashboard (no equal-weight tiles competing for attention)
- Not a chatbot interface (no bubble conversation UI as primary mode)
- Not generic SaaS dark mode (no purple gradients, no glowing cards)

### Color System

```css
:root {
  /* Core palette */
  --bg-primary: #0a0a0a;          /* Near-black — the canvas */
  --bg-secondary: #111111;        /* Card backgrounds */
  --bg-tertiary: #1a1a1a;         /* Elevated surfaces */
  --bg-glass: rgba(255,255,255,0.03); /* Ultra-subtle elevation */

  /* Text */
  --text-primary: #f0ece4;        /* Warm off-white — not harsh pure white */
  --text-secondary: #8a8478;      /* Muted warm grey */
  --text-tertiary: #4a4642;       /* Subtle labels */

  /* The Signal Color — used ONLY for high-signal items */
  --signal: #c8a96e;              /* Warm gold — deliberate, rare, earned */
  --signal-subtle: rgba(200, 169, 110, 0.12);

  /* Domain colors — subtle, not loud */
  --d1: #4a7fa5;   /* Professional/AI — muted steel blue */
  --d2: #5a9e7a;   /* Wealth/Crypto — muted green */
  --d3: #9e5a5a;   /* Geopolitics — muted terracotta */
  --d4: #7a5a9e;   /* Personal Growth — muted violet */

  /* Functional */
  --border: rgba(240, 236, 228, 0.06);
  --border-active: rgba(240, 236, 228, 0.15);
  --success: #5a9e7a;
  --error: #9e5a5a;
}
```

**The Signal Color Rule:** `--signal` (gold) appears in exactly three contexts:
1. The highest-signal newsletter/story of the day
2. The weekly conviction statement
3. The "Must Listen" podcast triage badge
Everywhere else: monochrome. When gold appears, it means: *this matters.*

### Typography

```css
/* Import from Google Fonts */
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;1,400&family=DM+Mono:wght@300;400&family=DM+Sans:wght@300;400;500&display=swap');

:root {
  /* Display — for headlines, opening statements, dominant thoughts */
  --font-display: 'Playfair Display', Georgia, serif;

  /* Body — for reading, card content, analysis */
  --font-body: 'DM Sans', system-ui, sans-serif;

  /* Mono — for metadata, timestamps, domain tags, data points */
  --font-mono: 'DM Mono', 'Courier New', monospace;
}
```

**Typography hierarchy (strict):**

| Role | Font | Size | Weight | Color |
|------|------|------|--------|-------|
| Opening Statement | Playfair Display | 28px | 400 | --text-primary |
| Section headline | Playfair Display italic | 20px | 400 | --text-primary |
| Card title | DM Sans | 16px | 500 | --text-primary |
| Body text | DM Sans | 14px | 300 | --text-primary |
| Metadata / tags | DM Mono | 11px | 400 | --text-tertiary |
| Data points | DM Mono | 13px | 400 | --text-secondary |
| Signal gold text | Playfair Display | varies | 400 | --signal |

### Spatial System

Base unit: 8px. All spacing is multiples of 8.

```css
:root {
  --space-xs: 8px;
  --space-sm: 16px;
  --space-md: 24px;
  --space-lg: 40px;
  --space-xl: 64px;
  --space-2xl: 96px;

  --radius-sm: 4px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-full: 9999px;

  /* Content max-width — generous breathing room */
  --content-width: 680px;
}
```

All content is centered within `--content-width`. On mobile: full width with 20px horizontal padding. The constraint creates focus.

### Motion System

```css
:root {
  /* Timing functions */
  --ease-out: cubic-bezier(0.32, 0.72, 0, 1);    /* Snappy settle */
  --ease-in-out: cubic-bezier(0.45, 0, 0.55, 1);  /* Smooth transition */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* Slight overshoot */

  /* Durations */
  --duration-fast: 150ms;
  --duration-normal: 280ms;
  --duration-slow: 450ms;
  --duration-reveal: 600ms;
}

/* Standard reveal animation — used for all content entering */
@keyframes revealUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Staggered children — apply animation-delay in multiples of 80ms */
.reveal { animation: revealUp var(--duration-reveal) var(--ease-out) both; }
.reveal-1 { animation-delay: 80ms; }
.reveal-2 { animation-delay: 160ms; }
.reveal-3 { animation-delay: 240ms; }
.reveal-4 { animation-delay: 320ms; }

/* Expand/collapse — replaces max-height hacks */
.expandable {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--duration-slow) var(--ease-out);
}
.expandable.open {
  grid-template-rows: 1fr;
}
.expandable > * { overflow: hidden; }
/* NOTE: grid-template-rows transition is the correct pattern.
   It eliminates the max-height clipping bug entirely.
   No max-height values needed anywhere in this spec. */
```

---

## 2. Application Architecture

### File
Single file: `index-v2.html`
Same pattern as v1 — all HTML, CSS, JS in one file.
Reads: `briefing.json`, `weekly-report.json`, `knowledge/user-profile.md`, `knowledge/user-model.md`
Writes: nothing (read-only frontend)

### State Management

```javascript
const STATE = {
  // Data
  briefing: null,           // from briefing.json
  weeklyReport: null,       // from weekly-report.json (may be null)
  userModel: null,          // from knowledge/user-model.md (raw text)

  // Navigation
  view: 'opening',          // 'opening' | 'briefing' | 'grow' | 'saved' | 'weekly'
  scrollPositions: {},      // remember scroll per view

  // Expanded items
  expandedCards: new Set(), // card IDs currently expanded

  // Chat
  chatOpen: false,
  chatContext: null,        // { type, id, title } — what triggered the chat
  chatMessages: [],
  chatSystemPrompt: null,   // built once, cached

  // Saved
  savedItems: [],           // persisted to localStorage

  // UI
  isLoading: true,
  sundayMode: false,        // true on Sundays — activates weekly synthesis view
}
```

### View Routing

No URL routing needed. Views are managed by `STATE.view` and CSS visibility.

```javascript
function navigateTo(view) {
  // Save current scroll position
  STATE.scrollPositions[STATE.view] = window.scrollY;
  STATE.view = view;
  renderCurrentView();
  // Restore scroll or go to top
  window.scrollTo(0, STATE.scrollPositions[view] || 0);
}
```

---

## 3. The Four Moments — Information Architecture

Replace the v1 tab structure (Today / Podcasts / Grow / Saved / Settings) with a **linear morning ritual** that has a clear arc.

```
Moment 1: THE SIGNAL        (30 seconds)  — What matters most today
Moment 2: THE BRIEFING      (5-10 min)    — Deep dive on demand
Moment 3: THE GROWTH        (2 minutes)   — One thing for you
Moment 4: THE CHALLENGE     (30 seconds)  — What will you do differently
```

Navigation: bottom bar with four icons (no labels — icons only on mobile, icons + labels on desktop). Linear by design, non-linear by choice.

**Sunday Exception:** On Sundays, Moment 1 becomes THE WEEK — the weekly synthesis view replaces the daily opening. A different mode, different visual treatment, same navigation structure.

---

## 4. Screen-by-Screen Specification

---

### 4.1 — The Loading State

**Not a spinner. A presence.**

While `briefing.json` loads, show:

```
[centered, vertically middle of screen]

  ✦

[DM Mono, 11px, --text-tertiary, letter-spacing 0.3em]
PREPARING YOUR BRIEFING
```

The `✦` pulses gently (opacity 0.4 → 1.0 → 0.4, 2s loop). That's the only animation.
No skeleton screens. No loading bars. Just the mark and the word.

---

### 4.2 — Moment 1: THE SIGNAL (Opening Screen)

**This is the most important screen in the app.** The user sees this first, every morning.

**Layout:**

```
[top — 40px padding]

[DM Mono, 11px, --text-tertiary]
MONDAY  ·  16 MARCH  ·  DUBAI

[48px space]

[Playfair Display, 28px, --text-primary, max-width 520px]
"{The system's opening statement — one sentence.
  The single most important thing that happened
  overnight, chosen by the intelligence engine.}"

[32px space]

[DM Sans, 14px, --text-secondary, max-width 440px]
{2-sentence expansion — what makes this significant
 and why it connects to the user's domains.}

[40px space]

[--signal gold, DM Mono 11px]
3 HIGH-SIGNAL ITEMS TODAY

[16px space]

[Three signal pills — horizontal row]
[D1 · AI Enterprise]  [D2 · Bitcoin]  [D3 · Gulf]

[48px space]

[DM Sans 14px, --text-secondary]
↓  Enter the briefing

[bottom — fixed bottom bar navigation]
```

**The Opening Statement** is generated by adding one field to `briefing.json`:

```json
"_opening": {
  "headline": "One sentence. The most important thing. Maximum 18 words.",
  "context": "Two sentences expanding on why this matters for the user specifically.",
  "signal_pills": [
    { "label": "AI Enterprise", "domain": "D1" },
    { "label": "Bitcoin", "domain": "D2" }
  ]
}
```

Add this to `generate.js` as a final Claude call after all newsletters are processed:

```javascript
// Final call — synthesize opening statement from all processed content
const openingPrompt = `Based on all the newsletters and content processed today, 
write the opening statement for ${USER_NAME}'s morning briefing.

Return JSON: {
  "headline": "Single most important sentence. Max 18 words. Present tense. Specific.",
  "context": "Two sentences: why this matters for ${USER_NAME}'s domains specifically.",
  "signal_pills": [up to 3 objects: { "label": "2-3 word topic", "domain": "D1|D2|D3|D4" }]
}`;
```

**Animation sequence on load:**
1. Date line fades in (0ms delay)
2. Headline reveals upward (200ms delay)
3. Context text reveals upward (400ms delay)
4. Signal pills slide in from left, staggered (600ms, 700ms, 800ms)
5. "Enter the briefing" fades in (1000ms)

**Sunday version:** Replace the opening statement with:

```
[DM Mono, 11px, --text-tertiary]
SUNDAY  ·  WEEK 11 COMPLETE

[48px space]

[Playfair Display italic, 28px, --signal]
"{Last week's dominant conviction — pulled from weekly-report.json}"

[32px space]

[DM Sans, 14px, --text-secondary]
{Dominant narrative in 2 sentences}

[40px space]

[DM Mono, 11px, --text-tertiary]
YOUR 3 CHALLENGES THIS WEEK

[3 challenge items, numbered, each on its own line]
```

---

### 4.3 — Moment 2: THE BRIEFING

**The main intelligence view.** Replaces the v1 "Today" + "Podcasts" tabs.

**Layout: Single scrolling feed, not a tab split.**

Newsletters and podcasts live in the same feed, ordered by signal strength (high → medium → low). The system decides order, not the user. This expresses editorial judgment.

**Feed header:**

```
[sticky, appears after scrolling past opening]

[DM Mono, 11px, --text-tertiary]
TODAY'S BRIEFING  ·  {newsletter_count} SOURCES  ·  {date}
```

#### Newsletter Card — Layer 1

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  [DM Mono, 11px, --text-tertiary]                    │
│  FROM:MORNINGBREW  ·  D1  ·  08:14                   │
│                                                      │
│  [DM Sans, 16px, 500, --text-primary]                │
│  Newsletter Name                                     │
│                                                      │
│  [DM Sans, 14px, 300, --text-secondary, line-h 1.6]  │
│  2-3 sentence summary. The most important            │
│  thing from this edition, specific and direct.       │
│                                                      │
│  [signal pills — domain dots only, minimal]          │
│  ● ● ●                                               │
│                                                      │
│  [bottom row]                                        │
│  [Triage badge]  [· · ·]  [Expand ↓]                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**HIGH SIGNAL card — visual differentiation:**
- Left border: 2px solid `--signal`
- Background: `--signal-subtle`
- Newsletter name in `--signal` color
- This is the ONLY card that looks different — all others are identical
- Maximum ONE card per day gets this treatment (the highest signal_strength item)

**Triage badge styles:**
```css
.triage-read    { color: var(--success); border: 1px solid var(--success); }
.triage-skim    { color: var(--text-secondary); border: 1px solid var(--border); }
.triage-skip    { color: var(--text-tertiary); border: 1px solid transparent; opacity: 0.5; }
```

Skip items are visually de-emphasized. Skim items are neutral. Read items are clear. The design reinforces the triage.

#### Newsletter Card — Layer 2 Expansion

Triggered by tapping "Expand ↓" or anywhere on the card body.
Uses `grid-template-rows` transition (no max-height clipping).

```
[expanded, continuous with Layer 1]
──────────────────────────────────────────────────────

  [DM Mono, 11px, --text-tertiary]
  HOW THEY FRAME IT

  [DM Sans, 14px, 300, --text-secondary]
  {framing — how the newsletter positioned this story}

  ────────────

  [DM Mono, 11px, --text-tertiary]
  KEY STORIES

  [For each story:]
  [DM Sans, 14px, 500, --text-primary]
  Story Headline

  [DM Sans, 14px, 300, --text-secondary, line-h 1.7]
  Full story content with all data points preserved.

  ────────────

  [DM Mono, 11px, --text-tertiary]
  DATA POINTS

  [For each data point — DM Mono, 13px, --text-secondary]
  → Specific number or named fact

  ────────────

  [DM Mono, 11px, --text-tertiary]
  IMPLICATIONS FOR YOU

  [DM Sans, 14px, 300, --text-secondary, line-h 1.6]
  {implications — specific to user's domains}

  ────────────

  [Playfair Display italic, 15px, --text-secondary]
  "{reflection question}"

  ────────────

  [bottom row]
  [Ask Claude →]  [Save ✦]  [Collapse ↑]

──────────────────────────────────────────────────────
```

#### Podcast Card — Layer 1

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  [DM Mono, 11px, --text-tertiary]                    │
│  PODCAST  ·  D2  ·  1H 23M                           │
│                                                      │
│  [DM Sans, 16px, 500, --text-primary]                │
│  Bankless                                            │
│                                                      │
│  [DM Sans, 13px, 300, --text-tertiary]               │
│  with Raoul Pal — macro investor, Real Vision CEO    │
│                                                      │
│  [DM Sans, 14px, 300, --text-secondary, line-h 1.6]  │
│  3-4 sentence summary. Most important idea first.    │
│                                                      │
│  [key statements — 3 items]                          │
│  [DM Sans, 13px, --text-secondary]                   │
│  "Statement one worth remembering"                   │
│  "Statement two worth remembering"                   │
│  "Statement three worth remembering"                 │
│                                                      │
│  [Must Listen ✦]              [Deep Dive ↓]          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Must Listen badge:** Uses `--signal` gold. This is the second context where gold appears.

#### Podcast Card — Layer 2 (Deep Dive)

```
──────────────────────────────────────────────────────

  [DM Mono, 11px, --text-tertiary]
  SPEAKERS

  [For each speaker]
  [DM Sans, 14px, 500]  Speaker Name
  [DM Mono, 11px, --text-tertiary]  HOST  or  GUEST
  [DM Sans, 13px, 300, --text-secondary]
  {Guest profile — 2-3 sentences. Empty for hosts.}

  ────────────

  [DM Mono, 11px, --text-tertiary]
  TOPICS

  [For each topic — collapsible individually]
  [DM Sans, 15px, 500, --text-primary]  ▸ Topic Title

  [expanded topic:]
  [DM Sans, 14px, 300, --text-secondary]
  Topic summary...

  Insights:
  · Insight one
  · Insight two

  [For each quote:]
  [left border 2px --border-active, padding-left 16px]
  [Playfair Display italic, 14px, --text-primary]
  "Verbatim quote from the transcript."
  [DM Mono, 11px, --text-tertiary]  — SPEAKER NAME

  ────────────

  [DM Mono, 11px, --text-tertiary]
  HYPOTHESES & BOLD CLAIMS

  [For each hypothesis:]
  [DM Sans, 14px, 500, --signal]  ⚡ Bold claim statement
  [DM Mono, 11px, --text-tertiary]  — SPEAKER
  [DM Sans, 13px, 300, --text-secondary]  Evidence: {reasoning}

  ────────────

  [DM Mono, 11px, --text-tertiary]
  DOMAIN CONNECTIONS

  [Only non-empty domains]
  [DM Mono, 11px, --d1]  D1  [DM Sans, 13px, 300]  Connection text
  [DM Mono, 11px, --d2]  D2  [DM Sans, 13px, 300]  Connection text

  ────────────

  [DM Mono, 11px, --text-tertiary]
  FOLLOW-UP

  [Group by category with emoji]
  📚  Book Title by Author — mentioned by Speaker
  🎙  Podcast Name — context
  🛠  Tool Name — context
  👤  Person Name — context

  [Each item has inline Save ✦ button]

  ────────────

  [Playfair Display italic, 15px, --text-secondary]
  "{reflection question}"

  [bottom row]
  [Ask Claude →]  [Save ✦]  [Collapse ↑]

──────────────────────────────────────────────────────
```

---

### 4.4 — Moment 3: THE GROWTH

Clean, single-column, one card per section. No tabs within this view.

**Layout:**

```
[DM Mono, 11px, --text-tertiary, top of view]
GROW  ·  {dayOfWeek}

[48px space]

[Small Talk card]
[Arabic card]
[Habitus card]
[Mini Concept card]
```

#### Small Talk Bridge Card

```
┌──────────────────────────────────────────────────────┐
│  [DM Mono, 11px, --text-tertiary]                    │
│  SMALL TALK                                          │
│                                                      │
│  [DM Sans, 16px, 500, --text-primary]                │
│  {topic_hook}                                        │
│                                                      │
│  [DM Sans, 14px, 300, --text-secondary, line-h 1.6]  │
│  {bridge — how to transition to meaningful talk}     │
│                                                      │
│  [DM Mono, 11px, --text-tertiary]                    │
│  WHEN TO USE                                         │
│  {when_to_use}                                       │
│                                                      │
│  [Ask Claude →]                                      │
└──────────────────────────────────────────────────────┘
```

#### Arabic Card

```
┌──────────────────────────────────────────────────────┐
│  [DM Mono, 11px, --text-tertiary]                    │
│  ARABIC                                              │
│                                                      │
│  [Playfair Display, 32px, --text-primary]            │
│  {arabic word in Arabic script}                      │
│                                                      │
│  [DM Mono, 13px, --signal]                           │
│  {transliteration}                                   │
│                                                      │
│  [DM Sans, 13px, 300, --text-tertiary]               │
│  {pronunciation guide}                               │
│                                                      │
│  [DM Sans, 14px, 300, --text-secondary, line-h 1.6]  │
│  {cultural_story — UAE context, when to use it}      │
│                                                      │
│  [Save ✦]                                            │
└──────────────────────────────────────────────────────┘
```

The Arabic script at 32px in Playfair is visually striking — elegant, unexpected. It demands a moment of attention.

#### Habitus Card

```
┌──────────────────────────────────────────────────────┐
│  [DM Mono, 11px, --text-tertiary]                    │
│  DUBAI  ·  {category}                                │
│                                                      │
│  [DM Sans, 16px, 500, --text-primary]                │
│  {name of venue/experience}                          │
│                                                      │
│  [DM Sans, 14px, 300, --text-secondary, line-h 1.6]  │
│  {insight — why and when to go}                      │
│                                                      │
│  [DM Mono, 13px, --signal]                           │
│  → {action — specific thing to do/try}               │
│                                                      │
│  [Save ✦]                                            │
└──────────────────────────────────────────────────────┘
```

#### Mini Concept Card

```
┌──────────────────────────────────────────────────────┐
│  [DM Mono, 11px, domain color for that day's domain] │
│  CONCEPT  ·  {domain}                                │
│                                                      │
│  [Playfair Display, 20px, --text-primary]            │
│  {concept name}                                      │
│                                                      │
│  [DM Sans, 14px, 300, --text-secondary, line-h 1.6]  │
│  {summary — MBA-level explanation}                   │
│                                                      │
│  [DM Mono, 11px, --text-tertiary]                    │
│  APPLY TODAY                                         │
│  {application — how to use this today}               │
│                                                      │
│  [Ask Claude →]  [Save ✦]                            │
└──────────────────────────────────────────────────────┘
```

---

### 4.5 — Moment 4: THE CHALLENGE

**The rarest screen. The most important.**

This is not a list of saved items. This is the weekly accountability screen — the three challenges set by last Sunday's synthesis, visible every day as a reminder.

Full-screen, one challenge at a time. Swipe or tap to move between them.

```
[centered, full viewport]

[DM Mono, 11px, --text-tertiary]
CHALLENGE  01 / 03

[80px space]

[Playfair Display italic, 24px, --text-primary, max-width 480px, centered]
"{Challenge text — one complete sentence.
  Specific, behavioral, uncomfortable.}"

[60px space]

[DM Mono, 11px, --text-tertiary]
SET ON SUNDAY  ·  WEEK 11

[40px space]

[two buttons]
[Ask Claude about this]  [Mark Reflected ✓]

[subtle page dots below — 3 dots indicating position]
● ○ ○
```

**Mark Reflected:** doesn't mean completed. It means you've thought about it. Tapping it dims the challenge slightly and moves you to the next one. A soft acknowledgment, not a checkbox. The language is intentional — "reflected", not "done."

**Saved Items:** Move to a separate section within THE CHALLENGE view, below the weekly challenges:

```
[DM Mono, 11px, --text-tertiary, section header]
SAVED ITEMS  ·  {count}

[For each saved item — compact row]
[DM Sans, 14px]  Item title or text
[DM Mono, 11px, --text-tertiary]  Source · Date
[✕ remove button — right aligned]
```

---

### 4.6 — Sunday Mode: THE WEEK

Activated automatically when `STATE.sundayMode === true` (detected from `weekly-report.json` date matching current Sunday).

The Opening Screen transforms completely. Same navigation, different visual language — slightly warmer, more spacious, reflective rather than active.

```
[DM Mono, 11px, --text-tertiary]
SUNDAY  ·  WEEK {number} COMPLETE

[64px space]

[Playfair Display italic, 14px, --text-tertiary]
This week's conviction:

[Playfair Display, 28px, --signal, max-width 520px]
"{one_conviction from weekly-report.json}"

[48px space]

[DM Sans, 14px, 300, --text-secondary, max-width 460px]
{dominant_narrative — 2 sentences}

[48px space]

[DM Mono, 11px, --text-tertiary]
SIGNAL TRACKER  ·  {count} THEMES

[Signal tracker rows]
[DM Mono, 11px, domain color]  D1
[DM Sans, 14px]  Topic name  [trend arrow ↑ ↓ →]
[DM Sans, 13px, --text-tertiary]  {one_line}

[48px space]

[DM Mono, 11px, --text-tertiary]
YOUR 3 CHALLENGES

[Full-width challenge cards — same style as Moment 4 but inline]

[48px space]

[DM Mono, 11px, --text-tertiary]
READING BEHAVIOR

[DM Sans, 14px, 300, --text-secondary]
{observation — the honest mirror}

[48px space]

[if week_recommendations exist:]
[DM Mono, 11px, --text-tertiary]
THIS WEEK'S RECOMMENDATIONS

[grouped by category with emoji and compact rows]
```

---

## 5. The Intelligence Chat — v2 Design

### Trigger Points
Same as v1 spec: floating "✦" button (bottom right), "Ask Claude →" on every card.

### Visual Design — the Drawer

```css
.drawer {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%) translateY(100%);
  width: 100%;
  max-width: var(--content-width); /* 680px — aligns with content */
  height: 72vh;
  background: var(--bg-secondary);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  border-top: 1px solid var(--border-active);
  transition: transform var(--duration-slow) var(--ease-out);
}
.drawer.open {
  transform: translateX(-50%) translateY(0);
}
```

### Opening State — Not Blank

When opened from a card, the drawer pre-populates with:

**Header:**
```
[DM Mono, 11px, --text-tertiary]
INTELLIGENCE  ·  {source card title}
```

**Pre-written question (editable before sending):**
```
[pre-filled in the textarea, selected/highlighted so one keystroke replaces it]
"Tell me more about [specific topic from card]. What are the deeper 
implications for [relevant domain]?"
```

When opened from the global button (no card context):
```
[pre-filled]
"What's the most important thing I should think about from today's briefing?"
```

The pre-filled text is selected by default — the user can immediately type to replace it, or hit Enter to send as-is. Zero friction.

### Message Design

```css
/* User message */
.msg-user {
  align-self: flex-end;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-active);
  border-radius: var(--radius-md) var(--radius-md) var(--radius-sm) var(--radius-md);
  padding: 12px 16px;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 300;
  max-width: 80%;
  color: var(--text-primary);
}

/* Assistant message */
.msg-assistant {
  align-self: flex-start;
  background: transparent; /* No background — just text */
  padding: 4px 0;
  font-family: var(--font-body);
  font-size: 14px;
  font-weight: 300;
  line-height: 1.7;
  color: var(--text-secondary);
  max-width: 100%;
}

/* Thinking state */
.msg-thinking::after {
  content: '▋';
  animation: blink 1s step-end infinite;
}
@keyframes blink { 50% { opacity: 0; } }
```

No bubble for assistant responses — just text. This makes Claude feel less like a chatbot, more like a voice in the room.

### Input Area

```
┌──────────────────────────────────────────────────────┐
│  [textarea — no border, just text]                   │
│  Ask anything about today's briefing...              │
│                                          [↑ send]    │
└──────────────────────────────────────────────────────┘
```

The input area has a subtle top border only (`var(--border)`). No box. No card. The text floats above a line. Minimal, focused.

---

## 6. Navigation — Bottom Bar

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│   ◈ Signal    ✦ Briefing    ↟ Grow    ⬡ Challenge   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Icons only on mobile. Icons + label on desktop (min-width: 768px).
Active state: icon in `--text-primary`, label in `--signal`. All others: `--text-tertiary`.
No borders, no backgrounds on active — just color change.

```css
.nav-bar {
  position: fixed;
  bottom: 0;
  left: 0; right: 0;
  height: 64px;
  background: var(--bg-primary);
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding-bottom: env(safe-area-inset-bottom); /* iPhone home indicator */
}
.nav-item { ... }
.nav-item.active .nav-icon { color: var(--text-primary); }
.nav-item.active .nav-label { color: var(--signal); }
.nav-item:not(.active) { color: var(--text-tertiary); }
```

---

## 7. Sound Design

Implement using the Web Audio API — no external files needed, no network requests.

```javascript
const AudioFX = {
  ctx: null,

  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  },

  // Called on briefing load complete — soft, settled tone
  briefingReady() {
    this._playTone(440, 0.03, 0.8, 'sine');
    setTimeout(() => this._playTone(554, 0.02, 0.6, 'sine'), 120);
  },

  // Called on save — single quiet note, satisfying
  saved() {
    this._playTone(660, 0.04, 0.3, 'sine');
  },

  // Called on chat open — subtle shift
  chatOpen() {
    this._playTone(330, 0.02, 0.4, 'sine');
  },

  // Sunday mode activation — slightly different, more contemplative
  sundayMode() {
    this._playTone(370, 0.03, 1.2, 'sine');
    setTimeout(() => this._playTone(440, 0.02, 1.0, 'sine'), 300);
  },

  _playTone(freq, gain, duration, type) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(this.ctx.destination);
    osc.type = type;
    osc.frequency.value = freq;
    gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(gain, this.ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
    osc.start(this.ctx.currentTime);
    osc.stop(this.ctx.currentTime + duration);
  }
};

// Initialize on first user interaction (browser requirement)
document.addEventListener('click', () => AudioFX.init(), { once: true });
```

**Sound map:**
| Event | Sound | Feel |
|-------|-------|------|
| Briefing loaded | Two-note soft chord | Settled, ready |
| Item saved | Single clean note | Definitive, satisfying |
| Chat opened | Low soft tone | Entering a quieter space |
| Sunday mode | Two-note slower chord | Reflective, different |
| Challenge marked | Soft descending two notes | Acknowledged |

---

## 8. iOS PWA Specifics

### Home Screen Widget (Shortcut Approach)
Add to `manifest.json`:
```json
{
  "shortcuts": [
    {
      "name": "Today's Signal",
      "url": "/?view=opening",
      "description": "Jump to today's opening statement"
    },
    {
      "name": "The Briefing",
      "url": "/?view=briefing",
      "description": "Jump directly to the briefing feed"
    }
  ]
}
```

### Status Bar
```html
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#0a0a0a">
```

### Safe Areas
All fixed elements (nav bar, chat drawer) use `env(safe-area-inset-*)` for iPhone notch/home indicator compatibility.

### Splash Screen
```html
<meta name="apple-mobile-web-app-capable" content="yes">
<link rel="apple-touch-startup-image" href="splash.png">
```
Splash: `#0a0a0a` background with centered `✦` in `--signal` gold. Simple. Unmistakable.

---

## 9. The `_opening` Field — Backend Addition

This is the only backend change required by this spec. Add one final Claude API call to `generate.js` after all newsletters are processed:

```javascript
async function generateOpeningStatement(allNewsletters, calendar, userProfile) {
  const processedNewsletters = allNewsletters
    .filter(n => n.has_new_edition)
    .map(n => ({
      name: n.name,
      summary: n.layer1?.summary,
      signals: n.layer1?.signals,
      signal_strength: n.layer1?.signal_strength || 'medium',
    }));

  const system = `You are writing the opening statement for ${process.env.USER_NAME}'s 
morning intelligence briefing. This is the first thing they read every day.
${userProfile}
Return ONLY valid JSON. No preamble. No fences.`;

  const prompt = `Based on today's processed intelligence, write the opening statement.

Processed newsletters today:
${JSON.stringify(processedNewsletters, null, 2)}

Return:
{
  "headline": "Single most important sentence from today. Max 18 words. Present tense. Specific. Not generic. Should make the reader want to know more.",
  "context": "Exactly 2 sentences. Why this matters specifically for ${process.env.USER_NAME}'s domains. Name the domain explicitly.",
  "signal_pills": [
    { "label": "2-3 word topic", "domain": "D1|D2|D3|D4" }
  ]
}

Rules:
- headline: must be about a SPECIFIC story/signal, not a category. "AI agents are replacing SDRs at Salesforce" not "AI is changing enterprise sales"
- signal_pills: maximum 3, only the genuinely high-signal topics from today
- If today is low-signal, say so honestly in the headline`;

  const raw = await claudeCall(system, prompt, 500);
  try {
    return JSON.parse(raw);
  } catch {
    return {
      headline: "Today's intelligence briefing is ready.",
      context: "Review the signals below.",
      signal_pills: []
    };
  }
}

// Call at end of main() in generate.js, before writing briefing.json:
briefingData._opening = await generateOpeningStatement(
  processedNewsletters, calendarData, KNOWLEDGE.userProfile
);
```

---

## 10. Implementation Notes for Claude Code

### What to build
- **One file:** `index-v2.html` — complete standalone PWA
- **One backend addition:** `_opening` field generation in `generate.js` (Section 9)
- **Do not touch:** `index.html`, all other scripts, all workflow files

### CSS Architecture within the single file
```html
<style>
  /* 1. CSS Variables (Section 1) */
  /* 2. Reset & Base */
  /* 3. Typography */
  /* 4. Layout & Spatial */
  /* 5. Animation */
  /* 6. Components: Cards */
  /* 7. Components: Navigation */
  /* 8. Components: Chat Drawer */
  /* 9. Components: Loading */
  /* 10. Sunday Mode overrides */
  /* 11. Mobile responsive */
  /* 12. iOS PWA */
</style>
```

### JavaScript Architecture within the single file
```html
<script>
  // 1. STATE object
  // 2. Data loading (fetch briefing.json, weekly-report.json, knowledge files)
  // 3. Sunday detection
  // 4. Render functions (renderOpening, renderBriefing, renderGrow, renderChallenge, renderWeekly)
  // 5. Card expansion logic (expandable grid pattern)
  // 6. Navigation
  // 7. Intelligence Chat (same Netlify function proxy as v1)
  // 8. Save/Remove items (localStorage)
  // 9. Audio FX
  // 10. Init
</script>
```

### Critical implementation rules
1. **No max-height for expand/collapse.** Use `grid-template-rows: 0fr → 1fr` transition exclusively.
2. **Staggered reveals on every view transition.** Apply `.reveal` + `.reveal-N` classes to all entering elements.
3. **Signal gold used sparingly.** Audit before finalizing: `--signal` must appear in ≤ 5 elements per screen.
4. **Audio requires user gesture.** Initialize `AudioFX` on first click only.
5. **Pre-fill chat input and select it.** `textarea.select()` after setting value.
6. **Sunday detection:** `new Date().getDay() === 0 && STATE.weeklyReport !== null`
7. **Domain colors on tags:** Use `--d1`, `--d2`, `--d3`, `--d4` CSS variables, not hardcoded hex.
8. **Safe area insets on all fixed elements.** Non-negotiable for iPhone.

---

## 11. Testing Checklist

**Visual:**
- [ ] Loading state shows `✦` pulse only — no spinner
- [ ] Opening statement renders in Playfair Display at 28px
- [ ] Only ONE card has gold left-border treatment (highest signal item)
- [ ] Triage: "Skip" cards are visually de-emphasized (opacity 0.5)
- [ ] Arabic script renders at 32px Playfair (not cropped, not system font fallback)
- [ ] Sunday mode has noticeably different visual feel — gold headline, spacious layout
- [ ] Chat assistant messages have NO bubble background — just text on dark

**Interaction:**
- [ ] Expand/collapse uses grid-template-rows — zero clipping on any content length
- [ ] Staggered reveal animation plays on every view change
- [ ] Chat opens with pre-filled question that is text-selected
- [ ] "Mark Reflected" dims challenge card softly, moves to next
- [ ] Bottom nav active state: icon white, label gold

**Audio:**
- [ ] No sound plays on page load (requires user gesture first)
- [ ] Save action triggers single note
- [ ] Briefing loaded triggers soft chord
- [ ] Sunday mode triggers slower two-note chord

**Data:**
- [ ] `_opening.headline` renders as Opening Statement
- [ ] `_opening.signal_pills` render with correct domain colors
- [ ] Weekly report data renders in Sunday mode
- [ ] Chat system prompt includes `user-model.md` content
- [ ] Saved items persist across refresh (localStorage)
- [ ] Missing data degrades gracefully (no JS errors if weeklyReport is null)

**iOS PWA:**
- [ ] Status bar is transparent black
- [ ] Nav bar clears iPhone home indicator (safe-area-inset-bottom)
- [ ] Chat drawer clears iPhone home indicator
- [ ] Splash screen shows on cold launch

---

*Experience Spec v1.0 | Prepared: March 2026 | For use with Claude Code alongside MORNING-OS-SPEC v4.0*
*Backend: MORNING-OS-SPEC v4.0 (unchanged) | Frontend: this document only*
