# Morning OS — Übergabedokument für neuen Chat

Stand: 2026-03-19 | Branch: `claude/review-project-progress-DdH9K` (1 Commit ahead of main)

---

## Was ist Morning OS?

Ein persönliches KI-gestütztes Briefing-System das täglich um 05:30 Dubai-Zeit automatisch:
- **Newsletters** aus Gmail analysiert (Layer1: Summary/Signals, Layer2: Deep Dive)
- **Podcast-Episoden** via YouTube-Transkripte analysiert (Layer1+Layer2)
- **Kalender & Geburtstage** aus Google Calendar holt
- **Growth-Content** generiert (Small Talk, Arabisch, Habitus, Mini-Konzept)
- Alles in `briefing.json` schreibt + nach **Notion** synct
- Sonntags eine **Weekly Synthesis** erstellt (Signale, Trends, Challenges)

**Tech-Stack:** Node.js 24, GitHub Actions (Cron), Claude Sonnet API, Netlify (Static + Functions), Notion API, Gmail/Calendar API, yt-dlp

**Kosten:** ~$3-5/Monat (hauptsächlich Claude API)

---

## Repo-Struktur

```
morning-os/
├── .github/workflows/
│   ├── daily-briefing.yml          # Cron 01:30 UTC (05:30 Dubai), timeout 30min
│   ├── weekly-synthesis.yml         # Cron 02:00 UTC Sonntags (06:00 Dubai)
│   └── deploy-app.yml              # Auto-Deploy GitHub Pages bei index.html/briefing.json Änderung
├── scripts/
│   ├── generate.js                 # [1313 Zeilen] Haupt-Orchestrierung: Gmail → Claude → Notion → briefing.json
│   ├── fetch-transcripts.js        # [232 Zeilen] yt-dlp YouTube-Transkripte (parallel)
│   ├── weekly-synthesis.js         # [416 Zeilen] Sonntags-Synthese → Notion Weekly DB + user-model.md
│   └── get-google-token.js         # [178 Zeilen] Einmal-Helper für Google OAuth Token
├── netlify/functions/
│   ├── podcast-read.js             # [121 Z.] GET: liest Podcast-JSON aus Notion Daily DB
│   ├── podcast-fetch.js            # [377 Z.] POST: On-Demand Claude-Analyse eines Podcasts
│   ├── save-podcasts.js            # [97 Z.] POST: speichert config.json via GitHub API
│   └── chat.js                     # [56 Z.] POST: Chat-Proxy zu Claude API
├── knowledge/
│   ├── user-profile.md             # Wer der User ist, Domains, Lesegewohnheiten
│   ├── user-model.md               # Lebendes Dokument, wird wöchentlich auto-aktualisiert
│   └── domains.md                  # D1-D4 Taxonomie mit Signal-Definitionen
├── index.html                      # [2493 Z.] PWA (Light Mode, 4 Tabs)
├── index-v2.html                   # [~1400 Z.] Alternative UI (Dark Mode, 5 Views) — via /v2
├── briefing.json                   # Täglicher Output (committed von Actions)
├── config.json                     # Active Podcasts IDs (committed von save-podcasts.js)
├── archive/                        # Tägliche Briefing-Snapshots für Weekly Synthesis
├── netlify.toml                    # Funktions-Timeouts, Redirects
├── package.json                    # ES Modules, keine Dependencies (native fetch)
├── ARCHITECTURE.md                 # System-Design + Known Bugs (342 Z.)
├── MORNING-OS-SPEC.md              # Implementierungs-Spec v4.0 (2200+ Z.)
└── MORNING-OS-EXPERIENCE-SPEC.md   # UX-Requirements (1600+ Z.)
```

---

## Datenfluss (Daily)

```
GitHub Actions Runner (01:30 UTC):
  1. fetch-transcripts.js
     └── yt-dlp → YouTube Auto-Subs → transcripts/{podId}-{date}.txt + -meta.json
         (7 Podcasts parallel, je 60s Timeout)

  2. generate.js
     ├── Gmail API → Newsletter-Bodies (auto-discovery oder Fallback-Liste)
     ├── Google Calendar API → Events + Geburtstage
     ├── Für jeden Newsletter: claudeCall() → Layer1/Layer2 JSON (2er Batches)
     ├── Für jeden Podcast MIT Transkript: claudePodcastAnalysis() (2er Batches)
     │   └── NEU: Fallback auf Episode-Beschreibung wenn kein Transkript
     ├── fetchGrowth() → claudeCall() → Small Talk, Arabisch, Habitus, Konzept
     ├── Opening Statement → claudeCall()
     ├── → briefing.json (geschrieben + committed + gepusht)
     ├── → archive/{date}.json (Kopie für Weekly Synthesis)
     └── → Notion Daily DB (Blocks + eingebetteter PODCAST_JSON Code-Block)

  3. Git Push → briefing.json + archive/ → Repo
  4. deploy-app.yml → GitHub Pages
```

---

