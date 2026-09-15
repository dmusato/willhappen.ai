// Progressive enhancement only. Every page is already complete when this file
// arrives — this adds the voting widget, share actions and the bits of motion
// that are nicer with JS than without it.
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ── analytics ───────────────────────────────────────────
  // Measurement, never a dependency: every call is a no-op when the tag is
  // absent — local dev, an unset GA_ID, a blocker — and nothing on the page
  // waits on it or breaks when it throws.
  //
  // Only what GA4 cannot already see for itself. Page views, 90% scroll,
  // outbound clicks, ?q= searches and form submits all arrive through enhanced
  // measurement; sending our own would double-count them and leave neither
  // number worth trusting. What is left is the things that happen without a
  // navigation: a vote, a share, reaching the reasoning, opening the rules.
  const track = (name, params) => {
    try { window.gtag && window.gtag("event", name, params || {}); } catch { /* never break a click */ }
  };
  const predictionId = () => $(".vote")?.dataset.id || undefined;

  // ── toast ───────────────────────────────────────────────
  let toastEl, toastTimer;
  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "toast";
      toastEl.setAttribute("role", "status");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
  }

  // ── nav ─────────────────────────────────────────────────
  function initNav() {
    const btn = $(".nav-toggle");
    const links = $("#nav-links");
    if (!btn || !links) return;
    btn.addEventListener("click", () => {
      const open = links.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
    });
  }

  // ── aurora parallax ─────────────────────────────────────
  function initParallax() {
    if (reduced || matchMedia("(hover: none)").matches) return;
    let queued = false, x = 0, y = 0;
    addEventListener("pointermove", (e) => {
      x = (e.clientX / innerWidth - 0.5) * 26;
      y = (e.clientY / innerHeight - 0.5) * 26;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        document.body.style.setProperty("--px", `${x}px`);
        document.body.style.setProperty("--py", `${y}px`);
        queued = false;
      });
    }, { passive: true });
  }

  // ── count-up on the big number ──────────────────────────
  function initOdometer() {
    const el = $(".odo");
    if (!el) return;
    const to = Number(el.dataset.to);
    if (!Number.isFinite(to) || reduced) return;
    const start = performance.now();
    const dur = 900;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      // ease-out-cubic: fast off the line, settles on the real number
      el.textContent = String(Math.round(to * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(tick);
      else el.textContent = String(to);
    };
    el.textContent = "0";
    requestAnimationFrame(tick);
  }

  // ── voting ──────────────────────────────────────────────
  const fingerprint = () => {
    let fp = localStorage.getItem("wh.fp");
    if (!fp) {
      fp = (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, "");
      localStorage.setItem("wh.fp", fp);
    }
    return fp;
  };

  function initVote() {
    const box = $(".vote");
    if (!box) return;
    const id = box.dataset.id;
    const fill = $(".vote-fill", box);
    const count = $(".vote-count", box);
    const buttons = $$(".vote-btn", box);

    const paint = ({ yes = 0, no = 0 }) => {
      const total = yes + no;
      const pct = total ? Math.round((yes / total) * 100) : 50;
      fill.style.width = `${pct}%`;
      count.textContent = total
        ? `${pct}% say it will · ${total} vote${total === 1 ? "" : "s"}`
        : "no votes yet — be first";
    };

    const mine = localStorage.getItem(`wh.v.${id}`);
    buttons.forEach((b) => b.classList.toggle("on", b.dataset.v === mine));

    fetch(`/api/vote?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && paint(d))
      .catch(() => { count.textContent = ""; });

    buttons.forEach((btn) => btn.addEventListener("click", async () => {
      const v = btn.dataset.v;
      buttons.forEach((b) => b.classList.toggle("on", b === btn));
      localStorage.setItem(`wh.v.${id}`, v);
      try {
        const res = await fetch("/api/vote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, verdict: v, fp: fingerprint() }),
        });
        const data = await res.json();
        if (res.ok) {
          paint(data);
          track("vote", { verdict: v, prediction: id });
          toast(v === "yes" ? "Voted: it will happen" : "Voted: it won't");
        }
        else toast(data.error === "rate_limited" ? "Give it a minute before changing again" : "Couldn't save that vote");
      } catch {
        toast("Offline — vote not saved");
      }
    }));
  }

  // ── share ───────────────────────────────────────────────
  function initShare() {
    const bar = $("[data-share]");
    if (!bar) return;
    const { url, text } = bar.dataset;

    const shared = (method) => track("share", { method, prediction: predictionId() });

    $('[data-act="native"]', bar)?.addEventListener("click", async () => {
      if (navigator.share) {
        try { await navigator.share({ title: "WillHappen.ai", text, url }); shared("native"); return; } catch { /* dismissed */ }
      }
      copy(url); shared("copy");
    });
    $('[data-act="copy"]', bar)?.addEventListener("click", () => { copy(url); shared("copy"); });

    // The network links leave the site, so GA4 counts them as outbound clicks
    // of its own. Naming them here too is not double-counting the visit — it
    // puts every way of sharing under one event, which is the only way to see
    // that copy-link beats all four networks put together.
    $$("a.share-btn", bar).forEach((a) => {
      const host = (a.getAttribute("href") || "").match(/^https?:\/\/([^/]+)/)?.[1] || "";
      const method = /reddit/.test(host) ? "reddit" : /ycombinator/.test(host) ? "hn"
        : /twitter|x\.com/.test(host) ? "x" : host.split(".").slice(-2)[0] || "link";
      a.addEventListener("click", () => shared(method));
    });
  }

  async function copy(url) {
    try { await navigator.clipboard.writeText(url); toast("Link copied"); }
    catch { toast(url); }
  }

  // ── suggest form ────────────────────────────────────────
  function initSuggest() {
    const form = $("#suggest-form");
    if (!form) return;
    const status = $(".form-status", form);
    const button = $("button[type=submit]", form);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(form));
      button.disabled = true;
      status.className = "form-status";
      status.textContent = "Sending…";
      try {
        const res = await fetch("/api/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          status.className = "form-status ok";
          status.innerHTML = data.issueUrl
            ? `Thanks — it's <a href="${data.issueUrl}" target="_blank" rel="noopener">issue #${data.number}</a>.`
            : "Thanks — submitted.";
          form.reset();
        } else {
          status.className = "form-status err";
          status.textContent = data.error === "rate_limited"
            ? "One suggestion a minute, please."
            : data.error === "suggestions_not_configured"
              ? "Suggestions aren't wired up on this instance yet."
              : data.error || "That didn't go through.";
        }
      } catch {
        status.className = "form-status err";
        status.textContent = "Network error — try again.";
      } finally {
        button.disabled = false;
      }
    });
  }

  // ── reveal on scroll ────────────────────────────────────
  function initReveal() {
    if (reduced || !("IntersectionObserver" in window)) return;
    const targets = $$(".block, .topic-card, .row");
    if (!targets.length) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("reveal");
        io.unobserve(e.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });
    targets.forEach((t) => io.observe(t));
  }

  // Did the reader get as far as the reasoning? On a forecast page the answers
  // sit below the dial and the market panel, so GA4's 90%-scroll event fires
  // long after this one and cannot stand in for it.
  function initReadDepth() {
    const list = $(".models");
    if (!list || !("IntersectionObserver" in window)) return;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      track("read_answers", { prediction: predictionId() });
    }, { threshold: 0.2 });
    seen.observe(list);
  }

  // Opening the resolution criteria is the clearest signal a reader is checking
  // the claim rather than skimming it.
  function initRules() {
    const rules = $("details.rules");
    rules?.addEventListener("toggle", () => {
      if (rules.open) track("open_rules", { prediction: predictionId() });
    }, { once: true });
  }

  // Submitting a filter should not carry an empty field into the URL.
  function initFilters() {
    const form = $(".filters");
    if (!form) return;
    form.addEventListener("submit", () => {
      $$("input, select", form).forEach((el) => { if (!el.value) el.disabled = true; });
    });
  }

  const boot = () => {
    initNav(); initParallax(); initOdometer(); initVote();
    initShare(); initSuggest(); initReveal(); initFilters();
    initReadDepth(); initRules();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.WH = { toast };
})();
