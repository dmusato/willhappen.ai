// /api/vote
//   GET  ?id=…                      → { yes, no, total }
//   POST { id, verdict, fp }        → records the vote, returns new tallies
//
// The crowd's opinion, kept deliberately separate from both the model consensus
// and the resolved verdict. One effective vote per browser per prediction.

import { json } from "./http.js";

const VALID = new Set(["yes", "no"]);
const ID_RE = /^[a-z0-9][a-z0-9-]{1,90}$/;
const YEAR = 365 * 86_400;

const tallyKey = (id) => `votes:tally:${id}`;
const userKey = (id, fp) => `votes:by:${id}:${fp}`;

export async function handleVote(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET") {
    const id = url.searchParams.get("id") || "";
    if (!ID_RE.test(id)) return json({ error: "bad_id" }, 400);
    const t = (await env.WH_KV.get(tallyKey(id), "json")) || { yes: 0, no: 0 };
    return json({ yes: t.yes || 0, no: t.no || 0, total: (t.yes || 0) + (t.no || 0) });
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const { id, verdict, fp } = (await request.json().catch(() => ({}))) || {};
  if (!ID_RE.test(String(id || ""))) return json({ error: "bad_id" }, 400);
  if (!VALID.has(verdict)) return json({ error: "bad_verdict" }, 400);
  if (typeof fp !== "string" || fp.length < 8 || fp.length > 64) return json({ error: "bad_fingerprint" }, 400);

  const [prior, stored] = await Promise.all([
    env.WH_KV.get(userKey(id, fp)),
    env.WH_KV.get(tallyKey(id), "json"),
  ]);
  const tally = { yes: stored?.yes || 0, no: stored?.no || 0 };

  if (prior === verdict) return json({ ...tally, total: tally.yes + tally.no, unchanged: true });

  // Changing your mind is allowed, but not in a loop — KV's floor TTL is 60s.
  if (prior) {
    const rl = `rl:${id}:${fp}`;
    if (await env.WH_KV.get(rl)) return json({ error: "rate_limited" }, 429);
    await env.WH_KV.put(rl, "1", { expirationTtl: 60 });
    if (VALID.has(prior)) tally[prior] = Math.max(0, tally[prior] - 1);
  }
  tally[verdict] += 1;

  await Promise.all([
    env.WH_KV.put(userKey(id, fp), verdict, { expirationTtl: YEAR }),
    env.WH_KV.put(tallyKey(id), JSON.stringify(tally)),
  ]);

  return json({ ...tally, total: tally.yes + tally.no });
}
