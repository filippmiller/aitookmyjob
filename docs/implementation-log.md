# Implementation Log

## 2026-02-11

### P1/P2 completion pass (active polling run)
- Added P1 backend flows:
  - `POST /api/auth/phone/start`
  - `POST /api/auth/phone/request-otp` (alias)
  - `POST /api/auth/phone/verify`
  - `POST /api/auth/phone/confirm` (alias)
- Enforced verified phone for trusted writes:
  - story submission (`POST /api/stories`)
  - forum topic creation (`POST /api/forum/topics`)
- Added AI-assisted moderation scoring on story intake:
  - toxicity/spam/pii/deanonymization heuristic scores
  - risk bands (`low`/`medium`/`high`)
  - recommendations returned in API response
- Added privacy transform model for public stories:
  - field-level masking (`name/company/date`) at read time
  - visibility mapping from frontend controls to canonical privacy schema
- Added story versioning and moderation score lookup:
  - table/file store for `story_versions`
  - `GET /api/admin/moderation/:id/scores`
- Added Telegram integration endpoints:
  - `POST /api/integrations/telegram/link/start`
  - `POST /api/integrations/telegram/link-code` (alias)
  - `POST /api/integrations/telegram/link` (alias)
  - `GET /api/integrations/telegram/status`
  - `POST /api/integrations/telegram/webhook`
- Added P2 analytics/transparency endpoints:
  - `GET /api/research/aggregate`
  - `GET /api/research/aggregates` (alias)
  - `GET /api/transparency/report` (supports `from`, `to`, or `period=YYYY-QN`)
  - `GET /api/admin/anomalies`
  - `GET /api/admin/anomaly/signals`
  - `GET /api/admin/anomalies/signals`
  - `GET /api/antiabuse/anomaly/signals`
- Added new persistence entities in Postgres + JSON fallback:
  - `auth_identities`
  - `story_versions`
  - `telegram_links`
  - `transparency_events`
  - New local fallback files under `data/` for the same entities
- Frontend integration (from worker + merged):
  - phone verification forms in Auth section
  - story privacy controls + risk warnings display
  - transparency and anomaly panels in Admin
  - Telegram linking/status panel in Integrations

### Validation (local, post-change)
- `node --check server.js` passed.
- `node --check public/app.js` passed.
- End-to-end smoke passed:
  - register -> phone request-otp -> phone confirm -> verified
  - submit story with privacy controls -> pending moderation
  - topic creation succeeds after phone verification
  - moderation queue and score detail endpoints return data
  - anomaly signal endpoint returns valid JSON
  - research aggregates and transparency endpoints return valid JSON
  - telegram link-code and webhook endpoints return expected responses

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

### Hotfix after first Postgres deploy
- Initial `DATABASE_URL` used `host.docker.internal` and failed inside Coolify runtime (`ENOTFOUND`).
- Updated runtime and preview env values to use Docker network hostname `postgres`.
- Triggered redeploy and validated container health.
- Runtime log now confirms: `Storage mode: postgres`.
- Post-deploy verification:
  - Public API `/api/stats` responds successfully.
  - New story submission writes to Postgres (`stories` row count increased).

### Security cleanup
- Revoked temporary Coolify API token used for provisioning.

### Planning checkpoint requested by user
- Paused feature expansion to create a full implementation whitepaper first.
- Added `docs/WHITEPAPER.md` as the authoritative architecture and execution blueprint.
- All next implementation steps will follow phases and acceptance criteria defined in the whitepaper.

### Docs alignment to WHITEPAPER P0 endpoints and operational flows
- Updated public docs to map WHITEPAPER P0 endpoint blueprint against currently implemented runtime endpoints.
- Documented P0 operational flows explicitly:
  - Public read flow: locale detection -> country-scoped stats/stories/companies reads.
  - Story intake flow: `POST /api/stories` -> validation/sanitization -> persisted `pending` moderation state.
  - Forum flow split: read endpoints active; write endpoints reserved for auth-gated P0 implementation.
  - Admin/moderation flow split: admin overview active with token protection; queue/action/sanctions endpoints documented as P0 target.
  - Auth/session + Telegram webhook flows documented as P0 targets.
- Added curl-based verification checklist with concrete commands for:
  - health/meta/locale checks
  - country-aware read APIs
  - story submit success and validation failure
  - admin unauthorized vs authorized access
  - localized route redirect/canonical checks

### Active polling multi-agent run (user-requested)
- Spawned 3 parallel workers:
  1) backend P0 APIs,
  2) frontend P0 UX,
  3) docs + validation runbook.
- Used active polling loops with forced finalize to avoid idle delay.
- Backend worker returned exploration only; backend scope was implemented directly in main agent to keep delivery on schedule.
- Frontend worker delivered major UI expansion (auth/forum/admin panels).
- Docs worker delivered endpoint verification documentation and README/deploy updates.

### P0 backend implementation completed in this cycle
- Added dependencies: `bcryptjs`, `jsonwebtoken`.
- Implemented auth APIs:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- Added session cookie auth (`auth_token`) and middleware.
- Added forum write APIs:
  - `POST /api/forum/topics`
  - `POST /api/forum/topics/:id/replies`
- Added moderation/admin APIs:
  - `GET /api/admin/moderation/queue`
  - `POST /api/admin/moderation/:id/action`
  - `POST /api/admin/sanctions`
- Added sanctions persistence and enforcement checks (mute/ban behavior gate).
- Added audit logging for auth/story/forum/moderation/sanction events.
- Extended Postgres initialization with new P0 tables and fallback local JSON storage for offline/dev.

### Validation performed (local)
- Health endpoint success.
- Register/login/me flow success.
- Topic creation + reply success.
- Moderation queue retrieval + action success.
- Sanction creation success.
- Full smoke output captured in terminal execution.

### Production rollout finalized (Coolify + Hetzner)
- Verified repository state and pushed latest build commit to GitHub:
  - branch: `master`
  - pushed commit: `6cffc36`
- Triggered production deployment through Coolify manual GitHub webhook endpoint:
  - `POST /webhooks/source/github/events/manual`
  - response: deployment queued for app UUID `wk848wc4oo88swk0g8oc8ksw`
  - deployment UUID: `ysw4g080g0sgkgskc4wgwws4`
- Used active polling against Docker runtime to track rollout progress:
  - old container image: `...:ee12088...`
  - new container image: `...:6cffc36...`
  - new container reached healthy running state.
- Production smoke checks completed on live URL:
  - `http://wk848wc4oo88swk0g8oc8ksw.89.167.42.128.sslip.io`
  - `GET /health` -> `ok: true`
  - `GET /api/meta` -> countries and 5 languages available
  - `GET /api/stats?country=global` -> valid counters/found rate response
  - `GET /api/admin/overview` (without token) -> `401` as expected
  - `HEAD /global/en/` -> `200`
