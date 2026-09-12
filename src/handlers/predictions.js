// GET /api/predictions            filtered + sorted listing
// GET /api/predictions/{id}       one full record
//
// Live state lives per-record in KV with a compact `predictions:index` for
// listing. The files under public/data/ are the seed the Worker loads the
// first time it is asked for something KV does not have yet — which is what
// makes a fresh clone of this repo show a populated site immediately.

import { getIndex, INDEX_KEY } from "../store/kv.js";
import { json } from "./http.js";

const ID_RE = /^[a-z0-9][a-z0-9-]{1,90}$/;
const MAX_LIMIT = 200;

export const SORTS = {
  new:       (a, b) => cmp(b.question_generated_at || b.created_at, a.question_generated_at || a.created_at),
  soon:      (a, b) => cmp(a.resolves_by, b.resolves_by),
  far:       (a, b) => cmp(b.resolves_by, a.resolves_by),
  contested: (a, b) => (b.spread ?? -1) - (a.spread ?? -1),
  edge:      (a, b) => Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0),
  confident: (a, b) => Math.abs((b.consensus_prob ?? 50) - 50) - Math.abs((a.consensus_prob ?? 50) - 50),
  likely:    (a, b) => (b.consensus_prob ?? 0) - (a.consensus_prob ?? 0),
  unlikely:  (a, b) => (a.consensus_prob ?? 100) - (b.consensus_prob ?? 100),
};

export async function handlePredictions(request, env) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(request.url);
  const id = url.pathname.replace(/^\/api\/predictions\/?/, "");
  return id ? serveOne(request, env, decodeURIComponent(id)) : serveIndex(request, env, url);
}

async function serveIndex(request, env, url) {
  let doc = await env.WH_KV.get(INDEX_KEY, "json");
  if (!doc) {
    doc = await seedIndex(request, env);
    if (!doc) return json({ error: "no_index" }, 503);
  }

  const q = url.searchParams;
  const rows = filterRows(doc.predictions || [], {
    topic: q.get("topic"),
    horizon: q.get("horizon"),
    status: q.get("status"),
    source: q.get("source"),
    search: q.get("q"),
    hasMarket: q.get("market") === "1",
  });

  const sortKey = SORTS[q.get("sort")] ? q.get("sort") : "new";
  rows.sort(SORTS[sortKey]);

  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.get("limit")) || 60));
  const offset = Math.max(0, Number(q.get("offset")) || 0);

  return json({
    generated_at: doc.generated_at,
    total: rows.length,
    offset,
    limit,
    sort: sortKey,
    predictions: rows.slice(offset, offset + limit),
  }, 200, { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" });
}

export function filterRows(rows, { topic, horizon, status, source, search, hasMarket }) {
  const needle = String(search || "").trim().toLowerCase();
  return rows.filter((p) => {
    if (topic && p.topic !== topic) return false;
    if (horizon && p.horizon !== horizon) return false;
    if (source && p.source !== source) return false;
    if (hasMarket && (p.market_prob === null || p.market_prob === undefined)) return false;
    if (status === "open" && p.verdict !== null && p.verdict !== undefined) return false;
    if (status === "resolved" && (p.verdict === null || p.verdict === undefined)) return false;
    if (status === "happened" && p.verdict !== true) return false;
    if (status === "missed" && p.verdict !== false) return false;
    if (needle && !String(p.headline || "").toLowerCase().includes(needle)) return false;
    return true;
  });
}

async function serveOne(request, env, id) {
  if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
  const data = await loadPrediction(env, request, id);
  if (!data) return json({ error: "not_found" }, 404);
  return json(data, 200, { "cache-control": "public, max-age=120, s-maxage=600, stale-while-revalidate=86400" });
}

// Shared by /p/{id}, the OG card and the social poster.
export async function loadPrediction(env, request, id) {
  if (!ID_RE.test(id)) return null;
  const live = await env.WH_KV.get(`prediction:${id}`, "json");
  if (live) return live;

  const seed = await env.ASSETS.fetch(new URL(`/data/predictions/${encodeURIComponent(id)}.json`, request.url));
  if (!seed.ok) return null;
  const data = await seed.json();
  await env.WH_KV.put(`prediction:${id}`, JSON.stringify(data));
  return data;
}

async function seedIndex(request, env) {
  const seed = await env.ASSETS.fetch(new URL("/data/index.json", request.url));
  if (!seed.ok) return null;
  const doc = await seed.json();
  await env.WH_KV.put(INDEX_KEY, JSON.stringify(doc));
  return doc;
}

export { getIndex };
const cmp = (a, b) => String(a || "").localeCompare(String(b || ""));
