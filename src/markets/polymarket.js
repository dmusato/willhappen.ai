// Polymarket — public Gamma API, no key. Gives us three things no LLM can:
// a question that is already falsifiable, written resolution criteria, and a
// price that real money agreed on.

const GAMMA = "https://gamma-api.polymarket.com";

export const id = "polymarket";
export const label = "Polymarket";

export async function fetchMarkets(env, { limit = 60, minLiquidity = 5000 } = {}) {
  const url = `${GAMMA}/markets?closed=false&active=true&archived=false&order=volume24hr&ascending=false&limit=${limit}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`polymarket ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const raw = await res.json();
  const rows = Array.isArray(raw) ? raw : raw?.data || [];
  return rows.map(normalize).filter((m) => m && usable(m, minLiquidity));
}

function normalize(m) {
  const outcomes = jsonish(m.outcomes);
  const prices = jsonish(m.outcomePrices);
  if (!Array.isArray(outcomes) || !Array.isArray(prices) || outcomes.length !== 2) return null;

  const yesAt = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
  if (yesAt === -1) return null;
  const prob = Math.round(Number(prices[yesAt]) * 100);
  if (!Number.isFinite(prob)) return null;

  const event = m.events?.[0];
  const url = event?.slug
    ? `https://polymarket.com/event/${event.slug}/${m.slug}`
    : `https://polymarket.com/market/${m.slug}`;

  return {
    source: id,
    externalId: `polymarket:${m.id}`,
    question: String(m.question || "").trim(),
    rules: String(m.description || "").trim().slice(0, 1200),
    url,
    prob,
    endDate: m.endDateIso || m.endDate || null,
    volumeUsd: Math.round(Number(m.volumeNum) || 0),
    liquidityUsd: Math.round(Number(m.liquidityNum) || 0),
    // Movement is the story: a market that slid 14 points this week is news.
    change1w: pts(m.oneWeekPriceChange),
    change1m: pts(m.oneMonthPriceChange),
    spreadPts: pts(m.spread),
    group: event?.slug || m.slug,
    tags: (event?.tags || []).map((t) => String(t.label || t.slug || "").toLowerCase()).filter(Boolean).slice(0, 8),
  };
}

function usable(m, minLiquidity) {
  if (!m.question || m.question.length < 12 || m.question.length > 240) return false;
  if (!m.endDate) return false;
  const ends = Date.parse(m.endDate);
  if (!Number.isFinite(ends)) return false;
  const daysOut = (ends - Date.now()) / 86_400_000;
  if (daysOut < 2 || daysOut > 3700) return false;
  if (m.liquidityUsd < minLiquidity) return false;
  // Already decided in all but name — nothing for six models to disagree about.
  if (m.prob < 3 || m.prob > 97) return false;
  return true;
}

// Gamma returns these arrays as JSON strings, not arrays.
function jsonish(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return null;
  try { return JSON.parse(v); } catch { return null; }
}

const pts = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

// Re-price a single market we already track, so an open prediction can show
// where the money has moved since we asked the models.
export async function fetchOne(env, externalId) {
  const marketId = String(externalId).split(":")[1];
  if (!marketId) return null;
  const res = await fetch(`${GAMMA}/markets/${encodeURIComponent(marketId)}`, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const raw = await res.json();
  const row = Array.isArray(raw) ? raw[0] : raw;
  return row ? normalize(row) : null;
}

// How the exchange itself settled. This is the strongest ground truth we have
// for any question that came from a market: real money, and a formal dispute
// process (UMA's optimistic oracle, with bonds that reach six figures).
export async function fetchResolution(env, externalId) {
  const marketId = String(externalId).split(":")[1];
  if (!marketId) return null;
  const res = await fetch(`${GAMMA}/markets/${encodeURIComponent(marketId)}`, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const raw = await res.json();
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row) return null;

  const outcomes = jsonish(row.outcomes) || [];
  const prices = (jsonish(row.outcomePrices) || []).map(Number);
  const yesAt = outcomes.findIndex((o) => String(o).toLowerCase() === "yes");
  const statuses = (jsonish(row.umaResolutionStatuses) || []).map((x) => String(x).toLowerCase());

  const settled = row.closed === true && yesAt !== -1 &&
    prices.length === 2 && prices.every((v) => Number.isFinite(v)) &&
    // A settled binary market pays 1 on one side and 0 on the other. Anything
    // in between means it is closed but not yet resolved.
    Math.max(...prices) === 1 && Math.min(...prices) === 0;

  return {
    source: id,
    settled,
    outcome: settled ? (prices[yesAt] === 1 ? "yes" : "no") : null,
    // A contested resolution is exactly the case a human should look at.
    disputed: statuses.includes("disputed"),
    question: String(row.question || "").trim(),
    url: row.slug ? `https://polymarket.com/market/${row.slug}` : "https://polymarket.com",
    bond_usd: Number(row.umaBond) || null,
  };
}
