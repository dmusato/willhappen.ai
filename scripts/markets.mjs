// Print what the market adapters would harvest right now. No keys needed —
// useful for checking a filter change before it reaches production.
//
//   npm run markets

import { collectMarkets } from "../src/markets/index.js";

const env = {
  MARKET_SOURCES: process.env.MARKET_SOURCES || "polymarket,kalshi",
  MARKET_MIN_LIQUIDITY: process.env.MARKET_MIN_LIQUIDITY || "5000",
};

const markets = await collectMarkets(env, { perSource: 120 });
const bySource = markets.reduce((a, m) => ({ ...a, [m.source]: (a[m.source] || 0) + 1 }), {});

console.log(`${markets.length} usable markets  ${JSON.stringify(bySource)}\n`);
for (const m of markets.slice(0, 30)) {
  const move = m.change1w ?? m.change1m;
  console.log(
    `${m.source.padEnd(11)} ${String(m.prob).padStart(3)}%` +
    `  ${move === null || move === undefined ? "     " : `${move > 0 ? "+" : ""}${move}`.padStart(5)}` +
    `  $${String(m.liquidityUsd).padStart(9)}  ${m.question.slice(0, 88)}`,
  );
}
