// One function per route. Each takes already-loaded data and returns a full
// HTML document — no page fetches its own content on the client.

import { PANEL, rosterForClient } from "../ai/roster.js";
import { HORIZONS, TOPICS, horizon as horizonOf, topic as topicOf } from "../catalog.js";
import { h, shell } from "./shell.js";
import {
  dial, fmtDate, marketPanel, modelList, probTone, relative,
  row, rows, section, sourceList, usd, verdictBlock,
} from "./components.js";

// ── landing ─────────────────────────────────────────────────
export function homePage({ site, index, board }) {
  const all = index.predictions;
  const stats = summarize(all, board);
  const fresh = [...all].sort(byNewest).slice(0, 8);
  const contested = [...all]
    .filter((p) => p.verdict === null && typeof p.edge === "number")
    .sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge)).slice(0, 5);
  const soon = [...all]
    .filter((p) => p.verdict === null && Date.parse(p.resolves_by) > Date.now())
    .sort((a, b) => Date.parse(a.resolves_by) - Date.parse(b.resolves_by)).slice(0, 5);
  const settled = [...all].filter((p) => p.verdict !== null && p.verdict !== undefined)
    .sort((a, b) => byNewest(a, b)).slice(0, 4);

  const empty = !all.length;
  const body = `
<section class="hero">
  <p class="eyebrow mono">SIX FRONTIER MODELS · ONE RUNNING SCORE</p>
  <h1>What will <i>happen</i>?</h1>
  <p class="lede">Every day this site reads the news and the prediction markets, turns what it finds
  into questions with a deadline, and asks six frontier AI models to put a number on each one.
  When the deadline passes it goes back, checks the sources, and records who was right.</p>

  ${empty ? "" : `<form class="search" action="/timeline" method="get" role="search">
    <input type="search" name="q" placeholder="Search ${all.length} forecasts — rates, wars, elections, AI…" aria-label="Search forecasts" autocomplete="off">
    <button class="btn" type="submit">Search</button>
  </form>`}

  ${empty ? "" : `<dl class="stats">
    <div><dt>Forecasts tracked</dt><dd>${stats.total}</dd></div>
    <div><dt>Already settled</dt><dd>${stats.resolved}</dd></div>
    <div><dt>Priced against markets</dt><dd>${stats.withMarket}</dd></div>
    <div><dt>${stats.skillLabel}</dt><dd class="${stats.skillTone}">${stats.skillValue}</dd></div>
  </dl>`}

  <ul class="panel-strip">
    ${PANEL.map((m) => `<li style="--c:${m.color};--ink:${m.ink}"><span>${h(m.name[0])}</span>${h(m.name)}</li>`).join("")}
  </ul>
</section>

${empty ? firstRun() : section("Latest forecasts", rows(fresh), { kicker: "FRESH OFF THE RUN", action: { href: "/timeline", label: "Full timeline" } })}

${contested.length ? section(
  `Where the models <i>disagree with the money</i>`,
  rows(contested),
  { kicker: "BIGGEST EDGE", action: { href: "/timeline?sort=edge", label: "All disagreements" } },
) : ""}

${soon.length ? section("Resolving soon", rows(soon), { kicker: "DEADLINE APPROACHING", action: { href: "/timeline?sort=soon", label: "By deadline" } }) : ""}

${settled.length ? section("Recently settled", rows(settled), { kicker: "CHECKED AGAINST SOURCES", action: { href: "/timeline?status=resolved", label: "All outcomes" } }) : ""}

<section class="block how">
  <header class="block-head"><div><div class="mono kicker">THE LOOP</div><h2>How it runs itself</h2></div></header>
  <ol class="steps">
    <li><span class="step-n">01</span><h3>Read the agenda</h3><p>Hourly, it pulls live markets from Polymarket and Kalshi and sweeps one news beat with a search-grounded model. Both give questions people are actually arguing about today.</p></li>
    <li><span class="step-n">02</span><h3>Make it falsifiable</h3><p>Each one is rewritten as a single statement with a deadline and explicit resolution criteria. Anything vague, duplicated or unfalsifiable is dropped here.</p></li>
    <li><span class="step-n">03</span><h3>Ask the panel</h3><p>Six models from six labs answer independently. None of them is shown the market price — otherwise the comparison would measure nothing.</p></li>
    <li><span class="step-n">04</span><h3>Go back and check</h3><p>After the deadline, one model gathers evidence with citations and a second rules on it. Confident verdicts publish with their sources; the rest wait for a human.</p></li>
  </ol>
  <p class="how-foot">Every step is in the open. <a href="https://github.com/dmusato/willhappen.ai" rel="noopener" target="_blank">Read the code</a> or <a href="/about">see the full method</a>.</p>
</section>`;

  return shell({
    site, page: "home", body,
    title: "WillHappen.ai — six AI models forecast the news, then get graded",
    description: `${all.length} forecasts on what happens next in politics, markets, AI and climate — six frontier models against live prediction-market prices, with every outcome checked against sources.`,
    canonical: `${site}/`,
    ogImage: `${site}/og-default.png`,
    jsonLd: {
      "@context": "https://schema.org", "@type": "WebSite", name: "WillHappen.ai", url: site,
      description: "Consensus forecasts from six frontier AI models, scored against prediction markets.",
      potentialAction: { "@type": "SearchAction", target: `${site}/timeline?q={q}`, "query-input": "required name=q" },
    },
  });
}

