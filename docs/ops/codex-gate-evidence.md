# Codex gate evidence pack — aitj-z8q

**Generated:** 2026-07-19  
**Master HEAD (deployed):** `f5da127` (hotfix #26; feature #25 analytics/privacy)  
**Prod surface:** https://aitookmyjob.filippmiller.com  
**Schema:** `015` (postgres)  
**Author:** Grok TL (implementation complete; **Codex owns accept/close**)

This document is **evidence for Codex gates**, not an acceptance decision.  
Do **not** close implementation beads until the linked Codex gate passes.

---

## Epic status matrix

| Bead | Role | Impl status | Close blocked on |
|------|------|-------------|------------------|
| aitj-z8q.1 | domain contract | shipped (master) | **.20** |
| aitj-z8q.2 | DNS/Coolify | **partial** — alt domain live; apex still GoDaddy | Human DNS + **.20** |
| aitj-z8q.3–.7 | foundation PG/migrate/jobs/obs/CI | shipped | **.20** |
| aitj-z8q.8–.11 | expression/insider/news/social | shipped | **.21** / **.22** |
| aitj-z8q.12–.17 | resources/feed/cohorts/admin/search | shipped | **.22** / **.23** |
| aitj-z8q.15 | notifications | shipped | **.22** |
| **aitj-z8q.18** | analytics | shipped PR #25 | **.23** |
| **aitj-z8q.19** | security/privacy/a11y/i18n | shipped PR #25 | **.23** |
| aitj-z8q.20–.24 | Codex gates | open | Codex |

---

## Production smoke (2026-07-19 ~11:21 UTC)

Base: `https://aitookmyjob.filippmiller.com`

| Path | HTTP | Notes |
|------|------|-------|
| `/health` | 200 | `schemaVersion=015`, `storage=postgres`, `gitSha=f5da127…` |
| `/ready` | 200 | `ready=true`, domain contract present |
| `/metrics` | 200 | release + counters JSON |
| `/` | 200 | HTML app shell |
| `/api/meta` | 200 | countries/languages |
| `/api/stats` | 200 | counters (e.g. sharedStories=6) |
| `/api/stories` | 200 | published stories |
| `/api/news` | 200 | community news |
| `/api/resources` | 200 | catalog |
| `/api/research/aggregates?country=global` | 200 | **k-anon k=5**; small profession/month cells suppressed |
| `/api/expression/modes` | 200 | publication intents |
| `/api/search?q=ai` | 200 | search results (no fabricated empty-query hits) |
| `/api/cohorts` | 200 | cohorts list |
| `/api/feed` | 200 | intent-aware feed |
| `/forum` | 200 | HTML |
| `/research` | 200 | HTML |
| `/api/auth/export` (no session) | **401** | privacy export requires auth |

### k-anonymity proof (public aggregates)

With 6 published stories and k=5:

- `totalPublishedStories=6` (global total kept)
- `topProfessions=[]` / profession `suppressedBuckets=6`
- Methodology: profession/month cells with `0 < n < k` omitted

### Apex domain (blocker for full .2 AC)

| Check | Result |
|-------|--------|
| `aitookmyjob.com` A | `76.223.105.230`, `13.248.243.5` (GoDaddy parking) |
| `aitookmyjob.com` Server | `DPS/2.0.0` |
| `aitookmyjob.com/health` | **404** |
| `aitookmyjob.filippmiller.com` A | `89.167.42.128` |
| Coolify FQDN | `https://aitookmyjob.filippmiller.com` only |

**Human cutover:** GoDaddy A `@` + `www` → `89.167.42.128`, then add apex domains in Coolify UI (API `PATCH fqdn` rejected: `"This field is not allowed"` on this Coolify build). Full steps: [`production-dns-coolify.md`](./production-dns-coolify.md).

---

## Migrations on prod

Boot log (deploy after #25): applied `001`…`015` cleanly; schema version **015**.

| Ver | Name | Bead |
|-----|------|------|
| 001–002 | baseline + integrity | .3/.4 |
| 003–004 | remaining entities + jobs | .3/.5 |
| 005–014 | expression…search | .8–.17 |
| **015** | **analytics_events** | **.18** |

---

## Gate-specific pointers

### .20 Foundation & production

- Domain contract: `docs/domain-contract-v1.md`, `lib/domain-contract.js`, `npm run test:domain`
- PG-only prod writes: `lib/context.js` `assertJsonFallbackAllowed` + storage routing tests
- Migrations: `migrations/001`–`015`, `npm run test:migrations`
- Jobs: `lib/jobs.js`, `lib/job-handlers.js`
- Observability: `/health` `/ready` `/metrics`, `docs/ops/backups.md`
- CI: `.github/workflows` + `npm run ci` (Quality gates + Migration apply green on #25/#26)
- Deploy: Coolify UUID `wk848wc4oo88swk0g8oc8ksw`, evidence above
- **Open risk:** apex DNS not cut over (.2 incomplete)

### .21 Expression / insider / news

- Expression: `lib/expression.js`, `routes/expression.js`, `tests/expression.test.js`
- Insider: `lib/insider.js`, evidence never public/search-indexed
- News: `lib/news-ingest.js`, `routes/news.js`, `tests/news-community.test.js`

### .22 Community / help / personalization

- Social: `lib/social.js`, `routes/social.js`
- Resources: `lib/…` + `routes/resources.js`
- Feed: `lib/personalization.js`, `routes/feed.js`
- Cohorts: `lib/cohorts.js`, `routes/cohorts.js`
- Notifications: `lib/notifications.js`
- Search: `lib/search.js`, `routes/search.js`

### .23 Admin / analytics / security / privacy  ← latest wave

| Area | Entry points | Tests |
|------|--------------|-------|
| Analytics events | `lib/analytics.js`, mig 015, job `analytics.expression` | `npm run test:analytics` |
| Funnels admin | `GET /api/admin/analytics/{catalog,funnels,events}` | unit + admin token |
| Public k-anon | `GET /api/research/aggregate(s)` | analytics + e2e research |
| Privacy export | `GET /api/auth/export` | `tests/analytics.test.js` privacy export |
| Account delete cascade | `lib/privacy.js` → `storageDeleteUser` | anonymize published, purge PII/analytics |
| i18n parity | `public/i18n/{en,ru,de,fr,es}.json` 162 keys | `npm run test:privacy` |
| a11y | skip-link + `:focus-visible` | privacy-i18n markup tests |
| CSRF / cookies | existing SameSite=Lax + CSRF middleware | e2e suites |

PRs: [#25](https://github.com/filippmiller/aitookmyjob/pull/25), hotfix [#26](https://github.com/filippmiller/aitookmyjob/pull/26).

### .24 Final release

Depends on .20–.23 all green + apex domain serving this app + backup/rollback rehearsal.

---

## Local quality (pre-merge #25)

```
npm run test:unit  → 318 pass (includes analytics + privacy-i18n)
CI Quality gates   → pass
CI Migration apply → pass (through 015)
```

---

## Suggested Codex order

1. **.20** — foundation (note .2 apex residual risk; alt domain is production-serving)
2. **.21** → **.22** in parallel after .20
3. **.23** — analytics/security wave
4. **.24** — only after apex cutover OR explicit waiver that filippmiller.com is interim canonical

---

## Rollback

- Coolify redeploy previous successful deployment UUID (see Coolify UI history).
- Schema: migrations are additive; `015` has `down()` dropping `analytics_events` only if needed.
- Apex DNS rollback: restore GoDaddy parking A records (documented in production-dns-coolify.md).
