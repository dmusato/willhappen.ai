// IndexNow — tell Bing, Yandex and Seznam about a page the moment it exists
// rather than waiting to be crawled. Google does not participate; for Google
// the sitemap plus a fast, linkable page is still the whole story.
//
// The key is deliberately a plain var, not a secret: the protocol works by
// asking us to serve it back at https://SITE/<key>.txt, so it is public by
// construction. Its only job is to prove that whoever submits a URL controls
// the host.

const ENDPOINT = "https://api.indexnow.org/indexnow";

const indexNowKey = (env) => {
  const key = String(env.INDEXNOW_KEY || "");
  return /^[a-f0-9]{8,128}$/i.test(key) ? key : "";
};

// GET /<key>.txt — the ownership proof. Anything else 404s as usual.
export function handleIndexNowKey(env, path) {
  const key = indexNowKey(env);
  if (!key || path !== `/${key}.txt`) return null;
  return new Response(key, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}

// One request for the whole batch. Worth saying plainly: a cron invocation gets
// roughly fifty subrequests for everything it does, so this must never become a
// call per URL.
export async function submitUrls(env, urls) {
  const key = indexNowKey(env);
  if (!key) return { skipped: "no_key" };

  const site = String(env.SITE_URL || "").replace(/\/$/, "");
  if (!site) return { skipped: "no_site_url" };

  const host = new URL(site).hostname;
  const list = [...new Set(urls)].filter(Boolean).slice(0, 10_000);
  if (!list.length) return { submitted: 0 };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation: `${site}/${key}.txt`, urlList: list }),
  });

  // 200 accepted, 202 accepted but key still being validated. Both are fine;
  // anything else we report rather than retry, because a failed ping costs
  // nothing but a crawl that would have happened anyway.
  return { submitted: list.length, status: res.status, ok: res.status === 200 || res.status === 202 };
}
