# Запуск: куда что класть

Порядок здесь не случайный — первый шаг самый долгий по времени ожидания,
а сайт можно увидеть работающим задолго до того, как он доедет до домена.

---

## 0. Домен в Cloudflare — начни с этого

Смена NS-серверов у регистратора занимает от десяти минут до суток, поэтому
запускай её первой, а всё остальное делай, пока она едет.

1. В Cloudflare: **Add a site** → `willhappen.ai` → план Free.
2. Cloudflare покажет два своих NS-сервера.
3. У регистратора, где куплен домен, замени NS на эти два.
4. Жди, пока зона в Cloudflare станет **Active**.

Пока ждёшь — всё остальное ниже уже можно делать.

---

## 1. Ключи: где взять

| Что | Обязательно | Где взять |
|---|---|---|
| `OPENROUTER_API_KEY` | да | [openrouter.ai/keys](https://openrouter.ai/keys) → Create key. **Пополни баланс**: без денег на счету ключ вернёт 402. $20 хватит на месяц с запасом. |
| `ADMIN_TOKEN` | да | Придумай сам. Сгенерировать длинный: `openssl rand -hex 32` |
| `GH_TOKEN` | нет | [github.com/settings/tokens](https://github.com/settings/tokens) → Fine-grained → доступ только к `willhappen.ai` → Issues: **Read and write**. Нужен, только чтобы форма `/suggest` открывала issue. |
| `POSTIZ_API_KEY` | нет | Postiz → Settings → Public API. Один ключ на все подключённые каналы. |
| `TG_BOT_TOKEN` | нет | [@BotFather](https://t.me/BotFather) → `/newbot`. Потом добавь бота админом в свой канал. |
| `BSKY_APP_PASSWORD` | нет | Bluesky → Settings → App passwords. Это **не** пароль от аккаунта. |

---

## 2. Развернуть

```bash
git clone https://github.com/dmusato/willhappen.ai.git
cd willhappen.ai
npm install

npx wrangler login                          # откроет браузер
npx wrangler kv namespace create WH_KV      # ← скопируй id из вывода
```

Вставь полученный id в `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "WH_KV"
id = "сюда"                                 # было REPLACE_WITH_KV_NAMESPACE_ID
```

Положи секреты — **не в файл, а в Cloudflare**. Команда спросит значение и
не оставит его в истории:

```bash
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put ADMIN_TOKEN
# необязательные, по желанию:
npx wrangler secret put GH_TOKEN
npx wrangler secret put POSTIZ_API_KEY
npx wrangler secret put TG_BOT_TOKEN
npx wrangler secret put BSKY_APP_PASSWORD
```

Не-секретные настройки (ид канала, subreddit, лимиты) живут прямо
в `[vars]` в `wrangler.toml` — их видно в репозитории, и это нормально.

Если зона ещё не Active, временно закомментируй блок `routes` в
`wrangler.toml` — иначе деплой упрётся в несуществующий домен.

```bash
npx wrangler deploy
```

---

## 3. Посмотреть, не дожидаясь домена

`workers_dev = true` уже включён, поэтому сразу после деплоя сайт живёт на
`https://willhappen-ai.<твой-субдомен>.workers.dev`. Точный адрес печатает
сам `wrangler deploy`.

Архив будет пустым до первого срабатывания крона. Не жди час:

```bash
curl -X POST https://willhappen-ai.<субдомен>.workers.dev/api/admin/run \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -d '{"plan":{"forecasts":4,"harvestMarkets":true}}'
```

Через минуту на главной появятся первые прогнозы. Ещё раз-другой — и лента
наполнится. Дальше крон сам добирает по два вопроса в час.

---

## 4. Подключить домен

Когда зона стала Active — раскомментируй `routes` и задеплой снова:

```bash
npx wrangler deploy
```

`custom_domain = true` сам заведёт DNS-запись и сертификат. Проверь:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://willhappen.ai
curl -s https://willhappen.ai/api/admin/status -H "authorization: Bearer $ADMIN_TOKEN"
```

---

## 5. Первая неделя

```bash
npm run tail                                # живые логи прода
```

- `GET /api/admin/status` — сколько потрачено сегодня, размер очереди, сколько ждёт ревью.
- `GET /api/admin/review` — вердикты, которые резолвер не решился опубликовать сам.
- Биржевые вердикты (`verdict_method: "exchange"`) проверять не нужно.
  А `"jury"` — это три модели, согласившиеся в прочитанном; их стоит просматривать,
  пока не появится доверие к порогам.

Если что-то пошло не так, всё выключается одной переменной в `wrangler.toml`:
`DAILY_QUESTIONS = "0"` останавливает генерацию, не трогая сайт.
