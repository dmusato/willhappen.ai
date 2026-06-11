// GET /og/:id  →  SVG image (1200×630) with the prediction's headline and
// consensus percentage. Cheap, cacheable, no external deps.

import { loadPrediction } from "./predictions.js";

export async function handleOg(request, env) {
  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();

  const p = await loadPrediction(env, request, id);
  if (!p) return new Response("not found", { status: 404 });

  const prob = Math.max(0, Math.min(100, p.consensus_prob | 0));
  const headline = (p.headline || "").slice(0, 140);
  const horizon = (p.horizon || "").toUpperCase();
  const by = new Date(p.resolves_by || Date.now()).toLocaleDateString("en-US", { year: "numeric", month: "short" });

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bg" cx="50%" cy="0%" r="100%">
      <stop offset="0" stop-color="#1e1b4b"/>
      <stop offset="0.55" stop-color="#0a0a1f"/>
      <stop offset="1" stop-color="#05061a"/>
    </radialGradient>
    <radialGradient id="b1" cx="72%" cy="18%" r="38%">
      <stop offset="0" stop-color="#a78bfa" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#a78bfa" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="b2" cx="15%" cy="75%" r="40%">
      <stop offset="0" stop-color="#38bdf8" stop-opacity="0.4"/>
      <stop offset="1" stop-color="#38bdf8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="big" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.2" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#a78bfa" stop-opacity="0.65"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#a78bfa"/>
      <stop offset="1" stop-color="#38bdf8"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#b1)"/>
  <rect width="1200" height="630" fill="url(#b2)"/>

  <!-- logo -->
  <g transform="translate(64,64)">
    <circle cx="14" cy="14" r="14" fill="url(#accent)"/>
    <text x="40" y="22" font-family="Instrument Serif, Georgia, serif" font-size="26" fill="#f5f3ff">
      will<tspan font-style="italic" fill="#a78bfa">happen</tspan><tspan fill="#a78bfa99" font-size="14"> .ai</tspan>
    </text>
  </g>

  <!-- meta -->
  <text x="64" y="170" font-family="JetBrains Mono, monospace" font-size="16" letter-spacing="4" fill="#a78bfa">
    ${horizon} HORIZON · BY ${by.toUpperCase()}
  </text>

  <!-- big % -->
  <text x="64" y="400" font-family="Instrument Serif, Georgia, serif" font-size="320" letter-spacing="-16" fill="url(#big)">
    ${prob}<tspan font-size="160" fill="#ffffff66">%</tspan>
  </text>

  <!-- headline -->
  <foreignObject x="64" y="420" width="1072" height="140">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:'Instrument Serif',Georgia,serif;color:#f5f3ff;font-size:42px;line-height:1.15;font-style:italic;letter-spacing:-0.5px;">
      ${escapeHtml(headline)}
    </div>
  </foreignObject>

  <!-- six dots -->
  <g transform="translate(64,580)">
    ${["#4285F4", "#D97757", "#10a37f", "#ffffff", "#0468ff", "#4f46e5"].map(
      (c, i) => `<circle cx="${i * 28}" cy="0" r="10" fill="${c}" stroke="#ffffff44" stroke-width="1"/>`,
    ).join("")}
    <text x="200" y="4" font-family="JetBrains Mono, monospace" font-size="12" fill="#f5f3ff99" letter-spacing="2">SIX AI MODELS · CONSENSUS</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=600, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
