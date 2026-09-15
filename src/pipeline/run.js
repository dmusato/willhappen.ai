// The cron body. Runs hourly and does a deliberately small slice of work.
//
// Two limits shape this. Cloudflare allows ~50 subrequests per invocation (KV
// operations included), and the project has a daily dollar budget. So instead
// of one big nightly job, each hour picks up a few questions, and the heavier
// phases rotate by hour. The side effect is nicer than the constraint: pages
// publish steadily through the day instead of all at 3am.

import { harvestMarkets, harvestNews, harvestSearches } from "./harvest.js";
import { forecastAndStore } from "./forecast.js";
import { resolveDue } from "./resolve.js";
import { refreshMarkets } from "./refresh.js";
import { computeLeaderboard } from "./score.js";
import {
  budgetLeft, getIndex, getLedger, getPrediction, getQueue, listPredictionIds,
  pushQueue, takeQueue, writeIndex,
} from "../store/kv.js";
import { submitUrls } from "../handlers/indexnow.js";

// Rough cost of putting one question to all six models. Only used to decide
// whether to start one — actual spend comes back from OpenRouter per call.
const FORECAST_COST_ESTIMATE = 0.015;

function runPlan(env, hour) {
  const n = (key, dflt) => Math.max(0, Number(env[key] ?? dflt) || 0);
  return {
    forecasts: n("FORECASTS_PER_RUN", 2),
    dailyTarget: n("DAILY_QUESTIONS", 30),
    queueLow: n("QUEUE_LOW_WATER", 12),
    harvestMarkets: hour % 6 === 0,
    harvestNews: hour % 6 === 3,
    // Evergreen, so it does not need to be swept often — but it is the only
    // source that answers to what people are actually looking for.
    harvestSearches: hour % 6 === 1,
    resolve: hour % 2 === 1 ? n("RESOLVES_PER_RUN", 2) : 0,
    refresh: hour % 4 === 2 ? n("REFRESH_PER_RUN", 6) : 0,
    social: n("SOCIAL_PER_RUN", 2),
  };
}

export async function runCycle(env, { reason = "cron", hour = new Date().getUTCHours(), overrides = {} } = {}) {
  const plan = { ...runPlan(env, hour), ...overrides };
  const started = Date.now();
  const out = { reason, hour, plan, steps: {} };

  const [left, ledger, queue] = await Promise.all([budgetLeft(env), getLedger(env), getQueue(env)]);
  out.budget = { left: left === Infinity ? null : round(left), spent_today: round(ledger.cost), forecasts_today: ledger.forecasts };

  const canSpend = left === Infinity || left > FORECAST_COST_ESTIMATE;
  const underTarget = plan.dailyTarget === 0 || ledger.forecasts < plan.dailyTarget;

  // 1 — top up the question queue, but only when it is running dry and there
  //     is money left to forecast what we harvest.
  if (canSpend && queue.length < plan.queueLow) {
    if (plan.harvestMarkets) out.steps.markets = await safe("harvest:markets", () => harvestMarkets(env, { want: 12 }));
    if (plan.harvestNews)    out.steps.news    = await safe("harvest:news", () => harvestNews(env, { want: 6 }));
    if (plan.harvestSearches) out.steps.searches = await safe("harvest:searches", () => harvestSearches(env, { want: 6 }));
  } else {
    out.steps.harvest_skipped = queue.length >= plan.queueLow ? "queue_full" : "no_budget";
  }

  // 2 — forecast.
  if (canSpend && underTarget && plan.forecasts > 0) {
    out.steps.forecast = await safe("forecast", () => forecastBatch(env, plan.forecasts));
  } else {
    out.steps.forecast_skipped = !canSpend ? "no_budget" : !underTarget ? "daily_target_met" : "disabled";
  }

  // 3 — check what has come due.
  if (plan.resolve > 0) {
    out.steps.resolve = await safe("resolve", () => resolveDue(env, { max: plan.resolve }));
    if (out.steps.resolve?.resolved > 0) {
      out.steps.leaderboard = await safe("leaderboard", async () => {
        const b = await computeLeaderboard(env);
        return { rows: b.rows.length, resolved: b.resolved };
      });
    }
  }

  // 4 — re-price open markets (free: no model calls).
  if (plan.refresh > 0) out.steps.refresh = await safe("refresh", () => refreshMarkets(env, { max: plan.refresh }));

  // 5 — give an index row back to anything that lost one. Cheap enough to run
  //     every hour, and only reported when it finds something.
  const repaired = await safe("reindex", () => repairIndex(env));
  if (repaired?.orphans) out.steps.reindex = repaired;

  // 6 — tell the crawlers that take a ping. One request for the batch, and a
  //     failure here must never mark the cycle failed: the pages are already
  //     published and in the sitemap either way.
  const fresh = out.steps.forecast?.ids || [];
  if (fresh.length) {
    const site = String(env.SITE_URL || "").replace(/\/$/, "");
    out.steps.indexnow = await safe("indexnow", () =>
      submitUrls(env, [site || null, ...fresh.map((id) => `${site}/p/${encodeURIComponent(id)}`)].filter(Boolean)));
  }

  out.ms = Date.now() - started;
  console.log(`[run] ${reason} h${hour}`, JSON.stringify(out.steps));
  return out;
}