// A fresh deployment has published nothing yet. Say so honestly rather than
// shipping invented forecasts in the seed data.
function firstRun() {
  return `<section class="block">
  <div class="firstrun">
    <div class="mono kicker">NOTHING PUBLISHED YET</div>
    <h2>This instance hasn't run its first forecast.</h2>
    <p>The archive fills itself: the scheduled job pulls live markets and the news, then puts each
    question to the panel. The first batch appears within the hour — or trigger one now.</p>
    <pre><code>curl -X POST https://your-worker/api/admin/run \
  -H 'authorization: Bearer $ADMIN_TOKEN' \
  -d '{"plan":{"forecasts":4,"harvestMarkets":true}}'</code></pre>
    <p class="fineprint">Running it locally? <code>npm run dev</code> with <code>MOCK_LLM=1</code> in
    <code>.dev.vars</code> walks the whole loop without an API key.</p>
  </div>
</section>`;
}

function summarize(all, board) {
  const resolved = all.filter((p) => p.verdict === true || p.verdict === false);
  const withMarket = all.filter((p) => p.market_prob !== null && p.market_prob !== undefined);
  const panel = board?.rows?.find((r) => r.key === "consensus");
  const market = board?.rows?.find((r) => r.key === "market");
  const enough = panel && panel.n >= (board?.min_sample ?? 10);

  if (!enough) {
    return {
      total: all.length, resolved: resolved.length, withMarket: withMarket.length,
      skillLabel: "Outcomes needed to rank", skillValue: Math.max(0, (board?.min_sample ?? 10) - (panel?.n || 0)), skillTone: "",
    };
  }
  if (market && market.n >= (board?.min_sample ?? 10)) {
    const diff = Math.round((market.brier - panel.brier) * 1000) / 1000;
    return {
      total: all.length, resolved: resolved.length, withMarket: withMarket.length,
      skillLabel: "AI vs market (Brier)", skillValue: `${diff > 0 ? "+" : ""}${diff}`, skillTone: diff > 0 ? "up" : "down",
    };
  }
  return {
    total: all.length, resolved: resolved.length, withMarket: withMarket.length,
    skillLabel: "Panel accuracy", skillValue: `${panel.accuracy}%`, skillTone: "up",
  };
}

