// GET /api/predictions         → compact index (sorted, newest first)
// GET /api/predictions/{id}    → one full prediction record
//
// Live state lives per-record in KV (`prediction:{id}`) with a separate
// `predictions:index` for fast listing. The static files in
// public/data/index.json + public/data/predictions/*.json act as a seed
// loaded on first read.

export async function handlePredictions(request, env) {
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });

  const url = new URL(request.url);
  const trail = url.pathname.replace(/^\/api\/predictions\/?/, "");

  if (!trail) return serveIndex(request, env);
  return serveOne(request, env, trail);
}

async function serveIndex(request, env) {
  let data = await env.WH_KV.get("predictions:index", "json");
  if (!data) {
    const seed = await env.ASSETS.fetch(new URL("/data/index.json", request.url));
    if (!seed.ok) return j({ error: "no_index" }, 500);
    data = await seed.json();
    await env.WH_KV.put("predictions:index", JSON.stringify(data));
  }
  return j(data, 200, { "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" });
}

async function serveOne(request, env, id) {
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) return j({ error: "bad_id" }, 400);

  let data = await env.WH_KV.get(`prediction:${id}`, "json");
  if (!data) {
    const seed = await env.ASSETS.fetch(new URL(`/data/predictions/${id}.json`, request.url));
    if (!seed.ok) return j({ error: "not_found" }, 404);
    data = await seed.json();
    await env.WH_KV.put(`prediction:${id}`, JSON.stringify(data));
  }
  return j(data, 200, { "cache-control": "public, max-age=120, s-maxage=600, stale-while-revalidate=86400" });
}

// Shared helper for other handlers that need a single prediction.
export async function loadPrediction(env, request, id) {
  if (!/^[a-z0-9_-]{2,32}$/.test(id)) return null;
  let data = await env.WH_KV.get(`prediction:${id}`, "json");
  if (data) return data;
  const seed = await env.ASSETS.fetch(new URL(`/data/predictions/${id}.json`, request.url));
  if (!seed.ok) return null;
  data = await seed.json();
  await env.WH_KV.put(`prediction:${id}`, JSON.stringify(data));
  return data;
}

const j = (d, s = 200, extra = {}) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      ...extra,
    },
  });
