// WillHappen.ai — shared client helpers. Vanilla. No deps.
(() => {
  const MODELS = ["gemini", "claude", "gpt", "grok", "llama", "deepseek"];
  const MODEL_NAMES = {
    gemini: "Gemini", claude: "Claude", gpt: "GPT-5",
    grok: "Grok", llama: "Llama", deepseek: "DeepSeek",
  };
  const MODEL_LETTER = { gemini: "G", claude: "C", gpt: "O", grok: "X", llama: "L", deepseek: "D" };

  const state = {
    predictions: null,
    horizons: null,
    subjects: null,
  };

  // ── data ───────────────────────────────────────────────
  async function loadData() {
    if (state.predictions) return state;
    const [p, h, s] = await Promise.all([
      fetch("/api/predictions").then((r) => r.json()).catch(() =>
        fetch("/data/index.json").then((r) => r.json())),
      fetch("/data/horizons.json").then((r) => r.json()),
      fetch("/data/subjects.json").then((r) => r.json()),
    ]);
    state.predictions = (p.predictions || p).slice();
    state.horizons = h;
    state.subjects = s;
    return state;
  }

  async function loadPrediction(id) {
    const r = await fetch(`/api/predictions/${encodeURIComponent(id)}`);
    if (r.ok) return r.json();
    const fallback = await fetch(`/data/predictions/${encodeURIComponent(id)}.json`);
    return fallback.ok ? fallback.json() : null;
  }

  // ── helpers ─────────────────────────────────────────────
  const probClass = (v) => (v > 70 ? "high" : v > 40 ? "mid" : "low");
  const horLabel = (id) => (state.horizons || []).find((h) => h.id === id)?.label || id;
  const horShort = (id) => (state.horizons || []).find((h) => h.id === id)?.short || id;
  const subjName = (id) => (state.subjects || []).find((s) => s.id === id)?.name || id;

  function el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "className") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v != null) n.setAttribute(k, v);
    }
    for (const c of [].concat(children)) {
      if (c == null) continue;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return n;
  }

  function dot(m, size) {
    const d = el("span", { className: "model-dot", "data-m": m, title: MODEL_NAMES[m] }, MODEL_LETTER[m]);
    if (size) { d.style.width = d.style.height = size + "px"; d.style.fontSize = (size * 0.5) + "px"; }
    return d;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  // ── prediction row ──────────────────────────────────────
  function predRow(p) {
    const row = el("a", { className: "pred-row", href: `/p/${p.id}` });
    row.appendChild(el("div", { className: "when" }, `IN ${horLabel(p.horizon).toUpperCase()}`));
    const headline = el("div", { className: "headline" });
    headline.appendChild(document.createTextNode(p.headline));
    if (p.verdict === true) headline.appendChild(el("span", { className: "verdict-chip yes" }, "✓ HAPPENED"));
    else if (p.verdict === false) headline.appendChild(el("span", { className: "verdict-chip no" }, "✗ DIDN'T"));
    row.appendChild(headline);
    row.appendChild(el("div", {
      className: `prob ${probClass(p.consensus_prob)}`,
      html: `${p.consensus_prob}<span class="pct">%</span>`,
    }));
    return row;
  }

  // ── rendering: feed (landing) ───────────────────────────
  async function renderRecentFeed(containerId, limit = 5) {
    const c = document.getElementById(containerId);
    if (!c) return;
    await loadData();
    const items = state.predictions
      .slice()
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .slice(0, limit);
    c.innerHTML = "";
    for (const p of items) c.appendChild(predRow(p));
  }

  // ── rendering: timeline ─────────────────────────────────
  async function renderTimeline() {
    await loadData();
    const list = document.getElementById("timeline-list");
    const slider = document.getElementById("rewind");
    const sliderLabel = document.getElementById("rewind-label");
    const calendar = document.getElementById("calendar");
    if (!list) return;

    const now = new Date();
    const maxYears = 100;
    const renderList = (maxFutureYears) => {
      const cutoff = new Date(now.getFullYear() + maxFutureYears, now.getMonth(), now.getDate());
      const filtered = state.predictions.filter((p) => new Date(p.resolves_by) <= cutoff)
        .sort((a, b) => new Date(a.resolves_by) - new Date(b.resolves_by));
      list.innerHTML = "";
      for (const p of filtered) list.appendChild(predRow(p));
      if (sliderLabel) sliderLabel.textContent = `${maxFutureYears}Y AHEAD · ${filtered.length} PREDICTIONS`;
    };

    if (slider) {
      slider.addEventListener("input", (e) => renderList(parseInt(e.target.value, 10)));
      renderList(parseInt(slider.value, 10));
    } else {
      renderList(maxYears);
    }

    if (calendar) renderCalendar(calendar);
  }

  function renderCalendar(c) {
    const hs = state.horizons;
    c.innerHTML = "";
    c.appendChild(el("div", { className: "cal-head" }, ""));
    for (const h of hs) c.appendChild(el("div", { className: "cal-head" }, h.short));
    const buckets = {};
    for (const p of state.predictions) {
      const key = p.topic + "|" + p.horizon;
      (buckets[key] = buckets[key] || []).push(p);
    }
    for (const s of state.subjects.slice(0, 10)) {
      c.appendChild(el("div", { className: "cal-head", style: "text-align:left;padding-left:8px;" }, s.icon + " " + s.name.split(" ")[0]));
      for (const h of hs) {
        const list = buckets[s.id + "|" + h.id] || [];
        const cell = el("a", {
          className: "cal-cell" + (list.length ? " has" : "") + (list.some((p) => p.verdict !== null) ? " resolved" : ""),
          href: list[0] ? `/p/${list[0].id}` : "javascript:void(0)",
          title: list.map((p) => `${p.consensus_prob}% · ${p.headline}`).join("\n") || `No ${h.short} prediction for ${s.name}`,
        }, list.length ? String(list.length) : "");
        c.appendChild(cell);
      }
    }
  }

  // ── rendering: detail ───────────────────────────────────
  async function renderDetail(id) {
    await loadData();
    const p = await loadPrediction(id);
    const root = document.getElementById("detail");
    if (!p) {
      root.innerHTML = "<h2 class='display' style='font-size:36px;'>Prediction not found.</h2><p><a class='pill' href='/timeline'>Back to timeline</a></p>";
      return;
    }
    document.title = `${p.headline} — WillHappen.ai`;

    const meta = `${subjName(p.topic).toUpperCase()} · ${horLabel(p.horizon).toUpperCase()} HORIZON · BY ${fmtDate(p.resolves_by).toUpperCase()}`;
    const gen = new Date(p.question_generated_at);

    root.innerHTML = "";
    root.appendChild(el("div", { className: "mono detail-meta" }, meta));
    root.appendChild(el("div", { className: "detail-headline" }, `"${p.headline}"`));
    const big = el("div", { className: "big-prob", html: `${p.consensus_prob}<span class="pct">%</span>` });
    root.appendChild(big);
    root.appendChild(el("div", { className: "mono consensus-tag" }, p.verdict === true ? "HAPPENED ✓" : p.verdict === false ? "DIDN'T HAPPEN ✗" : "CONSENSUS"));

    // model breakdown
    const grid = el("div", { className: "model-grid" });
    for (const m of MODELS) {
      const mm = p.models?.[m];
      if (!mm) continue;
      const cell = el("div", { className: "model-cell hover", title: mm.note, tabindex: "0" });
      cell.appendChild(dot(m, 26));
      cell.appendChild(el("div", { className: "mp" }, `${mm.prob}%`));
      cell.appendChild(el("div", { className: "mn" }, MODEL_NAMES[m]));
      cell.addEventListener("click", () => toast(`${MODEL_NAMES[m]} (${mm.prob}%): ${mm.note}`));
      grid.appendChild(cell);
    }
    root.appendChild(grid);

    // attribution
    const providers = Object.values(p.models || {}).map((v) => v.provider).join(", ");
    const questionBy = p.question_generated_by || "unknown";
    root.appendChild(el("div", {
      className: "card attribution",
      html: `
        <div><b>Question drafted by</b> <code>${questionBy}</code> on ${fmtDate(gen)}.</div>
        <div style="margin-top:6px;"><b>Evaluated by 6 models</b> via Cloudflare AI Gateway: <code>${providers}</code>.</div>
        <div style="margin-top:6px;"><b>Source:</b> ${p.source}. Resolves by <b>${fmtDate(p.resolves_by)}</b>.</div>
      `,
    }));

    // community bar + verdict buttons
    const votes = el("div", { className: "card community-bar" });
    votes.innerHTML = `
      <div class="mono-sm" style="min-width:70px;">COMMUNITY</div>
      <div class="track"><div class="fill" id="fill" style="width:50%"></div></div>
      <div class="num" id="votenum">— / —</div>`;
    root.appendChild(votes);

    const btns = el("div", { className: "verdict-buttons" });
    const yBtn = el("button", { className: "verdict-btn yes", "data-v": "yes" }, "Happened ✓");
    const nBtn = el("button", { className: "verdict-btn no", "data-v": "no" }, "Didn't ✗");
    btns.appendChild(yBtn); btns.appendChild(nBtn);
    root.appendChild(btns);

    // share bar
    const shareUrl = `https://willhappen.ai/p/${p.id}`;
    const shareText = `"${p.headline}" — ${p.consensus_prob}% say it'll happen by ${fmtDate(p.resolves_by)}. Six AI models agree.`;
    const share = el("div", { className: "share-bar" });
    share.appendChild(el("button", {
      className: "share-btn primary",
      onclick: () => shareNative(shareText, shareUrl),
    }, "Share ↗"));
    share.appendChild(el("a", {
      className: "share-btn",
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
      target: "_blank", rel: "noopener",
    }, "𝕏"));
    share.appendChild(el("a", {
      className: "share-btn",
      href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
      target: "_blank", rel: "noopener",
    }, "Facebook"));
    share.appendChild(el("a", {
      className: "share-btn",
      href: `https://reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(p.headline)}`,
      target: "_blank", rel: "noopener",
    }, "Reddit"));
    share.appendChild(el("button", {
      className: "share-btn",
      onclick: () => { navigator.clipboard?.writeText(shareUrl); toast("Link copied"); },
    }, "Copy link"));
    root.appendChild(share);

    // load + wire voting
    await refreshVotes(p.id);
    const myVerdict = localStorage.getItem(`wh.v.${p.id}`);
    if (myVerdict === "yes") yBtn.classList.add("voted");
    if (myVerdict === "no") nBtn.classList.add("voted");
    [yBtn, nBtn].forEach((b) => b.addEventListener("click", () => castVote(p.id, b.dataset.v)));
  }

  // ── voting ──────────────────────────────────────────────
  function fingerprint() {
    let f = localStorage.getItem("wh.fp");
    if (!f) { f = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); localStorage.setItem("wh.fp", f); }
    return f;
  }
  async function refreshVotes(id) {
    try {
      const r = await fetch(`/api/vote?id=${encodeURIComponent(id)}`);
      if (!r.ok) return;
      const { yes = 0, no = 0 } = await r.json();
      const total = yes + no;
      const pct = total ? Math.round((yes / total) * 100) : 50;
      const fill = document.getElementById("fill");
      const num = document.getElementById("votenum");
      if (fill) fill.style.width = pct + "%";
      if (num) num.textContent = total ? `${pct}% YES · ${total} VOTES` : "NO VOTES YET";
    } catch (_) {}
  }
  async function castVote(id, v) {
    const prev = localStorage.getItem(`wh.v.${id}`);
    localStorage.setItem(`wh.v.${id}`, v);
    document.querySelector(".verdict-btn.yes")?.classList.toggle("voted", v === "yes");
    document.querySelector(".verdict-btn.no")?.classList.toggle("voted", v === "no");
    try {
      await fetch("/api/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, verdict: v, fp: fingerprint(), prev }),
      });
      await refreshVotes(id);
      toast(v === "yes" ? "Marked as happened" : "Marked as didn't happen");
    } catch (_) { toast("Couldn't save vote"); }
  }

  // ── suggest form submit ─────────────────────────────────
  async function submitSuggestion(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      const r = await fetch("/api/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      if (r.ok) {
        const { issueUrl } = await r.json().catch(() => ({}));
        toast("Submitted — thank you!");
        if (issueUrl) setTimeout(() => (window.location.href = issueUrl), 1200);
        form.reset();
      } else { toast("Couldn't submit. Try again."); }
    } catch (_) { toast("Network error. Try again."); }
  }

  // ── share / toast ───────────────────────────────────────
  function shareNative(text, url) {
    if (navigator.share) navigator.share({ title: "WillHappen.ai", text, url }).catch(() => {});
    else { navigator.clipboard?.writeText(url); toast("Link copied"); }
  }
  function toast(msg) {
    let t = document.getElementById("toast");
    if (!t) { t = el("div", { id: "toast", className: "toast" }); document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2000);
  }

  // ── aurora parallax (subtle, desktop only) ──────────────
  function initParallax() {
    if (matchMedia("(max-width: 720px)").matches) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    document.addEventListener("mousemove", (e) => {
      const x = (e.clientX / innerWidth - 0.5) * 10;
      const y = (e.clientY / innerHeight - 0.5) * 10;
      document.body.style.setProperty("--px", x + "px");
      document.body.style.setProperty("--py", y + "px");
    }, { passive: true });
  }

  // ── landing ask → route to timeline search (simple) ─────
  function initAsk() {
    const btn = document.getElementById("ask-submit");
    const input = document.getElementById("ask-input");
    if (!btn || !input) return;
    const go = () => {
      const q = input.value.trim();
      if (!q) { input.focus(); return; }
      // No live inference on the client — redirect to suggest with prefill.
      window.location.href = "/suggest?q=" + encodeURIComponent(q);
    };
    btn.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  // ── expose ──────────────────────────────────────────────
  window.WH = {
    loadData, renderRecentFeed, renderTimeline, renderDetail,
    submitSuggestion, shareNative, toast, initParallax, initAsk,
    MODELS, MODEL_NAMES,
  };

  document.addEventListener("DOMContentLoaded", () => {
    initParallax();
    initAsk();
    const suggestQ = new URLSearchParams(location.search).get("q");
    const ta = document.querySelector("textarea[name=headline]");
    if (ta && suggestQ) ta.value = suggestQ;
  });
})();