// ── prediction detail ───────────────────────────────────────
export function predictionPage({ site, p, related }) {
  const t = topicOf(p.topic);
  const hz = horizonOf(p.horizon);
  const resolved = p.verdict === true || p.verdict === false;
  const canonical = `${site}/p/${p.id}`;
  const answered = Object.values(p.models || {}).filter((m) => typeof m.prob === "number").length;

  const body = `
<article class="detail">
  <nav class="crumbs mono"><a href="/timeline">Timeline</a> ${t ? `<span>/</span> <a href="/timeline?topic=${h(p.topic)}">${h(t.name)}</a>` : ""} <span>/</span> <span>${h(hz?.label || p.horizon)}</span></nav>

  <p class="detail-meta mono">
    ${t ? `<span style="--hue:${t.hue}">${h(t.icon)} ${h(t.name.toUpperCase())}</span>` : ""}
    <span>${h((hz?.label || "").toUpperCase())} HORIZON</span>
    <span>RESOLVES ${h(fmtDate(p.resolves_by).toUpperCase())}${resolved ? "" : ` · ${h(relative(p.resolves_by))}`}</span>
  </p>

  <h1>${h(p.headline)}</h1>
  ${p.context ? `<p class="detail-context">${h(p.context)}</p>` : ""}

  ${verdictBlock(p)}
  ${dial(p)}
  ${marketPanel(p)}

  <section class="block">
    <header class="block-head"><div><div class="mono kicker">MODEL BY MODEL</div><h2>What each one said</h2></div></header>
    ${modelList(p)}
    <p class="fineprint">${answered} of ${PANEL.length} models answered${p.spread != null ? ` · ${p.spread} points between the highest and lowest` : ""}. None was shown the market price.</p>
  </section>

  ${p.rules ? `<details class="rules"><summary>Resolution criteria</summary><p>${h(p.rules)}</p>${p.source_url ? `<p><a href="${h(p.source_url)}" rel="noopener nofollow" target="_blank">Original market ↗</a></p>` : ""}</details>` : ""}

  <section class="vote" data-id="${h(p.id)}">
    <div class="mono kicker">WHAT DO YOU THINK?</div>
    <div class="vote-bar"><span class="vote-fill" style="width:50%"></span></div>
    <div class="vote-count mono">loading…</div>
    <div class="vote-buttons">
      <button class="vote-btn yes" data-v="yes">Will happen</button>
      <button class="vote-btn no" data-v="no">Won't happen</button>
    </div>
  </section>

  <section class="share" data-share data-url="${h(canonical)}" data-text="${h(shareText(p))}">
    <button class="share-btn primary" data-act="native">Share</button>
    <a class="share-btn" data-act="x" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText(p))}&url=${encodeURIComponent(canonical)}" rel="noopener" target="_blank">X</a>
    <a class="share-btn" href="https://www.reddit.com/submit?url=${encodeURIComponent(canonical)}&title=${encodeURIComponent(p.headline)}" rel="noopener" target="_blank">Reddit</a>
    <a class="share-btn" href="https://news.ycombinator.com/submitlink?u=${encodeURIComponent(canonical)}&t=${encodeURIComponent(p.headline)}" rel="noopener" target="_blank">HN</a>
    <button class="share-btn" data-act="copy">Copy link</button>
  </section>

  <p class="attribution mono">
    Question sourced from ${h(sourceLabel(p))}${p.question_generated_at ? ` on ${h(fmtDate(p.question_generated_at))}` : ""}.
    Forecast by ${PANEL.map((m) => m.model).join(", ")} via OpenRouter.
  </p>
</article>

${related.length ? section("More in this thread", rows(related), { kicker: "RELATED", id: "related" }) : ""}`;

  return shell({
    site, page: "prediction", body, ogType: "article",
    title: `${p.headline} — ${p.consensus_prob}% say yes | WillHappen.ai`,
    description: description(p),
    canonical,
    ogImage: `${site}/og/${encodeURIComponent(p.id)}.png`,
    jsonLd: {
      "@context": "https://schema.org", "@type": "Article",
      headline: p.headline.slice(0, 110),
      description: description(p),
      datePublished: p.question_generated_at || p.created_at,
      dateModified: p.verdict_at || p.market?.checked_at || p.question_generated_at,
      url: canonical,
      image: `${site}/og/${encodeURIComponent(p.id)}.png`,
      author: { "@type": "Organization", name: "WillHappen.ai", url: site },
      publisher: { "@type": "Organization", name: "WillHappen.ai", url: site },
      ...(p.sources?.length ? { citation: p.sources.map((s) => s.url) } : {}),
    },
  });
}

const sourceLabel = (p) =>
  p.source === "polymarket" ? "Polymarket" : p.source === "kalshi" ? "Kalshi" : p.source === "community" ? "a community suggestion" : "a news sweep";

