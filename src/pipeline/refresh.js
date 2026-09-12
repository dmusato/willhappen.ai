// Re-price the open predictions that came from a market.
//
// The number that makes a page worth revisiting is not the forecast, it's the
// drift: the panel said 63 in September and the money has since walked from
// 71 to 44. We keep the price we saw at forecast time and overwrite the live one.

import { SOURCES } from "../markets/index.js";
import { getIndex, getPrediction, putPrediction, writeIndex } from "../store/kv.js";
import { pool } from "../util.js";

export async function refreshMarkets(env, { max = 8 } = {}) {
  const { predictions } = await getIndex(env);
  const open = predictions.filter((p) => p.verdict === null && p.market_prob !== null && p.market_prob !== undefined);
  if (!open.length) return { checked: 0, updated: 0 };

  const records = [];
  for (const row of open) {
    const p = await getPrediction(env, row.id);
    if (p?.market?.source && SOURCES[p.market.source]?.fetchOne) records.push(p);
    if (records.length >= max) break;
  }
  if (!records.length) return { checked: 0, updated: 0 };

  const updated = [];
  await pool(records, 4, async (p) => {
    try {
      const live = await SOURCES[p.market.source].fetchOne(env, externalIdOf(p));
      if (!live || typeof live.prob !== "number") return;
      const opened = p.market.prob_at_forecast ?? p.market.prob;
      const next = {
        ...p,
        market: {
          ...p.market,
          prob: live.prob,
          prob_at_forecast: opened,
          drift: live.prob - opened,
          change_1w: live.change1w,
          change_1m: live.change1m,
          volume_usd: live.volumeUsd,
          liquidity_usd: live.liquidityUsd,
          checked_at: new Date().toISOString(),
        },
        edge: p.consensus_prob - live.prob,
      };
      await putPrediction(env, next);
      updated.push(next);
    } catch (err) {
      console.warn(`[refresh] ${p.id}:`, err?.message || err);
    }
  });

  if (updated.length) await writeIndex(env, updated);
  return { checked: records.length, updated: updated.length };
}

// Older records stored only the url; derive the external id when it's missing.
function externalIdOf(p) {
  if (p.market?.external_id) return p.market.external_id;
  const m = String(p.market?.url || "").match(/(\d{4,})(?:$|[/?])/);
  return `${p.market.source}:${m ? m[1] : ""}`;
}
