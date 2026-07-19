/**
 * Durable background jobs — enqueue, claim, complete, fail, retry, dead-letter.
 *
 * PostgreSQL path (DATABASE_URL): durable queue with FOR UPDATE SKIP LOCKED,
 * lease reclaim, idempotency keys, exponential backoff, run history,
 * stale-attempt guard (completion/failure requires the active lease/run token,
 * aitj-z8q.25) and cooperative handler cancellation via AbortSignal.
 * Without DATABASE_URL: in-memory queue for local dev (documented no-op semantics
 * for multi-process; single-process only).
 *
 * Bead: aitj-z8q.5
 */

"use strict";

const { customAlphabet } = require("nanoid");

const jobIdGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 16);
const runIdGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 16);

const JOB_STATUS = Object.freeze({
  PENDING: "pending",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  DEAD: "dead"
});

const RUN_STATUS = Object.freeze({
  RUNNING: "running",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  TIMEOUT: "timeout",
  DEAD: "dead"
});

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_LEASE_MS = 10 * 60 * 1000;
const LEASE_TIMEOUT_GRACE_MS = 250;
const DEFAULT_BACKOFF_BASE_MS = 30 * 1000;
const DEFAULT_BACKOFF_MAX_MS = 60 * 60 * 1000;
const DEFAULT_POLL_MS = 2000;

/** @type {Map<string, Function>} */
const handlers = new Map();

/** In-memory fallback store (dev without DATABASE_URL). */
const memory = {
  jobs: new Map(),
  runs: new Map(),
  /** @type {Map<string, string>} idempotencyKey -> jobId */
  byIdempotency: new Map()
};

function nowIso() {
  return new Date().toISOString();
}

/**
 * Exponential backoff: base * 2^(attempt-1), capped.
 * attempt is 1-based (after first failure attempt=1 → base, attempt=2 → 2*base, …).
 */
function computeBackoffMs(attempt, options = {}) {
  const base = Math.max(1000, Number(options.baseMs || DEFAULT_BACKOFF_BASE_MS));
  const max = Math.max(base, Number(options.maxMs || DEFAULT_BACKOFF_MAX_MS));
  const n = Math.max(1, Math.floor(Number(attempt) || 1));
  const raw = base * Math.pow(2, n - 1);
  return Math.min(max, Math.floor(raw));
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload || {},
    status: row.status,
    idempotencyKey: row.idempotency_key ?? row.idempotencyKey ?? null,
    attempts: Number(row.attempts || 0),
    maxAttempts: Number(row.max_attempts ?? row.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    runAt: row.run_at ? new Date(row.run_at).toISOString() : row.runAt || null,
    lockedAt: row.locked_at ? new Date(row.locked_at).toISOString() : row.lockedAt || null,
    lockedBy: row.locked_by ?? row.lockedBy ?? null,
    lastError: row.last_error ?? row.lastError ?? null,
    timeoutMs: Number(row.timeout_ms ?? row.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    result: typeof row.result === "string" ? JSON.parse(row.result) : row.result ?? null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : row.createdAt || null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : row.updatedAt || null
  };
}

function rowToRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.job_id ?? row.jobId,
    attempt: Number(row.attempt || 0),
    workerId: row.worker_id ?? row.workerId ?? null,
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : row.startedAt || null,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : row.finishedAt || null,
    status: row.status,
    error: row.error || null,
    result: typeof row.result === "string" ? JSON.parse(row.result) : row.result ?? null
  };
}

function registerHandler(type, fn) {
  if (!type || typeof fn !== "function") {
    throw new Error("registerHandler(type, fn) requires a non-empty type and function");
  }
  handlers.set(String(type), fn);
}

function getHandler(type) {
  return handlers.get(String(type)) || null;
}

function listHandlers() {
  return [...handlers.keys()];
}

/**
 * Resolve pool from options or context. Returns null when no PG.
 * @param {{ pool?: import('pg').Pool, getPool?: Function, usePostgres?: boolean }} options
 */