function description(p) {
  if (p.verdict === true) return `It happened. Six AI models had put it at ${p.consensus_prob}%. ${p.verdict_note || ""}`.trim();
  if (p.verdict === false) return `It didn't happen. Six AI models had put it at ${p.consensus_prob}%. ${p.verdict_note || ""}`.trim();
  const market = typeof p.market?.prob === "number" ? ` The market says ${p.market.prob}%.` : "";
  return `Six frontier AI models put this at ${p.consensus_prob}% by ${fmtDate(p.resolves_by)}.${market} Full reasoning from every model.`;
}

const shareText = (p) =>
  typeof p.market?.prob === "number"
    ? `"${p.headline}" — AI says ${p.consensus_prob}%, the market says ${p.market.prob}%.`
    : `"${p.headline}" — six frontier AI models put it at ${p.consensus_prob}%.`;

// ── timeline ────────────────────────────────────────────────
const SORT_LABELS = {
  new: "Newest", soon: "Resolving soon", contested: "Models disagree",
  edge: "Furthest from the market", confident: "Most confident", likely: "Most likely", unlikely: "Longest shots",
};

export function timelinePage({ site, list, total, query, index }) {
  const q = query;
  const chip = (name, value, label, current) => {
    const next = new URLSearchParams(q.raw);
    if (current === value) next.delete(name); else next.set(name, value);
    next.delete("offset");
    return `<a class="chip-link${current === value ? " on" : ""}" href="/timeline?${next.toString()}">${h(label)}</a>`;
  };

  const counts = countBy(index.predictions, "topic");
  const body = `
<section class="page-head">
  <div class="mono kicker">THE ARCHIVE</div>
  <h1>Every forecast,<br><i>in order.</i></h1>
  <p class="lede">${total} question${total === 1 ? "" : "s"}${q.topic ? ` in ${h(topicOf(q.topic)?.name || q.topic)}` : ""}${q.q ? ` matching “${h(q.q)}”` : ""}.
  Sorted by ${h((SORT_LABELS[q.sort] || "Newest").toLowerCase())}.</p>
</section>

<form class="filters" action="/timeline" method="get">
  <div class="filter-line">
    <input type="search" name="q" value="${h(q.q || "")}" placeholder="Search headlines…" aria-label="Search">
    <select name="sort" aria-label="Sort by">
      ${Object.entries(SORT_LABELS).map(([k, v]) => `<option value="${k}"${q.sort === k ? " selected" : ""}>${h(v)}</option>`).join("")}
    </select>
    <select name="status" aria-label="Status">
      <option value="">All outcomes</option>
      <option value="open"${q.status === "open" ? " selected" : ""}>Still open</option>
      <option value="resolved"${q.status === "resolved" ? " selected" : ""}>Settled</option>
      <option value="happened"${q.status === "happened" ? " selected" : ""}>Happened ✓</option>
      <option value="missed"${q.status === "missed" ? " selected" : ""}>Didn't ✗</option>
    </select>
    <button class="btn" type="submit">Apply</button>
  </div>
  ${q.topic ? `<input type="hidden" name="topic" value="${h(q.topic)}">` : ""}
  ${q.horizon ? `<input type="hidden" name="horizon" value="${h(q.horizon)}">` : ""}
</form>

<div class="chips" role="group" aria-label="Filter by horizon">
  ${HORIZONS.map((hz) => chip("horizon", hz.id, hz.label, q.horizon)).join("")}
</div>
<div class="chips topics" role="group" aria-label="Filter by topic">
  ${TOPICS.filter((t) => counts[t.id]).sort((a, b) => counts[b.id] - counts[a.id]).slice(0, 14)
    .map((t) => chip("topic", t.id, `${t.icon} ${t.name} ${counts[t.id]}`, q.topic)).join("")}
</div>

${rows(list)}
${pager(q, total, list.length)}`;

  return shell({
    site, page: "timeline", body,
    title: q.topic
      ? `${topicOf(q.topic)?.name || q.topic} forecasts — WillHappen.ai`
      : "Timeline — every AI forecast, in order | WillHappen.ai",
    description: `Browse ${total} AI consensus forecasts with prediction-market prices and verified outcomes. Filter by topic, horizon and result.`,
    canonical: `${site}/timeline${q.topic ? `?topic=${encodeURIComponent(q.topic)}` : ""}`,
  });
}

