# PostgreSQL backups & restore drill

Bead: **aitj-z8q.6**  
Scripts: `scripts/backup-pg.js`, `scripts/restore-pg.js`, `scripts/backup-pg.sh`  
npm: `npm run db:backup`, `npm run db:restore`

## Why

Production storage is PostgreSQL (`DATABASE_URL`). File JSON under `data/` is
dev-only. Backups must be **scriptable**, **non-secret-leaking**, and drillable.

## Prerequisites

| Tool | Role |
|------|------|
| `pg_dump` | Logical backup (custom or plain) |
| `pg_restore` | Restore custom format (`.dump`) |
| `psql` | Restore plain SQL (`.sql`) |
| `DATABASE_URL` | Target / source connection string (never logged) |

Install client tools on the host that runs backups (Coolify sidecar, laptop, or
cron container). Override binaries with `PG_DUMP`, `PG_RESTORE`, `PSQL` if needed.

## Backup

```bash
# Default: custom compressed dump → ./backups/aitookmyjob-<utc>.dump
npm run db:backup

# Explicit
node scripts/backup-pg.js --out /var/backups/aitookmyjob --format custom
node scripts/backup-pg.js --format plain   # → .sql

# Shell wrapper (cron-friendly)
./scripts/backup-pg.sh --out /var/backups/aitookmyjob
```

Success prints a single JSON line (path + bytes). Failures exit non-zero and
redact any accidental connection-string echo.

### Suggested schedule

| Cadence | Retention (example) |
|---------|---------------------|
| Daily 03:00 UTC | 14 daily |
| Weekly Sunday | 8 weekly |
| Before risky migrations | Keep until verified |

Store dumps **off the app container** (object storage, another volume, or the
ops laptop). App disk is not a backup target.

## Restore (drill)

**Always restore to a non-production database first.**

```bash
# 1) Point DATABASE_URL at a scratch DB (not prod)
export DATABASE_URL='postgresql://…/aitookmyjob_restore_drill'

# 2) Restore (destructive — requires explicit confirm)
npm run db:restore -- --file backups/aitookmyjob-YYYYMMDD….dump --yes
# or
node scripts/restore-pg.js --file backups/….sql --yes

# 3) Verify
npm run db:status
# optional: start app against drill DB and hit /ready
```

### Production restore (incident)

1. Freeze writes if possible (scale web/worker to 0 or maintenance mode).
2. Snapshot current volume/DB if the platform allows (pre-restore safety).
3. Restore chosen dump to the production connection string with `--yes`.
4. Run `npm run db:status` — apply pending migrations only if the backup is
   older than current migration files: `npm run db:migrate`.
5. Smoke: `GET /live` 200, `GET /ready` 200, login + one story read.
6. Re-enable workers and traffic.

## What is *not* covered

- Object/media storage (this app stores media as text/JSON in PG or static files)
- Coolify/Postgres volume snapshots (platform-level — keep those too)
- Point-in-time recovery (WAL archiving) — optional future hardening

## Checklist (quarterly drill)

- [ ] `pg_dump` succeeds from prod credentials on an ops host
- [ ] Restore into scratch DB completes
- [ ] `db:status` shows expected schema version
- [ ] App `/ready` returns 200 against scratch DB
- [ ] Backup artifact size/age recorded in ops notes
