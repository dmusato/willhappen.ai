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
// Layout is declared, not derived. Every y is fixed up front so the headline
// can never grow into the model dots — which is exactly what happened when
// these were computed from each other.
const LAYOUT = {
  wide: {
    W: 1200, H: 630, pad: 64,
    metaY: 118, metaSize: 17,
    headTop: 150, headBox: 170, headSizes: [46, 40, 34, 29],
    numY: 470, numSize: 190,
    capY: 506,
    dotsY: 558, dotGap: 56, dotR: 13,
    badge: { x: 816, y: 338, w: 320, h: 136 },
  },
  square: {
    W: 1080, H: 1080, pad: 80,
    metaY: 150, metaSize: 19,
    headTop: 190, headBox: 230, headSizes: [56, 50, 44, 38],
    numY: 640, numSize: 250,
    capY: 682,
    dotsY: 790, dotGap: 64, dotR: 15,
    badge: { x: 640, y: 470, w: 320, h: 136 },
    // Instagram crops and overlays the bottom of a square post, so the last
    // strip carries the wordmark rather than anything a reader needs.
    footerY: 905,
  },
};

function card(p, { square }) {
  const L = LAYOUT[square ? "square" : "wide"];
  const { W, H, pad } = L;
  const prob = clamp(p.consensus_prob);
  const t = topicOf(p.topic);
  const hz = horizonOf(p.horizon);
  const resolved = p.verdict === true || p.verdict === false;
  const head = fitHeadline(p.headline || "", W - pad * 2, L.headBox, L.headSizes);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Georgia, 'DejaVu Serif', 'Times New Roman', serif">
  <defs>
    <radialGradient id="bg" cx="50%" cy="0%" r="120%">
      <stop offset="0" stop-color="#1e1b4b"/><stop offset="0.55" stop-color="#0a0a1f"/><stop offset="1" stop-color="#05061a"/>
    </radialGradient>
    <radialGradient id="b1" cx="76%" cy="14%" r="46%">
      <stop offset="0" stop-color="#a78bfa" stop-opacity="0.4"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="b2" cx="12%" cy="82%" r="48%">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.28"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="num" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.2" stop-color="#ffffff"/><stop offset="1" stop-color="#8b5cf6"/>
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
    <text x="38" y="21" font-size="25" fill="#f5f3ff">will<tspan fill="#a78bfa">happen</tspan><tspan font-size="13" fill="#a78bfa" opacity="0.7"> .ai</tspan></text>
  </g>

  <text x="${pad}" y="${L.metaY}" font-family="'DejaVu Sans Mono', monospace" font-size="${L.metaSize}" letter-spacing="3.2" fill="#a78bfa">
    ${escapeXml(((t?.name || p.topic || "").toUpperCase()).slice(0, 24))} · ${escapeXml((hz?.label || p.horizon || "").toUpperCase())} · BY ${escapeXml(fmtMonth(p.resolves_by))}
  </text>

  <text x="${pad}" y="${L.headTop + head.size}" font-size="${head.size}" fill="#f5f3ff">
    ${head.lines.map((l, i) => `<tspan x="${pad}" dy="${i === 0 ? 0 : Math.round(head.size * 1.18)}">${escapeXml(l)}</tspan>`).join("")}
  </text>

  <text x="${pad}" y="${L.numY}" font-size="${L.numSize}" letter-spacing="-10" fill="url(#num)">${prob}<tspan font-size="${Math.round(L.numSize * 0.42)}" fill="#ffffff" opacity="0.38">%</tspan></text>
  <text x="${pad + 4}" y="${L.capY}" font-family="'DejaVu Sans Mono', monospace" font-size="${Math.round(L.metaSize * 0.9)}" letter-spacing="3.2" fill="${resolved ? (p.verdict ? "#6ee7b7" : "#f472b6") : "#f5f3ff"}" opacity="0.7">
    ${resolved ? (p.verdict ? "HAPPENED" : "DID NOT HAPPEN") : "AI CONSENSUS"}
  </text>

  ${marketBadge(p, L)}

  <g transform="translate(${pad},${L.dotsY})">
    ${PANEL.map((m, i) => {
      const cell = p.models?.[m.key];
      const x = i * L.dotGap;
      const val = typeof cell?.prob === "number" ? `${cell.prob}` : "–";
      return `<circle cx="${x + L.dotR}" cy="0" r="${L.dotR}" fill="${m.color}" stroke="#ffffff" stroke-opacity="0.28"/>` +
             `<text x="${x + L.dotR}" y="${L.dotR + 17}" text-anchor="middle" font-family="'DejaVu Sans Mono', monospace" font-size="13" fill="#f5f3ff" opacity="0.66">${val}</text>`;
    }).join("")}
    <text x="${PANEL.length * L.dotGap + 14}" y="5" font-family="'DejaVu Sans Mono', monospace" font-size="13" letter-spacing="2.4" fill="#f5f3ff" opacity="0.42">SIX FRONTIER MODELS</text>
  </g>
  ${!L.footerY ? "" : `<g transform="translate(0,${L.footerY})">
    <line x1="${pad}" y1="0" x2="${W - pad}" y2="0" stroke="#ffffff" stroke-opacity="0.1"/>
    <text x="${pad}" y="34" font-family="'DejaVu Sans Mono', monospace" font-size="15" letter-spacing="3" fill="#a78bfa" opacity="0.85">WILLHAPPEN.AI</text>
    <text x="${W - pad}" y="34" text-anchor="end" font-family="'DejaVu Sans Mono', monospace" font-size="15" letter-spacing="2" fill="#f5f3ff" opacity="0.45">RESOLVES ${escapeXml(fmtMonth(p.resolves_by))}</text>
  </g>`}
</svg>`;
}

// The comparison that makes the card worth a click: what the money says.
function marketBadge(p, L) {
  const m = p.market;
  if (!m || typeof m.prob !== "number") return "";
  const { x, y, w, h } = L.badge;
  const edge = (p.consensus_prob ?? 0) - m.prob;
  const tone = edge > 0 ? "#6ee7b7" : edge < 0 ? "#f472b6" : "#f5f3ff";
  const sign = edge > 0 ? "+" : "";
  return `
  <g transform="translate(${x},${y})">
    <rect width="${w}" height="${h}" rx="22" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.14"/>
    <text x="26" y="36" font-family="'DejaVu Sans Mono', monospace" font-size="13" letter-spacing="2.6" fill="#f5f3ff" opacity="0.5">THE MARKET SAYS</text>
    <text x="26" y="96" font-size="62" fill="#f5f3ff">${clamp(m.prob)}<tspan font-size="28" opacity="0.45">%</tspan></text>
    <text x="26" y="122" font-family="'DejaVu Sans Mono', monospace" font-size="14" letter-spacing="1.6" fill="${tone}">AI ${sign}${edge} PTS</text>
  </g>`;
}

// ── text layout ─────────────────────────────────────────────
// Proportional fonts need proportional measuring; a flat character count wraps
// "MMMMM" and "lllll" in the same place. These are rough serif advance ratios
// against an average glyph, which is accurate enough for a headline.
const NARROW = new Set([..."ijlt.,;:'!|()[]/ "]);
const WIDE = new Set([..."mwMW@%"]);
// Measured against DejaVu Serif, which is what the rasterizer actually falls
// back to — Georgia is narrower, so tuning to Georgia overflowed every line.
const AVG_ADVANCE = 0.62;

const charUnits = (c) => (NARROW.has(c) ? 0.42 : WIDE.has(c) ? 1.45 : /[A-Z]/.test(c) ? 1.15 : 1);
const textUnits = (s) => [...s].reduce((a, c) => a + charUnits(c), 0);

// Largest size first; keep the first one whose wrapped lines fit inside the
// box the layout reserved. Line count is derived from the box, so a headline
// can never grow down into the model dots however long it is.
function fitHeadline(text, availWidth, boxHeight, sizes) {
  for (const size of sizes) {
    const maxLines = Math.max(1, Math.floor(boxHeight / (size * 1.18)));
    const out = wrap(text, availWidth / (size * AVG_ADVANCE), maxLines);
    if (!out.truncated) return { size, lines: out.lines };
  }
  const size = sizes[sizes.length - 1];
  const maxLines = Math.max(1, Math.floor(boxHeight / (size * 1.18)));
  return { size, lines: wrap(text, availWidth / (size * AVG_ADVANCE), maxLines).lines };
}

function wrap(text, unitsPerLine, maxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  let used = 0;

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textUnits(candidate) > unitsPerLine) {
      lines.push(line);
      if (lines.length === maxLines) return { lines, truncated: true, ...ellipsize(lines, unitsPerLine) };
      line = word;
    } else {
      line = candidate;
    }
    used++;
  }
  if (line) lines.push(line);
  return { lines: lines.length ? lines : [""], truncated: false };
}

function ellipsize(lines, unitsPerLine) {
  const last = lines.length - 1;
  lines[last] = `${trimTo(lines[last], unitsPerLine - 1)}…`;
  return {};
}

function trimTo(s, units) {
  let out = "", w = 0;
  for (const c of s) {
    w += charUnits(c);
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
