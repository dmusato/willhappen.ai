// /feed.xml — RSS. Cheap to serve, and the readers that still carry a feed are
// exactly the audience for an archive like this.

import { getIndex } from "../store/kv.js";
import { escapeHtml } from "../util.js";

export async function handleFeed(request, env) {
  const site = (env.SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const { predictions, generated_at } = await getIndex(env);
  const items = predictions.slice(0, 60);

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>WillHappen.ai — six AI models forecast the news</title>
  <link>${escapeHtml(site)}</link>
  <description>Consensus forecasts from six frontier AI models, priced against prediction markets and checked against sources.</description>
  <language>en</language>
  <lastBuildDate>${rfc822(generated_at || Date.now())}</lastBuildDate>
  <atom:link href="${escapeHtml(site)}/feed.xml" rel="self" type="application/rss+xml"/>
${items.map((p) => `  <item>
    <title>${escapeHtml(title(p))}</title>
    <link>${escapeHtml(`${site}/p/${p.id}`)}</link>
    <guid isPermaLink="true">${escapeHtml(`${site}/p/${p.id}`)}</guid>
    <pubDate>${rfc822(p.verdict_at || p.question_generated_at || p.created_at)}</pubDate>
    <description>${escapeHtml(describe(p))}</description>
  </item>`).join("\n")}
</channel>
</rss>`;

  return new Response(body, {
    headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900, s-maxage=1800" },
  });
}

function title(p) {
  if (p.verdict === true) return `✓ ${p.headline}`;
  if (p.verdict === false) return `✗ ${p.headline}`;
  return `${p.consensus_prob}% — ${p.headline}`;
}

function describe(p) {
  if (p.verdict === true) return `It happened. The panel had it at ${p.consensus_prob}%.`;
  if (p.verdict === false) return `It didn't happen. The panel had it at ${p.consensus_prob}%.`;
  const market = typeof p.market_prob === "number" ? ` The market says ${p.market_prob}%.` : "";
  return `Six frontier AI models put this at ${p.consensus_prob}% by ${p.resolves_by}.${market}`;
}

function rfc822(v) {
  const d = new Date(v);
  return (Number.isNaN(+d) ? new Date() : d).toUTCString();
}
