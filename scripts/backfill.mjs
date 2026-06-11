// Backfill: build a historical seed archive from January 2026 to today.
// Writes:
//   public/data/predictions/<id>.json   — one full record per prediction
//   public/data/index.json              — compact listing for feeds/timeline
//
// Run:  npm run backfill

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../public/data");

const MODELS = [
  { key: "gemini",   provider: "google-ai-studio/gemini-2.5-pro" },
  { key: "claude",   provider: "anthropic/claude-sonnet-4-6" },
  { key: "gpt",      provider: "openai/gpt-5" },
  { key: "grok",     provider: "grok/grok-4" },
  { key: "llama",    provider: "workers-ai/@cf/meta/llama-3.3-70b-instruct" },
  { key: "deepseek", provider: "deepseek/deepseek-chat" },
];

// Each row: [month_index_from_jan_2026, topic, horizon, headline, base_prob, verdict_if_known]
const ROWS = [
  [0, "ai",       "1m",  "OpenAI announces a multi-agent coding product in January",                 78, true],
  [0, "markets",  "1m",  "S&P 500 closes January above 6,200",                                       62, true],
  [0, "crypto",   "1m",  "Bitcoin closes January above $110k",                                       58, false],
  [0, "geo",      "6m",  "A formal Russia–Ukraine ceasefire is signed in the first half of 2026",    24, false],
  [0, "space",    "1y",  "SpaceX completes a fully reusable Starship orbital flight in 2026",        66, null],

  [1, "ai",       "1m",  "Anthropic ships Claude 4.7 in February",                                   71, true],
  [1, "climate",  "1m",  "February 2026 sets a new global temperature record",                       54, false],
  [1, "health",   "6m",  "FDA approves the first CRISPR therapy for sickle cell at home delivery",   38, null],
  [1, "tech",     "1y",  "Apple announces an AR/VR consumer headset under $1,500",                   45, null],
  [1, "culture",  "1m",  "A non-English-language film tops the global box office in February",       62, true],

  [2, "ai",       "3y",  "An AI agent autonomously contributes a merged PR to the Linux kernel by 2029", 47, null],
  [2, "markets",  "3y",  "S&P 500 closes above 8,000 at least once before April 2029",               71, null],
  [2, "energy",   "1y",  "Solar + storage beats fossil baseline in 10 more countries in 2026",       69, null],
  [2, "robotics", "5y",  "A humanoid robot is sold to consumers under $20k by 2031",                 41, null],
  [2, "geo",      "1y",  "A new Asia-Pacific trade bloc launches in 2026",                           48, null],

  [3, "ai",       "1m",  "GPT-5 is released to general availability in April",                       82, true],
  [3, "crypto",   "1y",  "A G7 nation adopts Bitcoin as a strategic reserve asset in 2026",          18, null],
  [3, "space",    "5y",  "First crewed lunar landing since Apollo 17 happens before April 2031",     41, null],
  [3, "biotech",  "10y", "A drug approved before 2036 extends median human lifespan by 5+ years",    27, null],
  [3, "labor",    "3y",  "Remote work share in OECD economies drops below 18% by 2029",              52, null],
  [3, "demo",     "5y",  "China's total population falls below 1.35B before 2031",                   74, null],

  [4, "tech",     "5y",  "AR glasses outsell smartphones in at least one quarter by 2031",           58, null],
  [4, "ai",       "5y",  "A peer-reviewed paper claims AGI threshold met before May 2031",           34, null],
  [4, "climate",  "1y",  "2026 ends as the hottest year on record",                                  67, null],
  [4, "policy",   "1y",  "The EU AI Act enforcement phase 2 triggers a major model ban in 2026",     22, null],
  [4, "sports",   "1m",  "A 17-year-old wins a Grand Slam tennis title in May",                      12, false],
  [4, "gaming",   "3y",  "A AAA studio releases a fully AI-generated open-world game by 2029",       39, null],

  [5, "ai",       "1m",  "Google releases Gemini 3 with native agent runtime in June",               74, null],
  [5, "markets",  "1m",  "Fed cuts rates by 25bps in June",                                          48, null],
  [5, "climate",  "1m",  "A category-5 hurricane forms in the Atlantic before July",                 31, null],
  [5, "health",   "1m",  "WHO declares a new pandemic-tier health emergency in June",                7,  null],
  [5, "culture",  "6m",  "A film made entirely by AI grosses $100M+ globally before 2027",           29, null],
  [5, "longevity","10y", "An FDA-approved drug labeled to 'treat aging' exists by 2036",             36, null],
  [5, "oceans",   "10y", "Arctic Ocean has its first ice-free September before 2036",                73, null],

  [5, "space",    "50y", "A permanent, self-sustaining human settlement on Mars by 2076",            41, null],
  [5, "climate",  "100y","Net global CO₂ emissions reach zero and stay there before 2126",          49, null],
  [5, "biotech",  "100y","Average global life expectancy exceeds 100 years by 2126",                 28, null],
  [5, "ai",       "100y","A non-human entity holds elected political office before 2126",            14, null],
  [5, "energy",   "50y", "Fusion provides 5%+ of global electricity by 2076",                        44, null],
  [5, "demo",     "100y","World population peaks and falls below 8B before 2126",                    62, null],
];

