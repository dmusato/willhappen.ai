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
import { checkPolarity } from "../ai/polarity.js";
import { discoverQuestions } from "../discover/suggest.js";
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
- NEVER flip the polarity. If the source asks whether something will NOT happen, or will
  fail, stay, remain or stop, the statement must keep that negative. "Will OpenAI not IPO
  by December 2026?" becomes "OpenAI does not complete an IPO by December 2026" — never
  "OpenAI completes an IPO". The market price is attached to the source question, so an
  inverted headline silently publishes the opposite price as the crowd's view.
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

  // Deliberately no price. The curator writes `context`, and `context` is read
  // back to the panel at forecast time — so a curator that mentions the market
  // sits at 79% hands the panel the number the whole scoreboard exists to
  // compare it against. The curator needs the wording, the deadline and the
  // rules to do its job; it never needs the price.
  const items = fresh.map((m, i) =>
    `${i}. ${m.question}\n   deadline: ${String(m.endDate).slice(0, 10)} · ${m.source}` +
    (m.rules ? `\n   resolves: ${m.rules.slice(0, 400)}` : ""));

  const curated = await curate(env, items, `Source: prediction markets. Today is ${new Date().toISOString().slice(0, 10)}.`);

  // The price belongs to the exchange's wording, not ours. A rewrite that reads
  // better can mean the opposite, and then every number on the page derived from
  // that price — the edge, the market line, the scoreboard's whole comparison —
  // is inverted. One cheap call per market question, and a flip is corrected
  // rather than dropped: the crowd's view of our statement is simply 100 minus
  // their view of theirs.
  const queued = [];
  let polarityCost = 0;
  for (const c of curated) {
    const m = fresh[c.ref];
    if (!m) continue;

    const pol = await checkPolarity(env, c.headline, m.question);
    polarityCost += pol.cost || 0;
    if (pol.relation === "unrelated") {
      console.warn(`[harvest] dropped, headline drifted from market: "${c.headline}" vs "${m.question}" (${pol.why})`);
      continue;
    }
    const flipped = pol.relation === "opposite";
    const marketProb = flipped ? 100 - m.prob : m.prob;
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
        prob: marketProb,
        // Recorded so the re-pricer and the resolver keep applying the flip.
        inverted: flipped,
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

  if (polarityCost) await addSpend(env, { cost: polarityCost, calls: curated.length });

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

// ── the questions people actually search for ────────────────
// Markets say what money is betting on and the news says what just happened.
// Neither covers "when will humans land on the moon again" — a question asked
// hundreds of thousands of times a month that no exchange will ever list.
//
// A search like that cannot be forecast as written: it has no date, so it can
// never resolve and no model can be scored on it. But it decomposes cleanly —
// "before 2030", "before 2035", "before 2040" — and the set of rungs is the
// answer to "when", drawn as a curve. The catalog has had 5y, 10y and 50y
// horizons waiting for exactly this.
export async function harvestSearches(env, { want = 6 } = {}) {
  const t = TOPICS[await nextCursor(env, "searchtopic", TOPICS.length)];
  const asked = await discoverQuestions(env, t.seeds || [t.name.toLowerCase()]);
  if (!asked.length) return { added: 0, topic: t.id, asked: 0, source: "searches" };

  // Autocomplete is stable: the same popular queries come back on every sweep.
  // Matching on the raw query — before curation, not after — means we neither
  // pay to rewrite a question we already hold nor risk a second rewrite of it
  // landing under different wording. This is what `fingerprint` on the stored
  // record is for, and it is the same trick the market path uses.
  const known = await knownFingerprints(env);
  const fresh = asked
    .map((q) => ({ q, fp: fingerprint(normalizeQuestion(q)) }))
    .filter(({ q, fp }) => !known.has(fp) && !known.has(fingerprint(q)));
  if (!fresh.length) return { added: 0, topic: t.id, asked: asked.length, seen_before: asked.length, source: "searches" };

  // Autocomplete returns its most-searched completion first, so the order is
  // the demand ranking and the head of the list is where the good pages are.
  const batch = fresh.slice(0, 24);
  const curated = await curate(
    env,
    batch.map(({ q }, i) => `${i}. ${q}`),
    `Source: real search queries about ${t.name}, taken from what people type into a search engine.
Today is ${new Date().toISOString().slice(0, 10)}.

These are open-ended — "when will X" has no deadline and cannot resolve. Turn each into a
dated statement by choosing the nearest threshold a well-informed reader would actually
argue about: not so close that it is obviously false, not so far that nobody cares.
"when will humans land on the moon again" becomes "Humans land on the Moon again before
2031", not "before 2100". Keep the subject the searcher asked about — that is the whole
value of the question.

The list is ordered by how often each is searched, most first. Work from the top: item 0
is the page most people are looking for. Extract up to ${want} and keep the same "ref" as
the item you took each from, so the ranking is not lost. Prefer the topic ${t.id}.`,
  );

  const queued = [];
  for (const c of curated) {
    const src = batch[c.ref];
    if (!src) continue;
    const headFp = fingerprint(normalizeQuestion(c.headline));
    if (known.has(headFp)) continue;
    known.add(headFp);
    known.add(src.fp);
    queued.push({
      // The raw search, not the rewrite: it is the stable identity across
      // sweeps, and the wording we publish can change between them.
      fingerprint: src.fp,
      searched: src.q,
      headline: c.headline,
      context: c.context,
      topic: c.topic,
      horizon: c.horizon,
      resolves_by: null,
      source: "search",
      source_url: null,
      rules: null,
      market: null,
      // Ranked by how often the question is searched, since that order is what
      // autocomplete hands back. Above the news sweep, because an evergreen
      // page people are already looking for outlives a week's headline; still
      // below the market questions, which carry a crowd price to compare
      // against and are the only ones that can ever be settled by an exchange.
      priority: 9 - Math.min(5, c.ref),
      queued_at: new Date().toISOString(),
    });
  }

  const added = await pushQueue(env, queued);
  return { added, topic: t.id, asked: questions.length, source: "searches" };
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
  const add = (headline) => {
    if (!headline) return;
    set.add(fingerprint(headline));
    // The exact hash only catches a verbatim repeat. Normalising first — years,
    // plurals and filler stripped — is what makes "Humans land on the Moon
    // before 2031" collide with "Humans return to the Moon by 2031", which is
    // the shape a rewrite of the same search actually takes.
    set.add(fingerprint(normalizeQuestion(headline)));
  };
  for (const p of idx.predictions) {
    if (p.fp) set.add(p.fp);
    if (p.market_id) set.add(p.market_id);
    add(p.headline);
  }
  for (const q of queue) {
    if (q.fingerprint) set.add(q.fingerprint);
    if (q.external_id) set.add(q.external_id);
    add(q.headline);
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

