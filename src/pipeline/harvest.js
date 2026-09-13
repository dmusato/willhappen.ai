// Harvest — where tomorrow's questions come from.
//
// Two sources, deliberately different in character:
//   markets  prediction exchanges (Polymarket, Kalshi). Already falsifiable,
//            already have written resolution criteria, and carry a price that
//            real money agreed on — the number we grade the models against.
//   news     a search-grounded sweep of one news beat per run, for the
//            questions nobody has opened a market on yet.
//
// Both land in the same queue as {headline, topic, horizon, ...} and are
// forecast by the same panel.

import { chat } from "../ai/openrouter.js";
import { JOBS } from "../ai/roster.js";
import { BEATS, HORIZONS, HORIZON_IDS, TOPICS, TOPIC_IDS, horizon } from "../catalog.js";
import { collectMarkets } from "../markets/index.js";
import { addSpend, getIndex, getQueue, nextCursor, pushQueue } from "../store/kv.js";
import { fingerprint, normalizeQuestion } from "../util.js";

const CURATE_SCHEMA = {
  name: "harvest",
  shape: {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ref", "headline", "topic", "horizon", "context", "keep"],
          properties: {
            ref: { type: "integer" },
            keep: { type: "boolean" },
            headline: { type: "string" },
            topic: { type: "string", enum: TOPIC_IDS },
            horizon: { type: "string", enum: HORIZON_IDS },
            context: { type: "string" },
          },
        },
      },
    },
  },
};

const CURATOR = `You turn raw prediction-market questions and news items into clean, falsifiable
statements for a public forecasting archive.

For each numbered item return an object with the same "ref".

Rules:
- "headline" is ONE declarative sentence stating the thing that would happen, not a question.
  Good: "The Fed cuts rates at its October 2026 meeting."
  Bad:  "Will the Fed cut rates?" / "Fed rate decision"
- Keep any date, threshold or named party from the original. Never invent specifics.
- "context" is 1-2 sentences a reader needs: why this is live right now, and what
  exactly would count as it happening. Plain language, no hype, under 320 characters.
- "topic" must be the closest fit from the allowed list.
- "horizon" is the bucket closest to the item's stated deadline. Never pick one that
  ends before the deadline.
- Set "keep": false for anything unfalsifiable, a joke, a duplicate of another item in
  this batch, a pure sports score, or about a private individual who is not a public figure.`;

// ── markets ─────────────────────────────────────────────────
export async function harvestMarkets(env, { want = 12 } = {}) {
  const markets = await collectMarkets(env, { perSource: 80 });
  if (!markets.length) return { added: 0, considered: 0, source: "markets" };

  const known = await knownFingerprints(env);
  const fresh = [];
  for (const m of markets) {
    const fp = fingerprint(m.question);
    if (known.has(fp) || known.has(m.externalId)) continue;
    known.add(fp);
    known.add(m.externalId);
    fresh.push({ ...m, fingerprint: fp });
    if (fresh.length >= want) break;
  }
  if (!fresh.length) return { added: 0, considered: markets.length, source: "markets" };

  const items = fresh.map((m, i) =>
    `${i}. ${m.question}\n   deadline: ${String(m.endDate).slice(0, 10)} · market price: ${m.prob}% · ${m.source}` +
    (m.rules ? `\n   resolves: ${m.rules.slice(0, 400)}` : ""));

  const curated = await curate(env, items, `Source: prediction markets. Today is ${new Date().toISOString().slice(0, 10)}.`);

  const queued = [];
  for (const c of curated) {
    const m = fresh[c.ref];
    if (!m) continue;
    // Two exchanges list the same event under different wording, so the
    // rewritten headline needs its own dedupe pass — the source-question
    // fingerprints were different by construction.
    const headFp = fingerprint(c.headline);
    if (known.has(headFp)) continue;
    known.add(headFp);
    queued.push({
      fingerprint: m.fingerprint,
      headline: c.headline,
      context: c.context,
      topic: c.topic,
      horizon: horizonForDate(m.endDate, c.horizon),
      resolves_by: String(m.endDate).slice(0, 10),
      source: m.source,
      source_url: m.url,
      external_id: m.externalId,
      rules: m.rules || null,
      market: {
        source: m.source,
        external_id: m.externalId,
        question: m.question,
        prob: m.prob,
        url: m.url,
        volume_usd: m.volumeUsd,
        liquidity_usd: m.liquidityUsd,
        change_1w: m.change1w,
        change_1m: m.change1m,
        checked_at: new Date().toISOString(),
      },
      priority: 10 + Math.min(5, Math.floor(m.liquidityUsd / 200_000)),
      queued_at: new Date().toISOString(),
    });
  }

  const added = await pushQueue(env, queued);
  return { added, considered: markets.length, source: "markets" };
}

