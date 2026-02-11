# Implementation Log

## 2026-02-11

### Scope accepted
- Full build execution started.
- Decisions delegated to agent.
- Target: global, country-aware site with 5 languages (`en`, `ru`, `de`, `fr`, `es`).

### Subagents used
- Architecture explorer: proposed canonical route strategy `/:country/:lang` and API split.
- Translation explorer: produced starter translation key set for 5 languages.
- Security explorer: produced Express security baseline (helmet, validation, CORS, rate limits).

### Backend delivered
- Rebuilt `server.js` into production-style API + web server.
- Added secure middleware baseline:
  - `helmet` CSP + hardening headers
  - strict JSON/body limits
  - `cors` with allowlist support
  - `morgan` request logging
  - global + submit route rate limiting
- Implemented APIs:
  - `/api/meta`
  - `/api/locale`
  - `/api/stats`
  - `/api/stories` (GET + POST with moderation status)
  - `/api/companies/top`
  - `/api/forum/categories`
  - `/api/forum/topics`
  - `/api/admin/overview` (token protected)
- Implemented locale/country route handling and canonical redirects.

### Frontend delivered
- Replaced static landing with global SPA shell.
- Added dynamic hero, counters, company ticker, recovery ticker, latest stories, forum block, admin preview.
- Added interactive country/language switchers.
- Added submission form posting to `/api/stories` with success/fail feedback.
- Added responsive layout and non-generic visual design.

### i18n delivered
- Added translations:
  - `public/i18n/en.json`
  - `public/i18n/ru.json`
  - `public/i18n/de.json`
  - `public/i18n/fr.json`
  - `public/i18n/es.json`

### Data/model delivered
- Added seeded global dataset: `data/stories.json`.
- Seed contains multiple countries and job outcomes for working counters/tickers.

### Security posture
- Input validated via `zod` for story submission.
- Text sanitization for form payload fields.
- Rate limits on all traffic + tighter write endpoint limits.
- Admin endpoint protected by bearer/query token.

### Pending polish queued
- Add additional country-specific seeded stories.
- Add moderation UI workflow in dedicated admin route.
- Add persistence beyond local JSON (PostgreSQL) for production scale.

### Validation and bugfix notes
- Found Express 5 wildcard route incompatibility with `/:country/:lang/*`.
- Fixed with regex route handler for all localized subpaths.
- Smoke-tested runtime endpoints:
  - `/health`
  - `/api/meta`
  - `/api/stats?country=global`
  - `/api/companies/top?country=global`
  - `/global/en/`
- Tested POST submission to `/api/stories` and confirmed moderation status response.

### Postgres rollout on Hetzner (P0)
- Added native Postgres storage mode in `server.js` using `pg`.
- Added automatic startup migration (`stories` table + index).
- Added one-time seeding from `data/stories.json` when DB is empty.
- Kept JSON fallback mode for local/dev without `DATABASE_URL`.
- Added env switches:
  - `DATABASE_URL`
  - `PG_SSL`
- Provisioned dedicated DB resources on Hetzner host PostgreSQL:
  - role: `aitookmyjob`
  - database: `aitookmyjob`
- Connected Coolify app env to new database (`DATABASE_URL`, `PG_SSL=false`).
- Triggered application redeploy after env updates.
- Added `data/*.tmp` to `.gitignore` to prevent accidental secret file commits.
