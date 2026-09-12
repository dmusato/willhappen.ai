// Server-rendered HTML. Every page ships its content in the markup rather than
// fetching it — this site lives on search and link previews, and an empty div
// that fills in after three round trips is worth nothing to either.
//
// No templating library: tagged template literals and one escape function.

import { escapeHtml } from "../util.js";

export const h = escapeHtml;

export function shell({
  title,
  description,
  canonical,
  site,
  body,
  page = "",
  ogImage = null,
  ogType = "website",
  jsonLd = null,
  head = "",
}) {
  const img = ogImage || `${site}/og-default.png`;
  return `<!doctype html>
<html lang="en" data-page="${h(page)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)}</title>
<meta name="description" content="${h(description)}">
<link rel="canonical" href="${h(canonical)}">
<meta property="og:site_name" content="WillHappen.ai">
<meta property="og:title" content="${h(title)}">
<meta property="og:description" content="${h(description)}">
<meta property="og:url" content="${h(canonical)}">
<meta property="og:type" content="${h(ogType)}">
<meta property="og:image" content="${h(img)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${h(title)}">
<meta name="twitter:description" content="${h(description)}">
<meta name="twitter:image" content="${h(img)}">
<meta name="theme-color" content="#05061a">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="/assets/style.css">
<link rel="alternate" type="application/rss+xml" title="WillHappen.ai — latest forecasts" href="/feed.xml">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
${head}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${nav(page)}
<main id="main">
${body}
</main>
${footer()}
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

const LINKS = [
  { href: "/timeline", label: "Timeline", key: "timeline" },
  { href: "/topics", label: "Topics", key: "topics" },
  { href: "/models", label: "Scoreboard", key: "models" },
  { href: "/about", label: "How it works", key: "about" },
];

function nav(page) {
  return `<nav class="nav">
  <a class="logo" href="/" aria-label="WillHappen.ai home"><span class="dot" aria-hidden="true"></span><span class="word">will<i>happen</i><small>.ai</small></span></a>
  <button class="nav-toggle" aria-expanded="false" aria-controls="nav-links" aria-label="Menu"><span></span><span></span></button>
  <div class="nav-links" id="nav-links">
    ${LINKS.map((l) => `<a href="${l.href}"${page === l.key ? ' aria-current="page"' : ""}>${l.label}</a>`).join("\n    ")}
    <a class="nav-pill" href="https://github.com/dmusato/willhappen.ai" rel="noopener" target="_blank">
      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
      Star
    </a>
  </div>
</nav>`;
}

function footer() {
  return `<footer class="foot">
  <div class="foot-grid">
    <div>
      <a class="logo small" href="/"><span class="dot" aria-hidden="true"></span><span class="word">will<i>happen</i><small>.ai</small></span></a>
      <p>An open forecasting machine. Every day it reads the news and the prediction markets, asks six frontier models what happens next, then goes back and checks who was right.</p>
    </div>
    <div>
      <h3>Browse</h3>
      <a href="/timeline">Timeline</a><a href="/topics">Topics</a><a href="/models">Scoreboard</a><a href="/feed.xml">RSS</a>
    </div>
    <div>
      <h3>Project</h3>
      <a href="/about">How it works</a>
      <a href="https://github.com/dmusato/willhappen.ai" rel="noopener" target="_blank">Source on GitHub</a>
      <a href="/suggest">Suggest a question</a>
      <a href="https://github.com/dmusato/willhappen.ai/issues/new?template=report-outcome.yml" rel="noopener" target="_blank">Dispute an outcome</a>
    </div>
  </div>
  <div class="foot-legal">
    <span>MIT licensed · self-host your own in ten minutes</span>
    <span>Forecasts are model output, not advice.</span>
  </div>
</footer>`;
}