## Datenfluss (Weekly, Sonntags)

```
GitHub Actions Runner (02:00 UTC):
  weekly-synthesis.js
  ├── loadWeeklyArchive() → archive/*.json (letzte 7 Tage)
  ├── Claude Call 1: Synthese → signal_tracker, domain_pulse, one_conviction, challenges...
  ├── Claude Call 2: User Model Update → knowledge/user-model.md
  ├── → weekly-report.json (committed)
  └── → Notion Weekly DB (separate DB!)
```

---

## Notion-Architektur (2 Datenbanken)

### Daily DB (`NOTION_DATABASE_ID`)
- **Properties:** Name (title), Date (date), Status (select: Generated/Read)
- **Blocks:** Kalender → Newsletters (Layer1/2) → Podcasts (Layer1/2 + PODCAST_JSON Code-Block) → Growth
- **Gelesen von:** podcast-read.js (sucht PODCAST_JSON im Code-Block)
- **Geschrieben von:** generate.js (täglich), podcast-fetch.js (on-demand, non-blocking)

### Weekly DB (`NOTION_WEEKLY_DATABASE_ID`)
- **Properties:** Name (title), Date (date), Status (select: Generated/Reviewed)
- **Blocks:** Dominant Narrative → Domain Pulse → Signal Tracker → Conviction → Learning Gaps → Conflicts → Challenges → Reading Patterns → Recommendations
- **Geschrieben von:** weekly-synthesis.js (sonntags)

### Notion API Endpoints (alle `Notion-Version: 2022-06-28`)
| Endpoint | Methode | Verwendet in |
|----------|---------|--------------|
| `/v1/pages` | POST | generate.js, podcast-fetch.js, weekly-synthesis.js |
| `/v1/pages/{id}` | PATCH | generate.js (archivieren alter Pages) |
| `/v1/databases/{id}/query` | POST | generate.js, podcast-read.js, podcast-fetch.js |
| `/v1/blocks/{id}/children` | GET | podcast-read.js (paginiert) |
| `/v1/blocks/{id}/children` | PATCH | generate.js, podcast-fetch.js |

---

## Netlify Functions

| Funktion | Timeout | Zweck |
|----------|---------|-------|
| `podcast-read` | 10s | Liest Podcast-Daten aus Notion Daily DB (sucht PODCAST_JSON Code-Block) |
| `podcast-fetch` | 26s | On-Demand Claude-Analyse (web_search) für einzelnen Podcast, schreibt non-blocking nach Notion |
| `save-podcasts` | default | Speichert config.json via GitHub API (nicht Notion!) |
| `chat` | default | Claude-Proxy für Intelligence-Chat (max 1024 Tokens) |

---

## Frontend (index.html — PWA)

### 4 Tabs
1. **Today** — Kalender + Newsletter-Cards (Layer1 sichtbar, Layer2 aufklappbar)
2. **Podcasts** — 3-Step Fallback: Notion → briefing.json → podcast-fetch (on-demand)
3. **Grow** — Small Talk, Arabisch, Habitus, Mini-Konzept
4. **Saved** — localStorage Bookmarks

### Podcast-Lade-Reihenfolge (NICHT ÄNDERN!)
```
1. podcast-read.js (Notion) → PODCAST_JSON aus Daily Page
2. STATE.briefing.podcasts (aus briefing.json)
3. podcast-fetch.js (on-demand Claude web_search, pro Podcast)
```

### Key Functions
| Funktion | ~Zeile | Zweck |
|----------|--------|-------|
| `fetchStaticBriefing()` | 952 | Lädt briefing.json mit Cache-Bust |
| `renderTab()` | 1150 | Tab-Router |
| `renderNewsletterCard()` | 1284 | NL-Card mit Layer2-Expansion |
| `fetchPodcastsFromNotion()` | 1516 | 3-Step Fallback |
| `renderPodcastCard()` | 1623 | Podcast-Card |
| `syncPodcastConfig()` | 2148 | Sendet Podcast-IDs an save-podcasts |
| `loadRemoteConfig()` | 2172 | Synct config.json |
| `buildSystemPrompt()` | 2313 | Chat-Kontext aus Briefing + Knowledge |

### CSS
- **index.html:** Light Mode, `--accent: #0E8F62` (Grün), Fonts: Instrument Serif + DM Sans
- **index-v2.html:** Dark Mode, `--signal: #c8a96e` (Gold), Fonts: Playfair Display + DM Sans

### localStorage Keys (index.html)
`pig_os_briefing`, `pig_os_saved`, `pig_os_newsletters`, `pig_os_podcasts`, `pig_os_cached_nl`, `mos-podcast-cache` (6h TTL)

---

## GitHub Actions Secrets & Variables

