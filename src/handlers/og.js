// Share cards. GET /og/{id}.png (default), .svg, and ?v=square for the 1:1
// crop Instagram and Pinterest want.
//
// The SVG is drawn with real <tspan> lines rather than a <foreignObject>,
// because the rasterizer that turns it into a PNG — like most SVG renderers —
// ignores foreignObject entirely, and a share card with no headline on it is
// worse than no share card.

import { loadPrediction } from "./predictions.js";
import { PANEL } from "../ai/roster.js";
import { topic as topicOf, horizon as horizonOf } from "../catalog.js";
import { escapeHtml } from "../util.js";

const RASTERIZER = "https://wsrv.nl/";

export async function handleOg(request, env, ctx) {
  const url = new URL(request.url);
  const raw = decodeURIComponent(url.pathname.replace(/^\/og\//, ""));
  const wantSvg = raw.endsWith(".svg");
  const id = raw.replace(/\.(png|svg|jpg|jpeg)$/i, "");
  const square = url.searchParams.get("v") === "square";

  const p = await loadPrediction(env, request, id);
  if (!p) return new Response("not found", { status: 404 });

  const svg = card(p, { square });
  if (wantSvg) {
    return new Response(svg, {
      headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": CACHE },
    });
  }

  // Scrapers on X, Facebook, LinkedIn, Slack and Discord will not render SVG,
  // so the default extension is a real PNG. We rasterize through wsrv.nl and
  // fall back to the SVG if it is unreachable — a degraded card beats a 502.
  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const svgUrl = `${env.SITE_URL || url.origin}/og/${encodeURIComponent(id)}.svg${square ? "?v=square" : ""}`;
  const size = square ? "w=1080&h=1080" : "w=1200&h=630";
  try {
    const png = await fetch(`${RASTERIZER}?url=${encodeURIComponent(svgUrl)}&${size}&output=png&n=-1`, {
      cf: { cacheTtl: 86_400, cacheEverything: true },
    });
    if (png.ok && (png.headers.get("content-type") || "").includes("image")) {
      const out = new Response(png.body, {
        headers: { "content-type": "image/png", "cache-control": CACHE },
      });
      ctx?.waitUntil?.(cache.put(request, out.clone()));
      return out;
    }
  } catch (err) {
    console.warn("[og] rasterize failed:", err?.message || err);
  }
  return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}

// The card used for the site itself: the same furniture, a standing claim
// instead of a forecast.
export async function handleDefaultOg(request, env, ctx) {
  const url = new URL(request.url);
  const wantSvg = url.pathname.endsWith(".svg");
  const svg = card({
    headline: "Six frontier AI models forecast the news. Then we check who was right.",
    topic: "ai", horizon: "1y", resolves_by: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    consensus_prob: 50, verdict: null, models: {}, market: null,
  }, { square: url.searchParams.get("v") === "square" });

  if (wantSvg) return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": CACHE } });

  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const png = await fetch(`${RASTERIZER}?url=${encodeURIComponent(`${env.SITE_URL || url.origin}/og-default.svg`)}&w=1200&h=630&output=png&n=-1`, {
      cf: { cacheTtl: 604_800, cacheEverything: true },
    });
    if (png.ok && (png.headers.get("content-type") || "").includes("image")) {
      const out = new Response(png.body, { headers: { "content-type": "image/png", "cache-control": CACHE } });
      ctx?.waitUntil?.(cache.put(request, out.clone()));
      return out;
    }
  } catch { /* fall through to SVG */ }
  return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}

const CACHE = "public, max-age=3600, s-maxage=604800, stale-while-revalidate=604800";

// ── the card ────────────────────────────────────────────────
function card(p, { square }) {
  const W = square ? 1080 : 1200;
  const H = square ? 1080 : 630;
  const pad = square ? 80 : 64;
  const prob = clamp(p.consensus_prob);
  const t = topicOf(p.topic);
  const h = horizonOf(p.horizon);
  const by = fmtMonth(p.resolves_by);
  const resolved = p.verdict === true || p.verdict === false;

  const headSize = square ? 52 : 44;
  const headLines = wrap(p.headline || "", square ? 30 : 34, 3);
  const numSize = square ? 300 : 260;

  const numY = square ? 470 : 372;
  const headY = square ? 610 : 452;
  const dotsY = H - pad - (square ? 40 : 28);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Georgia, 'Times New Roman', serif">
  <defs>
    <radialGradient id="bg" cx="50%" cy="0%" r="120%">
      <stop offset="0" stop-color="#1e1b4b"/><stop offset="0.55" stop-color="#0a0a1f"/><stop offset="1" stop-color="#05061a"/>
    </radialGradient>
    <radialGradient id="b1" cx="76%" cy="14%" r="46%">
      <stop offset="0" stop-color="#a78bfa" stop-opacity="0.42"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="b2" cx="12%" cy="82%" r="48%">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.3"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="num" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.15" stop-color="#ffffff"/><stop offset="1" stop-color="#a78bfa"/>
    </linearGradient>
    <linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#b1)"/>
  <rect width="${W}" height="${H}" fill="url(#b2)"/>

  <g transform="translate(${pad},${pad - 22})">
    <circle cx="13" cy="13" r="13" fill="url(#brand)"/>
    <text x="38" y="21" font-size="25" fill="#f5f3ff">will<tspan font-style="italic" fill="#a78bfa">happen</tspan><tspan font-size="13" fill="#a78bfa" opacity="0.7"> .ai</tspan></text>
  </g>

  <text x="${pad}" y="${pad + (square ? 84 : 74)}" font-family="'DejaVu Sans Mono', monospace" font-size="${square ? 19 : 17}" letter-spacing="3.5" fill="#a78bfa">
    ${escapeXml(((t?.name || p.topic || "").toUpperCase()).slice(0, 26))} · ${escapeXml((h?.label || p.horizon || "").toUpperCase())} · BY ${escapeXml(by)}
  </text>

  <text x="${pad}" y="${numY}" font-size="${numSize}" letter-spacing="-14" fill="url(#num)">${prob}<tspan font-size="${Math.round(numSize * 0.42)}" fill="#ffffff" opacity="0.38">%</tspan></text>
  <text x="${pad + 6}" y="${numY + (square ? 52 : 46)}" font-family="'DejaVu Sans Mono', monospace" font-size="${square ? 18 : 16}" letter-spacing="3.5" fill="${resolved ? (p.verdict ? "#6ee7b7" : "#f472b6") : "#f5f3ff"}" opacity="0.75">
    ${resolved ? (p.verdict ? "HAPPENED ✓" : "DIDN'T HAPPEN ✗") : "AI CONSENSUS"}
  </text>

  ${marketBadge(p, W, pad, numY, square)}

  <text x="${pad}" y="${headY}" font-size="${headSize}" font-style="italic" fill="#f5f3ff">
    ${headLines.map((l, i) => `<tspan x="${pad}" dy="${i === 0 ? 0 : headSize * 1.2}">${escapeXml(l)}</tspan>`).join("")}
  </text>

  <g transform="translate(${pad},${dotsY})">
    ${PANEL.map((m, i) => {
      const cell = p.models?.[m.key];
      const x = i * (square ? 62 : 56);
      const val = typeof cell?.prob === "number" ? `${cell.prob}` : "–";
      return `<circle cx="${x + 13}" cy="0" r="13" fill="${m.color}" stroke="#ffffff" stroke-opacity="0.28"/>` +
             `<text x="${x + 13}" y="30" text-anchor="middle" font-family="'DejaVu Sans Mono', monospace" font-size="13" fill="#f5f3ff" opacity="0.68">${val}</text>`;
    }).join("")}
    <text x="${PANEL.length * (square ? 62 : 56) + 16}" y="6" font-family="'DejaVu Sans Mono', monospace" font-size="13" letter-spacing="2.4" fill="#f5f3ff" opacity="0.45">SIX FRONTIER MODELS</text>
  </g>
</svg>`;
}

// The comparison that makes the card worth a click: what the money says.
function marketBadge(p, W, pad, numY, square) {
  const m = p.market;
  if (!m || typeof m.prob !== "number") return "";
  const edge = (p.consensus_prob ?? 0) - m.prob;
  const x = W - pad - (square ? 300 : 320);
  const y = numY - (square ? 170 : 150);
  const tone = edge > 0 ? "#6ee7b7" : edge < 0 ? "#f472b6" : "#f5f3ff";
  const sign = edge > 0 ? "+" : "";
  return `
  <g transform="translate(${x},${y})">
    <rect width="${square ? 300 : 320}" height="132" rx="22" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.14"/>
    <text x="24" y="34" font-family="'DejaVu Sans Mono', monospace" font-size="13" letter-spacing="2.6" fill="#f5f3ff" opacity="0.5">THE MARKET SAYS</text>
    <text x="24" y="92" font-size="62" fill="#f5f3ff">${clamp(m.prob)}<tspan font-size="28" opacity="0.45">%</tspan></text>
    <text x="24" y="118" font-family="'DejaVu Sans Mono', monospace" font-size="14" letter-spacing="1.6" fill="${tone}">AI ${sign}${edge} PTS</text>
  </g>`;
}

// ── text layout ─────────────────────────────────────────────
// Proportional fonts need proportional measuring; a flat character count wraps
// "MMMMM" and "lllll" at the same place. These are rough serif ratios, which is
// accurate enough for three lines of headline.
const NARROW = new Set([..."ijlt.,;:'!|()[]/ "]);
const WIDE = new Set([..."mwMW@%"]);
const charWidth = (c) => (NARROW.has(c) ? 0.42 : WIDE.has(c) ? 1.45 : c === c.toUpperCase() && /[A-Z]/.test(c) ? 1.15 : 1);

function wrap(text, unitsPerLine, maxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  let width = 0;

  for (const word of words) {
    const w = [...word].reduce((a, c) => a + charWidth(c), 0);
    if (line && width + 1 + w > unitsPerLine) {
      lines.push(line);
      if (lines.length === maxLines) break;
      line = word; width = w;
    } else {
      line = line ? `${line} ${word}` : word;
      width += (line === word ? 0 : 1) + w;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (!lines.length) return [""];

  const used = lines.join(" ").split(/\s+/).length;
  if (used < words.length) lines[lines.length - 1] = trimTo(lines[lines.length - 1], unitsPerLine - 1) + "…";
  return lines;
}

function trimTo(s, units) {
  let out = "", w = 0;
  for (const c of s) {
    w += charWidth(c);
    if (w > units) break;
    out += c;
  }
  return out.replace(/[\s,.;:]+$/, "");
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const escapeXml = (s) => escapeHtml(s);

function fmtMonth(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", timeZone: "UTC" }).toUpperCase();
}
