// Nightly generator. Picks a handful of (topic, horizon) slots that haven't
// been refreshed recently, drafts a crisp question via Claude, then asks all
// six models for a probability + one-line rationale. Writes result to KV.

import { MODELS, QUESTION_DRAFTER, callModel } from "./providers.js";
import { TOPICS, HORIZONS } from "./topics.js";

const BATCH_PER_RUN = 3;       // keep nightly cost bounded
const STALE_DAYS = 7;          // refresh predictions older than this

export async function runGeneration(env, { cron } = {}) {
  console.log(`[gen] starting ${cron || "manual"} run at ${new Date().toISOString()}`);

  const archive = (await env.WH_KV.get("predictions:all", "json")) || { predictions: [] };
  const existing = archive.predictions || [];

  const candidates = pickSlots(existing, BATCH_PER_RUN);
  console.log(`[gen] slots:`, candidates.map((s) => `${s.topic.id}/${s.horizon.id}`).join(", "));

  const newEntries = [];
  for (const slot of candidates) {
    try {
      const entry = await generateOne(env, slot);
      newEntries.push(entry);
    } catch (err) {
      console.error(`[gen] failed ${slot.topic}/${slot.horizon}:`, err?.message || err);
    }
  }

  if (!newEntries.length) {
    console.log("[gen] nothing new this run");
    return;
  }

  const merged = mergeArchive(existing, newEntries);
  await env.WH_KV.put("predictions:all", JSON.stringify({
    generated_at: new Date().toISOString(),
    predictions: merged,
  }));
  console.log(`[gen] wrote ${newEntries.length} new / ${merged.length} total`);
}

function pickSlots(existing, n) {
  const now = Date.now();
  const staleMs = STALE_DAYS * 86400_000;
  const recent = new Set(existing
    .filter((p) => p.question_generated_at && (now - new Date(p.question_generated_at).getTime()) < staleMs)
    .map((p) => `${p.topic}|${p.horizon}`));

  const all = [];
  for (const t of TOPICS) for (const h of HORIZONS) {
    if (!recent.has(`${t.id}|${h.id}`)) all.push({ topic: t, horizon: h });
  }
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, n);
}

async function generateOne(env, { topic, horizon }) {
  const draftPrompt = [
    { role: "system", content: "You draft crisp yes/no prediction questions about the future. One short declarative sentence. No hedging. No explanation. Just the prediction sentence." },
    { role: "user", content: `Topic: ${topic.title} (${topic.hint}). Horizon: by ${horizon.label} from today. Write one concrete, falsifiable prediction about the near future in this topic and horizon.` },
  ];
  const drafted = await callModel(env, QUESTION_DRAFTER, draftPrompt, { temperature: 0.9, maxTokens: 120 });
  const headline = cleanHeadline(drafted.content);

  const resolvesBy = new Date(Date.now() + horizon.days * 86400_000).toISOString().slice(0, 10);
  const evalPrompt = (model) => [
    { role: "system", content: `You are ${model.key}. Estimate the probability (0-100) that the following prediction will be true by ${resolvesBy}. Respond with JSON only: {"prob": <int 0-100>, "note": "<≤14 words>"}.` },
    { role: "user", content: headline },
  ];

  const perModel = {};
  const now = new Date().toISOString();

  await Promise.all(MODELS.map(async (m) => {
    try {
      const r = await callModel(env, m, evalPrompt(m), { temperature: 0.3, maxTokens: 80, responseJson: true });
      const parsed = safeJson(r.content) || {};
      const prob = clampInt(parsed.prob, 0, 100, 50);
      const note = String(parsed.note || "").slice(0, 140);
      perModel[m.key] = { provider: `${m.provider}/${m.model}`, prob, note, queried_at: now };
    } catch (err) {
      console.warn(`[gen] ${m.key} failed:`, err?.message || err);
      perModel[m.key] = { provider: `${m.provider}/${m.model}`, prob: null, note: `error: ${String(err?.message || err).slice(0, 60)}`, queried_at: now };
    }
  }));

  const probs = Object.values(perModel).map((v) => v.prob).filter((v) => typeof v === "number");
  const consensus = probs.length ? median(probs) : 50;

  return {
    id: newId(),
    source: "auto",
    question_generated_by: `${QUESTION_DRAFTER.provider}/${QUESTION_DRAFTER.model}`,
    question_generated_at: now,
    topic: topic.id,
    horizon: horizon.id,
    created_at: now.slice(0, 10),
    resolves_by: resolvesBy,
    headline,
    consensus_prob: Math.round(consensus),
    models: perModel,
    verdict: null,
    verdict_source: null,
    verdict_note: null,
  };
}

function mergeArchive(existing, fresh) {
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const n of fresh) {
    let id = n.id;
    let i = 1;
    while (byId.has(id)) { id = `${n.id}-${i++}`; }
    n.id = id;
    byId.set(id, n);
  }
  return [...byId.values()].sort((a, b) => (b.question_generated_at || "").localeCompare(a.question_generated_at || ""));
}

function newId() {
  const ts = Date.now().toString(36).slice(-6);
  const rnd = Math.random().toString(36).slice(2, 6);
  return `a${ts}${rnd}`;
}

function cleanHeadline(s) {
  return String(s || "")
    .trim()
    .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 240) || "A notable event occurs.";
}

function safeJson(s) {
  try { return JSON.parse(s); } catch {}
  const m = String(s).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return null;
}

function clampInt(v, lo, hi, fallback) {
  const n = Number.parseInt(v, 10);
  if (Number.isFinite(n)) return Math.max(lo, Math.min(hi, n));
  return fallback;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