### Secrets
```
ANTHROPIC_API_KEY          Claude API Key
NOTION_API_KEY             Notion Integration Token
NOTION_DATABASE_ID         Daily Briefing DB (32-char ID)
NOTION_WEEKLY_DATABASE_ID  Weekly Synthesis DB (separate!)
GOOGLE_CLIENT_ID           Google OAuth
GOOGLE_CLIENT_SECRET       Google OAuth
GOOGLE_REFRESH_TOKEN       Google OAuth (via get-google-token.js generiert)
USER_NAME                  Name für Personalisierung
USER_PROFILE               Profil-Text für System Prompt
USER_CITY                  Stadt (Dubai)
USER_TIMEZONE              Zeitzone (Asia/Dubai)
```

### Variables
```
ACTIVE_NEWSLETTERS         Komma-getrennte Newsletter-IDs
ACTIVE_PODCASTS            Komma-getrennte Podcast-IDs
```

---

## Git-Status (Stand 2026-03-19)

### Auf `main` (via PRs gemergt):
- PR #22-#29: Diverse Fixes (UI, Newsletter Discovery, Podcast Pipeline, Rate Limits)
- PR #32: Rate Limits, Archive Commit, Podcast UI

### Auf Branch `claude/review-project-progress-DdH9K` (1 Commit ahead):
- `d73c290` — Parallel Transcript Fetch + Description Fallback
  - fetch-transcripts.js: `Promise.allSettled` statt sequentiell
  - generate.js: Fallback auf Episode-Beschreibung wenn kein Transkript
  - yt-dlp Logging verbessert (stderr sichtbar)

**→ PR muss noch erstellt und gemergt werden!**

---

## Abhängigkeiten (NICHT BRECHEN!)

```
config.json IDs ←→ PODCAST_DIRECTORY (generate.js + fetch-transcripts.js)
  Aktuell: bankless, lex-fridman, my-first-million, knowledge-project,
           tim-ferriss, all-in, huberman

Newsletter Discovery ←→ List-Unsubscribe Header Check (generate.js)
  OHNE Filter: normale Mails werden als Newsletter verarbeitet

claudeCall() ←→ 429 Retry (generate.js)
  OHNE Retry: Workflow scheitert bei Rate Limit

buildNotionBlocks() ←→ PODCAST_JSON Code-Block (generate.js)
  OHNE diesen Block: podcast-read.js findet keine Daten

Podcast Fallback-Chain ←→ 1.Notion → 2.briefing → 3.fetch (index.html)
  Reihenfolge NICHT ändern, jeder Step ist Fallback für den vorherigen
```

---

## Bekannte offene Punkte

### Noch zu mergen
| Was | Branch | Status |
|-----|--------|--------|
| Parallel Transcript + Description Fallback | `claude/review-project-progress-DdH9K` | PR erstellen & mergen |

### Bekannte Bugs (aus ARCHITECTURE.md)
| Bug | Datei | Beschreibung |
|-----|-------|--------------|
| Small Talk rendert nicht | index.html | `renderGrow()` prüft `g.small_talk` statt `g.small_talk_bridge` |
| Newsletter Layer2 clippt | index.html | `.layer2-panel.open` max-height 900px zu niedrig |
| Podcast Layer2 clippt | index.html | `.pl2-panel.open` max-height 1200px zu niedrig |
| Kein Feedback beim Speichern | index.html | "Save to thesis" hat keinen Toast |
| Keine Lösch-Funktion Saved | index.html | `renderSaved()` hat keinen Remove-Button |
| podcast-fetch.js kein 429 Retry | netlify/functions | Schlägt bei Rate Limit sofort fehl |

### Design-Entscheidungen (bewusst so)
- config.json speichert nur IDs (kein iTunes-Metadaten)
- Newsletter List-Unsubscribe Filter aktiv (verhindert falsche Mails)
- fetch-transcripts.js hat `continue-on-error: true` (blockiert Workflow nicht)
- index-v2.html nutzt Dark Mode ohne Toggle (System-Präferenz)

---

## Für Review/Weiterentwicklung starten mit

1. **PR mergen:** Branch `claude/review-project-progress-DdH9K` → main (1 Commit: parallel transcripts + description fallback)
2. **Workflow testen:** GitHub Actions → "Run workflow" manuell auslösen → Logs prüfen
3. **Notion prüfen:** Daily DB und Weekly DB in Notion öffnen, Struktur verifizieren
4. **Netlify prüfen:** Functions-Logs in Netlify Dashboard, podcast-read/fetch testen
5. **Frontend testen:** briefing.json direkt öffnen → App laden → alle 4 Tabs durchklicken
6. **Bugs fixen:** small_talk_bridge Rendering + Layer2 max-height sind Quick Wins

---

## Prompt für den neuen Chat

> Lies bitte zuerst `HANDOFF.md` im Root des Repos. Das ist ein vollständiges Übergabedokument vom vorherigen Chat mit der gesamten Architektur, Datenflüssen, Notion-Struktur, bekannten Bugs und offenen Punkten. Danach lies `ARCHITECTURE.md` für System-Design Details und `MORNING-OS-SPEC.md` für die vollständige Implementierungs-Spec.