// A run that hits the daily KV write ceiling lands a prediction record and is
// then refused the index rewrite that lists it, leaving a forecast that is paid
// for, fully answered, and read by nothing: the timeline, the API and the
// sitemap all work from the index, so no other phase would ever notice it.
//
// Costs a list and an index read — two operations against the ~50 an invocation
// has — and repairs only a few per run on purpose: the day the index breaks is
// usually the day there are no writes left to fix it with, so a backlog is
// better cleared across the following runs than attempted at once.
export async function repairIndex(env, { limit = 3 } = {}) {
  const [{ predictions }, ids] = await Promise.all([getIndex(env), listPredictionIds(env)]);
  const indexed = new Set(predictions.map((p) => p.id));
  const orphans = ids.filter((id) => !indexed.has(id));
  if (!orphans.length) return { records: ids.length, orphans: 0, added: 0, remaining: 0, total: predictions.length };

  const records = [];
  for (const id of orphans.slice(0, Math.max(1, limit))) {
    const full = await getPrediction(env, id);
    if (full) records.push(full);
  }
  return {
    records: ids.length,
    orphans: orphans.length,
    added: records.length,
    remaining: Math.max(0, orphans.length - records.length),
    total: records.length ? await writeIndex(env, records) : predictions.length,
  };
}

async function forecastBatch(env, n) {
  const questions = await takeQueue(env, n);
  if (!questions.length) return { forecast: 0, reason: "queue_empty" };

  const { predictions } = await getIndex(env);
  const ids = new Set(predictions.map((p) => p.id));

  const made = [];
  const failed = [];
  for (const q of questions) {
    try {
      made.push(await forecastAndStore(env, q, ids));
    } catch (err) {
      console.error(`[forecast] "${q.headline?.slice(0, 60)}":`, err?.message || err);
      failed.push(q);
    }
  }
  // A question that failed on a transient model error goes back in line rather
  // than being lost — but only once, marked so it drops out on a second failure.
  const retry = failed.filter((q) => !q.retried).map((q) => ({ ...q, retried: true, priority: (q.priority || 0) - 1 }));
  if (retry.length) await pushQueue(env, retry);

  if (made.length) await writeIndex(env, made);
  return { forecast: made.length, failed: failed.length, requeued: retry.length, ids: made.map((p) => p.id) };

}

async function safe(label, fn) {
  try { return await fn(); } catch (err) {
    console.error(`[run] ${label} failed:`, err?.message || err);
    return { error: String(err?.message || err).slice(0, 200) };
  }
}

const round = (n) => Math.round(n * 1e4) / 1e4;
