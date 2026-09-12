// Deciding whether something actually happened.
//
// This is the half of the project that can put a falsehood on a page as a
// fact, so it is tiered by how much the evidence is worth:
//
//   1. the exchange settled it — real money, a formal dispute window, and a
//      bond that reaches six figures. Better than anything a model can offer,
//      and it covers most of the archive because most questions come from
//      markets in the first place.
//   2. a jury of models rules on cited evidence — three labs, independently,
//      on identical evidence. Unanimous or it does not publish.
//   3. a human — everything else waits in the review queue, and every
//      published verdict can be disputed in public.
//
// The one thing never done here is publishing a verdict because a model
// sounded confident on its own.

import { chat } from "../ai/openrouter.js";
import { JOBS, PANEL } from "../ai/roster.js";
import { resolveFromExchange } from "../markets/index.js";
import {
  addSpend, appendScores, dropReview, getChecked, getIndex, getPrediction,
  markChecked, putPrediction, pushReview, writeIndex,
} from "../store/kv.js";
import { pool } from "../util.js";

// Three judges, deliberately from three different labs — two models from one
// family agreeing tells you about the family, not about the world.
const JURY = ["claude", "gpt", "gemini"];

const VERDICT_SCHEMA = {
  name: "verdict",
  shape: {
    type: "object",
    additionalProperties: false,
    required: ["status", "basis", "confidence", "summary", "sources"],
    properties: {
      status: { type: "string", enum: ["happened", "not_happened", "unclear"] },
      // Forces the judge to separate "the evidence says no" from "I found
      // nothing", which are very different grounds for the same verdict.
      basis: { type: "string", enum: ["direct_evidence", "contradicting_evidence", "absence_of_coverage", "insufficient"] },
      confidence: { type: "integer", minimum: 0, maximum: 100 },
      summary: { type: "string" },
      sources: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "url"],
          properties: { title: { type: "string" }, url: { type: "string" } },
        },
      },
    },
  },
};

const POLARITY_SCHEMA = {
  name: "polarity",
  shape: {
    type: "object",
    additionalProperties: false,
    required: ["relation", "why"],
    properties: {
      relation: { type: "string", enum: ["same", "opposite", "unrelated"] },
      why: { type: "string" },
    },
  },
};

const JUDGE = `You decide whether a prediction came true, using only the evidence given to you.
You cannot search. If the evidence does not settle it, say so.

- "happened": the evidence shows the statement is literally true as written.
- "not_happened": the evidence shows it did not occur, or that the opposite occurred.
- "unclear": thin, contradictory, or only tangentially related evidence.

Judge the statement exactly as written, including every date, number and named party.
A near miss is "not_happened", not "happened".

"basis" must say what you are actually standing on:
- "direct_evidence" — sources report the thing happening.
- "contradicting_evidence" — sources report something incompatible with it.
- "absence_of_coverage" — you found nothing either way. For a large public event
  that is weak evidence it did not happen; for a small or private one it is no
  evidence at all. Use "unclear" with low confidence unless the event is one that
  could not have gone unreported.
- "insufficient" — the evidence is off-topic or too thin to use.

Never invent a source. Every URL in "sources" must appear in the evidence above.`;

export function resolverConfig(env) {
  const n = (key, dflt) => Number(env[key] ?? dflt);
  return {
    minConfidence: n("RESOLVE_MIN_CONFIDENCE", 80),
    minSources: n("RESOLVE_MIN_SOURCES", 2),
    graceDays: n("RESOLVE_GRACE_DAYS", 1),
    // How long to keep waiting for an exchange to settle before falling back
    // to the jury. Markets often close days after their nominal end date.
    marketWaitDays: n("RESOLVE_MARKET_WAIT_DAYS", 21),
    recheckHours: n("RESOLVE_RECHECK_HOURS", 12),
    giveUpDays: n("RESOLVE_GIVE_UP_DAYS", 120),
  };
}

export function dueForResolution(index, cfg, checked = {}, now = Date.now()) {
  const deadline = now - cfg.graceDays * 86_400_000;
  const recheck = now - cfg.recheckHours * 3_600_000;
  return index
    .filter((p) => p.verdict === null || p.verdict === undefined)
    .filter((p) => {
      const ts = Date.parse(p.resolves_by);
      if (!Number.isFinite(ts) || ts > deadline) return false;
      const last = Date.parse(checked[p.id]);
      return !Number.isFinite(last) || last < recheck;
    })
    .sort((a, b) => Date.parse(a.resolves_by) - Date.parse(b.resolves_by));
}

