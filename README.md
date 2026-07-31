# PodArticle — production (Vercel)

Turns YouTube podcast episodes into podarticles: section-by-section maps with transcript-verified timestamps and a Top 5 of what to watch.

## Architecture

- `public/` — static frontend (index, pricing, episode template, seeded episode pages, app.js)
- `api/` — Vercel serverless functions (Node 18+)
  - `analyze.js` — POST `{url}` → metadata (Supadata) → transcript (Supadata, full caption track) → section map (Gemini, user's key) → save to library (Supabase)
  - `episodes.js` — GET library index / single episode by slug
  - `sitemap.js` — sitemap regenerated from the library on every request
- `lib/` — shared modules (youtube.js, gemini.js, db.js, auth.js)
- `docs/brand-ops.md` — custom auth domain + support mailbox setup (DNS/dashboard work)

## Environment variables

Copy `.env.example` → set in the Vercel dashboard. Never commit real keys.

| Var | Where to get it |
| --- | --- |
| `GEMINI_API_KEY` | aistudio.google.com → Get API key |
| `SUPADATA_API_KEY` | dash.supadata.ai → API keys (free: 100 credits/mo) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | Supabase project → Settings → API |
| `PAYWALL_ENABLED` | leave unset/`false` — PodArticle is free for everyone right now |
| `STRIPE_*` | dashboard.stripe.com (only read when the paywall is switched on) |

## Free mode

PodArticle is free and uncapped while we grow the first regular users. `checkAllowance`
in `lib/auth.js` returns `allowed` unconditionally unless `PAYWALL_ENABLED=true`, so
`/api/analyze` never returns `LIMIT_REACHED` — the limit is off server-side, not just
hidden in the UI.

The free-5 gate, the pricing page and the Stripe endpoints all stay in the repo. To
re-arm the paywall: set `PAYWALL_ENABLED=true`, fill in the `STRIPE_*` vars, and
un-pause the plan buttons in `public/pricing.html`.

## Supabase schema

Run the SQL in `lib/db.js`'s header comment in the Supabase SQL editor
(creates `episodes` + `usage` tables).

## Deploy

1. Push this directory to GitHub
2. Vercel → Import project → framework: Other, root = this directory
3. Add env vars → Deploy
4. Domains: podarticle.com as canonical; 301 redirect podarticles.com, podcastarticle.com, podcastarticles.com

## Notes

- Transcript coverage is full-episode by construction: Supadata returns YouTube's complete caption track (`mode=native`, 1 credit/analysis). Videos too new to have captions get the graceful "Transcript not available yet" message.
- `mode=native` keeps cost at 1 credit per analysis. Switch to `mode=auto` in `lib/youtube.js` if you want AI fallback transcription for uncaptioned videos (2 credits/minute).
- The seed library cards in `public/index.html` are static; the live library merges in from `/api/episodes` and dedupes by video ID.
