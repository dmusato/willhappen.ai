# CLAUDE.md — WillHappen.ai

Brief for any Claude session (Code, web, agent) that opens this repo.

## What this is

**WillHappen.ai** is a consensus forecasting site. A user asks a yes/no question about the future, six frontier AI models answer with a probability + reasoning, and we surface the aggregate. Predictions are archived on a public Timeline and can be shared. Outcomes are tracked ("happened ✓ / didn't ✗").

Opensource. Repo: https://github.com/dmusato/willhappen.ai. Host: Cloudflare at https://willhappen.ai.

## Non-negotiables

1. **One Cloudflare project.** Workers with Static Assets — static HTML/CSS/JS + fetch handlers + scheduled cron + KV + AI bindings, one `wrangler.toml`, one deploy.
2. **GitHub Actions does nothing outside of code.** No secrets, no cron, no deploys from Actions. Only PR lint + issue templates live on GitHub.
3. **Stay vanilla on the client.** HTML + CSS + plain JS, no framework, no build step. The design source is React but that's a prototype medium — we re-implement.
4. **Every prediction carries full attribution.** Which model drafted the question, when, and each evaluating model's probability + reasoning + timestamp.
5. **Keep it lightweight.** Landing < 60KB gzipped. Mobile-first (390px ceiling).
6. **Simple, direct code.** No premature abstraction, no frameworks "just in case".

## Architecture

```
                         Cloudflare Worker (single project "willhappen-ai")
                         ┌─────────────────────────────────────────────┐
Browser ──── request ───►│ fetch():                                    │
                         │   ├─ /api/predictions  → WH_KV              │
                         │   ├─ /api/vote         → WH_KV              │
                         │   ├─ /api/suggest      → GitHub Issues API  │
                         │   ├─ /og/:id           → SVG generator      │
                         │   ├─ /p/:id            → HTML w/ OG tags    │
                         │   └─ *                 → ASSETS (public/)   │
                         │                                             │
                         │ scheduled("17 3 * * *"):                    │
                         │   ├─ social autoposting (X, Reddit,         │
                         │   │   Facebook, Instagram carousels)        │
                         │   └─ Cloudflare AI Gateway                  │
                         │        ├─ google-ai-studio/gemini-2.5-pro   │
                         │        ├─ anthropic/claude-sonnet-4-6       │
                         │        ├─ openai/gpt-5                      │
                         │        ├─ grok/grok-4                       │
                         │        ├─ workers-ai/@cf/meta/llama-...     │
                         │        └─ deepseek/deepseek-chat            │
                         │        → writes predictions:all to WH_KV    │
                         └─────────────────────────────────────────────┘
```

## Directory map

```
public/                         served by Workers Static Assets (env.ASSETS)
  index.html                    landing: hero + ask + recent feed
  timeline.html                 archive + rewind slider + topic×horizon matrix
  predict.html                  client-rendered detail fallback (?id=…)
  suggest.html                  community submission form
  assets/style.css              liquid glass system — tokens mirror design/glass.jsx
  assets/app.js                 fetch / render / share / vote helpers
  assets/favicon.svg
  data/predictions.json         SEED only; KV takes over after first request
  data/subjects.json
  data/horizons.json
  _headers                      static asset cache policy
  robots.txt
src/
  worker.js                     main entry: fetch() + scheduled() + /api/admin/run
  handlers/predictions.js       GET /api/predictions
  handlers/vote.js              GET|POST /api/vote  → KV
  handlers/suggest.js           POST /api/suggest   → GH Issues
  handlers/og.js                GET /og/:id         → SVG 1200×630
  generate/generate.js          nightly batch — draft + evaluate + merge
  generate/providers.js         Cloudflare AI Gateway adapter
  generate/topics.js            30 topics × 9 horizons catalog
  social/index.js               autoposting orchestrator (KV checkpoints)
  social/twitter.js             X — OAuth 1.0a, POST /2/tweets
  social/reddit.js              Reddit — script app, link submit
  social/meta.js                Facebook Page + Instagram carousels (Graph API)
wrangler.toml                   one config for the whole project
package.json                    wrangler devDep + scripts
.github/ISSUE_TEMPLATE/         suggest + outcome issue templates
.github/workflows/lint.yml      syntax check on PRs (no secrets, no deploys)
CLAUDE.md                       (you are here)
README.md
LICENSE
```

## Design tokens (mirror `design/glass.jsx`)

```
--ink:#05061a  --ink2:#0a0a1f  --indigo:#1e1b4b
--lilac:#a78bfa  --sky:#38bdf8  --mint:#6ee7b7  --rose:#f472b6
--text:#f5f3ff  --text-dim:rgba(245,243,255,.72)
font-display: "Instrument Serif", serif
font-sans:    "Geist", system-ui, sans-serif
font-mono:    "JetBrains Mono", ui-monospace, monospace
```

Aurora: two soft radial blobs (lilac 72%/18%, sky 15%/75%) over
`radial-gradient(ellipse at 50% 0%, #1e1b4b, #0a0a1f 55%, #05061a)`,
`mix-blend-mode: screen`. No 3D tilt — only subtle hover lift + aurora
mouse-parallax (disabled on mobile and `prefers-reduced-motion`).

Glass card: `background: rgba(255,255,255,.05)` + `backdrop-filter: blur(20px)
saturate(160%)` + 0.5px hairline + inset top highlight.

## Data shape

One file per prediction. The repo holds the seed under
`public/data/predictions/{id}.json`; live state in KV mirrors the same
layout (`prediction:{id}` per record + a compact `predictions:index`).

