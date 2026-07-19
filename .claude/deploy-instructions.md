# Deployment Instructions — aitookmyjob

## Quick Deploy

```bash
# 1. Push changes to master
git push origin master

# 2. Open SSH tunnel to Hetzner Coolify (panel not public)
ssh -f -N -L 8000:localhost:8000 root@89.167.42.128

# 3. Trigger redeploy via Coolify API (prefer without force=true)
#    Coolify app UUID: wk848wc4oo88swk0g8oc8ksw
curl -s -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
  "http://localhost:8000/api/v1/deploy?uuid=wk848wc4oo88swk0g8oc8ksw"
# Cacheless rebuild only if needed (resource risk on busy VPS):
# curl -s -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
#   "http://localhost:8000/api/v1/deploy?uuid=wk848wc4oo88swk0g8oc8ksw&force=true"
```

Token: Coolify API token from `~/.claude/projects/C--dev/memory/hetzner-vps.md` (never commit).

## Build

No build step required — runs as a plain Node.js server.

```bash
npm install
npm start  # node server.js
```

**Node version:** >=20  
**Container port:** 8080 (`Dockerfile` + Coolify `ports_exposes`)

## Deploy Target

| Field | Value |
|-------|-------|
| **Platform** | Coolify on Hetzner VPS (`89.167.42.128`) |
| **Coolify UUID** | `wk848wc4oo88swk0g8oc8ksw` |
| **Project** | AITookMyJob |
| **Deploy branch** | `master` |
| **Repo** | https://github.com/filippmiller/aitookmyjob |
| **Live (current)** | https://aitookmyjob.filippmiller.com (Node app; restored 2026-07-19) |
| **Canonical apex** | https://aitookmyjob.com — **still GoDaddy DPS until DNS cutover** |

Full DNS/Coolify evidence + rollback: [`docs/ops/production-dns-coolify.md`](../docs/ops/production-dns-coolify.md)

## Environment Variables

Required in Coolify (names only — values in Coolify UI/API):

- `DATABASE_URL` — PostgreSQL (`postgres` container, db `aitookmyjob`)
- `PG_SSL`
- `ADMIN_TOKEN` — must not be default `change-me-admin-token` in production
- `AUTH_SECRET` — must not be default `change-me-auth-secret` in production
- `NODE_ENV=production`
- `REQUIRE_STRICT_SECRETS=true`
- `BASE_URL`
- `CORS_ORIGINS`
- `ALLOW_DEV_OTP=false` (prod)
- `PORT=8080` (usually set by Coolify)

See `.env.example` for the full list.

## Verification

```bash
# Current working production surface (alt domain)
curl -s https://aitookmyjob.filippmiller.com/health
# Expect: {"ok":true,"service":"aitookmyjob",...}

curl -s -o /dev/null -w "%{http_code}\n" https://aitookmyjob.filippmiller.com/
# Expect: 200

# Apex — only valid after GoDaddy A records → 89.167.42.128 + Coolify FQDN update
curl -s https://aitookmyjob.com/health
# Expect after cutover: same JSON with service=aitookmyjob
# Until cutover: GoDaddy 404 / DPS Server header
```

After deploy: check Coolify status, container logs (`docker logs` filter `wk848`), no crash loop.

## Troubleshooting

- **Coolify CLI flag syntax:** Use `coolify deploy uuid <UUID>`, NOT `--uuid`
- **PowerShell vs Git Bash:** `timeout /t` doesn't work in Git Bash; use `powershell -Command "Start-Sleep -Seconds N"`
- **503 on filippmiller subdomain:** app exited — redeploy UUID above; ensure `ADMIN_TOKEN`/`AUTH_SECRET` are real (strict secrets gate)
- **Apex still GoDaddy:** DNS NS is domaincontrol.com; change A `@`/`www` to `89.167.42.128` in GoDaddy DNS (see ops doc)
- **Disk pressure on VPS:** avoid `force=true` unless necessary; disk was ~88% on 2026-07-19

## Last Verified

2026-07-19 — Coolify redeploy finished (`pkqz544ws44z80tqifzftb7i`); `aitookmyjob.filippmiller.com/health` 200 from Node app; apex still GoDaddy parking. See `docs/ops/production-dns-coolify.md`.
