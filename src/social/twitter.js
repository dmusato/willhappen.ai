// X (Twitter) — POST /2/tweets with OAuth 1.0a user context.
// Secrets: TW_API_KEY, TW_API_SECRET, TW_ACCESS_TOKEN, TW_ACCESS_SECRET.

const enc = (s) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function hmacSha1(key, msg) {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function oauthHeader(env, method, url) {
  const p = {
    oauth_consumer_key: env.TW_API_KEY,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env.TW_ACCESS_TOKEN,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(p).sort().map((k) => `${enc(k)}=${enc(p[k])}`).join("&");
  const base = [method.toUpperCase(), enc(url), enc(paramString)].join("&");
  const signingKey = `${enc(env.TW_API_SECRET)}&${enc(env.TW_ACCESS_SECRET)}`;
  p.oauth_signature = await hmacSha1(signingKey, base);
  return "OAuth " + Object.keys(p).sort().map((k) => `${enc(k)}="${enc(p[k])}"`).join(", ");
}

export function twitterConfigured(env) {
  return Boolean(env.TW_API_KEY && env.TW_API_SECRET && env.TW_ACCESS_TOKEN && env.TW_ACCESS_SECRET);
}

export async function postTweet(env, text) {
  const url = "https://api.twitter.com/2/tweets";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: await oauthHeader(env, "POST", url),
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`twitter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return { id: data?.data?.id, url: `https://x.com/i/status/${data?.data?.id}` };
}