// ── tier 1: the exchange ────────────────────────────────────
async function tryExchange(env, p, cfg) {
  const externalId = p.market?.external_id;
  if (!externalId) return null;

  const settlement = await resolveFromExchange(env, p.market.source, externalId);
  if (!settlement) return null;

  if (!settlement.settled) {
    const overdue = (Date.now() - Date.parse(p.resolves_by)) / 86_400_000;
    // Still inside the window where a market is simply slow to settle.
    return overdue < cfg.marketWaitDays ? { waiting: "market_not_settled" } : null;
  }

  // The headline was rewritten from the market question by a model, so before
  // trusting the settlement we check the two still mean the same thing. One
  // cheap call, and it removes the only way this tier can be silently wrong.
  const polarity = await checkPolarity(env, p.headline, settlement.question);
  if (polarity.relation === "unrelated") {
    return { review: { reason: "headline_drifted", settlement, polarity } };
  }

  const yes = settlement.outcome === "yes";
  const verdict = polarity.relation === "opposite" ? !yes : yes;

  if (settlement.disputed) {
    // It settled, but through a contested resolution — exactly when a person
    // should look rather than a cron job.
    return { review: { reason: "resolution_disputed", settlement, polarity, verdict } };
  }

  return {
    verdict,
    method: "exchange",
    confidence: 100,
    note: `Settled by ${settlement.source === "kalshi" ? "Kalshi" : "Polymarket"}: “${settlement.question}” resolved ${settlement.outcome.toUpperCase()}.`,
    sources: [{ title: `${settlement.source === "kalshi" ? "Kalshi" : "Polymarket"} — settled market`, url: settlement.url || p.source_url }],
    settlement,
  };
}

async function checkPolarity(env, headline, marketQuestion) {
  if (!marketQuestion) return { relation: "same", why: "no market question stored" };
  try {
    const r = await chat(env, {
      model: JOBS.reason.model,
      fallbacks: JOBS.reason.fallbacks,
      temperature: 0,
      maxTokens: 200,
      schema: POLARITY_SCHEMA,
      messages: [
        { role: "system", content: `Decide how a statement relates to answering YES on a market question.
"same" — the statement is true exactly when the market resolves YES.
"opposite" — the statement is true exactly when the market resolves NO.
"unrelated" — they are about different things, or differ in a date, threshold or party.` },
        { role: "user", content: `Statement: ${headline}\nMarket question: ${marketQuestion}` },
      ],
    });
    await addSpend(env, { cost: r.cost, calls: 1 });
    return r.json || { relation: "unrelated", why: "no answer" };
  } catch (err) {
    console.warn("[resolve] polarity check failed:", err?.message || err);
    return { relation: "unrelated", why: String(err?.message || err).slice(0, 80) };
  }
}

