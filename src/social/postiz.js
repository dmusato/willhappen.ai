// Postiz — one API key, every connected channel.
//
// Postiz allows 30 API requests an hour, so a prediction costs exactly two:
// upload the share card, then one POST carrying a tailored body for every
// channel at once. Channels are discovered, never configured — connect X or
// Pinterest in the Postiz UI and it starts receiving posts on the next run.

const CLOUD = "https://api.postiz.com/public/v1";

// Channels that need fields we cannot infer (a video, a title, a board) are
// skipped unless POSTIZ_SETTINGS supplies them.
const SETTINGS = {
  x: { who_can_reply_post: "everyone" },
  linkedin: {},
  "linkedin-page": {},
  facebook: {},
  instagram: { post_type: "post", collaborators: [] },
  "instagram-standalone": { post_type: "post", collaborators: [] },
  threads: {},
  bluesky: {},
  mastodon: {},
  telegram: {},
  nostr: {},
  vk: {},
  warpcast: {},
  discord: null,
  slack: null,
  reddit: null,
  lemmy: null,
  pinterest: null,
  youtube: null,
  tiktok: null,
  medium: null,
  devto: null,
  hashnode: null,
  wordpress: null,
  dribbble: null,
  gmb: null,
  listmonk: null,
};

export const postizConfigured = (env) => Boolean(env.POSTIZ_API_KEY);

const base = (env) => String(env.POSTIZ_API_URL || CLOUD).replace(/\/$/, "");

async function call(env, path, { method = "GET", body } = {}) {
  const res = await fetch(`${base(env)}${path}`, {
    method,
    headers: {
      authorization: env.POSTIZ_API_KEY,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`postiz ${method} ${path} ${res.status}: ${text.slice(0, 220)}`);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

export async function listChannels(env) {
  const raw = await call(env, "/integrations");
  const rows = Array.isArray(raw) ? raw : raw?.integrations || [];
  return rows.filter((c) => c && !c.disabled).map((c) => ({
    id: c.id,
    name: c.name,
    identifier: String(c.identifier || "").toLowerCase(),
  }));
}

export async function uploadFromUrl(env, url) {
  const out = await call(env, "/upload-from-url", { method: "POST", body: { url } });
  const media = out?.data || out;
  if (!media?.id) throw new Error(`postiz upload returned no id: ${JSON.stringify(out).slice(0, 160)}`);
  return { id: media.id, path: media.path || url };
}

// `bodies` maps a channel identifier to its text; "default" covers the rest.
export async function publish(env, { channels, bodies, image, when = "now", date }) {
  const posts = [];
  const used = [];

  for (const ch of channels) {
    const extra = settingsFor(env, ch.identifier);
    if (!extra) continue;
    const content = bodies[ch.identifier] || bodies.default;
    if (!content) continue;
    posts.push({
      integration: { id: ch.id },
      value: [{ content, image: image ? [{ id: image.id, path: image.path }] : [] }],
      settings: { __type: ch.identifier, ...extra },
    });
    used.push(ch);
  }
  if (!posts.length) return { posted: 0, channels: [] };

  const res = await call(env, "/posts", {
    method: "POST",
    body: {
      type: when,
      date: date || new Date().toISOString(),
      shortLink: false,
      tags: [],
      posts,
    },
  });
  return { posted: posts.length, channels: used.map((c) => c.identifier), response: shrink(res) };
}

function settingsFor(env, identifier) {
  let overrides = {};
  try { overrides = JSON.parse(env.POSTIZ_SETTINGS || "{}"); } catch { overrides = {}; }
  const custom = overrides[identifier];
  if (custom) return custom;
  const known = SETTINGS[identifier];
  // Unknown channel types are let through with no extra settings rather than
  // dropped — Postiz validates, and a new platform should not need a release.
  return known === null ? null : known || {};
}

const shrink = (r) => {
  const rows = Array.isArray(r) ? r : r?.posts || [];
  return rows.slice(0, 8).map((p) => ({ id: p?.id, releaseURL: p?.releaseURL })).filter((p) => p.id);
};
