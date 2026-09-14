// Response helpers shared by every handler.

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...extra,
    },
  });

export const preflight = () =>
  new Response(null, { status: 204, headers: { ...CORS, "access-control-max-age": "86400" } });

export function requireAdmin(request, env) {
  const token = env.ADMIN_TOKEN;
  if (!token) return json({ error: "admin_disabled" }, 503);
  const auth = request.headers.get("authorization") || "";
  const given = auth.replace(/^Bearer\s+/i, "");
  if (!timingSafeEqual(given, token)) return json({ error: "unauthorized" }, 401);
  return null;
}

// Constant-time compare so the admin token can't be probed byte by byte.
function timingSafeEqual(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
