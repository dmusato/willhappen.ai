// Every KV read and write in one place, so the keyspace is documented by the
// code that uses it rather than by a table in a README that drifts.
//
//   prediction:{id}      full record
//   predictions:index    compact listing, newest first
//   queue:questions      harvested questions waiting for a forecast
//   scores:log           append-only (model, prob, outcome) rows for the board
//   ledger:{YYYY-MM-DD}  spend + counters for one UTC day
//   leaderboard          computed model calibration
//   review:queue         verdicts the resolver was not confident enough to publish
//   cursor:{name}        rotation cursors (news beats, market pages)
//   votes:tally:{id}     { yes, no }
//   votes:by:{id}:{fp}   "yes" | "no"  (1y)
//   social:{net}:{id}    posted checkpoint

export const INDEX_KEY = "predictions:index";
export const QUEUE_KEY = "queue:questions";
export const REVIEW_KEY = "review:queue";
export const LEADERBOARD_KEY = "leaderboard";

const MAX_QUEUE = 400;
const MAX_REVIEW = 200;

export const today = () => new Date().toISOString().slice(0, 10);

// ── predictions ──────────────────────────────────────────────
export const getPrediction = (env, id) => env.WH_KV.get(`prediction:${id}`, "json");
export const putPrediction = (env, p) => env.WH_KV.put(`prediction:${p.id}`, JSON.stringify(p));

export async function getIndex(env) {
  return (await env.WH_KV.get(INDEX_KEY, "json")) || { generated_at: null, predictions: [] };
}

export function indexEntry(p) {
  return {
    id: p.id,
    fp: p.fingerprint || null,
    headline: p.headline,
    topic: p.topic,
    horizon: p.horizon,
    source: p.source,
    created_at: p.created_at,
    resolves_by: p.resolves_by,
    consensus_prob: p.consensus_prob,
    spread: p.spread ?? null,
    market_prob: p.market?.prob ?? null,
    market_id: p.market?.external_id ?? null,
    // Carried in the index so the re-pricer can pick the stalest rows without
    // reading every full record to find out when each was last checked.
    market_checked_at: p.market?.checked_at ?? null,
    edge: p.edge ?? null,
    verdict: p.verdict,
    question_generated_at: p.question_generated_at,
  };
}

// Upserts by id so a re-forecast replaces the old row instead of duplicating it.
export async function writeIndex(env, records) {
  const idx = await getIndex(env);
  const rows = new Map(idx.predictions.map((r) => [r.id, r]));
  for (const p of records) rows.set(p.id, indexEntry(p));
  const predictions = [...rows.values()].sort(byNewest);
  await env.WH_KV.put(INDEX_KEY, JSON.stringify({ generated_at: new Date().toISOString(), predictions }));
  return predictions.length;
}

export const byNewest = (a, b) =>
  String(b.question_generated_at || b.created_at || "").localeCompare(String(a.question_generated_at || a.created_at || ""));

// ── question queue ───────────────────────────────────────────
export const getQueue = async (env) => (await env.WH_KV.get(QUEUE_KEY, "json")) || [];
export const putQueue = (env, q) => env.WH_KV.put(QUEUE_KEY, JSON.stringify(q.slice(0, MAX_QUEUE)));

export async function pushQueue(env, questions) {
  if (!questions.length) return 0;
  const queue = await getQueue(env);
  const have = new Set(queue.map((q) => q.fingerprint));
  const add = questions.filter((q) => q.fingerprint && !have.has(q.fingerprint));
  if (!add.length) return 0;
  await putQueue(env, [...queue, ...add]);
  return add.length;
}

export async function takeQueue(env, n) {
  const queue = await getQueue(env);
  if (!queue.length) return [];
  // Markets first: they carry a crowd price, which is the more interesting page.
  const ranked = [...queue].sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const take = ranked.slice(0, n);
  const taken = new Set(take.map((q) => q.fingerprint));
  await putQueue(env, queue.filter((q) => !taken.has(q.fingerprint)));
  return take;
}

