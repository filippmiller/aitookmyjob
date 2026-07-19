/**
 * 004 — Durable background jobs + run history.
 *
 * Tables: jobs, job_runs
 * Supports: stable IDs, idempotency keys, retries/backoff, timeouts,
 * lease-based claim (FOR UPDATE SKIP LOCKED), dead-letter, concurrency control.
 *
 * Bead: aitj-z8q.5
 */

"use strict";

module.exports = {
  version: "004",
  name: "jobs",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'dead')),
        idempotency_key TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5
          CHECK (max_attempts >= 1 AND max_attempts <= 100),
        run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_at TIMESTAMPTZ,
        locked_by TEXT,
        last_error TEXT,
        timeout_ms INTEGER NOT NULL DEFAULT 300000
          CHECK (timeout_ms >= 1000 AND timeout_ms <= 3600000),
        result JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_idempotency_key
        ON jobs (idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_jobs_status_run_at ON jobs (status, run_at);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_jobs_type_created ON jobs (type, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_jobs_locked_at ON jobs (locked_at) WHERE status = 'running';"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS job_runs (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        attempt INTEGER NOT NULL,
        worker_id TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        status TEXT NOT NULL DEFAULT 'running'
          CHECK (status IN ('running', 'succeeded', 'failed', 'timeout', 'dead')),
        error TEXT,
        result JSONB
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_job_runs_job_id ON job_runs (job_id, started_at DESC);"
    );
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS job_runs CASCADE;");
    await client.query("DROP TABLE IF EXISTS jobs CASCADE;");
  }
};
