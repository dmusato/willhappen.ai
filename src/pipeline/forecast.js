// Forecast — put one question to the whole panel and assemble the record.
//
// The models are never shown the market price. If they were, the edge we
// publish would just measure how well they can read a number off a prompt,
// and the leaderboard would be worthless.

import { chat, ModelError } from "../ai/openrouter.js";
import { PANEL } from "../ai/roster.js";
import { resolvesBy } from "../catalog.js";
import { addSpend, putPrediction } from "../store/kv.js";
import { clampInt, clip, fingerprint, median, pool, slugify, todayISO } from "../util.js";

const FORECAST_SCHEMA = {
  name: "forecast",
  shape: {
    type: "object",
    additionalProperties: false,
    // "because" is asked for in the prompt but not required here: a lab that
    // chokes on an array in a strict schema should still give us its take
    // rather than failing the whole answer.
    required: ["prob", "take"],
    properties: {
      prob: { type: "integer", minimum: 0, maximum: 100 },
      take: { type: "string" },
      because: { type: "array", items: { type: "string" } },
    },
  },
};

const SYSTEM = `You are a calibrated forecaster. You are given a statement about the future and the
date by which it resolves.

Return the probability (0-100) that the statement will be literally true by that date.

- Start from base rates. How often has something like this happened in a comparable window?
- Weigh only what actually moves the odds: who has to act, how long that takes, what
  would have to break.
- Do not round to comfortable numbers. 63 is a better answer than 65 when you mean 63.
- Do not hedge toward 50. If a thing is unlikely, say 8.
Your reasoning comes in two parts, and neither may restate the question or repeat the
number you already gave.

- "take" — one sentence, under 140 characters: the single thing this turns on.
- "because" — two or three points, each one sentence under 130 characters. Between
  them cover who has to act and by when, what has to clear first, the base rate and
  why this case sits above or below it, and the one development that would most
  change your mind.

Name specifics — dates, bodies, thresholds, precedents. "Many factors" and "remains
uncertain" say nothing and cost a reader their time. A reader should finish understanding
why you landed here rather than ten points either side.`;

async function forecastQuestion(env, q, { existingIds = new Set() } = {}) {
  const now = new Date();
  const resolves = q.resolves_by || resolvesBy(q.horizon, now);

  const user = [
    `Statement: ${q.headline}`,
    q.context ? `Context: ${q.context}` : null,
    `Resolves by: ${resolves}`,
    `Today: ${now.toISOString().slice(0, 10)}`,
    q.rules ? `Resolution criteria: ${q.rules.slice(0, 700)}` : null,
  ].filter(Boolean).join("\n");

  const messages = [{ role: "system", content: SYSTEM }, { role: "user", content: user }];

  const results = await pool(PANEL, PANEL.length, async (m) => {
    const started = Date.now();
    try {
      const r = await chat(env, {
        model: m.model,
        messages,
        temperature: 0.2,
        // Room for real reasoning. At 220 the ceiling alone would have kept
        // the answer to a sentence however the prompt was worded.
        maxTokens: 500,
        schema: FORECAST_SCHEMA,
        // The panel runs in parallel, so this is the wait for the slowest lab,
        // not the sum. 40s cut off models whose thinking cannot be switched
        // off entirely — we paid for those answers and then discarded them.
        timeoutMs: 60_000,
      });
      const prob = clampInt(r.json?.prob, 0, 100);
      if (prob === null) {
        // Which failure this was matters and the record used to say neither: a
        // reply that was not JSON at all is a different problem from one that
        // parsed without a number in it. Carry a scrap of what came back, or
        // the next one is just as opaque as the last.
        throw new ModelError(
          r.json
            ? `no probability in ${JSON.stringify(r.json).slice(0, 90)}`
            : `reply was not JSON: ${String(r.content || "").trim().slice(0, 90)}`,
          { model: m.model });
      }
      return {
        key: m.key,
        cost: r.cost,
        cell: {
          model: m.model,
          prob,
          take: clip(r.json?.take, 180),
          because: (Array.isArray(r.json?.because) ? r.json.because : [])
            .slice(0, 3).map((s) => clip(s, 170)).filter(Boolean),
          queried_at: new Date().toISOString(),
          ms: Date.now() - started,
        },
      };
    } catch (err) {
      console.warn(`[forecast] ${m.key}: ${err?.message || err}`);
      return {
        key: m.key,
        cost: 0,
        cell: { model: m.model, prob: null, take: null, because: [], error: String(err?.message || err).slice(0, 120), queried_at: new Date().toISOString(), ms: Date.now() - started },
      };
    }
  });

  const models = Object.fromEntries(results.map((r) => [r.key, r.cell]));
  const probs = results.map((r) => r.cell.prob).filter((p) => typeof p === "number");
  const spent = results.reduce((a, r) => a + r.cost, 0);

  // Three answers is the floor: below that a single outlier is the consensus.
  // Whatever did answer was still billed, so the ledger has to hear about it
  // before we give up — the daily cap is measured against real spend, and a
  // question that keeps half-failing gets requeued and charged again.
  if (probs.length < 3) {
    await addSpend(env, { cost: spent, calls: results.length });
    throw new Error(`only ${probs.length}/${PANEL.length} models answered`);
  }

  await addSpend(env, { cost: spent, calls: results.length, forecasts: 1 });

  const consensus = Math.round(median(probs));
  const spread = Math.max(...probs) - Math.min(...probs);
  const marketProb = q.market?.prob ?? null;

  const fp = q.fingerprint || fingerprint(q.headline);
  return {
    id: uniqueId(q.headline, fp, existingIds),
    v: 2,
    // Persisted so the harvester can recognise this question again even after
    // the curator rephrased it — the raw source question is what was hashed.
    fingerprint: fp,
    headline: q.headline,
    context: q.context || null,
    topic: q.topic,
    horizon: q.horizon,
    source: q.source || "news",
    source_url: q.source_url || null,
    rules: q.rules || null,
    created_at: todayISO(),
    resolves_by: resolves,
    question_generated_by: q.source === "news" ? "news-sweep" : q.source,
    question_generated_at: new Date().toISOString(),
    consensus_prob: consensus,
    spread,
    answered: probs.length,
    models,
    market: q.market ? { ...q.market, external_id: q.external_id || q.market.external_id || null } : null,
    // Positive edge: the panel is more bullish than the money.
    edge: marketProb === null ? null : consensus - marketProb,
    verdict: null,
    verdict_source: null,
    verdict_at: null,
    verdict_note: null,
    verdict_confidence: null,
    sources: [],
  };
}

export async function forecastAndStore(env, q, existingIds) {
  const record = await forecastQuestion(env, q, { existingIds });
  await putPrediction(env, record);
  return record;
}

// Slug ids: the URL is the headline, which matters more than tidiness for a
// site whose whole distribution is search and social.
function uniqueId(headline, fp, existing = new Set()) {
  const base = slugify(headline, 64);
  const suffix = (fp || fingerprint(headline)).slice(0, 4);
  let id = `${base}-${suffix}`;
  let n = 2;
  while (existing.has(id)) id = `${base}-${suffix}${n++}`;
  existing.add(id);
  return id;
}