// ── score log ────────────────────────────────────────────────
// Written once when a prediction resolves. The leaderboard reads this single
// key instead of re-reading every resolved record — KV reads count against the
// Worker subrequest limit, and a cron run has ~50 of them to spend.
export const SCORES_KEY = "scores:log";
const MAX_SCORES = 5000;

export const getScores = async (env) => (await env.WH_KV.get(SCORES_KEY, "json")) || [];

export async function appendScores(env, rows) {
  if (!rows.length) return 0;
  const log = await getScores(env);
  const have = new Set(log.map((r) => r.id));
  const add = rows.filter((r) => !have.has(r.id));
  if (!add.length) return 0;
  await env.WH_KV.put(SCORES_KEY, JSON.stringify([...log, ...add].slice(-MAX_SCORES)));
  return add.length;
}

export const putScores = (env, rows) => env.WH_KV.put(SCORES_KEY, JSON.stringify(rows.slice(-MAX_SCORES)));

// ── spend ledger ─────────────────────────────────────────────
// OpenRouter reports the real dollar cost per call; we accumulate it per UTC
// day so the budget cap reflects money actually spent, not an estimate.
export async function getLedger(env, day = today()) {
  return (await env.WH_KV.get(`ledger:${day}`, "json")) || { day, cost: 0, calls: 0, forecasts: 0, resolves: 0, harvests: 0 };
}

export async function addSpend(env, { cost = 0, calls = 0, forecasts = 0, resolves = 0, harvests = 0 } = {}) {
  const day = today();
  const l = await getLedger(env, day);
  const next = {
    day,
    cost: round6(l.cost + cost),
    calls: l.calls + calls,
    forecasts: l.forecasts + forecasts,
    resolves: l.resolves + resolves,
    harvests: l.harvests + harvests,
  };
  // 40 days of history is enough to draw a spend chart and cheap to keep.
  await env.WH_KV.put(`ledger:${day}`, JSON.stringify(next), { expirationTtl: 40 * 86_400 });
  return next;
}

export const dailyBudget = (env) => Math.max(0, Number(env.DAILY_BUDGET_USD ?? 0.7) || 0);

export async function budgetLeft(env) {
  const cap = dailyBudget(env);
  if (!cap) return Infinity;
  const { cost } = await getLedger(env);
  return cap - cost;
}

// ── review queue (verdicts needing a human) ──────────────────
export const getReview = async (env) => (await env.WH_KV.get(REVIEW_KEY, "json")) || [];

export async function pushReview(env, item) {
  const q = await getReview(env);
  const next = [item, ...q.filter((r) => r.id !== item.id)].slice(0, MAX_REVIEW);
  await env.WH_KV.put(REVIEW_KEY, JSON.stringify(next));
}

export async function dropReview(env, id) {
  const q = await getReview(env);
  await env.WH_KV.put(REVIEW_KEY, JSON.stringify(q.filter((r) => r.id !== id)));
}

// ── resolution bookkeeping ───────────────────────────────────
// One key, not one per prediction: a market whose deadline passed but which
// the exchange has not settled yet would otherwise be re-checked every run and
// block newer questions from ever being looked at.
const CHECKED_KEY = "resolve:checked";
const CHECKED_TTL_DAYS = 200;

export const getChecked = async (env) => (await env.WH_KV.get(CHECKED_KEY, "json")) || {};

export async function markChecked(env, ids) {
  if (!ids.length) return;
  const now = Date.now();
  const map = await getChecked(env);
  for (const id of ids) map[id] = new Date(now).toISOString();

  const cutoff = now - CHECKED_TTL_DAYS * 86_400_000;
  const pruned = Object.fromEntries(
    Object.entries(map).filter(([, at]) => Date.parse(at) > cutoff));
  await env.WH_KV.put(CHECKED_KEY, JSON.stringify(pruned));
}

// ── cursors ──────────────────────────────────────────────────
export async function nextCursor(env, name, len) {
  const raw = await env.WH_KV.get(`cursor:${name}`);
  const i = (Number.parseInt(raw, 10) || 0) % Math.max(1, len);
  await env.WH_KV.put(`cursor:${name}`, String((i + 1) % Math.max(1, len)));
  return i;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;
