# WillHappen.ai

> Ask any question about the future. Six frontier AI models answer. See the consensus.

**Live:** https://willhappen.ai · **Source:** this repo · **License:** MIT

Opensource consensus forecasting. Every prediction is evaluated by six frontier models through **Cloudflare AI Gateway** — Gemini, Claude, GPT, Grok, Llama, DeepSeek — with full attribution for who drafted the question and how each model reasoned. Archive, share, and track outcomes over 9 horizons from 1 week to 100 years.

## Features

- **Multi-model consensus** — 6 frontier LLMs per prediction, full reasoning preserved.
- **Every prediction attributed** — question author, timestamp, per-model probability + note + provider ID.
- **Timeline archive** — rewind slider, topic × horizon matrix, ✓/✗ verdict tracking.
- **Share anywhere** — native Web Share + Twitter/X + copy-link + pre-rendered OG images.
- **Community suggestions** — `/suggest` opens a GitHub issue; maintainers promote the strongest ones.
- **Static, fast, mobile-first** — < 60KB landing page, no JS framework.
- **Liquid-glass UI** — dark aurora + frosted glass cards, Instrument Serif + Geist + JetBrains Mono.

## One-project Cloudflare stack

Everything runs as a single Cloudflare Worker with Static Assets. One `wrangler.toml`, one deploy.

| Concern | Where |
|---|---|
| Static HTML/CSS/JS | `public/` served via Workers Static Assets |
| API endpoints | `src/handlers/*.js` (fetch handler) |
| Voting storage | Workers KV (`WH_KV`) |
| Nightly generation | `src/generate/generate.js` (scheduled cron) |
| AI calls | Cloudflare AI Gateway (unified OpenAI-compatible endpoint) |
| Suggestions | `src/handlers/suggest.js` → GitHub Issues API |
| Secrets | `wrangler secret put …` |

GitHub Actions is used only for syntax-linting PRs and hosting issue templates. All runtime concerns live in Cloudflare.

## Layout

```
public/            static assets (Workers Static Assets root)
  index.html, timeline.html, suggest.html, predict.html
  assets/          style.css + app.js + favicon.svg
  data/            seed JSONs (KV takes over after first request)
src/
  worker.js              main fetch + scheduled handler
  handlers/              /api/* + /og/:id
  generate/              nightly multi-model generation
wrangler.toml            the whole project
package.json             just wrangler
.github/                 issue templates + lint workflow
```

## Local dev

```bash
git clone https://github.com/dmusato/willhappen.ai.git
cd willhappen.ai
npm install
npm run dev                   # wrangler dev — localhost:8787
# trigger the cron handler once locally:
npm run cron:local
```

## Deploy

```bash
wrangler kv namespace create WH_KV                  # paste id into wrangler.toml
wrangler secret put AI_GATEWAY_TOKEN                 # and each provider key
wrangler secret put OPENAI_API_KEY
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put GOOGLE_AI_STUDIO_API_KEY
wrangler secret put XAI_API_KEY
wrangler secret put DEEPSEEK_API_KEY
wrangler secret put GH_TOKEN                         # scope: public_repo
wrangler deploy
```

Attach `willhappen.ai` as a custom domain in the Cloudflare dashboard (or through `wrangler.toml [routes]`). Connect the GitHub repo in the Workers dashboard for auto-deploy on `main`.

## Contribute

- **Suggest a prediction:** use `/suggest` or open a ["Suggest"](../../issues/new?template=suggest-prediction.yml) issue.
- **Report an outcome:** open a ["Report outcome"](../../issues/new?template=report-outcome.yml) issue with a credible source.
- **Improve the site:** PRs welcome. Keep it vanilla and lightweight.

See [CLAUDE.md](./CLAUDE.md) for the full architecture + style rules.

## License

MIT. See [LICENSE](./LICENSE).
