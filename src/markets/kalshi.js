// Kalshi — CFTC-regulated exchange, public read API, no key.
//
// The flat /markets feed is ~90% sports legs with no liquidity figures, so we
// read /events instead: events carry a category we can filter on and nest
// their markets. Liquidity is derived from open interest, which Kalshi does
// report, rather than the liquidity field, which it returns as 0.

const API = "https://api.elections.kalshi.com/trade-api/v2";

export const id = "kalshi";
export const label = "Kalshi";

const SKIP_CATEGORIES = /sport|entertainment/i;

// Kalshi rejects /events outright above 200 rather than clamping, and the
// registry hands every source the same page size — so one caller asking for a
// bigger sweep would drop Kalshi from the harvest entirely instead of just
// reading fewer rows from it.
const MAX_PAGE = 200;

export async function fetchMarkets(env, { limit = MAX_PAGE, minLiquidity = 5000 } = {}) {
  const page = Math.min(Math.max(1, limit), MAX_PAGE);
  const res = await fetch(`${API}/events?status=open&with_nested_markets=true&limit=${page}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`kalshi ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const events = (await res.json())?.events || [];

  const out = [];
  for (const ev of events) {
    if (SKIP_CATEGORIES.test(String(ev.category || ""))) continue;
    for (const m of ev.markets || []) {
      const row = normalize(ev, m);
      if (row && usable(row, minLiquidity)) out.push(row);
    }
  }
  return out;
}

function normalize(ev, m) {
  const bid = num(m.yes_bid_dollars);
  const ask = num(m.yes_ask_dollars);
  const last = num(m.last_price_dollars);
  const prev = num(m.previous_price_dollars);
  const price = bid !== null && ask !== null && ask > 0 ? (bid + ask) / 2 : last;
  if (price === null || price <= 0) return null;

  const title = String(m.title || ev.title || "").replace(/\s{2,}/g, " ").trim();
  const series = String(ev.series_ticker || ev.event_ticker || "").split("-")[0].toLowerCase();
  const openInterest = num(m.open_interest_fp) || 0;

  return {
    source: id,
    externalId: `kalshi:${m.ticker}`,
    question: title,
    rules: String(m.rules_primary || "").replace(/\s{2,}/g, " ").trim().slice(0, 1200),
    url: series ? `https://kalshi.com/markets/${series}` : "https://kalshi.com/markets",
    prob: Math.round(price * 100),
    endDate: m.close_time || m.expiration_time || null,
    volumeUsd: Math.round(num(m.volume_fp) || 0),
    liquidityUsd: Math.round(openInterest * price),
    change1w: null,
    change1m: prev !== null && last !== null ? Math.round((last - prev) * 100) : null,
    spreadPts: bid !== null && ask !== null ? Math.round((ask - bid) * 100) : null,
    group: ev.event_ticker || m.ticker,
    tags: [String(ev.category || "").toLowerCase()].filter(Boolean),
  };
}

function usable(m, minLiquidity) {
  const q = m.question;
  if (!q || q.length < 16 || q.length > 220) return false;
  // Kalshi templates leave holes when a candidate name is missing.
  if (/\bWill\s+(be|become)\b/i.test(q)) return false;
  if (/(^|,)\s*(yes|no) /i.test(q) || q.split(",").length > 3) return false;
  if (!m.endDate) return false;
  const daysOut = (Date.parse(m.endDate) - Date.now()) / 86_400_000;
  if (!Number.isFinite(daysOut) || daysOut < 2 || daysOut > 3700) return false;
  if (m.liquidityUsd < minLiquidity) return false;
  if (m.prob < 3 || m.prob > 97) return false;
  return true;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function fetchOne(env, externalId) {
  const ticker = String(externalId).split(":")[1];
  if (!ticker) return null;
  const res = await fetch(`${API}/markets/${encodeURIComponent(ticker)}`, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const m = (await res.json())?.market;
  if (!m) return null;
  return normalize({ series_ticker: String(m.event_ticker || "").split("-")[0], event_ticker: m.event_ticker, title: m.title, category: "" }, m);
}

export async function fetchResolution(env, externalId) {
  const ticker = String(externalId).split(":")[1];
  if (!ticker) return null;
  const res = await fetch(`${API}/markets/${encodeURIComponent(ticker)}`, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const m = (await res.json())?.market;
  if (!m) return null;

  const status = String(m.status || "").toLowerCase();
  const result = String(m.result || "").toLowerCase();
  const settled = (status === "settled" || status === "finalized") && (result === "yes" || result === "no");
  const series = String(m.event_ticker || m.ticker || "").split("-")[0].toLowerCase();

  return {
    source: id,
    settled,
    outcome: settled ? result : null,
    disputed: false,
    question: String(m.title || "").replace(/\s{2,}/g, " ").trim(),
    url: series ? `https://kalshi.com/markets/${series}` : "https://kalshi.com",
    bond_usd: null,
  };
}
