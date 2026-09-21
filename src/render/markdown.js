// The same pages, as Markdown, for whatever is reading without a browser.
//
// An assistant fetching a forecast page wants the numbers and the reasoning.
// What it gets from the HTML is a nav, a dial drawn in absolutely-positioned
// spans, a vote widget and a share bar — all of which it has to see through to
// find six probabilities. Serving the content directly is both kinder to the
// agent and better for us: what gets quoted is then what we wrote, not a
// scraper's guess at it.
//
// Reached two ways: an `Accept: text/markdown` header on any page, or the same
// URL with `.md` on the end for anything that cannot set headers.

import { PANEL } from "../ai/roster.js";
import { horizon as horizonOf, topic as topicOf } from "../catalog.js";
import { answer } from "../util.js";
import { aboutBody, termsBody } from "./pages.js";
import { fmtDate } from "./components.js";

const fence = (s) => String(s || "").replace(/\r/g, "").trim();

export function predictionMarkdown(p, site) {
  const t = topicOf(p.topic);
  const hz = horizonOf(p.horizon);
  const answered = Object.values(p.models || {}).filter((m) => typeof m.prob === "number");
  const settled = p.verdict === true || p.verdict === false;

  const lines = [
    `# ${fence(p.headline)}`,
    "",
    `**AI consensus: ${p.consensus_prob}%** — the median of ${answered.length} frontier models, each asked independently.`,
    "",
    `| | |`,
    `|---|---|`,
    `| Resolves by | ${fmtDate(p.resolves_by)} |`,
    `| Topic | ${t?.name || p.topic} |`,
    `| Horizon | ${hz?.label || p.horizon} |`,
    `| Spread | ${p.spread ?? "—"} points between highest and lowest |`,
    p.market && typeof p.market.prob === "number"
      ? `| Prediction market | ${p.market.prob}% (${p.market.source}) |` : null,
    typeof p.edge === "number" ? `| Edge | ${p.edge > 0 ? "+" : ""}${p.edge} points vs the market |` : null,
    `| Outcome | ${settled ? (p.verdict ? "Happened" : "Did not happen") : "Still open"} |`,
    "",
  ].filter((l) => l !== null);

  if (p.context) lines.push(fence(p.context), "");

  if (settled && p.verdict_note) {
    lines.push(`## Outcome`, "", fence(p.verdict_note), "");
    if (p.sources?.length) {
      lines.push(...p.sources.map((s) => `- [${fence(s.title || s.url)}](${s.url})`), "");
    }
  }

  lines.push(`## What each model said`, "");
  for (const m of PANEL) {
    const cell = p.models?.[m.key];
    if (!cell) continue;
    const prob = typeof cell.prob === "number" ? `${cell.prob}%` : "no answer";
    lines.push(`### ${m.name} (${m.lab}) — ${prob}`, "");
    const said = answer(cell);
    if (said) {
      lines.push(fence(said.take), "");
      if (said.because.length) lines.push(...said.because.map((b) => `- ${fence(b)}`), "");
    }
    lines.push(`\`${cell.model}\`${cell.queried_at ? ` · asked ${fmtDate(cell.queried_at)}` : ""}`, "");
  }

  if (p.rules) lines.push(`## Resolution criteria`, "", fence(p.rules), "");

  lines.push(
    "---",
    "",
    `No model is ever shown the market price. Source: ${p.source}${p.source_url ? ` — ${p.source_url}` : ""}.`,
    `Canonical: ${site}/p/${encodeURIComponent(p.id)}`,
  );
  return lines.join("\n");
}

export function listMarkdown(rows, { site, title, intro }) {
  const lines = [`# ${fence(title)}`, ""];
  if (intro) lines.push(fence(intro), "");
  lines.push(`| Forecast | Consensus | Market | Resolves | Outcome |`, `|---|---|---|---|---|`);
  for (const r of rows) {
    const outcome = r.verdict === true ? "Happened" : r.verdict === false ? "Did not" : "Open";
    lines.push(`| [${fence(r.headline).replace(/\|/g, "\\|")}](${site}/p/${encodeURIComponent(r.id)}) | ${r.consensus_prob}% | ${
      typeof r.market_prob === "number" ? `${r.market_prob}%` : "—"} | ${fmtDate(r.resolves_by)} | ${outcome} |`);
  }
  return lines.join("\n");
}

