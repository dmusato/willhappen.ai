// Resolve — the half of the project that makes the other half mean anything.
//
// Two stages on purpose. A search-grounded model gathers evidence and cites
// it; a separate model reads only that evidence and rules. Asking one model to
// both search and judge lets it talk itself into a verdict, and these verdicts
// publish themselves.

import { chat } from "../ai/openrouter.js";
import { JOBS } from "../ai/roster.js";
import { addSpend, appendScores, dropReview, getIndex, getPrediction, putPrediction, pushReview, writeIndex } from "../store/kv.js";

const VERDICT_SCHEMA = {
  name: "verdict",
  shape: {
    type: "object",
    additionalProperties: false,
    required: ["status", "confidence", "summary", "sources"],
    properties: {
      status: { type: "string", enum: ["happened", "not_happened", "unclear"] },
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

const JUDGE = `You decide whether a prediction came true, using only the evidence given to you.

- "happened": the evidence shows the statement is literally true as written.
- "not_happened": the deadline passed and the evidence shows it did not occur, or
  the evidence shows the opposite occurred.
- "unclear": the evidence is thin, contradictory, or only tangentially related.

Rules:
- Judge the statement as written, including every date, number and named party.
  A near miss is "not_happened", not "happened".
- "confidence" is how sure you are given THIS evidence. Absence of coverage for a
  big public event is weak evidence it did not happen; absence of coverage for a
  small one tells you nothing — say "unclear" and keep confidence low.
- "sources" must be URLs that actually appear in the evidence. Never invent one.
- "summary" is one sentence a reader can check against those sources.`;

export function resolverConfig(env) {
  return {
    minConfidence: Number(env.RESOLVE_MIN_CONFIDENCE ?? 80),
    minSources: Number(env.RESOLVE_MIN_SOURCES ?? 2),
    // A prediction is only worth checking once its deadline is actually behind us.
    graceDays: Number(env.RESOLVE_GRACE_DAYS ?? 1),
  };
}

export function dueForResolution(index, { graceDays }) {
  const cutoff = Date.now() - graceDays * 86_400_000;
  return index
    .filter((p) => p.verdict === null || p.verdict === undefined)
    .filter((p) => {
      const ts = Date.parse(p.resolves_by);
      return Number.isFinite(ts) && ts <= cutoff;
    })
    .sort((a, b) => Date.parse(a.resolves_by) - Date.parse(b.resolves_by));
}

export async function resolveOne(env, id) {
  const p = await getPrediction(env, id);
  if (!p) return { id, skipped: "not_found" };
  if (p.verdict !== null && p.verdict !== undefined) return { id, skipped: "already_resolved" };

  const cfg = resolverConfig(env);
  const today = new Date().toISOString().slice(0, 10);

  // Stage 1 — evidence.
  const evidence = await chat(env, {
    model: JOBS.search.model,
    fallbacks: JOBS.search.fallbacks,
    temperature: 0,
    maxTokens: 800,
    messages: [
      { role: "system", content: "You are a research assistant. Report what sources say, with dates and outlet names. Never speculate and never fill gaps from memory." },
      { role: "user", content:
`Today is ${today}. Did this happen?

Statement: ${p.headline}
Deadline that has now passed: ${p.resolves_by}
${p.rules ? `Resolution criteria: ${p.rules.slice(0, 600)}` : ""}

Search for reporting on the outcome. State what the sources say, when they said it, and whether they confirm, contradict, or do not address the statement. If you find nothing, say so plainly.` },
    ],
  });
  await addSpend(env, { cost: evidence.cost, calls: 1 });

  // Stage 2 — judgement over that evidence alone.
  const cited = evidence.citations.map((c) => `- ${c.title}: ${c.url}`).join("\n");
  const judged = await chat(env, {
    model: JOBS.reason.model,
    fallbacks: JOBS.reason.fallbacks,
    temperature: 0,
    maxTokens: 700,
    schema: VERDICT_SCHEMA,
    messages: [
      { role: "system", content: JUDGE },
      { role: "user", content:
`Statement: ${p.headline}
Deadline: ${p.resolves_by}
${p.rules ? `Resolution criteria: ${p.rules.slice(0, 600)}\n` : ""}
Evidence gathered today (${today}):
${evidence.content}

Sources cited by the search:
${cited || "(none returned)"}` },
    ],
  });
  await addSpend(env, { cost: judged.cost, calls: 1, resolves: 1 });

  const v = judged.json || {};
  const sources = mergeSources(v.sources, evidence.citations);
  const confidence = Number(v.confidence) || 0;
  const decided = v.status === "happened" || v.status === "not_happened";
  const publish = decided && confidence >= cfg.minConfidence && sources.length >= cfg.minSources;

  if (!publish) {
    await pushReview(env, {
      id: p.id,
      headline: p.headline,
      resolves_by: p.resolves_by,
      status: v.status || "unclear",
      confidence,
      summary: String(v.summary || "").slice(0, 400),
      sources,
      checked_at: new Date().toISOString(),
    });
    return { id, verdict: null, status: v.status || "unclear", confidence, queued_for_review: true };
  }

  const next = {
    ...p,
    verdict: v.status === "happened",
    verdict_source: "resolver",
    verdict_at: new Date().toISOString(),
    verdict_note: String(v.summary || "").slice(0, 400),
    verdict_confidence: confidence,
    sources,
  };
  await putPrediction(env, next);
  await dropReview(env, p.id);
  await appendScores(env, [scoreRow(next)]);
  return { id, verdict: next.verdict, confidence, sources: sources.length };
}

export async function resolveDue(env, { max = 3 } = {}) {
  const cfg = resolverConfig(env);
  const { predictions } = await getIndex(env);
  const due = dueForResolution(predictions, cfg).slice(0, max);
  if (!due.length) return { checked: 0, resolved: 0, review: 0 };

  const resolved = [];
  let review = 0;
  for (const row of due) {
    try {
      const r = await resolveOne(env, row.id);
      if (r.queued_for_review) review++;
      else if (typeof r.verdict === "boolean") resolved.push(r.id);
    } catch (err) {
      console.error(`[resolve] ${row.id}:`, err?.message || err);
    }
  }

  if (resolved.length) {
    const records = [];
    for (const id of resolved) {
      const p = await getPrediction(env, id);
      if (p) records.push(p);
    }
    await writeIndex(env, records);
  }
  return { checked: due.length, resolved: resolved.length, review };
}

// The judge's list is the primary one; search citations backfill it so a page
// always has something a reader can click.
function mergeSources(fromJudge, fromSearch) {
  const out = [];
  const seen = new Set();
  for (const s of [...(fromJudge || []), ...(fromSearch || [])]) {
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
    outcome: p.verdict ? 1 : 0,
    consensus: typeof p.consensus_prob === "number" ? p.consensus_prob : null,
    market: p.market?.prob_at_forecast ?? p.market?.prob ?? null,
    models,
  };
}
