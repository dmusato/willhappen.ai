// WillHappen.ai — the whole project, one Cloudflare Worker.
//
//   fetch()      server-rendered pages, the JSON API, share cards, feeds
//   scheduled()  hourly: harvest → forecast → resolve → re-price → post
//
// KV is the source of truth. The JSON under public/data/ is a seed, loaded the
// first time the Worker is asked for something KV does not have — which is why
// a fresh clone of this repo serves a populated site on its first request.

import { handlePredictions, loadPrediction } from "./handlers/predictions.js";
import { handleVote } from "./handlers/vote.js";
import { handleSuggest } from "./handlers/suggest.js";
import { handleOg, handleDefaultOg } from "./handlers/og.js";
import { handleCatalog, handleLeaderboard } from "./handlers/meta.js";
import { handleSitemap } from "./handlers/sitemap.js";
import { handleFeed } from "./handlers/feed.js";
import { handleAdmin } from "./handlers/admin.js";
import { json, preflight } from "./handlers/http.js";
import { getIndex, INDEX_KEY } from "./store/kv.js";
import { getLeaderboard } from "./pipeline/score.js";
import { runCycle } from "./pipeline/run.js";
import { runSocial } from "./social/index.js";
import { filterRows, SORTS } from "./handlers/predictions.js";
import {
  aboutPage, homePage, modelsPage, notFoundPage, predictionPage,
  suggestPage, timelinePage, topicsPage,
} from "./render/pages.js";

const PAGE_CACHE = "public, max-age=120, s-maxage=900, stale-while-revalidate=86400";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return preflight();

    try {
      // ── API ───────────────────────────────────────────
      if (path.startsWith("/api/")) {
        if (path === "/api/predictions" || path.startsWith("/api/predictions/")) return await handlePredictions(request, env);
        if (path === "/api/vote")        return await handleVote(request, env);
        if (path === "/api/suggest")     return await handleSuggest(request, env);
        if (path === "/api/catalog")     return handleCatalog();
        if (path === "/api/leaderboard") return await handleLeaderboard(request, env);
        if (path === "/api/health")      return json({ ok: true, time: new Date().toISOString() });
        if (path.startsWith("/api/admin")) return await handleAdmin(request, env, ctx);
        return json({ error: "unknown_endpoint" }, 404);
      }

      // ── machine-readable ──────────────────────────────
      if (path === "/sitemap.xml")  return await handleSitemap(request, env);
      if (path === "/feed.xml" || path === "/rss.xml") return await handleFeed(request, env);
      if (path === "/og-default.png" || path === "/og-default.svg") return await handleDefaultOg(request, env, ctx);
      if (path.startsWith("/og/"))  return await handleOg(request, env, ctx);

      // ── pages ─────────────────────────────────────────
      if (request.method === "GET" || request.method === "HEAD") {
        // Cloudflare does not cache what a Worker returns unless the Worker
        // puts it there, so until now the cache-control on these pages only
        // ever reached the browser and every cold visit paid for a read of the
        // whole index plus a full render. The share-card handler already works
        // this way; pages are the hotter path. The cache key is the request URL,
        // so /timeline?topic=ai is cached apart from /timeline, and the stored
        // response expires on its own s-maxage.
        const cacheable = request.method === "GET";
        const cache = caches.default;
        if (cacheable) {
          const hit = await cache.match(request);
          if (hit) return hit;
        }

        const page = await renderPage(path, url, env, request);
        if (page) {
          if (cacheable && page.status === 200) ctx.waitUntil(cache.put(request, page.clone()));
          return page;
        }
      }
    } catch (err) {
      console.error(`[fetch] ${path}:`, err?.stack || err);
      if (path.startsWith("/api/")) return json({ error: "internal_error" }, 500);
      return html(notFoundPage({ site: siteUrl(env, url) }), 500);
    }

    // Static assets (CSS, JS, seed JSON, favicon, robots.txt).
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;
    return html(notFoundPage({ site: siteUrl(env, url) }), 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      const hour = new Date(event.scheduledTime || Date.now()).getUTCHours();
      const cycle = await runCycle(env, { reason: event.cron || "cron", hour });
      const social = await runSocial(env, { max: cycle.plan.social }).catch((err) => ({ error: String(err?.message || err) }));
      console.log("[scheduled]", JSON.stringify({ hour, steps: cycle.steps, social }));
    })());
  },
};

