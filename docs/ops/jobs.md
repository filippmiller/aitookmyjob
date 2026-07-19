# Durable background jobs — operations guide

Bead: **aitj-z8q.5**  
Module: `lib/jobs.js`  
Worker: `scripts/job-worker.js`  
Migration: `004_jobs` (`jobs`, `job_runs`)

## Why

In-process `setInterval` alone is not a production scheduler: multi-instance
deploys duplicate work, restarts lose timers, and failures have no retry/history.
This infrastructure provides:

| Capability | Mechanism |
|------------|-----------|
| Stable IDs | `job_*` / `run_*` nanoid keys |
| Idempotency | Unique partial index on `idempotency_key` |
| Exclusive claim | `FOR UPDATE SKIP LOCKED` + worker lease |
| Retries + backoff | Exponential (`30s * 2^(attempt-1)`, cap 1h) |
| Timeout | Per-job `timeout_ms` (default 5m) |
| Concurrency | Worker `JOBS_CONCURRENCY` + claim limit |
| Run history | `job_runs` row per attempt |
| Dead letter | `status = dead` after `max_attempts` |
| Cancellation | `AbortSignal` in handler `meta.signal`, aborted on timeout (cooperative — handlers must check it before side effects) (aitj-z8q.25) |
| Stale-attempt guard | `complete`/`fail` with a run token mutate only while that run is the job's active attempt (run `running` + `attempt`/`locked_by` match); superseded attempts no-op and are flagged `stale` (aitj-z8q.25) |
| Admin inspect/retry | `/api/admin/jobs*` |

## Storage modes

| Mode | When | Behaviour |
|------|------|-----------|
| **PostgreSQL** | `DATABASE_URL` set | Durable queue; multi-worker safe |
| **Memory** | No `DATABASE_URL` | In-process only; lost on restart; not multi-process safe |

Memory mode is for local dev without Postgres. Do not use it in production.

## Job lifecycle

```
pending ──claim──► running ──success──► succeeded
                      │
                      ├──fail (attempts < max)──► pending (run_at += backoff)
                      │
                      └──fail (attempts ≥ max)──► dead
```

Admin `POST …/retry` moves `failed` / `dead` / `succeeded` → `pending` (bumps
`max_attempts` if exhausted so the job can run again).

Stale `running` leases (worker crash) are reclaimed when
`locked_at < now - max(lease_ms, timeout_ms + 250ms)` on the next claim. A competing
worker therefore cannot reclaim a live attempt before its allowed handler
timeout, even when configured with a shorter lease.
When reclaim does occur, the superseded `job_runs` row is closed as `timeout`
with `lease_reclaimed` before the replacement run is created.

After a reclaim, the superseded attempt can no longer mutate the job:
`complete`/`fail` verify the run token against the job's current
`attempts`/`locked_by` (and the run still being `running`), so a timed-out or
zombie handler cannot complete, requeue, or dead-letter the newer attempt
(aitj-z8q.25). Handlers also receive `meta.signal` (AbortSignal) which is
aborted on timeout — cooperative handlers check `signal.aborted` before
externally visible side effects to reduce duplicate-effect risk.
`notification.send` additionally claims its delivery atomically before calling
email/Telegram providers; concurrent calls for the same delivery skip while it
is `sending`. Telegram HTTP and injected senders receive the AbortSignal;
SMTP checks it immediately before Nodemailer's non-cancellable `sendMail` call.
An already-`sending` delivery is never resent automatically; an operator must
reconcile provider state before resetting it for retry.
Provider exceptions, response loss, and aborts after invocation are ambiguous:
the delivery remains `sending` with `reconciliationRequired` instead of being
returned to the automatic retry path. Only proven pre-send failures or explicit
provider rejection can become retryable.

## Running a worker

**Preferred production path:** separate process (or one replica with worker role).

```bash
# Standalone worker (after migrate / with DATABASE_URL)
npm run jobs:worker

# Or:
DATABASE_URL=… JOBS_CONCURRENCY=1 JOBS_POLL_MS=2000 node scripts/job-worker.js
```

**Optional in-process poller** (same Node process as HTTP server):

```bash
JOBS_WORKER=1 npm start
```

Default: `JOBS_WORKER` is off. News scheduling still **enqueues** jobs from the
web process; execution should be done by a worker.

### Env knobs

