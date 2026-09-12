# CLAUDE.md — WillHappen.ai

Brief for any Claude session that opens this repo.

## What this is

A forecasting machine that runs itself. Hourly it harvests questions from live
prediction markets and the news, puts each one to six frontier models through
OpenRouter, publishes a page, and — once the deadline passes — searches for the
outcome, cites sources, and records who was right. The models are scored against
each other **and against the market price on the same questions**.

Open source, MIT. Repo: https://github.com/dmusato/willhappen.ai.
Live: https://willhappen.ai, one Cloudflare Worker.

## Non-negotiables

1. **One Cloudflare project.** Worker + Static Assets + KV. One `wrangler.toml`,
   one deploy. No queues, no D1, no second service.
2. **One model gateway.** Everything goes through OpenRouter
   (`src/ai/openrouter.js`). Nothing else in the codebase calls a model API.
3. **GitHub Actions does nothing but lint.** No secrets, no cron, no deploys.
4. **No build step, no framework, no bundler.** Pages are server-rendered from
   template literals; the client JS is progressive enhancement only.
5. **Never show a model the market price.** It would make the published edge —
   and the whole scoreboard — meaningless.
6. **Never ship invented data.** No fabricated forecasts in the seed, no
   placeholder model answers. An empty archive with an honest empty state is
   correct; fake history is not.
7. **Keep it small.** Landing under 60KB gzipped. Mobile-first.

## Architecture

```
                Cloudflare Worker "willhappen-ai"
  ┌──────────────────────────────────────────────────────────────┐
  │ fetch()                                                      │
  │   /                /timeline  /topics  /models  /about       │
  │   /p/{id}          server-rendered, OG tags + JSON-LD        │
  │   /og/{id}.png     share card (SVG → PNG via wsrv.nl)        │
  │   /api/*           predictions · vote · suggest · catalog ·  │
  │                    leaderboard · admin                       │
  │   /sitemap.xml  /feed.xml                                    │
  │   *                → ASSETS (public/)                        │
  │                                                              │
  │ scheduled("7 * * * *")  → pipeline/run.js                    │
  │   harvest → forecast → resolve → refresh → score → social    │
  └──────────────────────────────────────────────────────────────┘
```

### Why hourly, not nightly

A Worker invocation gets ~50 subrequests, **and KV operations count**. Thirty
questions × six models does not fit in one run. `pipeline/run.js` therefore does
a small slice each hour and rotates the heavy phases by hour (`runPlan`). Any
change that adds per-item KV reads to the cron path has to be checked against
that ceiling — this is why dedupe reads two whole keys instead of one key per
question, and why the leaderboard reads an append-only `scores:log` instead of
re-reading every resolved record.

## Directory map

```
src/
  worker.js              routing + page rendering + scheduled()
  catalog.js             topics, horizons, news beats
  util.js                slugify, fingerprint, median, pool
  ai/
    openrouter.js        the only module that talks to a model
    roster.js            PANEL (six labs) + JOBS (search, reason)
  markets/
    index.js             source registry + cross-source dedupe/ranking
    polymarket.js        Gamma API
    kalshi.js            /events with nested markets
  pipeline/
    harvest.js           markets + news → curated, dated statements → queue
    forecast.js          question → six independent answers → record
    resolve.js           tier 1 exchange settlement · tier 2 jury · tier 3 human
    refresh.js           re-price open markets; drift is the returning hook
    score.js             Brier, skill, accuracy, calibration bins
    run.js               what one hourly slice does
  render/
    shell.js             document shell, nav, footer
    components.js        dial, rows, model list, market panel, verdict
    pages.js             one function per route
  handlers/
    http.js              json(), preflight(), requireAdmin()
    predictions.js       listing + filters + sorts, seed fallback
    og.js                share cards, both variants
    meta.js sitemap.js feed.js vote.js suggest.js admin.js
  social/
    index.js             orchestrator + copywriting
    postiz.js            one key, every connected channel
    telegram.js bluesky.js          direct, no app review needed
    twitter.js reddit.js meta.js    direct, need an app
  store/kv.js            every KV read and write
public/                  style.css, app.js, favicon, seed index.json
test/                    node --test, no framework
scripts/                 lint.mjs, markets.mjs
```

## Data shape

`prediction:{id}` in KV, where `id` is a slug (the URL is the headline):

```json
{
  "id": "the-fed-cuts-rates-in-october-a1b2",
  "v": 2,
  "fingerprint": "a1b2c3d4",
  "headline": "The Fed cuts its benchmark rate at the October 2026 meeting",
  "context": "Why this is live now and what counts as it happening.",
  "topic": "markets", "horizon": "1m",
  "source": "polymarket", "source_url": "https://polymarket.com/…",
  "rules": "Verbatim resolution criteria from the exchange.",
  "created_at": "2026-09-12", "resolves_by": "2026-10-29",
  "question_generated_by": "polymarket", "question_generated_at": "…",
  "consensus_prob": 63, "spread": 24, "answered": 6,
  "models": {
    "claude": { "model": "anthropic/claude-sonnet-5", "prob": 71,
                "note": "…", "queried_at": "…", "ms": 2100 }
  },
  "market": { "source": "polymarket", "external_id": "polymarket:123",
              "prob": 79, "prob_at_forecast": 71, "drift": 8,
              "change_1w": -4, "volume_usd": 4200000, "checked_at": "…" },
  "edge": -16,
  "verdict": null, "verdict_source": null, "verdict_at": null,
  "verdict_note": null, "verdict_confidence": null, "sources": []
}
```