// ── news ────────────────────────────────────────────────────
export async function harvestNews(env, { want = 6 } = {}) {
  const beat = BEATS[await nextCursor(env, "beat", BEATS.length)];
  const day = new Date().toISOString().slice(0, 10);

  const brief = await chat(env, {
    model: JOBS.search.model,
    fallbacks: JOBS.search.fallbacks,
    temperature: 0.3,
    maxTokens: 900,
    webSearch: 0,
    messages: [
      { role: "system", content: "You are a wire-service desk editor. Report only what sources say. No speculation, no framing." },
      { role: "user", content:
`Today is ${day}. Summarise the ${want + 4} biggest unresolved developments in ${beat.query} from the past week.

For each: one line on what happened, and one line on the specific open question it leaves — something that will be settled by a verifiable event on a known date. Include the date or deadline whenever one exists.` },
    ],
  });
  await addSpend(env, { cost: brief.cost, calls: 1, harvests: 1 });

  const curated = await curate(
    env,
    [`0. ${brief.content.slice(0, 4000)}`],
    `Source: a news briefing on ${beat.query}. Today is ${day}. Extract up to ${want} separate questions from it; number your "ref" values 0,1,2,… in the order you extract them, ignoring the item numbering above. Prefer topics from: ${beat.topics.join(", ")}.`,
  );

  const known = await knownFingerprints(env);
  const queued = [];
  for (const c of curated) {
    const fp = fingerprint(c.headline);
    if (known.has(fp)) continue;
    known.add(fp);
    queued.push({
      fingerprint: fp,
      headline: c.headline,
      context: c.context,
      topic: c.topic,
      horizon: c.horizon,
      resolves_by: null,
      source: "news",
      source_url: null,
      rules: null,
      market: null,
      priority: 5,
      queued_at: new Date().toISOString(),
    });
  }

  const added = await pushQueue(env, queued);
  return { added, beat: beat.id, source: "news" };
}

// ── shared ──────────────────────────────────────────────────
async function curate(env, items, preamble) {
  const r = await chat(env, {
    model: JOBS.reason.model,
    fallbacks: JOBS.reason.fallbacks,
    temperature: 0.2,
    maxTokens: 2400,
    schema: CURATE_SCHEMA,
    messages: [
      { role: "system", content: CURATOR },
      { role: "user", content: `${preamble}\n\n${items.join("\n\n")}` },
    ],
  });
  await addSpend(env, { cost: r.cost, calls: 1 });

  const rows = r.json?.questions || [];
  const seen = new Set();
  return rows.filter((q) => {
    if (!q?.keep || !q.headline) return false;
    if (!TOPIC_IDS.includes(q.topic) || !HORIZON_IDS.includes(q.horizon)) return false;
    const head = q.headline.trim();
    if (head.length < 16 || head.length > 220 || head.endsWith("?")) return false;
    const norm = normalizeQuestion(head);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  }).map((q) => ({ ...q, headline: q.headline.trim(), context: String(q.context || "").trim().slice(0, 320) }));
}

// The published archive plus whatever is already queued. Both are single KV
// reads, which is why dedupe lives here and not in a per-question lookup.
//
// Three keys go into the set, because a question changes shape as it moves
// through the pipeline: the fingerprint of the source question (stored on the
// record), the fingerprint of the curated headline, and — for markets — the
// exchange's own id. Missing any one of them re-publishes the same question.
async function knownFingerprints(env) {
  const [idx, queue] = await Promise.all([getIndex(env), getQueue(env)]);
  const set = new Set();
  for (const p of idx.predictions) {
    if (p.fp) set.add(p.fp);
    if (p.market_id) set.add(p.market_id);
    set.add(fingerprint(p.headline));
  }
  for (const q of queue) {
    if (q.fingerprint) set.add(q.fingerprint);
    if (q.external_id) set.add(q.external_id);
    if (q.headline) set.add(fingerprint(q.headline));
  }
  return set;
}

// A market's real deadline beats whatever bucket the model guessed: pick the
// smallest horizon that still reaches the deadline.
function horizonForDate(endDate, fallback) {
  const ts = Date.parse(endDate);
  if (!Number.isFinite(ts)) return fallback;
  const days = (ts - Date.now()) / 86_400_000;
  const fit = HORIZONS.find((h) => h.days >= days);
  return (fit || HORIZONS[HORIZONS.length - 1]).id;
}

export const _internals = { horizonForDate, curate, TOPICS, horizon };