// ── tier 2: a jury over cited evidence ──────────────────────
async function tryJury(env, p, cfg) {
  const today = new Date().toISOString().slice(0, 10);

  const evidence = await chat(env, {
    model: JOBS.search.model,
    fallbacks: JOBS.search.fallbacks,
    temperature: 0,
    maxTokens: 900,
    messages: [
      { role: "system", content: "You are a research assistant. Report what sources say, with dates and outlet names. Never speculate and never fill gaps from memory." },
      { role: "user", content:
`Today is ${today}. Did this happen?

Statement: ${p.headline}
Deadline, now passed: ${p.resolves_by}
${p.rules ? `Resolution criteria: ${p.rules.slice(0, 600)}` : ""}

Search for reporting on the outcome. Report three things separately:
1. Evidence that it DID happen, with dates and outlets.
2. Evidence that it did NOT happen, or that something incompatible happened.
3. Whether an event like this would normally be widely reported — and if so, whether you found any coverage at all.

If you found nothing, say that plainly rather than reasoning from memory.` },
    ],
  });
  await addSpend(env, { cost: evidence.cost, calls: 1 });

  const cited = evidence.citations.map((c) => `- ${c.title}: ${c.url}`).join("\n");
  const brief = `Statement: ${p.headline}
Deadline: ${p.resolves_by}
${p.rules ? `Resolution criteria: ${p.rules.slice(0, 600)}\n` : ""}
Evidence gathered today (${today}):
${evidence.content}

Sources cited by the search:
${cited || "(none returned)"}`;

  // Each juror sees identical evidence and never sees the others' answers.
  const jurors = JURY.map((key) => PANEL.find((m) => m.key === key)).filter(Boolean);
  const votes = await pool(jurors, jurors.length, async (m) => {
    try {
      const r = await chat(env, {
        model: m.model,
        temperature: 0,
        maxTokens: 700,
        schema: VERDICT_SCHEMA,
        messages: [{ role: "system", content: JUDGE }, { role: "user", content: brief }],
      });
      return { key: m.key, cost: r.cost, ...(r.json || {}) };
    } catch (err) {
      console.warn(`[resolve] juror ${m.key}: ${err?.message || err}`);
      return { key: m.key, cost: 0, status: "unclear", basis: "insufficient", confidence: 0 };
    }
  });
  await addSpend(env, { cost: votes.reduce((a, v) => a + (v.cost || 0), 0), calls: votes.length, resolves: 1 });

  const heard = votes.filter((v) => v.status);
  const decided = heard.filter((v) => v.status === "happened" || v.status === "not_happened");
  const unanimous = decided.length === heard.length && heard.length >= 2 &&
    new Set(decided.map((v) => v.status)).size === 1;

  const sources = mergeSources(votes.flatMap((v) => v.sources || []), evidence.citations);
  const confidence = heard.length ? Math.round(heard.reduce((a, v) => a + (v.confidence || 0), 0) / heard.length) : 0;
  const status = unanimous ? decided[0].status : "unclear";

  // A "did not happen" resting only on nobody having written about it is the
  // easiest way to publish a falsehood, so it never auto-publishes.
  const onlySilence = decided.length > 0 && decided.every((v) => v.basis === "absence_of_coverage");

  const publish = unanimous && !onlySilence &&
    confidence >= cfg.minConfidence && sources.length >= cfg.minSources;

  return {
    verdict: publish ? status === "happened" : null,
    method: "jury",
    publish,
    status,
    confidence,
    unanimous,
    only_silence: onlySilence,
    votes: votes.map((v) => ({ model: v.key, status: v.status || "unclear", basis: v.basis || "insufficient", confidence: v.confidence || 0 })),
    note: (decided[0]?.summary || votes.find((v) => v.summary)?.summary || "").slice(0, 400),
    sources,
  };
}

// ── orchestration ───────────────────────────────────────────
export async function resolveOne(env, id, { cfg = null } = {}) {
  const config = cfg || resolverConfig(env);
  const p = await getPrediction(env, id);
  if (!p) return { id, skipped: "not_found" };
  if (p.verdict !== null && p.verdict !== undefined) return { id, skipped: "already_resolved" };

  const exchange = await tryExchange(env, p, config);

  if (exchange?.waiting) return { id, waiting: exchange.waiting };

  if (exchange?.review) {
    await pushReview(env, reviewItem(p, {
      status: exchange.review.verdict === undefined ? "unclear" : exchange.review.verdict ? "happened" : "not_happened",
      confidence: 100,
      method: "exchange",
      reason: exchange.review.reason,
      summary: exchange.review.reason === "resolution_disputed"
        ? `The exchange settled this, but the resolution was disputed. Market question: “${exchange.review.settlement.question}” → ${exchange.review.settlement.outcome?.toUpperCase()}.`
        : `Our headline may no longer match the market it came from (${exchange.review.polarity?.why || "unclear"}). Market question: “${exchange.review.settlement.question}”.`,
      sources: [{ title: "Original market", url: exchange.review.settlement.url || p.source_url }],
    }));
    return { id, verdict: null, method: "exchange", queued_for_review: exchange.review.reason };
  }

  if (exchange?.verdict !== undefined && exchange.verdict !== null) {
    await publishVerdict(env, p, {
      verdict: exchange.verdict,
      method: "exchange",
      confidence: 100,
      note: exchange.note,
      sources: exchange.sources,
      detail: { market_question: exchange.settlement.question, disputed: false, bond_usd: exchange.settlement.bond_usd },
    });
    return { id, verdict: exchange.verdict, method: "exchange", confidence: 100 };
  }

  // Give up on very old questions rather than paying for a jury forever.
  const overdue = (Date.now() - Date.parse(p.resolves_by)) / 86_400_000;
  if (overdue > config.giveUpDays) {
    await pushReview(env, reviewItem(p, {
      status: "unclear", confidence: 0, method: "none", reason: "stale",
      summary: `Still unresolved ${Math.round(overdue)} days after its deadline. Needs a human or should be retired.`,
      sources: [],
    }));
    return { id, verdict: null, queued_for_review: "stale" };
  }

  const jury = await tryJury(env, p, config);
  if (jury.publish) {
    await publishVerdict(env, p, {
      verdict: jury.verdict,
      method: "jury",
      confidence: jury.confidence,
      note: jury.note,
      sources: jury.sources,
      detail: { votes: jury.votes },
    });
    return { id, verdict: jury.verdict, method: "jury", confidence: jury.confidence, votes: jury.votes };
  }

  await pushReview(env, reviewItem(p, {
    status: jury.status,
    confidence: jury.confidence,
    method: "jury",
    reason: !jury.unanimous ? "jury_split" : jury.only_silence ? "absence_of_coverage" : jury.sources.length < config.minSources ? "too_few_sources" : "low_confidence",
    summary: jury.note,
    sources: jury.sources,
    votes: jury.votes,
  }));
  return { id, verdict: null, method: "jury", status: jury.status, confidence: jury.confidence, queued_for_review: true, votes: jury.votes };
}