`consensus_prob` is the **median**, not the mean — one outlier at 2% should not
drag a panel that otherwise agrees. `edge` is `consensus − market`, positive when
the models are more bullish than the money.

## KV keyspace

| Key | Value | TTL |
|---|---|---|
| `prediction:{id}` | full record | none |
| `predictions:index` | compact rows, newest first | none |
| `queue:questions` | harvested, awaiting a forecast | none |
| `scores:log` | append-only `{id, outcome, models, market}` rows | none |
| `leaderboard` | computed board | none |
| `ledger:{YYYY-MM-DD}` | `{cost, calls, forecasts, resolves}` | 40d |
| `review:queue` | verdicts the resolver would not publish on its own | none |
| `resolve:checked` | `{id: lastCheckedAt}` — one key, not one per prediction | none |
| `cursor:{name}` | rotation cursors (news beats) | none |
| `votes:tally:{id}` / `votes:by:{id}:{fp}` | community vote | none / 1y |
| `rl:*` | rate limits | 60s |
| `social:{channel}:{id}` | posted checkpoint | none |

## Resolution — read this before touching resolve.js

This is the only code here that can publish a falsehood as a fact, so it is tiered and the
tiers are not interchangeable:

1. **The exchange settled it.** `market.external_id` → `fetchResolution()`. Polymarket is
   settled when `closed === true` **and** `outcomePrices` is exactly `1`/`0` — a price of
   0.97 is a price, not a settlement. Kalshi is `status` settled/finalized plus `result`.
   A `disputed` entry in `umaResolutionStatuses` never auto-publishes.
2. **A jury.** Three models from three different labs, identical evidence, no search of
   their own, no sight of each other. Unanimous or it goes to review. Each juror must
   declare a `basis`, and a verdict resting only on `absence_of_coverage` never publishes —
   that is the easiest way to be confidently wrong about something that simply was not
   covered.
3. **A human.** Everything else, plus a public dispute link on every verdict.

Two things that look like details and are not:

- **Polarity.** The headline was rewritten from the market question by a model, so before a
  settlement is applied one cheap call confirms the two still mean the same thing. Without
  it, a curator that flipped "no change in rates" into "the Fed changes rates" would publish
  an inverted outcome with total confidence.
- **Re-check throttling.** `resolve:checked` exists because a market that is merely slow to
  settle would otherwise be re-examined every run and starve newer questions. Anything that
  changes how due work is selected has to keep that property.

## Dedupe — read this before touching harvest

A question changes shape as it moves through the pipeline, and dedupe has to
survive all of it. `knownFingerprints()` builds a set from **three** keys:

- `p.fp` — fingerprint of the original source question, stored on the record
- `fingerprint(p.headline)` — fingerprint of the curated headline
- `p.market_id` — the exchange's own id

Miss any one and the same market is re-queued every hour. The curated headline
is also re-checked after curation, because two exchanges list the same event
with different wording. `normalizeQuestion()` strips filler, years and plurals
but deliberately keeps word order — "A beats B" is not "B beats A".

## Common tasks

**Change the panel** — edit `PANEL` in `src/ai/roster.js`. Nothing else
hardcodes a model key; UI colours, share cards and the scoreboard all read it.

**Add a topic or horizon** — `src/catalog.js`. Topic hues feed the UI directly.

**Add an exchange** — a file in `src/markets/` exporting `id`, `label`,
`fetchMarkets(env, opts)` and `fetchOne(env, externalId)`, plus one line in
`SOURCES`. Match the normalized shape; `npm run markets` shows what it yields.

**Publish a verdict by hand**
```bash
curl -X POST $SITE/api/admin/verdict -H "authorization: Bearer $ADMIN_TOKEN" \
  -d '{"id":"…","verdict":true,"note":"source says …"}'
```

**See what's pending review** — `GET /api/admin/review`.

**Rebuild the scoreboard from scratch** — `POST /api/admin/rebuild-scores`.
Expensive in KV reads, which is why it is admin-only and off the cron path.

## Dev

| Command | Effect |
|---|---|
| `npm run dev` | local Worker; put `MOCK_LLM=1` in `.dev.vars` to run keyless |
| `npm run dev:fresh` | same, wiping local KV first |
| `npm run markets` | print what the exchanges would yield right now |
| `npm test` | unit tests |
| `npm run lint` | syntax + JSON check, zero dependencies |
| `npm run deploy` / `npm run tail` | ship / watch production |

`MOCK_LLM=1` returns deterministic synthetic answers from `openrouter.js`, so the
whole loop runs offline. **Mocks must mirror the real schema exactly** — an early
version omitted the `keep` and `ref` fields and the entire harvest silently
no-opped.

## Style rules

- Vanilla everywhere. If a dependency feels justified, try twenty lines of plain
  JS first.
- Comment the *why*, never the *what*. If the code already says it, delete the
  comment.
- Prose in the UI is part of the product. Say what a number means, not just the
  number: "the models are sharply more confident than traders risking real
  money" beats "edge: +41".
- State limits plainly rather than hedging everywhere. `/about` is the contract
  with the reader — keep it accurate.
