// /api/admin/* — everything that costs money or overrides the machine.
// Guarded by ADMIN_TOKEN; when that secret is unset the whole surface 503s.

import { runCycle } from "../pipeline/run.js";
import { computeLeaderboard } from "../pipeline/score.js";
import { resolveOne, scoreRow } from "../pipeline/resolve.js";
import { harvestMarkets, harvestNews } from "../pipeline/harvest.js";
import {
  appendScores, dropReview, getIndex, getLedger, getPrediction, getQueue,
  getReview, listPredictionIds, putPrediction, putScores, writeIndex,
} from "../store/kv.js";
import { json, requireAdmin } from "./http.js";

export async function handleAdmin(request, env, ctx) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  const path = new URL(request.url).pathname.replace(/^\/api\/admin\/?/, "");
  const body = request.method === "POST" ? await request.json().catch(() => ({})) : {};

  switch (path) {
    case "status":   return json(await status(env));
    case "run":      return json(await runCycle(env, { reason: "admin", hour: numOr(body.hour, new Date().getUTCHours()), overrides: body.plan || {} }));
    case "harvest":  return json(body.source === "news" ? await harvestNews(env, { want: numOr(body.want, 6) }) : await harvestMarkets(env, { want: numOr(body.want, 12) }));
    case "resolve":  return json(body.id ? await resolveOne(env, body.id) : { error: "id required" }, body.id ? 200 : 400);
    case "review":   return json({ pending: await getReview(env) });
    case "verdict":  return json(...await setVerdict(env, body));
    case "leaderboard": return json(await computeLeaderboard(env));
    case "rebuild-scores": return json(await rebuildScores(env, ctx));
    case "reindex":  return json(await reindex(env, { limit: numOr(body.limit, 40) }));
    default: return json({ error: "unknown_admin_route", routes: ["status", "run", "harvest", "resolve", "review", "verdict", "leaderboard", "rebuild-scores", "reindex"] }, 404);
  }
}

async function status(env) {
  const [ledger, queue, review, index] = await Promise.all([getLedger(env), getQueue(env), getReview(env), getIndex(env)]);
  const open = index.predictions.filter((p) => p.verdict === null || p.verdict === undefined).length;
  return {
    ok: true,
    now: new Date().toISOString(),
    ledger,
    budget_usd: Number(env.DAILY_BUDGET_USD ?? 0.7),
    daily_target: Number(env.DAILY_QUESTIONS ?? 30),
    queue: queue.length,
    review_pending: review.length,
    predictions: { total: index.predictions.length, open, resolved: index.predictions.length - open },
    index_generated_at: index.generated_at,
  };
}

// Publish a verdict by hand — the escape hatch for anything the resolver
// flagged as unclear, and the path a community report ends up taking.
async function setVerdict(env, { id, verdict, note = "", source = "maintainer" }) {
  if (!id || typeof verdict !== "boolean") return [{ error: 'send {"id":"…","verdict":true|false}' }, 400];
  const p = await getPrediction(env, id);
  if (!p) return [{ error: "not_found" }, 404];

  const next = {
    ...p,
    verdict,
    verdict_source: source,
    verdict_method: "maintainer",
    verdict_at: new Date().toISOString(),
    verdict_note: String(note).slice(0, 400) || p.verdict_note,
    verdict_confidence: 100,
    verdict_detail: null,
  };
  await putPrediction(env, next);
  await writeIndex(env, [next]);
  await appendScores(env, [scoreRow(next)]);
  await dropReview(env, id);
  await computeLeaderboard(env);
  return [{ ok: true, id, verdict }, 200];
}

// Walks every resolved record to rebuild the score log from scratch. Expensive
// in KV reads, so it is admin-only and runs outside the cron's subrequest budget.
async function rebuildScores(env, ctx) {
  const { predictions } = await getIndex(env);
  const resolved = predictions.filter((p) => p.verdict === true || p.verdict === false);
  const rows = [];
  for (const row of resolved) {
    const full = await getPrediction(env, row.id);
    if (full) rows.push(scoreRow(full));
  }
  rows.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  await putScores(env, rows);
  const board = await computeLeaderboard(env);
  return { rebuilt: rows.length, rows: board.rows.length };
}

// Gives an index row back to a record that has none.
//
// A run that hits the daily KV write cap can land a prediction and then be
// refused the index rewrite that lists it: the forecast is paid for and
// invisible — not in the timeline, the API or the sitemap — and nothing in the
// pipeline would ever notice, because every other phase works from the index.
// Reads only the orphans rather than the whole archive, so it stays inside a
// Worker's subrequest budget; `remaining` says whether to call it again.
async function reindex(env, { limit = 40 } = {}) {
  const [{ predictions }, ids] = await Promise.all([getIndex(env), listPredictionIds(env)]);
  const indexed = new Set(predictions.map((p) => p.id));
  const orphans = ids.filter((id) => !indexed.has(id));

  const records = [];
  for (const id of orphans.slice(0, Math.max(1, limit))) {
    const full = await getPrediction(env, id);
    if (full) records.push(full);
  }
  const total = records.length ? await writeIndex(env, records) : predictions.length;
  return {
    records: ids.length,
    orphans: orphans.length,
    added: records.length,
    remaining: Math.max(0, orphans.length - records.length),
    total,
  };
}

const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
