// Social posting orchestrator. Runs after nightly generation.
//
// Checkpoints live in KV — `social:{platform}:{prediction_id}` — so a partial
// failure (one platform down) retries only that platform on the next run.
// Platforms without secrets are skipped silently: configure once, it just works.

import { twitterConfigured, postTweet } from "./twitter.js";
import { redditConfigured, postRedditLink } from "./reddit.js";
import { facebookConfigured, instagramConfigured, postFacebook, postInstagram, igImageUrl } from "./meta.js";

const MAX_PER_RUN = 4;        // per platform, per night
const FRESH_DAYS = 2;         // only post predictions drafted in the last N days

export async function runSocialPosting(env) {
  const site = env.SITE_URL || "https://willhappen.ai";
  const indexDoc = await env.WH_KV.get("predictions:index", "json");
  const idx = indexDoc?.predictions || [];
  if (!idx.length) return;

  const cutoff = Date.now() - FRESH_DAYS * 86400_000;
  const recentIds = idx
    .filter((p) => p.question_generated_at && new Date(p.question_generated_at).getTime() > cutoff)
    .sort((a, b) => (b.question_generated_at || "").localeCompare(a.question_generated_at || ""))
    .map((p) => p.id);

  if (!recentIds.length) {
    console.log("[social] nothing fresh to post");
    return;
  }

  const fresh = [];
  for (const id of recentIds) {
    const full = await env.WH_KV.get(`prediction:${id}`, "json");
    if (full) fresh.push(full);
  }
  if (!fresh.length) {
    console.log("[social] no full records resolved for fresh ids");
    return;
  }

  const results = {};
  if (twitterConfigured(env))   results.twitter   = await postEach(env, "twitter", fresh, (p) => postTweet(env, tweetText(p, site)));
  if (redditConfigured(env))    results.reddit    = await postEach(env, "reddit", fresh, (p) => postRedditLink(env, { title: redditTitle(p), url: predUrl(p, site) }));
  if (facebookConfigured(env))  results.facebook  = await postEach(env, "facebook", fresh, (p) => postFacebook(env, { message: longText(p, site), link: predUrl(p, site) }));
  if (instagramConfigured(env)) results.instagram = await postInstagramDigest(env, fresh, site);

  console.log("[social] done:", JSON.stringify(results));
  return results;
}

async function postEach(env, platform, fresh, send) {
  let posted = 0, skipped = 0, failed = 0;
  for (const p of fresh) {
    if (posted >= MAX_PER_RUN) break;
    const key = `social:${platform}:${p.id}`;
    if (await env.WH_KV.get(key)) { skipped++; continue; }
    try {
      const r = await send(p);
      await env.WH_KV.put(key, JSON.stringify({ at: new Date().toISOString(), ...r }));
      posted++;
      console.log(`[social] ${platform} ← ${p.id}`);
    } catch (err) {
      failed++;
      console.error(`[social] ${platform} ${p.id} failed:`, err?.message || err);
    }
  }
  return { posted, skipped, failed };
}

// Instagram is a daily digest: one carousel covering the night's fresh
// predictions (2–10 slides), or a single image if there's only one.
async function postInstagramDigest(env, fresh, site) {
  const unposted = [];
  for (const p of fresh) {
    if (unposted.length >= 10) break;
    if (!(await env.WH_KV.get(`social:instagram:${p.id}`))) unposted.push(p);
  }
  if (!unposted.length) return { posted: 0, skipped: fresh.length, failed: 0 };

  try {
    const imageUrls = unposted.map((p) => igImageUrl(site, p.id));
    const r = await postInstagram(env, { imageUrls, caption: igCaption(unposted, site) });
    const now = new Date().toISOString();
    await Promise.all(unposted.map((p) =>
      env.WH_KV.put(`social:instagram:${p.id}`, JSON.stringify({ at: now, id: r.id }))));
    console.log(`[social] instagram ← ${unposted.length} slide(s)`);
    return { posted: unposted.length, skipped: 0, failed: 0 };
  } catch (err) {
    console.error("[social] instagram failed:", err?.message || err);
    return { posted: 0, skipped: 0, failed: unposted.length };
  }
}

// ── copywriting ─────────────────────────────────────────────
const predUrl = (p, site) => `${site}/p/${p.id}`;

function tweetText(p, site) {
  const head = p.headline.length > 180 ? p.headline.slice(0, 177) + "…" : p.headline;
  return `🔮 ${head}\n\n${p.consensus_prob}% — consensus of 6 frontier AI models · resolves by ${p.resolves_by}\n\n${predUrl(p, site)}`;
}

function redditTitle(p) {
  return `${p.headline} — ${p.consensus_prob}% consensus from 6 AI models (Gemini, Claude, GPT, Grok, Llama, DeepSeek)`;
}

function longText(p, site) {
  const lines = Object.entries(p.models || {})
    .filter(([, m]) => typeof m.prob === "number")
    .map(([k, m]) => `• ${k}: ${m.prob}% — ${m.note}`);
  return [
    `🔮 ${p.headline}`,
    ``,
    `Consensus: ${p.consensus_prob}% · resolves by ${p.resolves_by}`,
    ``,
    ...lines,
    ``,
    `Vote "happened / didn't" → ${predUrl(p, site)}`,
  ].join("\n");
}

function igCaption(preds, site) {
  const lines = preds.map((p) => `🔮 ${p.consensus_prob}% — ${p.headline}`);
  return [
    `Tonight's forecasts from 6 frontier AI models:`,
    ``,
    ...lines,
    ``,
    `Full reasoning + voting → ${site}`,
    ``,
    `#AI #forecasting #future #predictions #willhappen`,
  ].join("\n").slice(0, 2200);
}
