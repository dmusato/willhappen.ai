// Meta Graph API — Facebook Page posts + Instagram carousels.
// Secret: FB_PAGE_TOKEN (long-lived Page access token; the linked IG business
// account is reachable with the same token).
// Vars: FB_PAGE_ID, IG_USER_ID.

const G = "https://graph.facebook.com/v21.0";

export function facebookConfigured(env) {
  return Boolean(env.FB_PAGE_TOKEN && env.FB_PAGE_ID);
}
export function instagramConfigured(env) {
  return Boolean(env.FB_PAGE_TOKEN && env.IG_USER_ID);
}

async function graph(env, path, params) {
  const body = new URLSearchParams({ ...params, access_token: env.FB_PAGE_TOKEN });
  const res = await fetch(`${G}/${path}`, { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`graph ${path} ${res.status}: ${JSON.stringify(data.error || data).slice(0, 200)}`);
  }
  return data;
}

export async function postFacebook(env, { message, link }) {
  const data = await graph(env, `${env.FB_PAGE_ID}/feed`, { message, link });
  return { id: data.id };
}

// Instagram requires JPEG by public URL. We rasterize our SVG OG cards through
// wsrv.nl (free libvips proxy) — no wasm or canvas needed in the Worker.
export function igImageUrl(siteUrl, predictionId) {
  const svg = `${siteUrl}/og/${predictionId}`;
  return `https://wsrv.nl/?url=${encodeURIComponent(svg)}&w=1080&h=566&fit=cover&output=jpg&q=88`;
}

async function waitForContainer(env, id, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${G}/${id}?fields=status_code&access_token=${env.FB_PAGE_TOKEN}`);
    const data = await res.json().catch(() => ({}));
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") throw new Error(`ig container ${id} failed`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`ig container ${id} not ready`);
}

export async function postInstagram(env, { imageUrls, caption }) {
  const ig = env.IG_USER_ID;

  if (imageUrls.length === 1) {
    const c = await graph(env, `${ig}/media`, { image_url: imageUrls[0], caption });
    await waitForContainer(env, c.id);
    const pub = await graph(env, `${ig}/media_publish`, { creation_id: c.id });
    return { id: pub.id };
  }

  const children = [];
  for (const u of imageUrls.slice(0, 10)) {
    const c = await graph(env, `${ig}/media`, { image_url: u, is_carousel_item: "true" });
    await waitForContainer(env, c.id);
    children.push(c.id);
  }
  const carousel = await graph(env, `${ig}/media`, {
    media_type: "CAROUSEL",
    children: children.join(","),
    caption,
  });
  await waitForContainer(env, carousel.id);
  const pub = await graph(env, `${ig}/media_publish`, { creation_id: carousel.id });
  return { id: pub.id, items: children.length };
}