function pager(q, total, shown) {
  const limit = q.limit;
  const offset = q.offset;
  if (total <= limit) return "";
  const link = (o, label, rel) => {
    const p = new URLSearchParams(q.raw);
    p.set("offset", String(o));
    return `<a class="pill" rel="${rel}" href="/timeline?${p.toString()}">${label}</a>`;
  };
  return `<nav class="pager">
    ${offset > 0 ? link(Math.max(0, offset - limit), "← Newer", "prev") : "<span></span>"}
    <span class="mono">${offset + 1}–${offset + shown} of ${total}</span>
    ${offset + shown < total ? link(offset + limit, "Older →", "next") : "<span></span>"}
  </nav>`;
}

// ── topics ──────────────────────────────────────────────────
export function topicsPage({ site, index }) {
  const all = index.predictions;
  const stats = TOPICS.map((t) => {
    const mine = all.filter((p) => p.topic === t.id);
    const resolved = mine.filter((p) => p.verdict === true || p.verdict === false);
    const hits = resolved.filter((p) => p.verdict === true).length;
    const avg = mine.length ? Math.round(mine.reduce((a, p) => a + (p.consensus_prob || 0), 0) / mine.length) : null;
    return { t, n: mine.length, resolved: resolved.length, hits, avg, latest: [...mine].sort(byNewest)[0] || null };
  }).filter((s) => s.n > 0).sort((a, b) => b.n - a.n);

  const body = `
<section class="page-head">
  <div class="mono kicker">BY SUBJECT</div>
  <h1>What the machine<br><i>is watching.</i></h1>
  <p class="lede">${stats.length} live subjects across ${all.length} forecasts. Every deadline from one week out to fifty years.</p>
</section>

<div class="topic-grid">
${stats.map(({ t, n, resolved, hits, avg, latest }) => `  <a class="topic-card" href="/timeline?topic=${h(t.id)}" style="--hue:${t.hue}">
    <span class="topic-icon" aria-hidden="true">${h(t.icon)}</span>
    <h2>${h(t.name)}</h2>
    <p class="topic-hint">${latest ? h(latest.headline) : ""}</p>
    <dl class="topic-stats mono">
      <div><dt>forecasts</dt><dd>${n}</dd></div>
      <div><dt>settled</dt><dd>${resolved}</dd></div>
      ${avg === null ? "" : `<div><dt>avg odds</dt><dd>${avg}%</dd></div>`}
      ${resolved ? `<div><dt>came true</dt><dd>${Math.round((hits / resolved) * 100)}%</dd></div>` : ""}
    </dl>
  </a>`).join("\n")}
</div>

${section("Every horizon", `<div class="chips big">${HORIZONS.map((hz) => {
  const n = all.filter((p) => p.horizon === hz.id).length;
  return n ? `<a class="chip-link" href="/timeline?horizon=${h(hz.id)}">${h(hz.label)} <b>${n}</b></a>` : "";
}).join("")}</div>`, { kicker: "BY DEADLINE" })}`;

  return shell({
    site, page: "topics", body,
    title: "Topics — what the forecasting machine is watching | WillHappen.ai",
    description: "AI consensus forecasts by subject: politics, markets, AI, climate, space, health and more.",
    canonical: `${site}/topics`,
  });
}

