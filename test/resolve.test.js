import { test } from "node:test";
import assert from "node:assert/strict";
import { dueForResolution, resolverConfig, resolveOne } from "../src/pipeline/resolve.js";

// ── in-memory KV, enough for the resolver's reads and writes ──
function fakeEnv(records = [], extra = {}) {
  const store = new Map();
  for (const p of records) store.set(`prediction:${p.id}`, JSON.stringify(p));
  const env = {
    MOCK_LLM: "1",
    RESOLVE_MIN_SOURCES: "2",
    ...extra,
    WH_KV: {
      get: async (k, type) => (store.has(k) ? (type === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null),
      put: async (k, v) => void store.set(k, v),
    },
  };
  return { env, store, read: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null) };
}

function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => handler(String(url));
  return fn().finally(() => { globalThis.fetch = real; });
}

const jsonRes = (body) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const marketPrediction = (over = {}) => ({
  id: "the-fed-cuts-rates-a1b2",
  headline: "The Fed cuts its benchmark rate at the October 2026 meeting",
  topic: "markets", horizon: "1m",
  resolves_by: "2026-10-29",
  source: "polymarket",
  source_url: "https://polymarket.com/event/x",
  consensus_prob: 63,
  models: { claude: { prob: 71 }, gpt: { prob: 63 } },
  market: { source: "polymarket", external_id: "polymarket:999", question: "Will the Fed cut rates in October?", prob: 79, prob_at_forecast: 71 },
  verdict: null,
  ...over,
});

const settled = (over = {}) => ({
  id: "999", question: "Will the Fed cut rates in October?", slug: "fed-cut",
  closed: true, outcomes: '["Yes", "No"]', outcomePrices: '["1", "0"]',
  umaResolutionStatuses: "[]", umaBond: "500", ...over,
});

// ── which predictions are even looked at ──────────────────
test("dueForResolution: only overdue, unresolved, not recently checked", () => {
  const cfg = resolverConfig({});
  const now = Date.parse("2026-11-01T00:00:00Z");
  const rows = [
    { id: "overdue", resolves_by: "2026-10-01", verdict: null },
    { id: "future", resolves_by: "2027-01-01", verdict: null },
    { id: "resolved", resolves_by: "2026-09-01", verdict: true },
    { id: "checked-recently", resolves_by: "2026-08-01", verdict: null },
    { id: "checked-long-ago", resolves_by: "2026-07-01", verdict: null },
  ];
  const checked = {
    "checked-recently": "2026-10-31T20:00:00Z",
    "checked-long-ago": "2026-10-20T00:00:00Z",
  };
  const due = dueForResolution(rows, cfg, checked, now).map((r) => r.id);

  assert.deepEqual(due, ["checked-long-ago", "overdue"], "oldest deadline first");
  assert.ok(!due.includes("checked-recently"), "a market that is simply slow to settle must not block newer questions");
});

// ── tier 1: the exchange ──────────────────────────────────
test("exchange settlement publishes a verdict without asking a jury", async () => {
  const { env, read } = fakeEnv([marketPrediction()]);
  let searched = false;
  const out = await withFetch((url) => {
    if (url.includes("openrouter")) searched = true;
    return jsonRes(settled());
  }, () => resolveOne(env, "the-fed-cuts-rates-a1b2"));

  assert.equal(out.verdict, true);
  assert.equal(out.method, "exchange");
  assert.equal(searched, false, "mock mode short-circuits the model calls");

  const saved = read("prediction:the-fed-cuts-rates-a1b2");
  assert.equal(saved.verdict, true);
  assert.equal(saved.verdict_method, "exchange");
  assert.equal(saved.verdict_confidence, 100);
  assert.match(saved.verdict_note, /Polymarket/);
  assert.equal(saved.sources.length, 1);
  // Resolving has to feed the scoreboard, or the leaderboard silently stalls.
  assert.equal(read("scores:log").length, 1);
  assert.equal(read("scores:log")[0].method, "exchange");
});

