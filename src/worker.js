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
import { handleIndexNowKey } from "./handlers/indexnow.js";
import { handleApiCatalog, handleArd, handleLlmsTxt } from "./handlers/agents.js";
import { handleMcp, handleMcpCard } from "./handlers/mcp.js";
import { aboutMarkdown, listMarkdown, predictionMarkdown, termsMarkdown } from "./render/markdown.js";
import { configureShell } from "./render/shell.js";
import { getIndex, readIndex, writeIndexDoc } from "./store/kv.js";
import { getLeaderboard } from "./pipeline/score.js";
import { runCycle } from "./pipeline/run.js";
import { runSocial } from "./social/index.js";
import { filterRows, SORTS } from "./handlers/predictions.js";
import {
  aboutPage, homePage, modelsPage, notFoundPage, predictionPage,
  suggestPage, termsPage, timelinePage, topicPage, topicsPage,
} from "./render/pages.js";
import { topic as topicOf } from "./catalog.js";

const PAGE_CACHE = "public, max-age=120, s-maxage=900, stale-while-revalidate=86400";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    configureShell(env);

    if (request.method === "OPTIONS") return preflight();

    try {
      const canonical = canonicalRedirect(url, env);
      if (canonical) return canonical;

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
      const inKey = handleIndexNowKey(env, path);
      if (inKey) return inKey;

      // Crawlers ask for /favicon.ico by name whether or not the page links an
      // icon, and this was answering every one of them with the HTML 404 page.
      if (path === "/favicon.ico") return Response.redirect(`${siteUrl(env, url)}/assets/favicon.svg`, 301);

      // The workers.dev preview answers everything the real domain does, so it
      // is a second crawlable copy of the whole archive. Worth keeping — it is
      // how a deploy gets looked at — but the canonical tag on those pages only
      // asks a crawler not to index them, after it has already spent the budget
      // fetching them. Matched on the hostname rather than on "is not
      // SITE_URL", so a fork whose SITE_URL still says willhappen.ai shuts out
      // nothing but its own preview.
      if (path === "/robots.txt" && url.hostname.toLowerCase().endsWith(".workers.dev")) {
        return new Response("User-agent: *\nDisallow: /\n", {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
        });
      }

      // ── machine-readable descriptions ─────────────────
      if (path === "/mcp")                     return await handleMcp(request, env, siteUrl(env, url));
      if (path === "/.well-known/mcp/server-card.json" || path === "/.well-known/mcp.json")
        return handleMcpCard(siteUrl(env, url));
      if (path === "/llms.txt")                return await handleLlmsTxt(env, siteUrl(env, url));
      if (path === "/.well-known/api-catalog") return handleApiCatalog(siteUrl(env, url));
      if (path === "/.well-known/ai-catalog.json") return handleArd(siteUrl(env, url));

      // Markdown of any page, by suffix or by Accept header. Agents that can
      // set headers get the negotiated version; everything else adds .md.
      // HEAD too, for the same reason the page renderer below takes it: a
      // .md URL that answers GET with 200 and HEAD with 404 is one surface
      // disagreeing with itself.
      if (request.method === "GET" || request.method === "HEAD") {
        const wantsMd = path.endsWith(".md") ||
          /\btext\/markdown\b/.test(request.headers.get("accept") || "");
        if (wantsMd) {
          const md = await renderMarkdown(path.replace(/\.md$/, "") || "/", url, env, request);
          if (md) return md;
        }
      }

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
        const key = cacheable ? cacheKey(request, url, env) : null;
        if (key) {
          const hit = await cache.match(key);
          if (hit) return hit;
        }

        const page = await renderPage(path, url, env, request);
        if (page) {
          if (key && page.status === 200) ctx.waitUntil(cache.put(key, page.clone()));
          return page;
        }
      }
    } catch (err) {
      console.error(`[fetch] ${path}:`, err?.stack || err);
      if (path.startsWith("/api/")) return json({ error: "internal_error" }, 500);
      return html(notFoundPage({ site: siteUrl(env, url) }), 500);
    }

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
    const [stored, board] = await Promise.all([readIndex(env), getLeaderboard(env)]);
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

  if (path.startsWith("/topics/")) {
    const t = topicOf(decodeURIComponent(path.slice(8).split("/")[0]));
    if (!t) return html(notFoundPage({ site }), 404);
    const { predictions } = await getIndex(env);
    const list = predictions.filter((p) => p.topic === t.id).sort(SORTS.new);
    if (!list.length) return html(notFoundPage({ site }), 404);
    return html(topicPage({ site, t, list: list.slice(0, 60), total: list.length }));
  }

  if (path === "/models") return html(modelsPage({ site, board: await getLeaderboard(env) }));
  if (path === "/about")  return html(aboutPage({ site }));
  if (path === "/terms")  return html(termsPage({ site }));
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