// ── scoreboard ──────────────────────────────────────────────
export function modelsPage({ site, board }) {
  const min = board?.min_sample ?? 10;
  const ranked = (board?.rows || []).filter((r) => r.n > 0);
  const enough = ranked.some((r) => r.n >= min);

  const body = `
<section class="page-head">
  <div class="mono kicker">CALIBRATION</div>
  <h1>Which model actually<br><i>knows what happens next?</i></h1>
  <p class="lede">Every settled question scores every model that answered it. Brier score is the mean squared error of
  the probability — lower is better, and 0.250 is what you get by answering 50 to everything. The prediction
  markets are scored on exactly the same questions.</p>
</section>

${!ranked.length ? `<p class="empty">No questions have resolved yet. The board fills itself as deadlines pass.</p>` : `
${enough ? "" : `<p class="notice">Provisional — the board needs ${min} settled questions per row before the ranking means anything. Treat it as a sample, not a verdict.</p>`}
<div class="board-wrap">
<table class="board">
  <thead><tr><th>Model</th><th>Brier ↓</th><th>Skill</th><th>Right</th><th>Avg call</th><th>Boldness</th><th>Graded on</th></tr></thead>
  <tbody>
${ranked.map((r, i) => `    <tr class="${r.key === "market" ? "is-market" : r.key === "consensus" ? "is-consensus" : ""}${r.n < min ? " thin" : ""}">
      <th scope="row"><span class="board-rank">${i + 1}</span><span class="board-dot" style="--c:${h(r.color || "#a78bfa")}"></span><b>${h(r.name)}</b><em>${h(r.lab || "")}</em></th>
      <td class="num strong">${r.brier?.toFixed(3) ?? "—"}</td>
      <td class="num ${r.skill > 0 ? "up" : "down"}">${r.skill === null ? "—" : `${r.skill > 0 ? "+" : ""}${(r.skill * 100).toFixed(0)}%`}</td>
      <td class="num">${r.accuracy ?? "—"}%</td>
      <td class="num">${r.avg_prob ?? "—"}%</td>
      <td class="num">${r.boldness ?? "—"}</td>
      <td class="num muted">${r.n}</td>
    </tr>`).join("\n")}
  </tbody>
</table>
</div>

${section("Are they calibrated?", calibrationChart(ranked, min), {
  kicker: "SAID VS HAPPENED",
})}
`}

<section class="block">
  <header class="block-head"><div><div class="mono kicker">THE PANEL</div><h2>Who answers</h2></div></header>
  <ul class="panel-cards">
${rosterForClient().map((m) => `    <li style="--c:${m.color};--ink:${m.ink}"><span class="model-badge">${h(m.name[0])}</span><b>${h(m.name)}</b><em>${h(m.lab)}</em><code>${h(m.model)}</code></li>`).join("\n")}
  </ul>
  <p class="fineprint">Reached through OpenRouter. Swapping a lab in or out is one line in <code>src/ai/roster.js</code>.</p>
</section>`;

  return shell({
    site, page: "models", body,
    title: "Scoreboard — which AI model forecasts best | WillHappen.ai",
    description: "Brier scores and calibration for six frontier AI models on real resolved questions, benchmarked against Polymarket and Kalshi prices.",
    canonical: `${site}/models`,
  });
}

// A reliability diagram: what a forecaster said against what actually happened.
// The diagonal is perfect calibration.
//
// Eight equally-weighted polylines is spaghetti, so the two lines that carry
// the argument — the panel against the market — are drawn solid and the
// individual models sit behind them.
function calibrationChart(ranked, min) {
  const usable = ranked.filter((r) => r.calibration?.length >= 2 && r.n >= Math.min(min, 5));
  if (!usable.length) return `<p class="empty">Not enough settled questions to draw a calibration curve yet.</p>`;

  const lead = new Set(["consensus", "market"]);
  const ordered = [...usable.filter((r) => !lead.has(r.key)), ...usable.filter((r) => lead.has(r.key))];

  const W = 460, H = 440, pad = 46;
  const x = (v) => pad + (v / 100) * (W - pad * 2);
  const y = (v) => H - pad - (v / 100) * (H - pad * 2);

  return `<div class="calib">
<svg viewBox="0 0 ${W} ${H}" class="calib-svg" role="img" aria-label="Calibration: predicted probability against observed outcome rate">
  <rect x="${pad}" y="${pad}" width="${W - pad * 2}" height="${H - pad * 2}" fill="rgba(255,255,255,.02)" stroke="rgba(255,255,255,.1)"/>
  ${[25, 50, 75].map((v) => `<line x1="${x(v)}" y1="${pad}" x2="${x(v)}" y2="${H - pad}" stroke="rgba(255,255,255,.05)"/><line x1="${pad}" y1="${y(v)}" x2="${W - pad}" y2="${y(v)}" stroke="rgba(255,255,255,.05)"/>`).join("")}
  <line x1="${x(0)}" y1="${y(0)}" x2="${x(100)}" y2="${y(100)}" stroke="rgba(245,243,255,.3)" stroke-dasharray="4 5"/>
  ${ordered.map((r) => {
    const on = lead.has(r.key);
    const pts = r.calibration.map((c) => `${x(c.said)},${y(c.happened)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${h(r.color || "#a78bfa")}" stroke-width="${on ? 2.5 : 1.4}" stroke-linejoin="round" opacity="${on ? 1 : 0.34}"/>` +
      r.calibration.map((c) => `<circle cx="${x(c.said)}" cy="${y(c.happened)}" r="${on ? Math.min(7, 3 + c.n * 0.4) : 2.6}" fill="${h(r.color || "#a78bfa")}" opacity="${on ? 1 : 0.4}"><title>${h(r.name)}: said ~${c.said}%, happened ${c.happened}% (${c.n} question${c.n === 1 ? "" : "s"})</title></circle>`).join("");
  }).join("")}
  ${[0, 50, 100].map((v) => `<text x="${x(v)}" y="${H - pad + 20}" text-anchor="middle" class="calib-tick">${v}</text><text x="${pad - 10}" y="${y(v) + 4}" text-anchor="end" class="calib-tick">${v}</text>`).join("")}
  <text x="${W / 2}" y="${H - 8}" text-anchor="middle" class="calib-label">what it said →</text>
  <text x="13" y="${H / 2}" text-anchor="middle" transform="rotate(-90 13 ${H / 2})" class="calib-label">what happened →</text>
