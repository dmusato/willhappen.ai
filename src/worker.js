// WillHappen.ai — single Cloudflare Worker
//   • serves static assets (public/)
//   • exposes /api/* endpoints
//   • runs nightly generation via scheduled()
//
// All state lives in KV; no GitHub commits. `data/predictions.json` in the
// repo is only a seed used the very first time the Worker is hit.

import { handleVote } from "./handlers/vote.js";
import { handleSuggest } from "./handlers/suggest.js";
import { handlePredictions } from "./handlers/predictions.js";
import { handleOg } from "./handlers/og.js";
import { runGeneration } from "./generate/generate.js";
import { runSocialPosting } from "./social/index.js";

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extra,
    },
  });

const corsPreflight = () =>
  new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    if (request.method === "OPTIONS") return corsPreflight();

    try {
      if (p === "/api/predictions")          return await handlePredictions(request, env, ctx);
      if (p === "/api/vote")                 return await handleVote(request, env, ctx);
      if (p === "/api/suggest")              return await handleSuggest(request, env, ctx);
      if (p.startsWith("/og/"))              return await handleOg(request, env, ctx);
      if (p === "/api/health")               return json({ ok: true, time: new Date().toISOString() });
      if (p === "/api/admin/run")            return await handleAdminRun(request, env, ctx);
    } catch (err) {
      console.error("handler error", err);
      return json({ error: String(err?.message || err) }, 500);
    }

    // Intercept the seed file so the same URL can be upgraded to live KV data
    // without changing the client.
    if (p === "/data/predictions.json") {
      const live = await env.WH_KV.get("predictions:all", "json");
      if (live) return json(live);
      // fall through to static asset (the committed seed)
    }

    // pre-rendered per-prediction page with OG tags
    if (p.startsWith("/p/") && !p.endsWith(".html")) {
      const id = p.slice(3).split("/")[0];
      return await renderPredictionPage(id, env, request);
    }

    // static asset fallback
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      await runGeneration(env, { cron: event.cron });
      await runSocialPosting(env);
    })());
  },
};

// POST /api/admin/run  { generate?: true, social?: true }
// Manual trigger for testing — requires `authorization: Bearer <ADMIN_TOKEN>`.
async function handleAdminRun(request, env) {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const auth = request.headers.get("authorization") || "";
  if (!env.ADMIN_TOKEN || auth !== `Bearer ${env.ADMIN_TOKEN}`) {
    return json({ error: "unauthorized" }, 401);
  }
  const body = await request.json().catch(() => ({}));
  const out = {};
  if (body.generate) { await runGeneration(env, { cron: "manual" }); out.generate = "done"; }
  if (body.social)   { out.social = (await runSocialPosting(env)) || "nothing to post"; }
  if (!body.generate && !body.social) out.hint = 'send {"generate":true} and/or {"social":true}';
  return json(out);
}

async function renderPredictionPage(id, env, request) {
  const all = (await env.WH_KV.get("predictions:all", "json")) ??
              (await (await env.ASSETS.fetch(new URL("/data/predictions.json", request.url))).json());
  const p = (all?.predictions || []).find((x) => x.id === id);

  const title = p ? `${p.headline} — WillHappen.ai` : "Prediction — WillHappen.ai";
  const desc  = p
    ? `${p.consensus_prob}% say it'll happen. Six AI models agree.`
    : "Consensus forecasts from six frontier AI models.";
  const ogUrl = `https://willhappen.ai/og/${id}`;
  const canon = `https://willhappen.ai/p/${id}`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="canonical" href="${canon}">
  <meta name="description" content="${escapeHtml(desc)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(desc)}">
  <meta property="og:image" content="${ogUrl}">
  <meta property="og:url" content="${canon}">
  <meta property="og:type" content="article">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${ogUrl}">
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=JetBrains+Mono:wght@400&display=swap">
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <nav class="nav">
    <a class="logo" href="/"><span class="dot"></span>will<i>happen</i><small>.ai</small></a>
    <div class="nav-links">
      <a href="/timeline">Timeline</a>
      <a href="/suggest">Suggest</a>
      <a class="nav-pill" href="https://github.com/dmusato/willhappen.ai">GitHub ↗</a>
    </div>
  </nav>
  <main>
    <section id="detail" class="detail-wrap"></section>
  </main>
  <footer class="foot">
    <div>Open source · <a href="https://github.com/dmusato/willhappen.ai">github.com/dmusato/willhappen.ai</a></div>
    <div>Six frontier AI models · <a href="/timeline">Timeline</a> · <a href="/suggest">Suggest</a></div>
  </footer>
  <script src="/assets/app.js"></script>
  <script>
    WH.renderDetail(${JSON.stringify(id)});
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=120, s-maxage=600, stale-while-revalidate=86400",
    },
  });
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
