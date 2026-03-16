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
  blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'This Week\'s Conviction' } }] } });
  blocks.push({
    type: 'quote',
    quote: { rich_text: [{ type: 'text', text: { content: synthesis.one_conviction } }] },
  });

  blocks.push({ type: 'divider', divider: {} });

  // Learning Gaps
  if ((synthesis.learning_gaps || []).length > 0) {
    blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Learning Gaps' } }] } });
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
    blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Source Conflicts' } }] } });
    for (const conflict of synthesis.source_conflicts) {
      blocks.push({
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: [{ type: 'text', text: { content: `${conflict.topic}: ${conflict.position_a} vs ${conflict.position_b} — ${conflict.implication}` } }] },
      });
    }
    blocks.push({ type: 'divider', divider: {} });
  }

  // Weekly Challenges
  blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Your 3 Challenges This Week' } }] } });
  for (const challenge of (synthesis.weekly_challenges || [])) {
    blocks.push({
      type: 'numbered_list_item',
      numbered_list_item: { rich_text: [{ type: 'text', text: { content: challenge } }] },
    });
  }

  blocks.push({ type: 'divider', divider: {} });

  // Reading Behavior
  blocks.push({ type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: 'Your Reading Patterns This Week' } }] } });
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
