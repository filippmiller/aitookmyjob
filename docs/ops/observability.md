# Observability — live/ready, logs, metrics, alerts

Bead: **aitj-z8q.6**  
Modules: `lib/logger.js`, `lib/metrics.js`, `lib/alerts.js`, `lib/readiness.js`, `lib/release.js`

## Probes

| Endpoint | Meaning | Failures |
|----------|---------|----------|
| `GET /live` | Process is up (liveness). Memory/pid/uptime + release. | Only if process dead |
| `GET /health` | Lightweight service identity + schema/storage + release | Always 200 if listening |
| `GET /ready` | Dependencies healthy (readiness) | **503** if DB down, pool missing, pending migrations; optional jobs threshold |
| `GET /metrics` | In-process counters/gauges + release + memory | Always 200 if listening |

Coolify / load balancer recommendation:

- **Liveness path:** `/live` (restart only when process is wedged)
- **Readiness path:** `/ready` (remove from pool when DB/migrations bad)

### Ready checks

| Check | Required? | Notes |
|-------|-----------|-------|
| Process | always | Implied by response |
| DB `SELECT 1` | when `DATABASE_URL` set | 503 `db_unavailable` / `pool_not_ready` |
| Migrations | when PG | 503 `migrations_pending` |
| Jobs queue | soft by default | Counts by status; set `READY_CHECK_JOBS=true` to fail when `dead > READY_JOBS_DEAD_MAX` (default 50) |

File-json mode (no `DATABASE_URL`) is always ready (dev only).

## Release metadata

Every probe includes `release`:

```json
{
  "service": "aitookmyjob",
  "version": "1.0.0",
  "gitSha": "abc123…",
  "node": "v20.x",
  "env": "production"
}
```

Sources:

| Field | Source |
|-------|--------|
| `version` | `RELEASE_VERSION` or `package.json` |
| `gitSha` | `GIT_SHA` → `SOURCE_COMMIT` → `COOLIFY_COMMIT` → `COMMIT_SHA` → `unknown` |

Set `GIT_SHA` (or Coolify’s commit env) in the deploy so incidents map to a commit.

## Structured logs

- Format: one JSON object per line on stdout/stderr
- Fields: `ts`, `level`, `msg`, `service`, optional `requestId`, `component`
- **Redaction:** keys matching password/token/secret/authorization/cookie/email/phone/etc. → `[REDACTED]`; Bearer tokens, DB URLs, emails, phones scrubbed in free-form strings
- Request middleware sets `X-Request-Id` (honours inbound header ≤128 chars) and logs HTTP access as JSON via morgan
- Probe paths `/live` `/ready` `/health` `/metrics` are not access-logged (metrics still count)

Do **not** log request bodies, OTP codes, or full story text.

## Metrics hooks

`GET /metrics` JSON snapshot (not Prometheus text — fine for webhooks/robots).
All HTTP requests (including probes) increment counters; access logs still skip probe spam.

| Counter | Meaning |
|---------|---------|
| `http_requests_total` | Every finished request |
| `http_errors_4xx` / `http_errors_5xx` | Status classes |
| `ready_failures` | `/ready` returned not-ready |
| `job_failures` / `jobs_processed` | In-process worker ticks |
| `job_enqueue_failures` | Scheduler could not enqueue |
| `alerts_*` | Alert attempts / webhook results |
| `unhandled_errors` | Express error middleware |

## Alerts

Module: `lib/alerts.js`

| Env | Default | Purpose |
|-----|---------|---------|
| `ALERT_WEBHOOK_URL` | unset | If set, POST JSON alert body |
| `ALERT_WEBHOOK_TIMEOUT_MS` | `5000` | fetch timeout |
| `ALERT_DEDUPE_MS` | `60000` | Same fingerprint not re-sent |

When webhook is unset, alerts are **structured-logged only** (`level=warn`, `msg=alert`).

### Built-in alert types

| Type | Severity | Trigger |
|------|----------|---------|
| `readiness_failed` | critical | `/ready` not ready (availability / DB / migrations / jobs) |
| `unhandled_error` | critical | Express 500 path |
| `job_enqueue_failed` | warning | News ingest enqueue error |
| `job_worker_tick_failed` | warning | In-process worker poll error |

### Example webhook payload

```json
{
  "service": "aitookmyjob",
  "severity": "critical",
  "type": "readiness_failed",
  "message": "db_unavailable",
  "details": { "error": "db_unavailable", "storage": "postgres" },
  "release": { "version": "1.0.0", "gitSha": "…" },
  "timestamp": "2026-07-19T12:00:00.000Z"
}
```

Wire `ALERT_WEBHOOK_URL` to Slack/Discord/PagerDuty/n8n as needed. No vendor SDK required.

### External uptime (recommended)

Also monitor from outside the VPS:

1. HTTP check `https://…/live` every 1m → page on failure
2. HTTP check `https://…/ready` every 1m → page on non-200
3. Optional: scrape `/metrics` and alert on `job_failures` growth

## Env summary

```bash
GIT_SHA=          # or SOURCE_COMMIT / COOLIFY_COMMIT
RELEASE_VERSION=  # optional override of package.json version
LOG_LEVEL=info    # debug enables debug logs
ALERT_WEBHOOK_URL=
ALERT_DEDUPE_MS=60000
READY_CHECK_JOBS=false
READY_JOBS_DEAD_MAX=50
```
