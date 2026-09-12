// Social distribution. Postiz when it is configured (one key, every network);
// otherwise the direct per-network adapters. Either way a prediction is posted
// at most once — the checkpoint key is the contract.

import { postizConfigured, listChannels, publish, uploadFromUrl } from "./postiz.js";
import { twitterConfigured, postTweet } from "./twitter.js";
import { redditConfigured, postRedditLink } from "./reddit.js";
import { facebookConfigured, instagramConfigured, postFacebook, postInstagram, igImageUrl } from "./meta.js";
import { getIndex, getPrediction } from "../store/kv.js";
import { horizon as horizonOf, topic as topicOf } from "../catalog.js";

const FRESH_HOURS = 36;

export async function runSocial(env, { max = 2 } = {}) {
  const site = (env.SITE_URL || "https://willhappen.ai").replace(/\/$/, "");
  const usePostiz = postizConfigured(env);
  if (!usePostiz && !anyDirect(env)) return { skipped: "no_social_configured" };

  const channel = usePostiz ? "postiz" : "direct";
  const fresh = await pickUnposted(env, channel, max);
  if (!fresh.length) return { posted: 0, reason: "nothing_fresh" };

  let channels = [];
  if (usePostiz) {
    channels = await listChannels(env);
    if (!channels.length) return { posted: 0, reason: "no_channels_connected" };
  }

  const results = [];
  for (const p of fresh) {
    try {
      const out = usePostiz ? await viaPostiz(env, p, site, channels) : await viaDirect(env, p, site);
      await env.WH_KV.put(`social:${channel}:${p.id}`, JSON.stringify({ at: new Date().toISOString(), ...out }));
      results.push({ id: p.id, ...out });
    } catch (err) {
      console.error(`[social] ${p.id}:`, err?.message || err);
      results.push({ id: p.id, error: String(err?.message || err).slice(0, 160) });
    }
  }
  return { posted: results.filter((r) => !r.error).length, via: channel, results };
}

async function viaPostiz(env, p, site, channels) {
  let image = null;
  const needsImage = channels.some((c) => /instagram|pinterest|tiktok/.test(c.identifier));
  try {
    image = await uploadFromUrl(env, cardUrl(site, p, needsImage));
  } catch (err) {
    // A failed upload must not block the text post everywhere else.
    console.warn(`[social] card upload failed for ${p.id}:`, err?.message || err);
  }
  return publish(env, { channels, image, bodies: bodies(p, site) });
}

async function viaDirect(env, p, site) {
  const out = {};
  if (twitterConfigured(env))   out.x = await postTweet(env, shortCopy(p, site));
  if (redditConfigured(env))    out.reddit = await postRedditLink(env, { title: redditTitle(p), url: pageUrl(site, p) });
  if (facebookConfigured(env))  out.facebook = await postFacebook(env, { message: longCopy(p, site), link: pageUrl(site, p) });
  if (instagramConfigured(env)) out.instagram = await postInstagram(env, { imageUrls: [igImageUrl(site, p.id)], caption: longCopy(p, site) });
  return out;
}

const anyDirect = (env) =>
  twitterConfigured(env) || redditConfigured(env) || facebookConfigured(env) || instagramConfigured(env);

async function pickUnposted(env, channel, max) {
  const { predictions } = await getIndex(env);
  const cutoff = Date.now() - FRESH_HOURS * 3_600_000;
  const candidates = predictions
    .filter((p) => Date.parse(p.question_generated_at || p.created_at) > cutoff)
    // Lead with the pages worth clicking: where the panel and the money disagree.
    .sort((a, b) => Math.abs(b.edge ?? 0) - Math.abs(a.edge ?? 0))
    .slice(0, max * 4);

  const out = [];
  for (const row of candidates) {
    if (out.length >= max) break;
    if (await env.WH_KV.get(`social:${channel}:${row.id}`)) continue;
    const full = await getPrediction(env, row.id);
    if (full) out.push(full);
  }
  return out;
}

// ── copy ────────────────────────────────────────────────────
const pageUrl = (site, p) => `${site}/p/${p.id}`;
const cardUrl = (site, p, square) => `${site}/og/${p.id}.png${square ? "?v=square" : ""}`;

function bodies(p, site) {
  return {
    default: longCopy(p, site),
    x: shortCopy(p, site),
    bluesky: shortCopy(p, site, 290),
    mastodon: longCopy(p, site).slice(0, 480),
    threads: longCopy(p, site).slice(0, 480),
    instagram: `${longCopy(p, site)}\n\n${hashtags(p)}`,
    "instagram-standalone": `${longCopy(p, site)}\n\n${hashtags(p)}`,
    pinterest: `${p.headline} — ${p.consensus_prob}% consensus from six frontier AI models. ${pageUrl(site, p)}`,
    reddit: longCopy(p, site),
    telegram: longCopy(p, site),
  };
}

function marketLine(p) {
  if (!p.market || typeof p.market.prob !== "number") return null;
  const edge = p.consensus_prob - p.market.prob;
  if (edge === 0) return `The market agrees exactly: ${p.market.prob}%.`;
  const dir = edge > 0 ? "more" : "less";
  return `The market says ${p.market.prob}% — the models are ${Math.abs(edge)} points ${dir} confident.`;
}

function shortCopy(p, site, limit = 280) {
  const url = pageUrl(site, p);
  const tail = `\n\n${url}`;
  const market = p.market && typeof p.market.prob === "number"
    ? `\n\n🤖 ${p.consensus_prob}%  vs  💰 ${p.market.prob}% (market)`
    : `\n\n🤖 ${p.consensus_prob}% — consensus of 6 frontier models`;
  const room = limit - market.length - tail.length - 2;
  const head = p.headline.length > room ? `${p.headline.slice(0, Math.max(0, room - 1))}…` : p.headline;
  return `${head}${market}${tail}`;
}

function longCopy(p, site) {
  const lines = Object.entries(p.models || {})
    .filter(([, m]) => typeof m.prob === "number")
    .sort((a, b) => b[1].prob - a[1].prob)
    .map(([k, m]) => `· ${k}: ${m.prob}%${m.note ? ` — ${m.note}` : ""}`);

  return [
    `🔮 ${p.headline}`,
    ``,
    `AI consensus: ${p.consensus_prob}% · resolves by ${p.resolves_by}`,
    marketLine(p),
    ``,
    ...lines,
    ``,
    `Full reasoning, sources and the running scoreboard:`,
    pageUrl(site, p),
  ].filter((l) => l !== null).join("\n");
}

function redditTitle(p) {
  const market = p.market && typeof p.market.prob === "number" ? ` (the market says ${p.market.prob}%)` : "";
  return `${p.headline} — six frontier AI models put it at ${p.consensus_prob}%${market}`.slice(0, 300);
}

function hashtags(p) {
  const t = topicOf(p.topic);
  const h = horizonOf(p.horizon);
  return ["#AI", "#forecasting", "#predictions", t ? `#${t.name.replace(/[^A-Za-z]/g, "")}` : null, h ? `#${h.short}` : null, "#willhappen"]
    .filter(Boolean).join(" ");
}
