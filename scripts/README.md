# Scripts

## `backfill.mjs`

Regenerates `public/data/predictions.json` with a curated archive starting
from January 2026 (≈40 entries, ~10 already resolved). Run after editing
the `ROWS` table in the script.

```bash
npm run backfill
```

The output JSON is the **seed** — it's loaded into KV on the Worker's first
read, then KV becomes the source of truth. Re-seeding production means
clearing the KV key:

```bash
wrangler kv key delete --binding=WH_KV 'predictions:all'
# next request to /api/predictions re-loads from public/data/predictions.json
```

## Local end-to-end test (no external keys)

```bash
# 1. Set MOCK_LLM=1 in .dev.vars (already done in template)
# 2. Start a fresh local Worker
npm run dev:fresh

# 3. In another terminal — trigger the nightly cron
npm run cron:trigger

# 4. Watch the logs in the wrangler dev terminal:
#    [gen] starting 17 3 * * * run at ...
#    [gen] slots: biotech/5y, ...
#    [gen] wrote 3 new / 43 total
#    [social] done: {}   ← empty because social secrets aren't set

# 5. Confirm new entries via the API
curl -s http://localhost:8787/api/predictions | jq '.predictions | length'
```

`MOCK_LLM=1` makes `callModel()` return deterministic synthetic responses
so the whole pipeline (drafting question → 6 model evaluations → consensus
→ KV write → social orchestrator) runs without any provider keys.

Switch off `MOCK_LLM` (delete the line from `.dev.vars`) once you've added
the real provider keys to call the live Cloudflare AI Gateway from local.
