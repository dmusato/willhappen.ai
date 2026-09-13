// /sitemap.xml — every prediction page plus the static routes. This site is a
// search-distributed archive, so the sitemap is load-bearing, not decoration.

import { getIndex } from "../store/kv.js";
import { escapeHtml } from "../util.js";

const STATIC = [
  { path: "/", priority: "1.0", freq: "hourly" },
  { path: "/timeline", priority: "0.9", freq: "hourly" },
  { path: "/models", priority: "0.8", freq: "daily" },
  { path: "/topics", priority: "0.8", freq: "daily" },
  { path: "/about", priority: "0.4", freq: "monthly" },
  { path: "/suggest", priority: "0.3", freq: "monthly" },
];

export async function handleSitemap(request, env) {
  const site = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const { predictions } = await getIndex(env);

  // Google caps a sitemap at 50k URLs; newest first keeps fresh pages inside it.
  const rows = predictions.slice(0, 45_000);
  const body = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...STATIC.map((s) => url(`${site}${s.path}`, null, s.freq, s.priority)),
    ...rows.map((p) => url(`${site}/p/${encodeURIComponent(p.id)}`, lastmod(p), p.verdict === null ? "weekly" : "monthly", "0.7")),
    `</urlset>`,
  ].join("\n");

  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=1800, s-maxage=3600" },
  });
}

const url = (loc, mod, freq, priority) =>
  `  <url><loc>${escapeHtml(loc)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ""}<changefreq>${freq}</changefreq><priority>${priority}</priority></url>`;

const lastmod = (p) => String(p.verdict_at || p.question_generated_at || p.created_at || "").slice(0, 10) || null;