export async function resolveDue(env, { max = 3 } = {}) {
  const cfg = resolverConfig(env);
  const [{ predictions }, checked] = await Promise.all([getIndex(env), getChecked(env)]);
  const due = dueForResolution(predictions, cfg, checked).slice(0, max);
  if (!due.length) return { checked: 0, resolved: 0, review: 0, waiting: 0 };

  const resolved = [];
  let review = 0, waiting = 0;
  for (const row of due) {
    try {
      const r = await resolveOne(env, row.id, { cfg });
      if (r.waiting) waiting++;
      else if (r.queued_for_review) review++;
      else if (typeof r.verdict === "boolean") resolved.push(r.id);
    } catch (err) {
      console.error(`[resolve] ${row.id}:`, err?.message || err);
    }
  }

  await markChecked(env, due.map((d) => d.id));

  if (resolved.length) {
    const records = [];
    for (const id of resolved) {
      const p = await getPrediction(env, id);
      if (p) records.push(p);
    }
    await writeIndex(env, records);
  }
  return { checked: due.length, resolved: resolved.length, review, waiting };
}

async function publishVerdict(env, p, { verdict, method, confidence, note, sources, detail }) {
  const next = {
    ...p,
    verdict,
    verdict_source: "resolver",
    verdict_method: method,
    verdict_at: new Date().toISOString(),
    verdict_note: String(note || "").slice(0, 400),
    verdict_confidence: confidence,
    verdict_detail: detail || null,
    sources,
  };
  await putPrediction(env, next);
  await dropReview(env, p.id);
  await appendScores(env, [scoreRow(next)]);
  return next;
}

function reviewItem(p, { status, confidence, method, reason, summary, sources, votes }) {
  return {
    id: p.id,
    headline: p.headline,
    resolves_by: p.resolves_by,
    source: p.source,
    source_url: p.source_url || null,
    status,
    confidence,
    method,
    reason,
    summary: String(summary || "").slice(0, 400),
    sources: sources || [],
    votes: votes || null,
    checked_at: new Date().toISOString(),
  };
}

// The jurors' lists are primary; search citations backfill them so a page
// always has something a reader can click.
function mergeSources(fromJudges, fromSearch) {
  const out = [];
  const seen = new Set();
  for (const s of [...(fromJudges || []), ...(fromSearch || [])]) {
    const url = String(s?.url || "").trim();
    if (!/^https?:\/\//.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: String(s.title || hostOf(url)).slice(0, 160), url });
    if (out.length >= 6) break;
  }
  return out;
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

// One compact row per resolved prediction — everything the leaderboard needs,
// so it never has to re-read the full records.
export function scoreRow(p) {
  const models = {};
  for (const [key, cell] of Object.entries(p.models || {})) {
    if (typeof cell?.prob === "number") models[key] = cell.prob;
  }
  return {
    id: p.id,
    at: p.verdict_at || new Date().toISOString(),
    resolves_by: p.resolves_by,
    topic: p.topic,
    horizon: p.horizon,
    method: p.verdict_method || p.verdict_source || "maintainer",
    outcome: p.verdict ? 1 : 0,
    consensus: typeof p.consensus_prob === "number" ? p.consensus_prob : null,
    market: p.market?.prob_at_forecast ?? p.market?.prob ?? null,
    models,
  };
}
