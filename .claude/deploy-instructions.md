# Deployment Instructions — aitookmyjob

## Quick Deploy

```bash
# 1. Push changes to master
git push origin master

# 2. Open SSH tunnel to Hetzner Coolify (panel not public)
ssh -f -N -L 8000:localhost:8000 root@89.167.42.128

# 3. Trigger redeploy via Coolify API
#    NOTE: The Coolify app UUID for aitookmyjob is NOT documented in this repo.
#    Look it up via the Coolify panel at http://localhost:8000 after tunneling,
#    or from ~/.claude/projects/C--dev/memory/hetzner-vps.md if documented there.
curl -s -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
  "http://localhost:8000/api/v1/deploy?uuid=<AITOOKMYJOB_UUID>&force=true"
```

## Build

No build step required — runs as a plain Node.js server.

```bash
npm install
npm start  # node server.js
```

**Node version:** >=20

## Deploy Target

- **Platform:** Coolify on Hetzner VPS (89.167.42.128)
- **Live URL:** https://aitookmyjob.com (HTTP 200)
- **Alt URL:** https://aitookmyjob.filippmiller.com (HTTP 200)
- **Repo:** https://github.com/filippmiller/aitookmyjob
- **Deploy branch:** master

## Environment Variables

Required (names only — values in Coolify):
- `DATABASE_URL`
- `BASE_URL`
- `CORS_ORIGINS`
- `SESSION_SECRET`

See `.env.example` for the full list.

## Verification

```bash
curl -s -o /dev/null -w "%{http_code}" https://aitookmyjob.com
# Expected: 200
```

## Troubleshooting

- **Coolify CLI flag syntax:** Use `coolify deploy uuid <UUID>`, NOT `--uuid`
- **PowerShell vs Git Bash:** `timeout /t` doesn't work in Git Bash; use `powershell -Command "Start-Sleep -Seconds N"`
- **Heavy uncommitted state on 2026-04-09:** As of repo-health check, repo had many uncommitted modifications (data files, server changes, public assets). These were NOT committed by the health check — needs human review before push.

## Last Verified

2026-04-09 — Site live at HTTP 200. Heavy uncommitted local state requires manual review.
