// The reusable pieces of the interface, rendered as strings.
//
// The one that matters is dial(): a single graphic carrying the consensus, how
// far apart the six models were, where each one landed, and what the money
// says — the thing a reader screenshots.

import { PANEL, byKey } from "../ai/roster.js";
import { horizon as horizonOf, topic as topicOf } from "../catalog.js";
import { h } from "./shell.js";

export const probTone = (v) => (v >= 70 ? "high" : v >= 40 ? "mid" : "low");

export function dial(p, { compact = false } = {}) {
  const cells = PANEL
    .map((m) => ({ m, cell: p.models?.[m.key] }))
    .filter((x) => typeof x.cell?.prob === "number");
  const probs = cells.map((x) => x.cell.prob);
  const lo = probs.length ? Math.min(...probs) : p.consensus_prob;
  const hi = probs.length ? Math.max(...probs) : p.consensus_prob;
  const market = typeof p.market?.prob === "number" ? p.market.prob : null;

  return `<div class="dial${compact ? " compact" : ""}" role="img" aria-label="${h(ariaFor(p, lo, hi, market))}">
  ${compact ? "" : `<div class="dial-head">
    <div class="dial-num ${probTone(p.consensus_prob)}"><span class="odo" data-to="${p.consensus_prob}">${p.consensus_prob}</span><i>%</i></div>
    <div class="dial-cap">
      <span class="mono">AI CONSENSUS</span>
      <span class="dial-sub">${probs.length} of ${PANEL.length} models · ${hi - lo} pt spread</span>
    </div>
  </div>`}
  <div class="dial-track">
    <span class="dial-range" style="--lo:${lo};--hi:${hi}"></span>
    ${market === null ? "" : `<span class="dial-market" style="--at:${market}"><b>${market}%</b><em>market</em></span>`}
    <span class="dial-consensus" style="--at:${p.consensus_prob}"></span>
    ${cells.map(({ m, cell }) =>
      `<span class="dial-dot" style="--at:${cell.prob};--c:${m.color}" title="${h(m.name)} · ${cell.prob}%"></span>`).join("")}
  </div>
  ${compact ? "" : `<div class="dial-axis"><span>0</span><span>impossible ← → certain</span><span>100</span></div>`}
</div>`;
}

function ariaFor(p, lo, hi, market) {
  const base = `AI consensus ${p.consensus_prob} percent, models ranged ${lo} to ${hi}`;
  return market === null ? base : `${base}, prediction market at ${market} percent`;
}

export function modelList(p) {
  const rows = PANEL.map((m) => ({ m, cell: p.models?.[m.key] })).filter((x) => x.cell);
  rows.sort((a, b) => (b.cell.prob ?? -1) - (a.cell.prob ?? -1));

  return `<ul class="models">
${rows.map(({ m, cell }) => {
  const failed = typeof cell.prob !== "number";
  return `  <li class="model${failed ? " failed" : ""}" style="--c:${m.color};--ink:${m.ink}">
    <span class="model-badge" aria-hidden="true">${h(m.name[0])}</span>
    <div class="model-id"><b>${h(m.name)}</b><em>${h(m.lab)}</em></div>
    <p class="model-note">${failed ? "<span class='muted'>no answer this run</span>" : h(cell.note || "—")}</p>
    <div class="model-prob">${failed ? "–" : `${cell.prob}<i>%</i>`}</div>
    <div class="model-bar"><span style="width:${failed ? 0 : cell.prob}%"></span></div>
  </li>`;
}).join("\n")}
</ul>`;
}

export function marketPanel(p) {
  const m = p.market;
  if (!m || typeof m.prob !== "number") return "";
  const edge = p.consensus_prob - m.prob;
  const drift = typeof m.drift === "number" ? m.drift : null;
  const week = typeof m.change_1w === "number" ? m.change_1w : null;
  const label = m.source === "kalshi" ? "Kalshi" : "Polymarket";

  return `<section class="market">
  <header>
    <span class="mono">WHAT THE MONEY SAYS</span>
    <a class="market-src" href="${h(m.url || "#")}" rel="noopener nofollow" target="_blank">${h(label)} ↗</a>
  </header>
  <div class="market-grid">
    <div class="market-big"><b>${m.prob}</b><i>%</i><span class="mono">market price</span></div>
    <dl>
      <div><dt>AI edge</dt><dd class="${edge > 0 ? "up" : edge < 0 ? "down" : ""}">${edge > 0 ? "+" : ""}${edge} pts</dd></div>
      ${week === null ? "" : `<div><dt>Moved this week</dt><dd class="${week > 0 ? "up" : week < 0 ? "down" : ""}">${week > 0 ? "+" : ""}${week} pts</dd></div>`}
      ${drift === null ? "" : `<div><dt>Since we asked</dt><dd class="${drift > 0 ? "up" : drift < 0 ? "down" : ""}">${drift > 0 ? "+" : ""}${drift} pts</dd></div>`}
      ${m.volume_usd ? `<div><dt>Volume</dt><dd>${usd(m.volume_usd)}</dd></div>` : ""}
    </dl>
  </div>
  <p class="market-read">${h(readout(p.consensus_prob, m.prob, edge))}</p>
</section>`;
}