async function renderPage(path, url, env, request) {
  const site = siteUrl(env, url);

  if (path === "/") {
    // Seed only when the key is genuinely absent. Keying off an empty array
    // would re-write KV on every home page view of a site with no forecasts yet.
    const [stored, board] = await Promise.all([env.WH_KV.get(INDEX_KEY, "json"), getLeaderboard(env)]);
    const index = stored || (await seedFromAssets(env, request)) || { generated_at: null, predictions: [] };
    return html(homePage({ site, index, board }));
  }

  if (path === "/timeline") {
    const index = await getIndex(env);
    const query = parseQuery(url);
    const filtered = filterRows(index.predictions, query);
    filtered.sort(SORTS[query.sort] || SORTS.new);
    return html(timelinePage({
      site, index, query, total: filtered.length,
      list: filtered.slice(query.offset, query.offset + query.limit),
    }));
  }

  if (path === "/topics") return html(topicsPage({ site, index: await getIndex(env) }));
  if (path === "/models") return html(modelsPage({ site, board: await getLeaderboard(env) }));
  if (path === "/about")  return html(aboutPage({ site }));
  if (path === "/suggest") return html(suggestPage({ site, prefill: url.searchParams.get("q") || "" }));

  if (path.startsWith("/p/")) {
    const id = decodeURIComponent(path.slice(3).split("/")[0]);
    const p = await loadPrediction(env, request, id);
    if (!p) return html(notFoundPage({ site }), 404);
    const { predictions } = await getIndex(env);
    const related = predictions
      .filter((r) => r.id !== p.id && r.topic === p.topic)
      .sort((a, b) => String(b.question_generated_at).localeCompare(String(a.question_generated_at)))
      .slice(0, 4);
    return html(predictionPage({ site, p, related }), 200, PAGE_CACHE);
  }

  return null;
}

function parseQuery(url) {
  const q = url.searchParams;
  const raw = new URLSearchParams(q);
  raw.delete("offset");
  return {
    q: (q.get("q") || "").slice(0, 120),
    topic: q.get("topic") || "",
    horizon: q.get("horizon") || "",
    status: q.get("status") || "",
    source: q.get("source") || "",
    sort: SORTS[q.get("sort")] ? q.get("sort") : "new",
    search: (q.get("q") || "").slice(0, 120),
    hasMarket: q.get("market") === "1",
    limit: Math.min(100, Math.max(10, Number(q.get("limit")) || 40)),
    offset: Math.max(0, Number(q.get("offset")) || 0),
    raw: Object.fromEntries(raw),
  };
}

// First boot: pull the repo's seed index into KV. Ships empty by default —
// a self-hosted instance fills it from its own first run rather than inheriting
// someone else's forecasts.
async function seedFromAssets(env, request) {
  try {
    const res = await env.ASSETS.fetch(new URL("/data/index.json", request.url));
    if (!res.ok) return null;
    const doc = await res.json();
    await env.WH_KV.put(INDEX_KEY, JSON.stringify(doc));
    return doc;
  } catch (err) {
    console.warn("[seed] failed:", err?.message || err);
    return null;
  }
}

const siteUrl = (env, url) => String(env.SITE_URL || url.origin).replace(/\/$/, "");

// public/_headers only reaches what the ASSETS binding serves, and every page
// here is rendered by the Worker instead — so the /* block in that file was
// never actually covering the HTML. These mirror it, and the two should be
// changed together.
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), interest-cohort=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
};

const html = (body, status = 200, cache = PAGE_CACHE) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": status === 200 ? cache : "no-store",
      ...SECURITY_HEADERS,
    },
  });
