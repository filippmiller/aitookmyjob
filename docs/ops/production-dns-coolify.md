# Production DNS + Coolify — aitookmyjob (aitj-z8q.2)

**Date:** 2026-07-19 (updated after analytics wave + hotfix)  
**Bead:** aitj-z8q.2  
**Branch:** `ops/prod-dns-coolify-z8q-2`  
**Author ops session:** Grok implementer (subagent)  
**Current prod git:** `f5da127` · **schema:** `015` · **Codex evidence:** [`codex-gate-evidence.md`](./codex-gate-evidence.md)

---

## Executive summary

| Surface | Before (2026-07-19) | After ops restore |
|---------|---------------------|-------------------|
| `https://aitookmyjob.com` | GoDaddy DPS parking (`Server: DPS/2.0.0`) | **Still GoDaddy** — DNS not pointed at VPS (human action required) |
| `https://aitookmyjob.com/health` | 404 (GoDaddy site) | **Still 404** until DNS cutover |
| `https://aitookmyjob.filippmiller.com` | 503 (app exited) | **200** — Node app healthy |
| `https://aitookmyjob.filippmiller.com/health` | 503 | **200** `{"ok":true,"service":"aitookmyjob",...}` |
| Coolify app status | `exited:unhealthy` (last online 2026-05-17) | `running:unknown` (healthcheck disabled in Coolify) |

**Honest status:** Coolify deployment and alt-domain routing are restored. Apex `aitookmyjob.com` still serves the legacy GoDaddy Website Builder site because DNS (GoDaddy nameservers) points at parking IPs, not Hetzner.

---

## Coolify application

