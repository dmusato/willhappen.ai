// GET /api/predictions
// Returns the full prediction archive. Reads from KV; seeds from the
// committed static file on first request.

export async function handlePredictions(request, env) {
  if (request.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  let data = await env.WH_KV.get("predictions:all", "json");
  if (!data) {
    const seedRes = await env.ASSETS.fetch(new URL("/data/predictions.json", request.url));
    data = await seedRes.json();
    // fire and forget — avoid blocking the response on the write
    await env.WH_KV.put("predictions:all", JSON.stringify(data));
  }

  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      "access-control-allow-origin": "*",
    },
  });
}
