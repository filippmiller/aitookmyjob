/**
 * Standalone durable job worker process.
 *
 * Preferred production scheduler path: run this process (or cron → enqueue)
 * instead of relying solely on in-process setInterval.
 *
 * Usage:
 *   DATABASE_URL=… node scripts/job-worker.js
 *   JOBS_CONCURRENCY=2 JOBS_POLL_MS=2000 node scripts/job-worker.js
 *
 * Bead: aitj-z8q.5
 */

"use strict";

const dotenv = require("dotenv");
dotenv.config();

const os = require("os");
const ctx = require("../lib/context");
const jobs = require("../lib/jobs");
const { registerBuiltinHandlers } = require("../lib/job-handlers");

const workerId =
  process.env.JOBS_WORKER_ID ||
  `worker_${os.hostname()}_${process.pid}_${Date.now().toString(36)}`;

async function main() {
  if (!ctx.usePostgres) {
    console.warn(
      "[job-worker] No DATABASE_URL — using in-memory queue (dev only; not durable, not multi-process safe)."
    );
  } else {
    const pool = await ctx.buildPgPool();
    ctx.setPgPool(pool);
    await ctx.initStorage();
    console.log("[job-worker] Storage mode: postgres");
  }

  registerBuiltinHandlers(ctx, jobs);

  const concurrency = Math.max(1, Math.min(20, Number(process.env.JOBS_CONCURRENCY || 1)));
  const pollMs = Math.max(500, Number(process.env.JOBS_POLL_MS || 2000));
  const leaseMs = Math.max(5000, Number(process.env.JOBS_LEASE_MS || jobs.DEFAULT_LEASE_MS));

  console.log(
    `[job-worker] starting workerId=${workerId} concurrency=${concurrency} pollMs=${pollMs} leaseMs=${leaseMs}`
  );
  console.log(`[job-worker] handlers: ${jobs.listHandlers().join(", ") || "(none)"}`);

  const stop = jobs.startWorkerLoop(
    workerId,
    { concurrency, pollMs, leaseMs, unref: false, logger: console },
    {
      usePostgres: ctx.usePostgres,
      getPool: () => ctx.getPgPool(),
      useMemory: !ctx.usePostgres
    }
  );

  const shutdown = (signal) => {
    console.log(`[job-worker] ${signal} received — stopping`);
    stop();
    const pool = ctx.getPgPool();
    if (pool) {
      pool.end().finally(() => process.exit(0));
    } else {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[job-worker] fatal:", err);
  process.exit(1);
});
