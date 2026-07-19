/**
 * Durable jobs unit tests (offline / in-memory).
 * Run: npm run test:jobs
 *
 * Covers: claim exclusivity, idempotency, backoff state machine,
 * dead-letter, admin retry, timeout path, handlers.
 *
 * Bead: aitj-z8q.5
 */

"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const jobs = require("../lib/jobs");
const { loadMigrations } = require("../lib/migrate");

beforeEach(() => {
  jobs.memoryReset();
  // Clear handlers between tests that register custom ones — re-register after reset of module state
  // handlers Map is module-level; tests that need isolation re-register.
});

describe("computeBackoffMs / nextStateAfterOutcome", () => {
  it("grows exponentially and caps", () => {
    const base = 30_000;
    assert.equal(jobs.computeBackoffMs(1, { baseMs: base }), 30_000);
    assert.equal(jobs.computeBackoffMs(2, { baseMs: base }), 60_000);
    assert.equal(jobs.computeBackoffMs(3, { baseMs: base }), 120_000);
    assert.equal(jobs.computeBackoffMs(10, { baseMs: base, maxMs: 60_000 }), 60_000);
  });

  it("state machine: success → succeeded", () => {
    const n = jobs.nextStateAfterOutcome({ attempts: 1, maxAttempts: 5, outcome: "success" });
    assert.equal(n.status, jobs.JOB_STATUS.SUCCEEDED);
  });

  it("state machine: fail under max → pending with backoff", () => {
    const n = jobs.nextStateAfterOutcome({ attempts: 2, maxAttempts: 5, outcome: "fail" });
    assert.equal(n.status, jobs.JOB_STATUS.PENDING);
    assert.equal(n.runAtDelayMs, jobs.computeBackoffMs(2));
  });

  it("state machine: fail at max → dead", () => {
    const n = jobs.nextStateAfterOutcome({ attempts: 5, maxAttempts: 5, outcome: "fail" });
    assert.equal(n.status, jobs.JOB_STATUS.DEAD);
    assert.equal(n.runAtDelayMs, 0);
  });
});

describe("idempotent enqueue", () => {
  it("returns same job for duplicate idempotency key", async () => {
    const a = await jobs.enqueue(
      { type: "jobs.ping", payload: { n: 1 }, idempotencyKey: "ping:once" },
      { useMemory: true }
    );
    const b = await jobs.enqueue(
      { type: "jobs.ping", payload: { n: 2 }, idempotencyKey: "ping:once" },
      { useMemory: true }
    );
    assert.equal(a.created, true);
    assert.equal(b.created, false);
    assert.equal(a.job.id, b.job.id);
    assert.equal(a.job.payload.n, 1);
  });

  it("creates distinct jobs without idempotency key", async () => {
    const a = await jobs.enqueue({ type: "jobs.ping" }, { useMemory: true });
    const b = await jobs.enqueue({ type: "jobs.ping" }, { useMemory: true });
    assert.notEqual(a.job.id, b.job.id);
  });
});