function resolvePool(options = {}) {
  if (options.pool) return options.pool;
  if (typeof options.getPool === "function") {
    try {
      return options.getPool() || null;
    } catch (_e) {
      return null;
    }
  }
  return null;
}

function usePg(options = {}) {
  if (options.useMemory === true) return false;
  if (options.usePostgres === false) return false;
  const pool = resolvePool(options);
  if (pool) return true;
  if (options.usePostgres === true) return true;
  // Lazy require to avoid circular deps at load time
  try {
    // eslint-disable-next-line global-require
    const ctx = require("./context");
    return Boolean(ctx.usePostgres && ctx.getPgPool && ctx.getPgPool());
  } catch (_e) {
    return false;
  }
}

function getPoolOrThrow(options = {}) {
  const pool = resolvePool(options);
  if (pool) return pool;
  // eslint-disable-next-line global-require
  const ctx = require("./context");
  const p = ctx.getPgPool();
  if (!p) throw new Error("PostgreSQL pool not initialized");
  return p;
}

// ── Memory implementation ──

function memoryEnqueue({ type, payload, idempotencyKey, runAt, maxAttempts, timeoutMs }) {
  if (idempotencyKey) {
    const existingId = memory.byIdempotency.get(idempotencyKey);
    if (existingId) {
      const existing = memory.jobs.get(existingId);
      if (existing) return { job: { ...existing }, created: false };
    }
  }
  const id = `job_${jobIdGen()}`;
  const now = nowIso();
  const job = {
    id,
    type: String(type),
    payload: payload && typeof payload === "object" ? { ...payload } : {},
    status: JOB_STATUS.PENDING,
    idempotencyKey: idempotencyKey || null,
    attempts: 0,
    maxAttempts: Math.min(100, Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS)),
    runAt: runAt ? new Date(runAt).toISOString() : now,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    timeoutMs: Math.min(3600000, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)),
    result: null,
    createdAt: now,
    updatedAt: now
  };
  memory.jobs.set(id, job);
  if (idempotencyKey) memory.byIdempotency.set(idempotencyKey, id);
  return { job: { ...job }, created: true };
}

function memoryClaim(workerId, { limit = 1, leaseMs = DEFAULT_LEASE_MS } = {}) {
  const now = Date.now();
  const claimed = [];
  const sorted = [...memory.jobs.values()]
    .filter((j) => {
      if (j.status === JOB_STATUS.PENDING && new Date(j.runAt).getTime() <= now) return true;
      if (
        j.status === JOB_STATUS.RUNNING &&
        j.lockedAt &&
        now - new Date(j.lockedAt).getTime() >
          Math.max(
            Number(leaseMs) || DEFAULT_LEASE_MS,
            (Number(j.timeoutMs) || DEFAULT_TIMEOUT_MS) + LEASE_TIMEOUT_GRACE_MS
          )
      ) {
        return true;
      }
      return false;
    })
    .sort((a, b) => new Date(a.runAt) - new Date(b.runAt) || a.id.localeCompare(b.id));

  for (const j of sorted) {
    if (claimed.length >= limit) break;
    // Exclusive claim: only if still claimable
    const live = memory.jobs.get(j.id);
    if (!live) continue;
    const stillPending =
      live.status === JOB_STATUS.PENDING && new Date(live.runAt).getTime() <= now;
    const staleRunning =
      live.status === JOB_STATUS.RUNNING &&
      live.lockedAt &&
      now - new Date(live.lockedAt).getTime() >
        Math.max(
          Number(leaseMs) || DEFAULT_LEASE_MS,
          (Number(live.timeoutMs) || DEFAULT_TIMEOUT_MS) + LEASE_TIMEOUT_GRACE_MS
        );
    if (!stillPending && !staleRunning) continue;

    if (staleRunning) {
      for (const run of memory.runs.values()) {
        if (run.jobId === live.id && run.status === RUN_STATUS.RUNNING) {
          run.status = RUN_STATUS.TIMEOUT;
          run.finishedAt = nowIso();
          run.error = "lease_reclaimed";
        }
      }
    }

    live.status = JOB_STATUS.RUNNING;
    live.lockedAt = nowIso();
    live.lockedBy = workerId;
    live.attempts = (live.attempts || 0) + 1;
    live.updatedAt = nowIso();
    memory.jobs.set(live.id, live);

    const run = {
      id: `run_${runIdGen()}`,
      jobId: live.id,
      attempt: live.attempts,
      workerId,
      startedAt: nowIso(),
      finishedAt: null,
      status: RUN_STATUS.RUNNING,
      error: null,
      result: null
    };
    memory.runs.set(run.id, run);
    claimed.push({ job: { ...live }, runId: run.id });
  }
  return claimed;
}

