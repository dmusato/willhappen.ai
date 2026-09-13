// Telegram — a bot token from @BotFather and a channel id. No app review, no
// OAuth dance, no rate limit worth worrying about. Two minutes to set up and
// the best reach-per-effort of any channel here.
//
// Secret: TG_BOT_TOKEN.  Var: TG_CHAT_ID (e.g. "@willhappen" or "-1001234567890").

const API = "https://api.telegram.org";
const CAPTION_MAX = 1024;

export const telegramConfigured = (env) => Boolean(env.TG_BOT_TOKEN && env.TG_CHAT_ID);

export async function postTelegram(env, { text, imageUrl, linkUrl }) {
  const caption = `${text}`.slice(0, CAPTION_MAX - 40);
  const body = {
    chat_id: env.TG_CHAT_ID,
    parse_mode: "HTML",
    reply_markup: linkUrl ? { inline_keyboard: [[{ text: "See the full forecast →", url: linkUrl }]] } : undefined,
  };

  // A photo post with the share card reads far better in a channel than a link
  // preview, but a failed image must not cost us the post.
  if (imageUrl) {
    const photo = await call(env, "sendPhoto", { ...body, photo: imageUrl, caption }).catch((err) => {
      console.warn("[telegram] photo failed, falling back to text:", err?.message || err);
      return null;
    });
    if (photo) return { id: photo.message_id };
  }

  const msg = await call(env, "sendMessage", { ...body, text: caption, disable_web_page_preview: false });
  return { id: msg.message_id };
}

async function call(env, method, payload) {
  const res = await fetch(`${API}/bot${env.TG_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(`telegram ${method} ${res.status}: ${String(data.description || "").slice(0, 180)}`);
  return data.result;
}
