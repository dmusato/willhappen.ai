// Prediction-market sources. Each adapter exports the same shape, so adding an
// exchange is a file plus one line in SOURCES.

import * as polymarket from "./polymarket.js";
import * as kalshi from "./kalshi.js";

export const SOURCES = { polymarket, kalshi };
export const SOURCE_LABELS = Object.fromEntries(Object.values(SOURCES).map((s) => [s.id, s.label]));

// MARKET_SOURCES in wrangler.toml decides which exchanges are live.
export function enabledSources(env) {
  const want = String(env.MARKET_SOURCES ?? "polymarket,kalshi")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return want.map((k) => SOURCES[k]).filter(Boolean);
}

// One market per group (an "event" on Polymarket bundles 20 candidate legs —
// we want the most liquid one, not all twenty), newest movement first.
export async function collectMarkets(env, { perSource = 60, minLiquidity } = {}) {
  const min = Number(env.MARKET_MIN_LIQUIDITY ?? minLiquidity ?? 5000) || 0;
  const out = [];
  for (const src of enabledSources(env)) {
    try {
      out.push(...await src.fetchMarkets(env, { limit: perSource, minLiquidity: min }));
    } catch (err) {
      console.warn(`[markets] ${src.id} failed:`, err?.message || err);
    }
  }

  const best = new Map();
  for (const m of out) {
    const key = `${m.source}:${m.group}`;
    const prev = best.get(key);
    if (!prev || m.liquidityUsd > prev.liquidityUsd) best.set(key, m);
  }
  return [...best.values()].sort((a, b) => movement(b) - movement(a));
}

// Rank by how much the price moved and how uncertain it still is — a market
// stuck at 92% for a month is not a story, one that swung 15 points is.
const movement = (m) =>
  Math.abs(m.change1w ?? m.change1m ?? 0) * 3 + (50 - Math.abs(m.prob - 50));
