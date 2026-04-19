// /api/vote
//   GET  ?id=p1            → { yes, no, total }
//   POST { id, verdict, fp, prev? }  → records vote, returns new tallies
// One effective vote per fingerprint per prediction.

const VALID = new Set(["yes", "no"]);

const tallyKey = (id) => `votes:tally:${id}`;
const userKey  = (id, fp) => `votes:by:${id}:${fp}`;

export async function handleVote(request, env) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "missing id" }, 400);
    const t = (await env.WH_KV.get(tallyKey(id), "json")) || { yes: 0, no: 0 };
    return json({ ...t, total: (t.yes || 0) + (t.no || 0) });
  }

  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

  const body = await request.json().catch(() => ({}));
  const { id, verdict, fp, prev } = body || {};
  if (!id || !VALID.has(verdict) || !fp || fp.length < 6) {
    return json({ error: "bad request" }, 400);
  }

  // Rate-limit per fingerprint: at most 1 change per 2s.
  const rlKey = `rl:${fp}`;
  const rl = await env.WH_KV.get(rlKey);
  if (rl) return json({ error: "rate_limited" }, 429);
  await env.WH_KV.put(rlKey, "1", { expirationTtl: 2 });

  const prior = await env.WH_KV.get(userKey(id, fp));
  const tally = (await env.WH_KV.get(tallyKey(id), "json")) || { yes: 0, no: 0 };

  if (prior === verdict) {
    return json({ ...tally, total: tally.yes + tally.no, unchanged: true });
  }
  if (prior && VALID.has(prior)) tally[prior] = Math.max(0, (tally[prior] || 0) - 1);
  tally[verdict] = (tally[verdict] || 0) + 1;

  await Promise.all([
    env.WH_KV.put(userKey(id, fp), verdict, { expirationTtl: 60 * 60 * 24 * 365 }),
    env.WH_KV.put(tallyKey(id), JSON.stringify(tally)),
  ]);

  return json({ ...tally, total: tally.yes + tally.no });
}

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