describe("claim exclusivity", () => {
  it("two workers never claim the same job", async () => {
    const opts = { useMemory: true };
    for (let i = 0; i < 5; i++) {
      await jobs.enqueue({ type: "jobs.ping", payload: { i } }, opts);
    }

    const w1 = await jobs.claim("worker-a", { limit: 3 }, opts);
    const w2 = await jobs.claim("worker-b", { limit: 3 }, opts);

    const ids1 = new Set(w1.map((c) => c.job.id));
    const ids2 = new Set(w2.map((c) => c.job.id));
    for (const id of ids1) {
      assert.equal(ids2.has(id), false, `job ${id} claimed by both workers`);
    }
    assert.equal(w1.length + w2.length, 5);
    assert.equal(w1.length, 3);
    assert.equal(w2.length, 2);
  });

  it("running jobs are not re-claimed until lease expires", async () => {
    const opts = { useMemory: true };
    await jobs.enqueue({ type: "jobs.ping" }, opts);
    const first = await jobs.claim("w1", { limit: 1, leaseMs: 60_000 }, opts);
    assert.equal(first.length, 1);
    const second = await jobs.claim("w2", { limit: 1, leaseMs: 60_000 }, opts);
    assert.equal(second.length, 0);
  });

  it("does not reclaim before the job timeout when requested lease is shorter", async () => {
    const opts = { useMemory: true };
    await jobs.enqueue({ type: "jobs.ping", timeoutMs: 1000 }, opts);
    const first = await jobs.claim("w1", { limit: 1, leaseMs: 1 }, opts);
    assert.equal(first.length, 1);
    await new Promise((r) => setTimeout(r, 10));
    const premature = await jobs.claim("w2", { limit: 1, leaseMs: 1 }, opts);
    assert.equal(premature.length, 0, "timeout floor protects the active attempt");
  });

  it("stale leases are reclaimed", async () => {
    const opts = { useMemory: true };
    const { job } = await jobs.enqueue({ type: "jobs.ping", timeoutMs: 1000 }, opts);
    // Manually age the lock via memory store after claim
    const claimed = await jobs.claim("w1", { limit: 1, leaseMs: 60_000 }, opts);
    assert.equal(claimed.length, 1);
    // Force stale lockedAt
    const live = await jobs.getJob(job.id, opts);
    // mutate through claim path: re-get from memory by completing fail path —
    // direct poke via second claim with tiny lease after backdating
    // Use memory internals: re-enqueue pattern — set locked_at in the past via complete/fail no —
    // Claim with leaseMs: 1 after we backdate lockedAt on the stored job
    const memJob = (await jobs.listJobs({}, opts)).jobs[0];
    // We need to mutate memory — use fail/complete is wrong. Export isn't there for direct set.
    // Instead: claim with leaseMs: 0 effectively — DEFAULT reclaim checks locked_at age.
    // Patch: call claim after manually setting lockedAt via a completed failed path that leaves running?
    // Simpler: re-implement by using enqueue + claim, then use process of setting run_at.
    // Direct memory access through get + internal: use require and memoryReset only.
    // We'll simulate by claiming with leaseMs 1ms after waiting.
    await new Promise((r) => setTimeout(r, 1350));
    const reclaimed = await jobs.claim("w2", { limit: 1, leaseMs: 1 }, opts);
    assert.equal(reclaimed.length, 1);
    assert.equal(reclaimed[0].job.id, claimed[0].job.id);
    assert.equal(reclaimed[0].job.lockedBy, "w2");
    assert.ok(reclaimed[0].job.attempts >= 2);
    // silence unused
    assert.ok(memJob.id);
    assert.ok(live.id);
  });
});