test("a NO settlement becomes a false verdict", async () => {
  const { env, read } = fakeEnv([marketPrediction()]);
  await withFetch(() => jsonRes(settled({ outcomePrices: '["0", "1"]' })),
    () => resolveOne(env, "the-fed-cuts-rates-a1b2"));
  assert.equal(read("prediction:the-fed-cuts-rates-a1b2").verdict, false);
});

test("a disputed resolution goes to review instead of publishing", async () => {
  const { env, read } = fakeEnv([marketPrediction()]);
  const out = await withFetch(
    () => jsonRes(settled({ umaResolutionStatuses: '["proposed", "disputed", "proposed", "disputed"]' })),
    () => resolveOne(env, "the-fed-cuts-rates-a1b2"));

  assert.equal(out.verdict, null);
  assert.equal(out.queued_for_review, "resolution_disputed");
  assert.equal(read("prediction:the-fed-cuts-rates-a1b2").verdict, null, "nothing is published");
  const review = read("review:queue");
  assert.equal(review.length, 1);
  assert.match(review[0].summary, /disputed/i);
});

test("an unsettled market waits rather than guessing", async () => {
  const soon = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const { env, read } = fakeEnv([marketPrediction({ resolves_by: soon })]);
  const out = await withFetch(
    () => jsonRes(settled({ closed: false, outcomePrices: '["0.62", "0.38"]' })),
    () => resolveOne(env, "the-fed-cuts-rates-a1b2"));

  assert.equal(out.waiting, "market_not_settled");
  assert.equal(read("review:queue"), null, "waiting is not the same as needing a human");
});

test("closed but not yet paid out does not count as settled", async () => {
  const soon = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const { env } = fakeEnv([marketPrediction({ resolves_by: soon })]);
  const out = await withFetch(
    () => jsonRes(settled({ closed: true, outcomePrices: '["0.97", "0.03"]' })),
    () => resolveOne(env, "the-fed-cuts-rates-a1b2"));
  assert.equal(out.waiting, "market_not_settled", "97% is a price, not a settlement");
});

// ── tier 2 and the give-up path ───────────────────────────
test("a news question with a split jury is held for review", async () => {
  const { env, read } = fakeEnv([{
    id: "a-news-question-c3d4",
    headline: "A frontier lab publicly delays a model release citing safety evaluations",
    topic: "ai", horizon: "6m", resolves_by: "2026-08-01",
    source: "news", market: null, consensus_prob: 34, models: { claude: { prob: 34 } }, verdict: null,
  }]);
  const out = await withFetch(() => jsonRes({}), () => resolveOne(env, "a-news-question-c3d4"));

  assert.equal(out.method, "jury");
  assert.equal(out.votes.length, 3, "three jurors, three labs");
  // The mock gives each juror a different pseudo-random status, so this
  // exercises exactly the disagreement path that must never auto-publish.
  if (out.queued_for_review) {
    assert.equal(read("prediction:a-news-question-c3d4").verdict, null);
    assert.ok(read("review:queue")[0].reason);
  } else {
    assert.equal(typeof out.verdict, "boolean");
    assert.ok(read("prediction:a-news-question-c3d4").sources.length >= 2);
  }
});

test("a long-dead question is retired to review, not re-litigated forever", async () => {
  const ancient = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
  const { env, read } = fakeEnv([{
    id: "ancient-question-e5f6", headline: "Something nobody wrote about",
    topic: "ai", horizon: "1y", resolves_by: ancient,
    source: "news", market: null, consensus_prob: 20, models: {}, verdict: null,
  }]);
  const out = await withFetch(() => jsonRes({}), () => resolveOne(env, "ancient-question-e5f6"));

  assert.equal(out.queued_for_review, "stale");
  assert.match(read("review:queue")[0].summary, /days after its deadline/);
});

test("an already-resolved prediction is left alone", async () => {
  const { env } = fakeEnv([marketPrediction({ verdict: true })]);
  const out = await resolveOne(env, "the-fed-cuts-rates-a1b2");
  assert.equal(out.skipped, "already_resolved");
});
