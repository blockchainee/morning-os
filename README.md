# Morning OS — Cloud Setup Guide

Everything runs in GitHub Actions (free). No Mac needs to stay on.
Setup time: ~25 minutes.

---

## Architecture

```
GitHub Actions (cron 05:30 Dubai)
  → yt-dlp fetches podcast transcripts
  → Claude API processes Gmail + Calendar + podcasts
  → Writes daily briefing page to Notion
Morning OS app (your Netlify URL)
  → Reads from Notion on "Generate" tap
```

---

## Step 1 — Create a GitHub repository

1. Go to github.com → New repository
2. Name it: `morning-os` (private is fine)
3. Upload all files from this folder into the repository

---

## Step 2 — Add GitHub Secrets (your API keys)

In your GitHub repo → Settings → Secrets and variables → Actions

Add these **Secrets** (encrypted, never visible):
```
ANTHROPIC_API_KEY      → your Claude API key (console.anthropic.com)
NOTION_API_KEY         → your Notion integration token (see Step 3)
NOTION_DATABASE_ID     → your Notion briefing database ID (see Step 3)
GOOGLE_CLIENT_ID       → your Google OAuth client ID (see Step 4)
GOOGLE_CLIENT_SECRET   → your Google OAuth client secret (see Step 4)
GOOGLE_REFRESH_TOKEN   → your Google refresh token (see Step 4)
```

Add these **Variables** (visible, not sensitive):
```
ACTIVE_NEWSLETTERS   → a16z,bankless,pomp,tldr,semafor,intrigue,lenny,chamath,timeout
ACTIVE_PODCASTS      → bankless,lex-fridman,my-first-million,knowledge-project
```

For ACTIVE_PODCASTS — use the podcast IDs below. Only add podcasts you actually want:
- `bankless` — Bankless Podcast
- `lex-fridman` — Lex Fridman Podcast
- `my-first-million` — My First Million
- `knowledge-project` — The Knowledge Project
- `tim-ferriss` — The Tim Ferriss Show
- `all-in` — All-In Podcast
- `huberman` — Huberman Lab
- `invest-like-best` — Invest Like the Best
- `acquired` — Acquired
- `diary-of-ceo` — The Diary of a CEO

---

## Step 3 — Set up Notion

### Create the Notion Integration

1. Go to notion.so/my-integrations
2. Click "New integration"
3. Name: "Morning OS"
4. Select your workspace
5. Click Submit
6. Copy the "Internal Integration Token" → this is your NOTION_API_KEY

### Create the Briefing Database

1. In Notion, create a new page: "Morning OS Briefings"
2. Add a database (full page, not inline)
3. Add these properties to the database:
   - `Name` (title) — already exists
   - `Date` (date)
   - `Status` (select) — add options: "Generated", "Read"
4. Click "..." menu → Connections → Add connection → "Morning OS" (your integration)
5. Copy the database ID from the URL:
   `notion.so/YOUR_USERNAME/`**`THIS-32-CHAR-ID`**`?v=...`
   → This is your NOTION_DATABASE_ID

---

## Step 4 — Connect Gmail and Calendar (Google OAuth)

The script reads your Gmail newsletters and Google Calendar directly via API.
This requires a one-time OAuth setup (~5 minutes).

### Create Google Cloud credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use existing) — name it "Morning OS"
3. Go to **APIs & Services → Library**, enable:
   - **Gmail API**
   - **Google Calendar API**
4. Go to **APIs & Services → OAuth consent screen**
   - User type: **External**
   - App name: "Morning OS"
   - Add scopes: `gmail.readonly`, `calendar.readonly`
   - Add your email as a **test user**
   - Save
5. Go to **APIs & Services → Credentials**
   - Click **Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Add **Authorized redirect URI**: `http://localhost:3456/callback`
   - Click Create
   - Copy the **Client ID** and **Client Secret**

### Get your refresh token

Run the helper script locally (requires Node.js):
```bash
node scripts/get-google-token.js YOUR_CLIENT_ID YOUR_CLIENT_SECRET
```

This opens a browser window where you sign in with your Google account.
After authorizing, it prints your `GOOGLE_REFRESH_TOKEN`.

### Add to GitHub Secrets

Add these three secrets in your GitHub repo (Settings → Secrets → Actions):
```
GOOGLE_CLIENT_ID       → from step 5 above
GOOGLE_CLIENT_SECRET   → from step 5 above
GOOGLE_REFRESH_TOKEN   → from the helper script output
```

*Note: If you skip this step, Morning OS will still generate the Growth Layer
and process podcast transcripts — just without Gmail newsletters or Calendar data.*

---

## Step 5 — Test it manually

In your GitHub repo → Actions → "Morning OS — Daily Briefing" → Run workflow

Watch the logs. After ~3-5 minutes you should see a new page in your Notion database.

---

## Step 6 — Deploy the web app

1. Go to netlify.com/drop
2. Drag `morning-os.html` onto the page
3. Get your URL: e.g. `graceful-fox.netlify.app`
4. (Optional) Rename to `morningos.netlify.app` in site settings

---

## Step 7 — Connect the app to Notion

1. Open your Netlify URL in Safari
2. Tap ⚙️ Settings
3. Enter:
   - **Notion Integration Token** → your `secret_xxx` token
   - **Briefing Database ID** → your 32-character database ID
4. In the **Podcasts** section: search for shows using the iTunes search
5. Tap Save Settings

---

## Step 8 — Add to iPhone home screen

1. Open your Netlify URL in Safari on iPhone
2. Tap Share → "Add to Home Screen"
3. Name it **Morning OS**
4. Tap Add

---

## Daily routine

Every morning at 05:30 Dubai time:
- GitHub Actions wakes up (no Mac needed)
- Fetches podcast transcripts from YouTube
- Calls Claude API to process newsletters + calendar + podcasts
- Writes a rich Notion page with the full briefing

You wake up, tap Morning OS → tap "Generate" → briefing loads from Notion instantly.

---

## Adjusting the schedule

Edit `.github/workflows/daily-briefing.yml`:
```yaml
- cron: '30 1 * * *'  # 01:30 UTC = 05:30 Dubai (UTC+4)
```

Other Dubai times:
- 04:30 Dubai = `30 0 * * *`
- 05:00 Dubai = `0 1 * * *`  
- 06:00 Dubai = `0 2 * * *`

---

## Costs

- GitHub Actions: **free** (2,000 minutes/month free tier — each run takes ~5 min)
- Claude API: ~$0.10-0.15 per day
- Netlify hosting: **free**
- Notion: **free**

Total: ~$3-5/month