describe("complete / fail / dead-letter / retry", () => {
  const opts = { useMemory: true };

  it("complete marks succeeded and stores result", async () => {
    const { job } = await jobs.enqueue({ type: "jobs.ping" }, opts);
    const [c] = await jobs.claim("w1", { limit: 1 }, opts);
    const done = await jobs.complete(c.job.id, { ok: true }, c.runId, opts);
    assert.equal(done.status, jobs.JOB_STATUS.SUCCEEDED);
    assert.deepEqual(done.result, { ok: true });
    const runs = await jobs.getJobRuns(job.id, opts);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, jobs.RUN_STATUS.SUCCEEDED);
  });

  it("fail under max_attempts reschedules pending with backoff", async () => {
    const { job } = await jobs.enqueue(
      { type: "jobs.ping", maxAttempts: 3 },
      opts
    );
    const [c] = await jobs.claim("w1", { limit: 1 }, opts);
    const failed = await jobs.fail(c.job.id, new Error("boom"), { runId: c.runId }, opts);
    assert.equal(failed.status, jobs.JOB_STATUS.PENDING);
    assert.match(failed.lastError, /boom/);
    assert.ok(new Date(failed.runAt).getTime() > Date.now() - 1000);
    assert.ok(new Date(failed.runAt).getTime() >= Date.now() + jobs.computeBackoffMs(1) - 2000);
    const runs = await jobs.getJobRuns(job.id, opts);
    assert.equal(runs[0].status, jobs.RUN_STATUS.FAILED);
  });

  it("fail at max_attempts dead-letters", async () => {
    const { job } = await jobs.enqueue(
      { type: "jobs.ping", maxAttempts: 2 },
      opts
    );
    // attempt 1
    let [c] = await jobs.claim("w1", { limit: 1 }, opts);
    await jobs.fail(c.job.id, "e1", { runId: c.runId }, opts);
    // force run_at now so we can claim again
    const mid = await jobs.getJob(job.id, opts);
    // memory: retry path or direct — set runAt via retry-like: use fail left it pending with future run_at
    // Manually requeue by retry which is for dead — for pending we need run_at past.
    // Use enqueue is wrong. Call retry is only for failed/dead/succeeded.
    // We'll complete the loop by claiming with run_at manipulation through fail with attempts.
    // Simpler path: maxAttempts 1 so first fail → dead
    jobs.memoryReset();
    const { job: j2 } = await jobs.enqueue(
      { type: "jobs.ping", maxAttempts: 1 },
      opts
    );
    [c] = await jobs.claim("w1", { limit: 1 }, opts);
    const dead = await jobs.fail(c.job.id, "fatal", { runId: c.runId }, opts);
    assert.equal(dead.status, jobs.JOB_STATUS.DEAD);
    assert.match(dead.lastError, /fatal/);
    const runs = await jobs.getJobRuns(j2.id, opts);
    assert.equal(runs[0].status, jobs.RUN_STATUS.DEAD);
  });

  it("admin retry requeues dead jobs", async () => {
    const { job } = await jobs.enqueue(
      { type: "jobs.ping", maxAttempts: 1 },
      opts
    );
    const [c] = await jobs.claim("w1", { limit: 1 }, opts);
    await jobs.fail(c.job.id, "x", { runId: c.runId }, opts);
    const before = await jobs.getJob(job.id, opts);
    assert.equal(before.status, jobs.JOB_STATUS.DEAD);

    const out = await jobs.retry(job.id, opts);
    assert.equal(out.retried, true);
    assert.equal(out.job.status, jobs.JOB_STATUS.PENDING);
    assert.ok(out.job.maxAttempts > before.maxAttempts);
  });
});

describe("processOnce + handlers + timeout", () => {
  const opts = { useMemory: true };

  afterEach(() => {
    // leave handlers; tests register with unique types
  });

  it("processOnce runs handler and succeeds", async () => {
    jobs.registerHandler("test.ok", async (payload) => ({ doubled: payload.n * 2 }));
    await jobs.enqueue({ type: "test.ok", payload: { n: 21 } }, opts);
    const out = await jobs.processOnce("w1", { concurrency: 1 }, opts);
    assert.equal(out.processed, 1);
    assert.equal(out.results[0].ok, true);
    assert.deepEqual(out.results[0].result, { doubled: 42 });
    const listed = await jobs.listJobs({ status: "succeeded" }, opts);
    assert.equal(listed.total, 1);
  });

  it("missing handler fails the job", async () => {
    await jobs.enqueue({ type: "test.missing.handler.xyz", maxAttempts: 1 }, opts);
    const out = await jobs.processOnce("w1", { concurrency: 1 }, opts);
    assert.equal(out.processed, 1);
    assert.equal(out.results[0].ok, false);
    const j = await jobs.getJob(out.results[0].jobId, opts);
    assert.equal(j.status, jobs.JOB_STATUS.DEAD);
  });

  it("timeout fails with timeout flag", async () => {
    jobs.registerHandler("test.slow", async () => {
      await new Promise((r) => setTimeout(r, 1500));
      return { late: true };
    });
    // timeout_ms floor is 1000 (matches migration CHECK)
    await jobs.enqueue(
      { type: "test.slow", timeoutMs: 1000, maxAttempts: 1 },
      opts
    );
    const out = await jobs.processOnce("w1", { concurrency: 1 }, opts);
    assert.equal(out.results[0].ok, false);
    assert.equal(out.results[0].timedOut, true);
  });
});