| Field | Value |
|-------|-------|
| **Name** | `aitookmyjob` |
| **UUID** | `wk848wc4oo88swk0g8oc8ksw` |
| **Project** | AITookMyJob (`kw0gcg8gck040gksggw8kkgk`) |
| **Environment** | production (`rokgwgk8ss4cscos88co48s4`) |
| **Server** | Hetzner VPS `89.167.42.128` (Coolify host) |
| **Git** | `filippmiller/aitookmyjob.git` branch `master` |
| **Build pack** | Dockerfile (`ports_exposes=8080`) |
| **FQDN (Coolify)** | `https://aitookmyjob.filippmiller.com` only (apex not yet in Coolify; API PATCH `fqdn` returns "field not allowed" — use Coolify UI) |
| **Container (post-restore)** | rotates on each deploy; check `docker ps --filter name=wk848wc4` |
| **Deploy commit (live)** | `f5da127` — analytics/privacy (#25) + forum backfill hotfix (#26) |
| **Schema version** | `015` (`analytics_events`) |
| **Storage** | PostgreSQL (`DATABASE_URL` → host `postgres`, db `aitookmyjob`) |

### Redeploy (no cacheless force)

```bash
ssh -f -N -L 8000:localhost:8000 root@89.167.42.128
curl -s -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
  "http://localhost:8000/api/v1/deploy?uuid=wk848wc4oo88swk0g8oc8ksw"
# Prefer without force=true. Use force=true only if image/layers are corrupt.
```

---

## DNS current targets (measured 2026-07-19)

### `aitookmyjob.com` (apex) — NOT our app

| Record | Value |
|--------|-------|
| **NS** | `ns23.domaincontrol.com`, `ns24.domaincontrol.com` (**GoDaddy**) |
| **A** | `76.223.105.230`, `13.248.243.5` (GoDaddy / AWS parking) |
| **www A** | same parking IPs |
| **HTTP** | `Server: DPS/2.0.0`, CSP `frame-ancestors … godaddy.com` |

### `aitookmyjob.filippmiller.com` — our app

| Record | Value |
|--------|-------|
| **A** | `89.167.42.128` (Hetzner Coolify/Traefik) |
| **Parent NS** | Namecheap `dns1/dns2.registrar-servers.com` (wildcard already works) |

---

## Env checklist (names only — values live in Coolify)

**Required for production start** (strict secrets default on when `NODE_ENV=production`):

| Key | Notes |
|-----|-------|
| `DATABASE_URL` | postgres://…@postgres:5432/aitookmyjob (set; DB exists with schema) |
| `PG_SSL` | typically `false` on internal docker network |
| `ADMIN_TOKEN` | **was missing** → set 2026-07-19 (app exits if still `change-me-admin-token`) |
| `AUTH_SECRET` | **was missing** → set 2026-07-19 (app exits if still `change-me-auth-secret`) |
| `NODE_ENV` | `production` |
| `REQUIRE_STRICT_SECRETS` | `true` |
| `BASE_URL` | currently `https://aitookmyjob.filippmiller.com` (update after apex cutover) |
| `CORS_ORIGINS` | includes filippmiller + apex + www for post-cutover |
| `ALLOW_DEV_OTP` | `false` in prod |
| `PORT` | `8080` (Coolify / Dockerfile) |

Optional / future: `TELEGRAM_*`, news ingest knobs (see `.env.example`).

---

## Root cause analysis

1. **Coolify app stopped** (`exited:unhealthy`, last online 2026-05-17). No running container; Traefik returned 503 for `aitookmyjob.filippmiller.com`.
2. **Missing production secrets** (`ADMIN_TOKEN`, `AUTH_SECRET`). With `NODE_ENV=production`, `REQUIRE_STRICT_SECRETS` defaults true and server refuses to start (see `server.js` start gate).
3. **Apex DNS never migrated** off GoDaddy Website Builder parking. Even a healthy Coolify app cannot serve `aitookmyjob.com` until A records point at `89.167.42.128` **and** Coolify FQDN includes the apex (for Traefik + LE).

---

## What was changed in this session (ops)

Safe changes only:

1. Confirmed Coolify UUID + status via API over SSH (panel on localhost:8000).
2. Confirmed Postgres db `aitookmyjob` exists on shared `postgres` container with application tables.
3. **Added Coolify env vars:** `ADMIN_TOKEN`, `AUTH_SECRET`, `NODE_ENV`, `BASE_URL`, `CORS_ORIGINS`, `ALLOW_DEV_OTP`, `REQUIRE_STRICT_SECRETS` (via Coolify API POST envs; values never committed).
4. **Triggered redeploy without `force=true`** → deployment `pkqz544ws44z80tqifzftb7i` finished successfully.
5. Verified container logs: `Storage mode: postgres`, `aitookmyjob running on :8080`.
6. Documented UUID in `.claude/deploy-instructions.md` + this file.

**Not changed:** GoDaddy DNS (no registrar API access), Coolify FQDN still only filippmiller alt domain, no credential rotation of DB password, no force-push, no DB drops.

---

## Verification curls (after restore)

```bash
# Alt domain — THIS Node service
curl -s https://aitookmyjob.filippmiller.com/health
# Expect: {"ok":true,"service":"aitookmyjob","timestamp":"..."}

curl -s -o /dev/null -w "%{http_code}\n" https://aitookmyjob.filippmiller.com/
# Expect: 200

curl -s -o /dev/null -w "%{http_code}\n" https://aitookmyjob.filippmiller.com/api/meta
curl -s -o /dev/null -w "%{http_code}\n" https://aitookmyjob.filippmiller.com/api/stats
curl -s -o /dev/null -w "%{http_code}\n" https://aitookmyjob.filippmiller.com/api/stories
curl -s -o /dev/null -w "%{http_code}\n" https://aitookmyjob.filippmiller.com/api/news
# Expect: 200 each

# Apex — still GoDaddy until DNS cutover
curl -sI https://aitookmyjob.com/ | findstr /I "Server"
# Expect until cutover: Server: DPS/2.0.0...
curl -s -o /dev/null -w "%{http_code}\n" https://aitookmyjob.com/health
# Expect until cutover: 404
```

### Evidence captured 2026-07-19 ~08:16 UTC

```
https://aitookmyjob.filippmiller.com/health → 200
  body: {"ok":true,"service":"aitookmyjob",...}
  CSP: frame-ancestors 'none' (Helmet — NOT GoDaddy)

https://aitookmyjob.filippmiller.com/ → 200 (Content-Type: text/html)
https://aitookmyjob.filippmiller.com/api/stats → 200
  {"country":"global","counters":{"laidOff":554,"sharedStories":6,...}}

https://aitookmyjob.com/ → 200 Server: DPS/2.0.0 (GoDaddy)
https://aitookmyjob.com/health → 404 (GoDaddy)
```

TLS: Traefik + Let's Encrypt on `aitookmyjob.filippmiller.com`; HTTP→HTTPS redirect 302 observed.

---

## Human action required: point apex DNS at Hetzner

Registrar: **GoDaddy** (nameservers `ns23/ns24.domaincontrol.com`). No Cloudflare zone for this domain.

### Exact DNS records to set (reversible)

In GoDaddy DNS for `aitookmyjob.com`:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| **A** | `@` | `89.167.42.128` | 600 (or default) |
| **A** | `www` | `89.167.42.128` | 600 |
| Remove or stop | any parking/forwarding / Website Builder publish | — | — |

Optional: if you prefer `www` → apex CNAME, use CNAME `www` → `aitookmyjob.com` instead of a second A.

**Before flipping DNS**, add domains in Coolify so Traefik issues certs:

1. Coolify UI → Application `aitookmyjob` → Domains / FQDN set to both:
   - `https://aitookmyjob.com`
   - `https://www.aitookmyjob.com`
   - keep `https://aitookmyjob.filippmiller.com` during transition (or drop after cutover)
2. Or update Traefik labels / FQDN carefully (Coolify API does not reliably PATCH `fqdn`; UI is preferred).
3. After DNS propagates (`dig +short A aitookmyjob.com` → `89.167.42.128`):
   - `curl -s https://aitookmyjob.com/health` → `service:aitookmyjob`
   - Update Coolify env `BASE_URL=https://aitookmyjob.com`
   - Redeploy or restart so runtime env refreshes if needed

### Propagation check

```bash
dig +short A aitookmyjob.com
dig +short A www.aitookmyjob.com
# Both must be 89.167.42.128 before expecting LE cert success
```

---

## Rollback procedure

### A) Rollback Coolify app only (keep alt domain down or previous image)

```bash
# Stop current container (app goes 503 on filippmiller subdomain)
ssh root@89.167.42.128 "docker stop wk848wc4oo88swk0g8oc8ksw-081539515025"
# Note: container name changes each deploy — resolve with:
ssh root@89.167.42.128 "docker ps --filter name=wk848wc4oo88swk0g8oc8ksw --format '{{.Names}}'"

# Or via Coolify: stop application in UI / API
```

Redeploy previous known-good commit (last image tag was commit `6134bc4` — same as current restore). For a true code rollback, set Coolify to an older SHA or redeploy after git revert on `master`.

### B) Rollback apex DNS (if cutover already done)

In GoDaddy DNS, restore previous A records:

| Type | Name | Value |
|------|------|-------|
| A | `@` | `76.223.105.230` and/or `13.248.243.5` (prior parking) |
| A | `www` | same |

Or re-enable GoDaddy Website Builder publish/forwarding if that was the prior product setting.

**Tested in this session:** reverse path for app is stop container → 503 on filippmiller (Traefik no backend). DNS rollback not exercised (apex never cut over).

### C) Secret / env rollback

Env keys added are additive. Removing `ADMIN_TOKEN`/`AUTH_SECRET` will **break** production start under strict secrets — do not delete them. To rotate: set new values via Coolify envs API/UI and redeploy.

---

## Acceptance criteria mapping

| Criterion | Status |
|-----------|--------|
| `https://aitookmyjob.com/health` returns 200 from THIS service | **NO** — blocked on GoDaddy DNS (human) |
| Homepage + public APIs work | **YES** on `aitookmyjob.filippmiller.com` (`/`, `/api/meta`, `/api/stats`, `/api/stories`, `/api/news`) |
| TLS + canonical redirects | **YES** on filippmiller (HTTPS + HTTP→HTTPS). Apex still GoDaddy TLS |
| Rollback steps documented | **YES** (this file) |
| Deployment evidence | **YES** (this file + deploy UUID `pkqz544ws44z80tqifzftb7i`) |

---

## Follow-ups (not done here)

1. Human: GoDaddy DNS A → `89.167.42.128` for `@` and `www`.
2. Coolify: add apex + www to FQDN; LE certs after DNS.
3. Set `BASE_URL=https://aitookmyjob.com` after cutover.
4. Optional: enable Coolify HTTP healthcheck path `/health` (currently disabled).
5. Optional: `/ready` probe that checks Postgres pool.
6. Record Coolify UUID in `~/.claude/projects/C--dev/memory/hetzner-vps.md` Deployed Applications table (ops memory, outside this repo).