// Stamping the deployed version into the key means yesterday's markup is never
// served by today's Worker: a deploy starts a fresh keyspace, and the old
// entries simply age out unread.
function cacheKey(request, url, env) {
  const keyed = new URL(url);
  keyed.searchParams.set("__v", env.CF_VERSION?.id || "dev");
  return new Request(keyed, request);
}

// The one hostname this site is. Empty when SITE_URL is missing, unparseable,
// or on http — in which case nothing below fires, because sending http traffic
// to an http origin is a loop rather than a fix.
export function canonicalHost(env) {
  try {
    const u = new URL(String(env.SITE_URL || ""));
    return u.protocol === "https:" ? u.hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

// Every page answers on exactly one URL. Without this it also answers on
// http://, on www. and on both at once — four crawlable copies of all 357
// pages on a site whose entire distribution is search, and four entries in a
// crawl budget that a new domain does not have to spend. SITE_URL already
// names the one that counts.
//
// Only the canonical host and its www. sibling are redirected. A host we do
// not recognise — localhost under `npm run dev`, the workers.dev preview — is
// left alone, because a blind redirect to SITE_URL would make local
// development impossible.
export function canonicalRedirect(url, env) {
  const target = canonicalHost(env);
  if (!target) return null;

  const host = url.hostname.toLowerCase();
  if (host !== target && host !== `www.${target}`) return null;

  // A Worker on a custom domain is handed the scheme the client actually used,
  // so url.protocol is the whole test. Deliberately not cf-visitor: that header
  // would also fire on a request whose URL already reads https, making the
  // redirect target identical to the request and a loop possible if the header
  // were ever wrong. As written the target always differs from the request, so
  // following it lands on the branch above and stops.
  if (host === target && url.protocol !== "http:") return null;

  const to = new URL(url);
  to.protocol = "https:";
  to.hostname = target;
  to.port = "";
  return Response.redirect(to.toString(), 301);
}

// Markdown for the routes that carry content. About and terms are prose that
// already reads fine as HTML; the archive and the forecasts are the pages an
// agent is actually after.
async function renderMarkdown(path, url, env, request) {
  const site = siteUrl(env, url);
  const md = (body) => new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": PAGE_CACHE,
      "x-content-type-options": "nosniff",
      // Every one of these is the same content as an HTML page that is already
      // in the sitemap, so indexing both would put the archive in twice and
      // leave a search engine to guess which copy is the real one. Agents are
      // unaffected: noindex governs indexing, not fetching. follow keeps the
      // links inside them worth something.
      "x-robots-tag": "noindex, follow",
    },
  });

  if (path.startsWith("/p/")) {
    const id = decodeURIComponent(path.slice(3).split("/")[0]);
    const p = await loadPrediction(env, request, id);
    return p ? md(predictionMarkdown(p, site)) : null;
  }

  // llms.txt points agents at both, so both have to exist. Derived from the
  // pages rather than written again — see proseMarkdown.
  if (path === "/about") return md(aboutMarkdown(site));
  if (path === "/terms") return md(termsMarkdown(site));

  if (path === "/timeline" || path === "/") {
    const { predictions } = await getIndex(env);
    const query = parseQuery(url);
    const rows = filterRows(predictions, query).sort(SORTS[query.sort] || SORTS.new);
    return md(listMarkdown(rows.slice(0, 200), {
      site,
      title: "WillHappen.ai — every forecast",
      intro: `${rows.length} dated, falsifiable statements. Each was put to six frontier models independently; consensus is the median. No model is shown the market price.`,
    }));
  }

  if (path.startsWith("/topics/")) {
    const t = topicOf(decodeURIComponent(path.slice(8).split("/")[0]));
    if (!t) return null;
    const { predictions } = await getIndex(env);
    const rows = predictions.filter((p) => p.topic === t.id).sort(SORTS.new);
    if (!rows.length) return null;
    return md(listMarkdown(rows, { site, title: `${t.name} — forecasts`, intro: t.hint }));
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
    await writeIndexDoc(env, doc);
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
      // How an agent finds the rest without guessing. Relative references are
      // valid in a Link header and resolve against the request, which saves
      // threading the site URL through every caller of this helper.
      link: '</llms.txt>; rel="describedby"; type="text/plain", ' +
            '</sitemap.xml>; rel="sitemap"; type="application/xml", ' +
            '</.well-known/api-catalog>; rel="api-catalog"',
      ...SECURITY_HEADERS,
    },
  });
