// Reddit — script app, password grant. Posts a link to the subreddit.
// Secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD.
// Var: REDDIT_SUBREDDIT (without r/).

const UA = "willhappen-ai/1.0 (https://willhappen.ai)";

export function redditConfigured(env) {
  return Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET &&
                 env.REDDIT_USERNAME && env.REDDIT_PASSWORD && env.REDDIT_SUBREDDIT);
}

async function accessToken(env) {
  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: "Basic " + btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`),
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: new URLSearchParams({
      grant_type: "password",
      username: env.REDDIT_USERNAME,
      password: env.REDDIT_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`reddit auth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  if (!data.access_token) throw new Error("reddit auth: no token");
  return data.access_token;
}

export async function postRedditLink(env, { title, url }) {
  const token = await accessToken(env);
  const res = await fetch("https://oauth.reddit.com/api/submit", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: new URLSearchParams({
      sr: env.REDDIT_SUBREDDIT,
      kind: "link",
      title: title.slice(0, 300),
      url,
      resubmit: "true",
      api_type: "json",
    }),
  });
  if (!res.ok) throw new Error(`reddit submit ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const errors = data?.json?.errors;
  if (errors?.length) throw new Error(`reddit: ${JSON.stringify(errors).slice(0, 200)}`);
  return { url: data?.json?.data?.url };
}
