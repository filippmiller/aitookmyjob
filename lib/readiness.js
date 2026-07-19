/**
 * Readiness probe logic (testable without full Express app).
 * Bead: aitj-z8q.6
 *
 * Required: process always considered "live" separately.
 * Ready fails when required deps fail:
 *   - Postgres mode: DB ping + no pending migrations
 *   - Optional: jobs queue probe (READY_CHECK_JOBS=true)
 * File-json mode is always ready (dev fallback).
 */

"use strict";

/**
 * @param {{
 *   usePostgres: boolean,
 *   getPool?: () => import('pg').Pool | null,
 *   getMigrationStatus?: (pool: import('pg').Pool) => Promise<{
 *     ok: boolean,
 *     schemaVersion: string | null,
 *     pendingCount: number,
 *     latestAvailable?: string | null
 *   }>,
 *   checkJobs?: (pool: import('pg').Pool) => Promise<{
 *     ok: boolean,
 *     dead?: number,
 *     failed?: number,
 *     pending?: number,
 *     running?: number,
 *     error?: string
 *   }>,
 *   checkJobsEnabled?: boolean,
 *   domainContractVersion?: string | null
 * }} deps
 */
async function evaluateReadiness(deps) {
  const checks = {};
  const storage = deps.usePostgres ? "postgres" : "file-json";

  if (!deps.usePostgres) {
    return {
      ok: true,
      ready: true,
      statusCode: 200,
      storage,
      schemaVersion: null,
      checks: {
        process: { ok: true },
        storage: { ok: true, mode: "file-json" }
      }
    };
  }

  const pool = typeof deps.getPool === "function" ? deps.getPool() : null;
  if (!pool) {
    checks.db = { ok: false, error: "pool_not_ready" };
    return {
      ok: false,
      ready: false,
      statusCode: 503,
      storage,
      error: "pool_not_ready",
      checks
    };
  }

  try {
    await pool.query("SELECT 1;");
    checks.db = { ok: true };
  } catch (err) {
    checks.db = {
      ok: false,
      error: "db_unavailable",
      message: err instanceof Error ? err.message : String(err)
    };
    return {
      ok: false,
      ready: false,
      statusCode: 503,
      storage,
      error: "db_unavailable",
      message: checks.db.message,
      checks
    };
  }

  let schemaVersion = null;
  if (typeof deps.getMigrationStatus === "function") {
    try {
      const status = await deps.getMigrationStatus(pool);
      schemaVersion = status.schemaVersion;
      if (!status.ok) {
        checks.migrations = {
          ok: false,
          pendingCount: status.pendingCount,
          schemaVersion: status.schemaVersion,
          error: "migrations_pending"
        };
        return {
          ok: false,
          ready: false,
          statusCode: 503,
          storage,
          schemaVersion: status.schemaVersion,
          pendingCount: status.pendingCount,
          error: "migrations_pending",
          checks
        };
      }
      checks.migrations = {
        ok: true,
        schemaVersion: status.schemaVersion,
        pendingCount: 0
      };
    } catch (err) {
      checks.migrations = {
        ok: false,
        error: "migrations_check_failed",
        message: err instanceof Error ? err.message : String(err)
      };
      return {
        ok: false,
        ready: false,
        statusCode: 503,
        storage,
        error: "migrations_check_failed",
        message: checks.migrations.message,
        checks
      };
    }
  }

  const jobsEnabled =
    deps.checkJobsEnabled === true ||
    String(process.env.READY_CHECK_JOBS || "false").toLowerCase() === "true";

  if (jobsEnabled && typeof deps.checkJobs === "function") {
    try {
      const jobs = await deps.checkJobs(pool);
      checks.jobs = jobs;
      if (!jobs.ok) {
        return {
          ok: false,
          ready: false,
          statusCode: 503,
          storage,
          schemaVersion,
          domainContractVersion: deps.domainContractVersion || null,
          error: jobs.error || "jobs_unhealthy",
          checks
        };
      }
    } catch (err) {
      checks.jobs = {
        ok: false,
        error: "jobs_check_failed",
        message: err instanceof Error ? err.message : String(err)
      };
      return {
        ok: false,
        ready: false,
        statusCode: 503,
        storage,
        schemaVersion,
        error: "jobs_check_failed",
        message: checks.jobs.message,
        checks
      };
    }
  } else if (typeof deps.checkJobs === "function") {
    // Soft probe: include counts but do not fail readiness.
    try {
      const jobs = await deps.checkJobs(pool);
      checks.jobs = { ...jobs, required: false };
    } catch (err) {
      checks.jobs = {
        ok: false,
        required: false,
        error: "jobs_check_failed",
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }

  return {
    ok: true,
    ready: true,
    statusCode: 200,
    storage,
    schemaVersion,
    domainContractVersion: deps.domainContractVersion || null,
    checks
  };
}

/**
 * Default jobs probe: queue reachable + optional dead-letter threshold.
 * Fails only when used as a required check and threshold exceeded or query fails.
 */
async function defaultJobsCheck(pool) {
  const deadMax = Math.max(0, Number(process.env.READY_JOBS_DEAD_MAX || 50));
  try {
    const { rows } = await pool.query(
      `SELECT status, COUNT(*)::int AS n
         FROM jobs
        GROUP BY status`
    );
    const byStatus = { pending: 0, running: 0, succeeded: 0, failed: 0, dead: 0 };
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(byStatus, row.status)) {
        byStatus[row.status] = Number(row.n) || 0;
      }
    }
    const dead = byStatus.dead;
    const ok = dead <= deadMax;
    return {
      ok,
      ...byStatus,
      deadMax,
      error: ok ? undefined : "jobs_dead_threshold"
    };
  } catch (err) {
    // Missing jobs table before migration still surfaces via migrations check;
    // if we're here migrations passed — treat as hard failure when required.
    return {
      ok: false,
      error: "jobs_query_failed",
      message: err instanceof Error ? err.message : String(err)
    };
  }
}

module.exports = {
  evaluateReadiness,
  defaultJobsCheck
};