/**
 * Active-run check (aitj-z8q.25): a completion/failure is only accepted from
 * the attempt that currently owns the job — job still `running`, run still
 * `running`, and the run's attempt + worker match the job's live lease.
 * After a reclaim (attempts bumped, locked_by changed) a stale attempt's
 * token no longer matches and its mutations become no-ops.
 */
function isActiveRunMemory(job, runId) {
  const run = memory.runs.get(runId);
  return Boolean(
    run &&
      run.jobId === job.id &&
      run.status === RUN_STATUS.RUNNING &&
      run.attempt === job.attempts &&
      run.workerId === job.lockedBy &&
      job.status === JOB_STATUS.RUNNING
  );
}

function memoryComplete(jobId, result, runId) {
  const job = memory.jobs.get(jobId);
  if (!job) return null;
  // Stale-attempt gate: run token supplied but no longer the active run.
  if (runId && !isActiveRunMemory(job, runId)) return null;
  job.status = JOB_STATUS.SUCCEEDED;
  job.result = result ?? null;
  job.lastError = null;
  job.lockedAt = null;
  job.lockedBy = null;
  job.updatedAt = nowIso();
  memory.jobs.set(jobId, job);
  if (runId && memory.runs.has(runId)) {
    const run = memory.runs.get(runId);
    run.status = RUN_STATUS.SUCCEEDED;
    run.finishedAt = nowIso();
    run.result = result ?? null;
    memory.runs.set(runId, run);
  }
  return { ...job };
}

function memoryFail(jobId, error, { runId, timeout = false } = {}) {
  const job = memory.jobs.get(jobId);
  if (!job) return null;
  // Stale-attempt gate (aitj-z8q.25): a superseded attempt must not requeue
  // or dead-letter a job that a newer attempt now owns.
  if (runId && !isActiveRunMemory(job, runId)) return null;
  const errMsg = error instanceof Error ? error.message : String(error || "unknown error");
  const attempts = job.attempts || 0;
  const maxAttempts = job.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const exhausted = attempts >= maxAttempts;

  if (exhausted) {
    job.status = JOB_STATUS.DEAD;
    job.lastError = errMsg;
    job.lockedAt = null;
    job.lockedBy = null;
    job.updatedAt = nowIso();
  } else {
    const backoff = computeBackoffMs(attempts);
    job.status = JOB_STATUS.PENDING;
    job.lastError = errMsg;
    job.lockedAt = null;
    job.lockedBy = null;
    job.runAt = new Date(Date.now() + backoff).toISOString();
    job.updatedAt = nowIso();
  }
  memory.jobs.set(jobId, job);

  if (runId && memory.runs.has(runId)) {
    const run = memory.runs.get(runId);
    run.status = exhausted
      ? RUN_STATUS.DEAD
      : timeout
        ? RUN_STATUS.TIMEOUT
        : RUN_STATUS.FAILED;
    run.finishedAt = nowIso();
    run.error = errMsg;
    memory.runs.set(runId, run);
  }
  return { ...job };
}

