// POST /api/suggest — opens a GitHub issue with a community prediction
// suggestion. Requires env.GH_TOKEN with `public_repo` scope.

export async function handleSuggest(request, env) {
  if (request.method !== "POST") return text("method not allowed", 405);

  const body = await request.json().catch(() => ({}));
  const headline = (body.headline || "").trim();
  const horizon  = (body.horizon  || "").trim();
  const topic    = (body.topic    || "").trim();
  if (headline.length < 12 || headline.length > 240) return json({ error: "headline: 12–240 chars" }, 400);
  if (!horizon) return json({ error: "horizon required" }, 400);

  // Light rate limiting by CF-Connecting-IP
  const ip = request.headers.get("cf-connecting-ip") || "anon";
  const rl = `rl:suggest:${ip}`;
  const hit = await env.WH_KV.get(rl);
  if (hit) return json({ error: "rate_limited" }, 429);
  await env.WH_KV.put(rl, "1", { expirationTtl: 60 });

  if (!env.GH_TOKEN) return json({ error: "server not configured" }, 500);
  const repo = env.REPO || "dmusato/willhappen.ai";

  const title = `Suggest: ${headline.slice(0, 80)}`;
  const issueBody = [
    `**Suggested prediction**`,
    ``,
    `> ${headline}`,
    ``,
    `- Horizon: \`${horizon}\``,
    topic ? `- Topic: \`${topic}\`` : null,
    ``,
    `_Submitted anonymously via the /suggest form._`,
  ].filter(Boolean).join("\n");

  const gh = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.GH_TOKEN}`,
      "accept": "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "willhappen-ai-worker",
    },
    body: JSON.stringify({ title, body: issueBody, labels: ["suggestion", "community"] }),
  });
  if (!gh.ok) {
    const txt = await gh.text();
    return json({ error: "gh_failed", status: gh.status, detail: txt.slice(0, 300) }, 502);
  }
  const created = await gh.json();
  return json({ ok: true, issueUrl: created.html_url, number: created.number });
}

const json = (d, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
  });
const text = (t, s = 200) => new Response(t, { status: s });