| Variable | Default | Meaning |
|----------|---------|---------|
| `JOBS_WORKER` | `true` if PG else `false` | Start in-process poller in `server.js` (set `false` on web when using dedicated worker) |
| `JOBS_WORKER_ID` | auto hostname+pid | Lease owner id |
| `JOBS_POLL_MS` | `2000` | Poll interval |
| `JOBS_CONCURRENCY` | `1` | Max jobs claimed per tick |
| `JOBS_LEASE_MS` | `600000` (10m) | Stale lock reclaim threshold |
| `NEWS_INGEST_ENABLED` | `true` if PG | Enqueue scheduled news.ingest jobs |
| `NEWS_INGEST_INTERVAL_HOURS` | `24` | Window for schedule idempotency |

## Built-in job types

| Type | Effect |
|------|--------|
| `news.ingest` | GDELT + RSS collect → `storageUpsertNewsItems` |
| `jobs.ping` | No-op health job (`{ pong: true }`) |
| `notification.send` | Deliver one `notification_deliveries` row (email/telegram) |
| `digest.weekly` | Fan-out weekly digest → enqueues `notification.send` per subscriber |
| `resource.link_check` | Probe resource URLs; set `link_status` / flag broken (aitj-z8q.12) |
| `news.source_check` | Probe news URLs; update `source_status` (aitj-z8q.10) |
| `cohort.reminder` | Event reminders + outcome follow-ups → notification fan-out (aitj-z8q.14) |
| `buddy.match` | Optional auto buddy matching for a cohort (aitj-z8q.14) |

Register more via `jobs.registerHandler(type, async (payload, meta) => …)` in
`lib/job-handlers.js` (or app bootstrap).

### Notifications (aitj-z8q.15)

| Surface | Path |
|---------|------|
| Module | `lib/notifications.js` |
| Migration | `005_notifications` |
| Admin list/retry | `GET/POST /api/admin/notifications/deliveries*` |
| Bounce/complaint hooks | `POST /api/admin/notifications/webhooks/{bounce,complaint}` |
| Unsubscribe | `GET/POST /api/notifications/unsubscribe?token=` |
| Preferences | `GET/PATCH /api/notifications/preferences` (auth) |

Email providers: `console` (default, simulated), `smtp` (`SMTP_*` / `SMTP_URL`),
`ethereal` (`EMAIL_PROVIDER=ethereal`). Logs never include raw email addresses.

## Admin API (auth: admin token or moderator role)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/admin/jobs?status=&type=&limit=&offset=` | List / filter |
| `GET` | `/api/admin/jobs/:id` | Job + run history |
| `POST` | `/api/admin/jobs/:id/retry` | Requeue failed/dead/succeeded |
| `POST` | `/api/admin/jobs` | Enqueue (`{ type, payload, idempotencyKey?, … }`) |

Example:

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/admin/jobs?status=dead"

curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"jobs.ping","payload":{"echo":"hi"}}' \
  "$BASE_URL/api/admin/jobs"

curl -s -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/admin/jobs/job_xxx/retry"
```

## News ingest wiring

`server.js` no longer runs ingest inline on the interval. It **enqueues**
`news.ingest` with a windowed idempotency key:

```
news.ingest:window:<floor(now / intervalMs)>
```

So multiple web replicas enqueue at most one job per schedule window.
A worker (standalone or `JOBS_WORKER=1`) executes it.

CLI one-shot remains available: `npm run news:ingest` (direct, not via queue).

## Production scheduler recommendations

1. **Best:** run `npm run jobs:worker` as a separate Coolify service / container
   with the same `DATABASE_URL` (and secrets) as the web app.
2. **Good:** external cron hits `POST /api/admin/jobs` with a stable
   `idempotencyKey` (or keeps using the web process only to enqueue).
3. **Acceptable for single replica:** `JOBS_WORKER=1` on the web process
   (still uses durable claim/locks — safe if you scale web later *without*
   enabling worker on every replica, or enable it on all: SKIP LOCKED prevents
   double execution).
4. **Not enough alone:** bare `setInterval` that performs side effects with no
   queue (removed for news ingest).

## Tests

```bash
npm run test:jobs
# included in:
npm run test:unit
```

Offline coverage: claim exclusivity, idempotent enqueue, backoff state machine,
retry → pending, dead-letter after max attempts.

## Related

- Migrations: `docs/ops/migrations.md` (version `004`)
- Domain contract: `docs/domain-contract-v1.md`
- News: `lib/news-ingest.js`, `scripts/ingest-news.js`