function memoryRetry(jobId) {
  const job = memory.jobs.get(jobId);
  if (!job) return null;
  if (![JOB_STATUS.FAILED, JOB_STATUS.DEAD, JOB_STATUS.SUCCEEDED].includes(job.status)) {
    return { job: { ...job }, retried: false, reason: `status is ${job.status}` };
  }
  job.status = JOB_STATUS.PENDING;
  job.runAt = nowIso();
  job.lockedAt = null;
  job.lockedBy = null;
  job.lastError = null;
  // Admin retry resets attempt budget partially: keep history, allow max_attempts more from current
  // Spec: requeue for execution; do not wipe attempts so history remains accurate.
  // Bump max_attempts if exhausted so it can run again.
  if (job.attempts >= job.maxAttempts) {
    job.maxAttempts = job.attempts + DEFAULT_MAX_ATTEMPTS;
  }
  job.updatedAt = nowIso();
  memory.jobs.set(jobId, job);
  return { job: { ...job }, retried: true };
}

function memoryList({ status, type, limit = 50, offset = 0 } = {}) {
  let rows = [...memory.jobs.values()];
  if (status) rows = rows.filter((j) => j.status === status);
  if (type) rows = rows.filter((j) => j.type === type);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const total = rows.length;
  const slice = rows.slice(offset, offset + limit).map((j) => ({ ...j }));
  return { jobs: slice, total };
}

function memoryGet(jobId) {
  const job = memory.jobs.get(jobId);
  return job ? { ...job } : null;
}

function memoryGetRuns(jobId) {
  return [...memory.runs.values()]
    .filter((r) => r.jobId === jobId)
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
    .map((r) => ({ ...r }));
}

function memoryReset() {
  memory.jobs.clear();
  memory.runs.clear();
  memory.byIdempotency.clear();
}

// ── PostgreSQL implementation ──