const HORIZON_DAYS = { "1w":7, "1m":30, "6m":180, "1y":365, "3y":1095, "5y":1825, "10y":3650, "50y":18250, "100y":36500 };

const dayInMonth = (m, d = 15) => new Date(Date.UTC(2026, m, d));
const shortId = (i) => "p" + (i + 1).toString().padStart(3, "0");

function spread(base, key) {
  const c = key.charCodeAt(0) + key.length * 3;
  const delta = ((c * 31) % 25) - 12;
  return Math.max(2, Math.min(98, base + delta));
}

function buildPrediction(row, i) {
  const [monthIdx, topic, horizon, headline, baseProb, verdict] = row;
  const created = dayInMonth(monthIdx, 10 + (i % 18));
  const queryTime = new Date(created.getTime() + 3 * 3600_000);
  const resolves = new Date(created.getTime() + HORIZON_DAYS[horizon] * 86400_000);

  const models = {};
  let sum = 0;
  for (const m of MODELS) {
    const prob = spread(baseProb, m.key);
    sum += prob;
    models[m.key] = {
      provider: m.provider,
      prob,
      note: `Backfill seed · ${m.key} prior`,
      queried_at: queryTime.toISOString(),
    };
  }

  return {
    id: shortId(i),
    source: "seed",
    question_generated_by: "anthropic/claude-sonnet-4-6",
    question_generated_at: created.toISOString(),
    topic,
    horizon,
    created_at: created.toISOString().slice(0, 10),
    resolves_by: resolves.toISOString().slice(0, 10),
    headline,
    consensus_prob: Math.round(sum / MODELS.length),
    models,
    verdict,
    verdict_source: verdict === null ? null : "maintainer",
    verdict_note: verdict === null ? null : "Backfill — historical record.",
  };
}

function indexEntry(p) {
  return {
    id: p.id,
    headline: p.headline,
    topic: p.topic,
    horizon: p.horizon,
    created_at: p.created_at,
    resolves_by: p.resolves_by,
    consensus_prob: p.consensus_prob,
    verdict: p.verdict,
    question_generated_at: p.question_generated_at,
  };
}

// ── write ────────────────────────────────────────────────
rmSync(resolve(OUT, "predictions"), { recursive: true, force: true });
mkdirSync(resolve(OUT, "predictions"), { recursive: true });

const predictions = ROWS.map(buildPrediction);

for (const p of predictions) {
  writeFileSync(resolve(OUT, "predictions", `${p.id}.json`), JSON.stringify(p, null, 2) + "\n");
}

const index = {
  generated_at: new Date().toISOString(),
  predictions: predictions
    .slice()
    .sort((a, b) => (b.question_generated_at || "").localeCompare(a.question_generated_at || ""))
    .map(indexEntry),
};
writeFileSync(resolve(OUT, "index.json"), JSON.stringify(index, null, 2) + "\n");

console.log(`✓ wrote ${predictions.length} files to public/data/predictions/`);
console.log(`✓ wrote index with ${index.predictions.length} entries to public/data/index.json`);
console.log(`  range:    ${predictions[0].created_at} → ${predictions[predictions.length - 1].created_at}`);
console.log(`  resolved: ${predictions.filter((p) => p.verdict !== null).length}`);