</svg>
<div class="calib-aside">
  <ul class="calib-key">${ordered.slice().reverse().map((r) =>
    `<li${lead.has(r.key) ? ' class="on"' : ""}><span style="--c:${h(r.color || "#a78bfa")}"></span>${h(r.name)}</li>`).join("")}</ul>
  <p class="fineprint">On the dashed line means honest: when it says 70%, it happens 70% of the time.
  Above the line is under-confident, below is over-confident. The panel and the markets are drawn
  solid because that is the comparison worth reading; individual models sit behind them.</p>
</div>
</div>`;
}

// ── about ───────────────────────────────────────────────────
export function aboutPage({ site }) {
  const body = `
<section class="page-head">
  <div class="mono kicker">METHOD</div>
  <h1>How this works,<br><i>in full.</i></h1>
  <p class="lede">No hand-picked questions, no edited answers, no quietly deleted misses. The whole loop is one
  Cloudflare Worker and the code is public.</p>
</section>

<div class="prose">
  <h2>Where the questions come from</h2>
  <p>Two sources. The first is prediction markets — Polymarket and Kalshi — where people risk money on a
  dated, written-down outcome. Those questions arrive already falsifiable and already carry a price, which
  is what we benchmark the models against. The second is a search-grounded sweep of one news beat per run,
  which catches the things nobody has opened a market on.</p>
  <p>Everything is then rewritten into a single declarative statement with a deadline. Anything vague,
  duplicated, unfalsifiable, or about a private individual is dropped at this step.</p>

  <h2>How the forecast is made</h2>
  <p>Six models from six different labs answer the same prompt independently: ${PANEL.map((m) => m.name).join(", ")}.
  The published number is the median, not the mean — one model at 2% shouldn't drag a panel that otherwise agrees.
  We also publish the spread, because six models agreeing at 60% and six models scattered from 10 to 95 are very
  different claims.</p>
  <p><b>No model is ever shown the market price.</b> If it were, the comparison on every page would only measure
  how well a model can read a number out of its prompt.</p>

  <h2>How outcomes get decided</h2>
  <p>Once a deadline passes, a search-grounded model gathers evidence and cites it. A second model then rules on
  that evidence alone — it never searches, so it can't talk itself into a story. A verdict publishes automatically
  only when it is confident and backed by at least two sources; everything else waits for a human. The sources are
  printed on the page so anyone can check the call, and
  <a href="https://github.com/dmusato/willhappen.ai/issues/new?template=report-outcome.yml" rel="noopener" target="_blank">disputing one</a>
  takes a minute.</p>

  <h2>How the scoreboard works</h2>
  <p>Every settled question scores every model that answered it, using the Brier score: the squared error of the
  probability. Lower is better; 0.250 is what you get by answering 50 to everything. The market price on the day we
  asked is scored the same way on the same questions, which is the only honest way to ask whether any of this beats
  the crowd. Nothing is graded retroactively and no forecast is edited after the fact.</p>

  <h2>What it costs</h2>
  <p>A question costs roughly a cent to put to all six models. The Worker keeps a spend ledger and stops when the
  daily budget is reached, which is why forecasts appear in small batches through the day instead of all at once.</p>

  <h2>Run your own</h2>
  <p>This is MIT-licensed and deliberately small: one Worker, one KV namespace, one OpenRouter key, no build step
  and no framework. Point it at your own topics and it becomes your forecasting archive.</p>
  <p><a class="btn" href="https://github.com/dmusato/willhappen.ai" rel="noopener" target="_blank">Get the code on GitHub</a></p>

  <h2>Limits, stated plainly</h2>
  <ul>
    <li>Language models are not oracles. They are fluent, confident, and wrong on a schedule nobody has mapped — which is the point of keeping score in public.</li>
    <li>Question selection is biased toward what markets and English-language news cover.</li>
    <li>Auto-resolution can be wrong. Confident verdicts still publish themselves, with their sources attached, and disputes are welcome.</li>
    <li>None of this is financial advice.</li>
  </ul>