async function pgEnqueue(pool, { type, payload, idempotencyKey, runAt, maxAttempts, timeoutMs }) {
  const id = `job_${jobIdGen()}`;
  const maxA = Math.min(100, Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS));
  const timeout = Math.min(3600000, Math.max(1000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
  const runAtDate = runAt ? new Date(runAt) : new Date();
  const payloadJson = JSON.stringify(payload && typeof payload === "object" ? payload : {});

  if (idempotencyKey) {
    // Insert-or-return existing for true idempotent enqueue
    const existing = await pool.query(
      `SELECT * FROM jobs WHERE idempotency_key = $1 LIMIT 1;`,
      [idempotencyKey]
    );
    if (existing.rows[0]) {
      return { job: rowToJob(existing.rows[0]), created: false };
    }
  }

  try {
    const res = await pool.query(
      `INSERT INTO jobs (
         id, type, payload, status, idempotency_key, attempts, max_attempts,
         run_at, timeout_ms, created_at, updated_at
       ) VALUES (
         $1, $2, $3::jsonb, 'pending', $4, 0, $5,
         $6, $7, NOW(), NOW()
       )
       RETURNING *;`,
      [id, String(type), payloadJson, idempotencyKey || null, maxA, runAtDate.toISOString(), timeout]
    );
    return { job: rowToJob(res.rows[0]), created: true };
  } catch (err) {
    // Unique violation on idempotency_key — concurrent insert race
    if (err && (err.code === "23505") && idempotencyKey) {
      const existing = await pool.query(
        `SELECT * FROM jobs WHERE idempotency_key = $1 LIMIT 1;`,
        [idempotencyKey]
      );
      if (existing.rows[0]) {
        return { job: rowToJob(existing.rows[0]), created: false };
      }
    }
    throw err;
  }
}

/**
 * Claim up to `limit` jobs using FOR UPDATE SKIP LOCKED so concurrent workers
 * never process the same job.
 */
async function pgClaim(pool, workerId, { limit = 1, leaseMs = DEFAULT_LEASE_MS } = {}) {
  const client = await pool.connect();
  const claimed = [];
  try {
    await client.query("BEGIN");

    // Reclaim stale leases + pick pending due jobs in one locked select
    const pick = await client.query(
      `SELECT id FROM jobs
       WHERE (
         (status = 'pending' AND run_at <= NOW())
         OR (
           status = 'running'
           AND locked_at IS NOT NULL
           AND locked_at < NOW() -
             (GREATEST($1::bigint, timeout_ms::bigint + $3::bigint)::text || ' milliseconds')::interval
         )
       )
       ORDER BY run_at ASC, id ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED;`,
      [
        String(Math.max(1000, Number(leaseMs) || DEFAULT_LEASE_MS)),
        Math.max(1, Math.min(50, Number(limit) || 1)),
        LEASE_TIMEOUT_GRACE_MS
      ]
    );

    for (const row of pick.rows) {
      // Close superseded attempt history before creating the replacement run.
      // Pending jobs normally match no running rows; reclaimed jobs do.
      await client.query(
        `UPDATE job_runs SET
           status = 'timeout',
           finished_at = NOW(),
           error = 'lease_reclaimed'
         WHERE job_id = $1 AND status = 'running';`,
        [row.id]
      );
      const upd = await client.query(
        `UPDATE jobs SET
           status = 'running',
           locked_at = NOW(),
           locked_by = $2,
           attempts = attempts + 1,
           updated_at = NOW()
         WHERE id = $1
         RETURNING *;`,
        [row.id, workerId]
      );
      const job = upd.rows[0];
      if (!job) continue;

      const runRes = await client.query(
        `INSERT INTO job_runs (id, job_id, attempt, worker_id, started_at, status)
         VALUES ($1, $2, $3, $4, NOW(), 'running')
         RETURNING id;`,
        [`run_${runIdGen()}`, job.id, job.attempts, workerId]
      );

      claimed.push({
        job: rowToJob(job),
        runId: runRes.rows[0].id
      });
    }

    await client.query("COMMIT");
    return claimed;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Ownership predicate (aitj-z8q.25): the supplied run token must be the job's
 * active attempt — run still `running`, matching the job's current attempts
 * counter and locked_by lease owner. Any reclaim bumps attempts / changes
 * locked_by, so a stale attempt's UPDATE matches zero rows.
 */
const ACTIVE_RUN_SQL = `EXISTS (
         SELECT 1 FROM job_runs r
         WHERE r.id = $3
           AND r.job_id = jobs.id
           AND r.status = 'running'
           AND r.attempt = jobs.attempts
           AND r.worker_id = jobs.locked_by
       )`;

async function pgComplete(pool, jobId, result, runId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // When runId is given (attempt-scoped completion) the update is gated on
    // the active lease/run token; a stale attempt mutates nothing.
    const res = await client.query(
      `UPDATE jobs SET
         status = 'succeeded',
         result = $2::jsonb,
         last_error = NULL,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
       WHERE id = $1
         AND ($3::text IS NULL OR (status = 'running' AND ${ACTIVE_RUN_SQL}))
       RETURNING *;`,
      [jobId, JSON.stringify(result ?? null), runId || null]
    );
    const jobRow = res.rows[0];
    if (jobRow && runId) {
      await client.query(
        `UPDATE job_runs SET
           status = 'succeeded',
           finished_at = NOW(),
           result = $2::jsonb,
           error = NULL
         WHERE id = $1 AND status = 'running';`,
        [runId, JSON.stringify(result ?? null)]
      );
    }
    await client.query("COMMIT");
    return jobRow ? rowToJob(jobRow) : null;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function pgFail(pool, jobId, error, { runId, timeout = false } = {}) {
  const errMsg = error instanceof Error ? error.message : String(error || "unknown error");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE;`, [jobId]);
    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }

    if (runId) {
      // Stale-attempt gate (aitj-z8q.25): only the attempt holding the active
      // lease/run token may fail/requeue/dead-letter the job. A timed-out or
      // reclaimed attempt leaves job state to the newer attempt.
      const own = await client.query(
        `SELECT 1 FROM job_runs r
         WHERE r.id = $1
           AND r.job_id = $2
           AND r.status = 'running'
           AND r.attempt = $3
           AND r.worker_id = $4
         LIMIT 1;`,
        [runId, jobId, Number(row.attempts || 0), row.locked_by]
      );
      if (row.status !== "running" || !own.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
    }

    const attempts = Number(row.attempts || 0);
    const maxAttempts = Number(row.max_attempts || DEFAULT_MAX_ATTEMPTS);
    const exhausted = attempts >= maxAttempts;

    let jobRow;
    if (exhausted) {
      const res = await client.query(
        `UPDATE jobs SET
           status = 'dead',
           last_error = $2,
           locked_at = NULL,
           locked_by = NULL,
           updated_at = NOW()
         WHERE id = $1
         RETURNING *;`,
        [jobId, errMsg]
      );
      jobRow = res.rows[0];
    } else {
      const backoff = computeBackoffMs(attempts);
      const res = await client.query(
        `UPDATE jobs SET
           status = 'pending',
           last_error = $2,
           locked_at = NULL,
           locked_by = NULL,
           run_at = NOW() + ($3::text || ' milliseconds')::interval,
           updated_at = NOW()
         WHERE id = $1
         RETURNING *;`,
        [jobId, errMsg, String(backoff)]
      );
      jobRow = res.rows[0];
    }

    if (runId) {
      const runStatus = exhausted
        ? RUN_STATUS.DEAD
        : timeout
          ? RUN_STATUS.TIMEOUT
          : RUN_STATUS.FAILED;
      await client.query(
        `UPDATE job_runs SET
           status = $2,
           finished_at = NOW(),
           error = $3
         WHERE id = $1 AND status = 'running';`,
        [runId, runStatus, errMsg]
      );
    }

    await client.query("COMMIT");
    return jobRow ? rowToJob(jobRow) : null;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function pgRetry(pool, jobId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query(`SELECT * FROM jobs WHERE id = $1 FOR UPDATE;`, [jobId]);
    const row = cur.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    if (!["failed", "dead", "succeeded"].includes(row.status)) {
      await client.query("COMMIT");
      return { job: rowToJob(row), retried: false, reason: `status is ${row.status}` };
    }

    let maxAttempts = Number(row.max_attempts);
    const attempts = Number(row.attempts);
    if (attempts >= maxAttempts) {
      maxAttempts = attempts + DEFAULT_MAX_ATTEMPTS;
    }

    const res = await client.query(
      `UPDATE jobs SET
         status = 'pending',
         run_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         last_error = NULL,
         max_attempts = $2,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *;`,
      [jobId, maxAttempts]
    );
    await client.query("COMMIT");
    return { job: rowToJob(res.rows[0]), retried: true };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_e) {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
}

async function pgList(pool, { status, type, limit = 50, offset = 0 } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  const clauses = [];
  const params = [];
  if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (type) {
    params.push(type);
    clauses.push(`type = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const countRes = await pool.query(`SELECT COUNT(*)::int AS n FROM jobs ${where};`, params);
  params.push(lim);
  params.push(off);
  const res = await pool.query(
    `SELECT * FROM jobs ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length};`,
    params
  );
  return {
    jobs: res.rows.map(rowToJob),
    total: countRes.rows[0]?.n || 0
  };
}

async function pgGet(pool, jobId) {
  const res = await pool.query(`SELECT * FROM jobs WHERE id = $1;`, [jobId]);
  return res.rows[0] ? rowToJob(res.rows[0]) : null;
}

async function pgGetRuns(pool, jobId) {
  const res = await pool.query(
    `SELECT * FROM job_runs WHERE job_id = $1 ORDER BY started_at DESC;`,
    [jobId]
  );
  return res.rows.map(rowToRun);
}

// ── Public API ──

/**
 * Enqueue a job. Returns { job, created }.
 * If idempotencyKey is set and a job already exists, returns that job with created=false.
 */
async function enqueue(input = {}, options = {}) {
  const type = input.type;
  if (!type) throw new Error("enqueue requires type");

  const args = {
    type,
    payload: input.payload || {},
    idempotencyKey: input.idempotencyKey || input.idempotency_key || null,
    runAt: input.runAt || input.run_at || null,
    maxAttempts: input.maxAttempts || input.max_attempts,
    timeoutMs: input.timeoutMs || input.timeout_ms
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    return pgEnqueue(pool, args);
  }
  return memoryEnqueue(args);
}

/**
 * Claim exclusive work for this worker. Concurrent claimers never get the same job.
 * @returns {Promise<Array<{ job: object, runId: string }>>}
 */
async function claim(workerId, claimOptions = {}, options = {}) {
  if (!workerId) throw new Error("claim requires workerId");
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    return pgClaim(pool, workerId, claimOptions);
  }
  return memoryClaim(workerId, claimOptions);
}

async function complete(jobId, result, runId, options = {}) {
  if (!jobId) throw new Error("complete requires jobId");
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    return pgComplete(pool, jobId, result, runId);
  }
  return memoryComplete(jobId, result, runId);
}

async function fail(jobId, error, failOptions = {}, options = {}) {
  if (!jobId) throw new Error("fail requires jobId");
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    return pgFail(pool, jobId, error, failOptions);
  }
  return memoryFail(jobId, error, failOptions);
}

async function retry(jobId, options = {}) {
  if (!jobId) throw new Error("retry requires jobId");
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    return pgRetry(pool, jobId);
  }
  return memoryRetry(jobId);
}