describe("stale attempt isolation (aitj-z8q.25)", () => {
  const opts = { useMemory: true };

  it("handler meta includes an AbortSignal", async () => {
    let seen = null;
    jobs.registerHandler("test.signal", async (_payload, meta) => {
      seen = meta && meta.signal;
      return { ok: 1 };
    });
    await jobs.enqueue({ type: "test.signal" }, opts);
    const out = await jobs.processOnce("w1", { concurrency: 1 }, opts);
    assert.equal(out.results[0].ok, true);
    assert.ok(seen instanceof AbortSignal, "handler received an AbortSignal");
    assert.equal(seen.aborted, false, "signal not aborted for a fast handler");
  });

  it("timeout aborts the handler signal", async () => {
    let seen = null;
    jobs.registerHandler("test.signal.timeout", async (_payload, meta) => {
      seen = meta && meta.signal;
      await new Promise((r) => setTimeout(r, 1500));
      return { late: true };
    });
    await jobs.enqueue({ type: "test.signal.timeout", timeoutMs: 1000, maxAttempts: 1 }, opts);
    const out = await jobs.processOnce("w1", { concurrency: 1 }, opts);
    assert.equal(out.results[0].ok, false);
    assert.equal(out.results[0].timedOut, true);
    assert.ok(seen instanceof AbortSignal);
    assert.equal(seen.aborted, true, "signal aborted on timeout");
  });

  it("cooperative handler performs no side effect after abort (no duplicate effect)", async () => {
    const effects = [];
    jobs.registerHandler("test.effect", async (_payload, meta) => {
      await new Promise((r) => setTimeout(r, 1200));
      if (meta.signal.aborted) return { skipped: true };
      effects.push("email-sent"); // externally visible effect
      return { sent: true };
    });
    // maxAttempts 1 → timed-out job goes dead; no retry can duplicate the effect
    await jobs.enqueue({ type: "test.effect", timeoutMs: 1000, maxAttempts: 1 }, opts);
    const out = await jobs.processOnce("w1", { concurrency: 1 }, opts);
    assert.equal(out.results[0].timedOut, true);
    // Let the zombie handler finish past its internal wait
    await new Promise((r) => setTimeout(r, 500));
    assert.deepEqual(effects, [], "no externally visible effect after abort");
  });

  it("stale complete is rejected after reclaim; only the active run mutates state", async () => {
    const { job } = await jobs.enqueue({ type: "jobs.ping", timeoutMs: 1000 }, opts);
    const [c1] = await jobs.claim("w1", { limit: 1, leaseMs: 60_000 }, opts);
    // Lease expires → w2 reclaims the job (attempt 2, new run)
    await new Promise((r) => setTimeout(r, 1350));
    const [c2] = await jobs.claim("w2", { limit: 1, leaseMs: 1 }, opts);
    assert.equal(c2.job.id, job.id);
    assert.equal(c2.job.attempts, 2);

    // Zombie attempt 1 finishes late and tries to complete
    const staleComplete = await jobs.complete(job.id, { zombie: true }, c1.runId, opts);
    assert.equal(staleComplete, null, "stale complete must be a no-op");
    const mid = await jobs.getJob(job.id, opts);
    assert.equal(mid.status, jobs.JOB_STATUS.RUNNING, "job still owned by newer attempt");
    assert.equal(mid.lockedBy, "w2");
    assert.equal(mid.result, null);

    // Active attempt completes normally
    const done = await jobs.complete(job.id, { ok: true }, c2.runId, opts);
    assert.equal(done.status, jobs.JOB_STATUS.SUCCEEDED);
    const runs = await jobs.getJobRuns(job.id, opts);
    const superseded = runs.find((r) => r.id === c1.runId);
    assert.equal(superseded.status, jobs.RUN_STATUS.TIMEOUT,
      "reclaimed run history is closed as timeout");
    assert.equal(superseded.error, "lease_reclaimed");
    assert.ok(superseded.finishedAt);
    assert.equal(runs.find((r) => r.id === c2.runId).status, jobs.RUN_STATUS.SUCCEEDED);
  });

  it("stale fail cannot requeue or dead-letter a newer attempt", async () => {
    const { job } = await jobs.enqueue({ type: "jobs.ping", maxAttempts: 1, timeoutMs: 1000 }, opts);
    const [c1] = await jobs.claim("w1", { limit: 1, leaseMs: 60_000 }, opts);
    await new Promise((r) => setTimeout(r, 1350));
    const [c2] = await jobs.claim("w2", { limit: 1, leaseMs: 1 }, opts);
    assert.ok(c2, "job reclaimed by w2");

    // maxAttempts=1: if the stale fail went through, the job would be dead
    const staleFail = await jobs.fail(job.id, new Error("zombie boom"), { runId: c1.runId }, opts);
    assert.equal(staleFail, null, "stale fail must be a no-op");
    const mid = await jobs.getJob(job.id, opts);
    assert.equal(mid.status, jobs.JOB_STATUS.RUNNING);
    assert.equal(mid.lockedBy, "w2");
    assert.equal(mid.lastError, null);
  });

  it("same-worker reclaim still rejects the zombie attempt (attempt token mismatch)", async () => {
    const { job } = await jobs.enqueue({ type: "jobs.ping", timeoutMs: 1000 }, opts);
    const [c1] = await jobs.claim("w1", { limit: 1, leaseMs: 60_000 }, opts);
    await new Promise((r) => setTimeout(r, 1350));
    // Same worker reclaims its own stale lease → attempts bump makes run 1 stale
    const [c2] = await jobs.claim("w1", { limit: 1, leaseMs: 1 }, opts);
    assert.equal(c2.job.attempts, 2);

    const stale = await jobs.complete(job.id, { zombie: true }, c1.runId, opts);
    assert.equal(stale, null);
    const mid = await jobs.getJob(job.id, opts);
    assert.equal(mid.status, jobs.JOB_STATUS.RUNNING);
    assert.equal(mid.lockedBy, "w1");
  });

  it("executeClaimed flags a superseded completion as stale", async () => {
    jobs.registerHandler("test.stale.flag", async () => ({ done: true }));
    const { job } = await jobs.enqueue({ type: "test.stale.flag", timeoutMs: 1000 }, opts);
    const [c1] = await jobs.claim("w1", { limit: 1, leaseMs: 60_000 }, opts);
    await new Promise((r) => setTimeout(r, 1350));
    const [c2] = await jobs.claim("w2", { limit: 1, leaseMs: 1 }, opts);
    // Execute the stale claim: handler succeeds but the completion is rejected
    const out = await jobs.executeClaimed(c1, opts);
    assert.equal(out.ok, true);
    assert.equal(out.stale, true, "superseded completion flagged stale");
    const mid = await jobs.getJob(job.id, opts);
    assert.equal(mid.status, jobs.JOB_STATUS.RUNNING, "job state left to active attempt");
    // Clean up: active attempt completes
    await jobs.complete(job.id, { ok: true }, c2.runId, opts);
  });
});

describe("scheduleIdempotencyKey", () => {
  it("is stable within a window and changes across windows", () => {
    const interval = 3600_000;
    const t0 = 1_700_000_000_000;
    const k1 = jobs.scheduleIdempotencyKey("news.ingest", interval, t0);
    const k2 = jobs.scheduleIdempotencyKey("news.ingest", interval, t0 + 1000);
    const k3 = jobs.scheduleIdempotencyKey("news.ingest", interval, t0 + interval);
    assert.equal(k1, k2);
    assert.notEqual(k1, k3);
    assert.match(k1, /^news\.ingest:window:\d+$/);
  });
});

describe("migration 004 present", () => {
  it("loads 004_jobs after 003", () => {
    const migrations = loadMigrations();
    const versions = migrations.map((m) => m.version);
    assert.ok(versions.includes("004"));
    const m004 = migrations.find((m) => m.version === "004");
    assert.equal(m004.name, "jobs");
    assert.equal(typeof m004.up, "function");
    assert.equal(typeof m004.down, "function");
    const idx = versions.indexOf("004");
    assert.ok(idx > versions.indexOf("003"));
  });
});