</div>`;

  return shell({
    site, page: "about", body,
    title: "How it works — method, scoring and limits | WillHappen.ai",
    description: "The full method: where the questions come from, how six AI models are polled, how outcomes are auto-resolved against sources, and how the Brier scoreboard is computed.",
    canonical: `${site}/about`,
  });
}

// ── suggest ─────────────────────────────────────────────────
export function suggestPage({ site, prefill = "" }) {
  const body = `
<section class="page-head narrow">
  <div class="mono kicker">SUGGEST</div>
  <h1>Something the machine<br><i>should be watching?</i></h1>
  <p class="lede">The archive builds itself from markets and the news, but it misses things. Send one and it
  becomes a public GitHub issue; good ones get added to the queue and go to the panel on the next run.</p>
</section>

<form class="form" id="suggest-form">
  <label>The statement
    <textarea name="headline" required minlength="12" maxlength="240" placeholder="A single thing that either happens or doesn't, with a deadline. For example: “The EU opens a formal antitrust case against a frontier AI lab before July 2027.”">${h(prefill)}</textarea>
  </label>
  <div class="form-row2">
    <label>By when
      <select name="horizon" required>${HORIZONS.map((hz) => `<option value="${hz.id}"${hz.id === "1y" ? " selected" : ""}>${h(hz.label)}</option>`).join("")}</select>
    </label>
    <label>Subject
      <select name="topic"><option value="">—</option>${TOPICS.map((t) => `<option value="${t.id}">${h(t.name)}</option>`).join("")}</select>
    </label>
  </div>
  <div class="form-foot">
    <p class="fineprint">Posted anonymously as a public GitHub issue. No account needed.</p>
    <button class="btn" type="submit">Submit</button>
  </div>
  <p class="form-status" role="status"></p>
</form>`;

  return shell({
    site, page: "suggest", body,
    title: "Suggest a question — WillHappen.ai",
    description: "Propose a falsifiable question for six frontier AI models to forecast.",
    canonical: `${site}/suggest`,
  });
}

export function notFoundPage({ site }) {
  const body = `<section class="page-head narrow">
  <div class="mono kicker">404</div>
  <h1>That one<br><i>didn't happen.</i></h1>
  <p class="lede">No page at this address.</p>
  <p><a class="btn" href="/timeline">Browse the timeline</a></p>
</section>`;
  return shell({ site, page: "404", body, title: "Not found — WillHappen.ai", description: "Page not found.", canonical: `${site}/404` });
}

// ── helpers ─────────────────────────────────────────────────
const byNewest = (a, b) =>
  String(b.verdict_at || b.question_generated_at || b.created_at || "").localeCompare(String(a.verdict_at || a.question_generated_at || a.created_at || ""));

function countBy(list, key) {
  const out = {};
  for (const p of list) out[p[key]] = (out[p[key]] || 0) + 1;
  return out;
}

export { dial, rows, section, fmtDate, probTone, usd, sourceList };
