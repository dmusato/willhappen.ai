// Bluesky — an app password from account settings. No app review, no paid
// tier, and an audience that overlaps heavily with anyone who would read a
// forecasting archive.
//
// Secrets: BSKY_HANDLE (e.g. "willhappen.bsky.social"), BSKY_APP_PASSWORD.

const HOST = "https://bsky.social";
const POST_MAX = 300; // graphemes, not bytes

export const blueskyConfigured = (env) => Boolean(env.BSKY_HANDLE && env.BSKY_APP_PASSWORD);

export async function postBluesky(env, { text, linkUrl, title, description, imageUrl }) {
  const session = await xrpc(HOST, "com.atproto.server.createSession", {
    identifier: env.BSKY_HANDLE,
    password: env.BSKY_APP_PASSWORD,
  });

  // An external embed renders the share card as a link card, which both looks
  // better and keeps the URL out of the 300-character budget.
  const embed = {
    $type: "app.bsky.embed.external",
    external: {
      uri: linkUrl,
      title: clip(title, 280),
      description: clip(description, 300),
      ...(await thumbFor(env, session, imageUrl)),
    },
  };

  const record = await xrpc(HOST, "com.atproto.repo.createRecord", {
    repo: session.did,
    collection: "app.bsky.feed.post",
    record: {
      $type: "app.bsky.feed.post",
      text: clipGraphemes(text, POST_MAX),
      createdAt: new Date().toISOString(),
      langs: ["en"],
      embed,
    },
  }, session.accessJwt);

  const rkey = String(record.uri || "").split("/").pop();
  return { id: record.uri, url: `https://bsky.app/profile/${env.BSKY_HANDLE}/post/${rkey}` };
}

async function thumbFor(env, session, imageUrl) {
  if (!imageUrl) return {};
  try {
    const img = await fetch(imageUrl);
    if (!img.ok) return {};
    const type = img.headers.get("content-type") || "image/png";
    const bytes = await img.arrayBuffer();
    // Bluesky rejects blobs over 1MB; the card is well under, but a redirect
    // to something larger should degrade to a card with no thumbnail.
    if (bytes.byteLength > 1_000_000) return {};
    const res = await fetch(`${HOST}/xrpc/com.atproto.repo.uploadBlob`, {
      method: "POST",
      headers: { "content-type": type, authorization: `Bearer ${session.accessJwt}` },
      body: bytes,
    });
    if (!res.ok) return {};
    const { blob } = await res.json();
    return blob ? { thumb: blob } : {};
  } catch (err) {
    console.warn("[bluesky] thumb upload failed:", err?.message || err);
    return {};
  }
}

async function xrpc(host, method, body, token) {
  const res = await fetch(`${host}/xrpc/${method}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`bluesky ${method} ${res.status}: ${String(data.message || data.error || "").slice(0, 180)}`);
  return data;
}

const clip = (s, n) => String(s || "").slice(0, n);

// Bluesky counts graphemes, so a naive slice can cut an emoji in half.
function clipGraphemes(s, max) {
  const chars = [...String(s || "")];
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join("")}…`;
}