Full record (`prediction:{id}` / `public/data/predictions/p001.json`):

```json
{
  "id": "a1k9f4x7",
  "question_generated_by": "anthropic/claude-sonnet-4-6",
  "question_generated_at": "2026-04-19T03:12:00Z",
  "source": "auto",                 // "auto" | "community" | "seed"
  "topic": "ai",
  "horizon": "5y",
  "created_at": "2026-04-19",
  "resolves_by": "2031-04-19",
  "headline": "A major frontier lab ships a multi-agent coding product",
  "consensus_prob": 41,
  "models": {
    "gemini":   { "provider": "google-ai-studio/gemini-2.5-pro",
                  "prob": 38, "note": "...", "queried_at": "..." },
    "claude":   { ... },
    "gpt":      { ... },
    "grok":     { ... },
    "llama":    { ... },
    "deepseek": { ... }
  },
  "verdict": null,                  // true | false | null
  "verdict_source": null,           // "maintainer" | "community" | null
  "verdict_note": null
}
```

Index entry (`predictions:index.predictions[]` / `public/data/index.json`):

```json
{ "id": "p001", "headline": "...", "topic": "ai", "horizon": "5y",
  "created_at": "2026-04-19", "resolves_by": "2031-04-19",
  "consensus_prob": 41, "verdict": null,
  "question_generated_at": "2026-04-19T03:12:00Z" }
```

Listing endpoints (`/api/predictions`, timeline, recent feed) serve the
index — ~10 KB for 40 entries. Detail pages and the OG image fetch a
single record (~1.2 KB).

## KV keyspace

| Key                       | Value                              | TTL |
|---------------------------|------------------------------------|-----|
| `prediction:{id}`         | full record JSON                   | none |
| `predictions:index`       | compact listing, sorted newest-first | none |
| `votes:tally:{id}`        | `{ yes, no }`                      | none |
| `votes:by:{id}:{fp}`      | `"yes"` \| `"no"`                  | 1y |
| `rl:{id}:{fp}`            | `"1"` (vote-change rate-limit)     | 60s |
| `rl:suggest:{ip}`         | `"1"` (suggest rate-limit)         | 60s |
| `social:{platform}:{id}`  | `{ at, ... }` posted checkpoint    | none |

## Social autoposting

Runs inside `scheduled()` right after generation (`src/social/index.js`).
Each platform activates only when its secrets exist — no code changes needed.
Checkpoints in KV guarantee each prediction is posted at most once per
platform; failures retry next night. Instagram posts a nightly digest
carousel (2–10 slides, OG cards rasterized to JPEG via wsrv.nl).

Manual trigger:
`curl -X POST https://willhappen.ai/api/admin/run -H 'authorization: Bearer $ADMIN_TOKEN' -d '{"generate":true,"social":true}'`

## Deploy (one-time setup)

```bash
npm install
wrangler kv namespace create WH_KV          # copy id → wrangler.toml
wrangler secret put AI_GATEWAY_TOKEN
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GOOGLE_AI_STUDIO_API_KEY
wrangler secret put XAI_API_KEY
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put GH_TOKEN                # scope: public_repo
wrangler deploy
```

Point `willhappen.ai` at the worker via Cloudflare DNS + a custom domain
route (see `wrangler.toml [routes]`).

## Dev commands

| Command | Effect |
|---|---|
| `npm run dev` | local worker + static assets, scheduled() exposed at `/__scheduled` |
| `npm run dev:fresh` | same but wipes local KV first |
| `npm run cron:trigger` | hit `/__scheduled?cron=...` on the running local worker |
| `npm run backfill` | regenerate `public/data/predictions.json` from `scripts/backfill.mjs` |
| `npm run deploy` | `wrangler deploy` |
| `npm run tail` | live logs from production worker |
| `npm run kv:seed` | one-off: load `public/data/predictions.json` into prod KV |
| `npm run lint` | node --check every JS file |

### Local end-to-end test without keys

Set `MOCK_LLM=1` in `.dev.vars` (gitignored). `src/generate/providers.js`
short-circuits to a deterministic synthetic response in mock mode, so the
full cron cycle (draft → 6-model evaluation → consensus → KV write →
social orchestrator) runs without any provider keys. Drop `MOCK_LLM`
from `.dev.vars` once real keys are set to call the live AI Gateway.

## Common tasks

### Mark an outcome resolved
Edit `public/data/predictions/{id}.json` — set `verdict`, `verdict_source`,
`verdict_note` — then push and update KV:
```bash
wrangler kv key put --binding=WH_KV "prediction:{id}" --path=public/data/predictions/{id}.json
# and refresh the index so it shows the ✓ / ✗ chip:
wrangler kv key delete --binding=WH_KV "predictions:index"
# next /api/predictions request re-seeds the index from public/data/index.json
# (run `npm run backfill` first if you want the index to reflect the new verdict)
```

### Add a topic
Edit `src/generate/topics.js` + `public/data/subjects.json`.

### Add a horizon
Edit `src/generate/topics.js` + `public/data/horizons.json`.

### Change the model roster
Edit `src/generate/providers.js`. Keep the six keys (`gemini`, `claude`, `gpt`, `grok`, `llama`, `deepseek`) or update the CSS dot selectors in `public/assets/style.css`.

## Style rules

- Vanilla everywhere. If a new dep feels justified, first try to solve it in 20 lines of plain JS.
- Don't add comments for what the code already says. Only `// why`.
- Every new prediction **must** pass through the attribution schema above.
- No framework runtime on the client. No bundler.
- Don't move secrets or cron to GitHub Actions — they live in Cloudflare.
