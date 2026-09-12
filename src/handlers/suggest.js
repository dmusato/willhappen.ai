// POST /api/suggest — a community question becomes a public GitHub issue.
// Needs GH_TOKEN with `public_repo`. Without it the endpoint says so rather
// than pretending to have accepted the submission.

import { HORIZON_IDS, TOPIC_IDS } from "../catalog.js";
import { json } from "./http.js";

export async function handleSuggest(request, env) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const body = (await request.json().catch(() => ({}))) || {};
  const headline = String(body.headline || "").trim().replace(/\s+/g, " ");
  const horizon = String(body.horizon || "").trim();
  const topic = String(body.topic || "").trim();

  if (headline.length < 12 || headline.length > 240) return json({ error: "headline must be 12–240 characters" }, 400);
  if (!HORIZON_IDS.includes(horizon)) return json({ error: "unknown horizon" }, 400);
  if (topic && !TOPIC_IDS.includes(topic)) return json({ error: "unknown topic" }, 400);

  const ip = request.headers.get("cf-connecting-ip") || "anon";
  const rl = `rl:suggest:${ip}`;
  if (await env.WH_KV.get(rl)) return json({ error: "rate_limited", retry_after: 60 }, 429);
  await env.WH_KV.put(rl, "1", { expirationTtl: 60 });

  if (!env.GH_TOKEN) return json({ error: "suggestions_not_configured" }, 503);
  const repo = env.REPO || "dmusato/willhappen.ai";

  const issue = {
    title: `Suggest: ${headline.slice(0, 90)}`,
    body: [
      "**Suggested question**", "", `> ${headline}`, "",
      `- Horizon: \`${horizon}\``,
      topic ? `- Topic: \`${topic}\`` : null,
      "",
      "_Submitted anonymously through the /suggest form. A maintainer promotes good ones into the forecast queue._",
    ].filter(Boolean).join("\n"),
    labels: ["suggestion", "community"],
  };

  const gh = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GH_TOKEN}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "willhappen-ai-worker",
    },
    body: JSON.stringify(issue),
  });

  if (!gh.ok) {
    console.error("[suggest] github", gh.status, (await gh.text()).slice(0, 200));
    return json({ error: "github_rejected", status: gh.status }, 502);
  }
  const created = await gh.json();
  return json({ ok: true, issueUrl: created.html_url, number: created.number });
}