// /about and /terms are prose, and their Markdown is derived from the HTML
// those pages already render rather than written out a second time — a second
// copy is wrong the moment either one is edited, and /about is the contract
// with the reader. The tag set is small and ours, so a handful of replacements
// beats a parser; anything without a rule here is dropped rather than printed
// as angle brackets.
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: " " };
const decode = (s) => s.replace(/&(#?[a-z0-9]+);/gi, (m, k) => ENTITIES[k.toLowerCase()] ?? m);

// Emphasis is kept in paragraphs and dropped in headings, where `## How this
// works, *in full.*` reads as markup noise rather than as the flourish it is
// in the rendered page.
function inline(html, { emphasis = true } = {}) {
  const stripped = String(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, emphasis ? "**$2**" : "$2")
    .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, emphasis ? "*$2*" : "$2")
    .replace(/<[^>]+>/g, "");
  return decode(stripped).replace(/\s+/g, " ").trim();
}

const BLOCKS = /<(h1|h2|h3|p|ul)\b[^>]*>([\s\S]*?)<\/\1>/gi;

export function proseMarkdown(html) {
  const out = [];
  for (const [, tag, inner] of String(html).matchAll(BLOCKS)) {
    const t = tag.toLowerCase();
    if (t === "ul") {
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
        .map(([, li]) => inline(li)).filter(Boolean);
      if (items.length) out.push(items.map((i) => `- ${i}`).join("\n"), "");
      continue;
    }
    const text = inline(inner, { emphasis: t === "p" });
    if (text) out.push(t === "p" ? text : `${"#".repeat(Number(t[1]))} ${text}`, "");
  }
  return out.join("\n").trim();
}

export const aboutMarkdown = (site) => prosePage(aboutBody(), site, "/about");
export const termsMarkdown = (site) => prosePage(termsBody(), site, "/terms");

const prosePage = (html, site, path) =>
  `${proseMarkdown(html)}\n\n---\n\nCanonical: ${site}${path}`;

// The convention agents look for first: what this site is, and where the
// machine-readable versions live. Deliberately short — it is a map, not a copy
// of the archive.
export function llmsTxt({ site, total, resolved }) {
  return `# WillHappen.ai

> Six frontier AI models from six different labs forecast the same dated,
> falsifiable statements. Every forecast is benchmarked against live
> prediction-market prices and, once its deadline passes, graded against
> cited sources. ${total} forecasts published, ${resolved} settled so far.

No model is ever shown the market price before answering — that is what makes
the published gap between the panel and the money worth anything.

## How to read it

- Every page here is available as Markdown: send \`Accept: text/markdown\`, or
  add \`.md\` to the URL (\`${site}/p/{id}.md\`, \`${site}/timeline.md\`,
  \`${site}/topics/{topic}.md\`, \`${site}/about.md\`).
- \`consensus\` is the median of the panel, not the mean, so one outlier cannot
  drag it.
- \`edge\` is consensus minus the market price, positive when the models are
  more confident than traders risking money.

## Data

- [Every forecast](${site}/timeline.md) — the full archive
- [Scoreboard](${site}/models) — Brier scores, calibration, models vs market
- [JSON API](${site}/api/predictions) — listing, filters, one record at \`/api/predictions/{id}\`
- [Leaderboard JSON](${site}/api/leaderboard)
- [Topics and horizons](${site}/api/catalog)
- [Sitemap](${site}/sitemap.xml) · [RSS](${site}/feed.xml)

## Method and limits

- [How it works](${site}/about.md) — sourcing, the panel, the three-tier resolver
- [Terms and disclaimer](${site}/terms.md) — machine output, not advice

## Using this

Read it, search it, ground an answer on it and cite it — that is what it is for.
The one reserved use is training. This archive exists to score models, so
folding its questions, its answers and their settled outcomes back into weights
corrupts the measurement. Declared in [robots.txt](${site}/robots.txt) as
\`search=yes, ai-input=yes, ai-train=no\`.

Source code: https://github.com/dmusato/willhappen.ai (MIT)
`;
}