// Says the comparison in words, because a signed integer is not an insight.
function readout(ai, market, edge) {
  const size = Math.abs(edge);
  if (size <= 3) return `The panel and the market agree almost exactly — ${ai}% against ${market}%.`;
  const dir = edge > 0 ? "more" : "less";
  const strength = size >= 25 ? "sharply" : size >= 12 ? "clearly" : "slightly";
  return `The models are ${strength} ${dir} confident than traders risking real money: ${ai}% against ${market}%.`;
}

export function verdictBlock(p) {
  if (p.verdict !== true && p.verdict !== false) return "";
  const yes = p.verdict === true;
  return `<section class="verdict ${yes ? "yes" : "no"}">
  <div class="verdict-mark" aria-hidden="true">${yes ? "✓" : "✗"}</div>
  <div>
    <h2>${yes ? "It happened." : "It didn't happen."}</h2>
    ${p.verdict_note ? `<p>${h(p.verdict_note)}</p>` : ""}
    <p class="verdict-meta mono">
      ${h(p.verdict_source === "resolver" ? "Auto-resolved from sources" : "Confirmed by a maintainer")}
      ${p.verdict_confidence ? ` · ${p.verdict_confidence}% confidence` : ""}
      ${p.verdict_at ? ` · ${fmtDate(p.verdict_at)}` : ""}
    </p>
    ${sourceList(p.sources)}
  </div>
</section>`;
}

export function sourceList(sources) {
  if (!sources?.length) return "";
  return `<ul class="sources">
${sources.map((s) => `    <li><a href="${h(s.url)}" rel="noopener nofollow" target="_blank">${h(s.title || s.url)}</a></li>`).join("\n")}
  </ul>`;
}

export function row(p) {
  const t = topicOf(p.topic);
  const hz = horizonOf(p.horizon);
  const resolved = p.verdict === true || p.verdict === false;
  const market = typeof p.market_prob === "number" ? p.market_prob : (typeof p.market?.prob === "number" ? p.market.prob : null);
  const edge = typeof p.edge === "number" ? p.edge : null;

  return `<a class="row" href="/p/${h(p.id)}">
  <div class="row-when">
    <span class="row-horizon">${h(hz?.short || p.horizon)}</span>
    <span class="mono">${h(fmtDate(p.resolves_by))}</span>
  </div>
  <div class="row-main">
    <h3>${h(p.headline)}${resolved ? `<span class="chip ${p.verdict ? "yes" : "no"}">${p.verdict ? "✓ happened" : "✗ didn't"}</span>` : ""}</h3>
    <div class="row-meta mono">
      ${t ? `<span class="row-topic" style="--hue:${t.hue}">${h(t.icon)} ${h(t.name)}</span>` : ""}
      ${typeof p.spread === "number" ? `<span>spread ${p.spread}</span>` : ""}
      ${edge !== null ? `<span class="${edge > 0 ? "up" : edge < 0 ? "down" : ""}">vs market ${edge > 0 ? "+" : ""}${edge}</span>` : ""}
    </div>
  </div>
  <div class="row-nums">
    <div class="row-prob ${probTone(p.consensus_prob)}">${p.consensus_prob}<i>%</i></div>
    ${market === null ? `<span class="row-sub mono">AI</span>` : `<span class="row-sub mono">AI vs ${market}%</span>`}
  </div>
</a>`;
}

export const rows = (list) =>
  list.length ? `<div class="rows">${list.map(row).join("\n")}</div>` : `<p class="empty">Nothing here yet.</p>`;

export function section(title, body, { kicker = "", action = null, id = "" } = {}) {
  return `<section class="block"${id ? ` id="${h(id)}"` : ""}>
  <header class="block-head">
    <div>
      ${kicker ? `<div class="mono kicker">${h(kicker)}</div>` : ""}
      <h2>${title}</h2>
    </div>
    ${action ? `<a class="pill" href="${h(action.href)}">${h(action.label)} →</a>` : ""}
  </header>
  ${body}
</section>`;
}

export function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function relative(iso) {
  const ms = new Date(iso) - Date.now();
  const days = Math.round(ms / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days < 0) return `${Math.abs(days)}d ago`;
  if (days === 0) return "today";
  if (days < 31) return `in ${days}d`;
  if (days < 365) return `in ${Math.round(days / 30)}mo`;
  return `in ${(days / 365).toFixed(days < 3650 ? 1 : 0)}y`;
}

export function usd(n) {
  const v = Number(n) || 0;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${v}`;
}

export { byKey };