async function listJobs(filters = {}, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    return pgList(pool, filters);
  }
  return memoryList(filters);
}

async function getJob(jobId, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    return pgGet(pool, jobId);
  }
  return memoryGet(jobId);
}

async function getJobRuns(jobId, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    return pgGetRuns(pool, jobId);
  }
  return memoryGetRuns(jobId);
}

/**
 * Execute one claimed job with timeout. Uses registered handler for job.type.
 *
 * Cancellation contract (aitj-z8q.25):
 * - The handler receives `meta.signal` (AbortSignal), aborted on timeout.
 *   JavaScript cannot force-stop a running promise, so this is cooperative:
 *   handlers that perform externally visible side effects should check
 *   `signal.aborted` before each effect.
 * - Completion/failure is gated on the active lease/run token (see
 *   pgComplete/pgFail): if this attempt was superseded (reclaim), the result
 *   write is rejected and the result is flagged `stale: true`.
 */
async function executeClaimed(claimed, options = {}) {
  const { job, runId } = claimed;
  const handler = getHandler(job.type);
  if (!handler) {
    await fail(job.id, new Error(`No handler registered for job type: ${job.type}`), { runId }, options);
    return { ok: false, jobId: job.id, error: "no_handler" };
  }

  const timeoutMs = job.timeoutMs || DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  let timer;

  try {
    const result = await Promise.race([
      Promise.resolve().then(() =>
        handler(job.payload || {}, { job, runId, signal: controller.signal })
      ),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error(`Job timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        if (typeof timer.unref === "function") timer.unref();
      })
    ]);
    if (timer) clearTimeout(timer);
    const completed = await complete(job.id, result ?? null, runId, options);
    if (!completed) {
      // Our lease was superseded by a newer attempt — job state untouched.
      return { ok: true, jobId: job.id, job: null, result, stale: true };
    }
    return { ok: true, jobId: job.id, job: completed, result };
  } catch (err) {
    if (timer) clearTimeout(timer);
    const failed = await fail(job.id, err, { runId, timeout: timedOut }, options);
    return {
      ok: false,
      jobId: job.id,
      job: failed,
      error: err instanceof Error ? err.message : String(err),
      timedOut,
      stale: failed === null
    };
  }
}

/**
 * Single poll tick: claim + execute up to `concurrency` jobs.
 */
async function processOnce(workerId, { concurrency = 1, leaseMs = DEFAULT_LEASE_MS } = {}, options = {}) {
  const limit = Math.max(1, Math.min(20, Number(concurrency) || 1));
  const claimed = await claim(workerId, { limit, leaseMs }, options);
  if (!claimed.length) return { processed: 0, results: [] };

  const results = [];
  // Process sequentially within a worker to respect concurrency=1 default;
  // for higher concurrency, map with limited parallelism.
  if (limit === 1) {
    for (const c of claimed) {
      results.push(await executeClaimed(c, options));
    }
  } else {
    // Batch claim already limited; run in parallel up to claimed.length
    const settled = await Promise.all(claimed.map((c) => executeClaimed(c, options)));
    results.push(...settled);
  }
  return { processed: results.length, results };
}

/**
 * Start a polling worker loop. Returns a stop() function.
 * Prefer a separate process (scripts/job-worker.js) in production.
 */
function startWorkerLoop(workerId, loopOptions = {}, options = {}) {
  const pollMs = Math.max(500, Number(loopOptions.pollMs || process.env.JOBS_POLL_MS || DEFAULT_POLL_MS));
  const concurrency = Number(loopOptions.concurrency || process.env.JOBS_CONCURRENCY || 1);
  const leaseMs = Number(loopOptions.leaseMs || process.env.JOBS_LEASE_MS || DEFAULT_LEASE_MS);
  const logger = loopOptions.logger || console;
  let stopped = false;
  let inFlight = false;
  let timer = null;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const out = await processOnce(workerId, { concurrency, leaseMs }, options);
      if (out.processed > 0 && logger.info) {
        logger.info(`[jobs] worker=${workerId} processed=${out.processed}`);
      } else if (out.processed > 0) {
        logger.log?.(`[jobs] worker=${workerId} processed=${out.processed}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (logger.error) logger.error(`[jobs] worker=${workerId} tick failed: ${msg}`);
      else console.error(`[jobs] worker=${workerId} tick failed:`, err);
    } finally {
      inFlight = false;
    }
  };

  timer = setInterval(tick, pollMs);
  if (typeof timer.unref === "function" && loopOptions.unref !== false) timer.unref();
  // Kick immediately
  setImmediate(tick);

  return function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  };
}

/**
 * Build a stable windowed idempotency key for recurring schedules.
 * e.g. news.ingest:window:1710000000 for a 24h window.
 */
function scheduleIdempotencyKey(type, intervalMs, at = Date.now()) {
  const window = Math.floor(Number(at) / Math.max(1000, Number(intervalMs) || 1));
  return `${type}:window:${window}`;
}

/**
 * Pure state-machine helper for tests / docs: given current attempts/max and
 * success|fail outcome, return next status and optional next run delay.
 */
function nextStateAfterOutcome({ attempts, maxAttempts, outcome }) {
  const a = Number(attempts) || 0;
  const max = Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS;
  if (outcome === "success") {
    return { status: JOB_STATUS.SUCCEEDED, runAtDelayMs: 0 };
  }
  if (a >= max) {
    return { status: JOB_STATUS.DEAD, runAtDelayMs: 0 };
  }
  return {
    status: JOB_STATUS.PENDING,
    runAtDelayMs: computeBackoffMs(a)
  };
}

module.exports = {
  JOB_STATUS,
  RUN_STATUS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_LEASE_MS,
  DEFAULT_BACKOFF_BASE_MS,
  DEFAULT_BACKOFF_MAX_MS,
  computeBackoffMs,
  nextStateAfterOutcome,
  scheduleIdempotencyKey,
  registerHandler,
  getHandler,
  listHandlers,
  enqueue,
  claim,
  complete,
  fail,
  retry,
  listJobs,
  getJob,
  getJobRuns,
  executeClaimed,
  processOnce,
  startWorkerLoop,
  // test helpers
  memoryReset,
  rowToJob,
  rowToRun
};
