/**
 * Offline unit tests: logger redaction + readiness evaluation.
 * Bead: aitj-z8q.6
 * Run: node --test tests/observability.test.js
 */

"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const logger = require("../lib/logger");
const { evaluateReadiness, defaultJobsCheck } = require("../lib/readiness");
const metrics = require("../lib/metrics");
const alerts = require("../lib/alerts");
const { getRelease, resetReleaseCache } = require("../lib/release");

describe("logger.redact", () => {
  it("redacts sensitive object keys", () => {
    const out = logger.redact({
      user: "alice",
      password: "hunter2",
      token: "abc",
      authorization: "Bearer xyz",
      nested: { apiKey: "k", safe: 1 }
    });
    assert.equal(out.user, "alice");
    assert.equal(out.password, logger.REDACT);
    assert.equal(out.token, logger.REDACT);
    assert.equal(out.authorization, logger.REDACT);
    assert.equal(out.nested.apiKey, logger.REDACT);
    assert.equal(out.nested.safe, 1);
  });

  it("scrubs emails, phones, bearer tokens, and postgres URLs in strings", () => {
    const out = logger.redact({
      msg: "user jane@example.com called +1 (555) 123-4567 with Bearer supersecrettokenvalue and url postgresql://u:p@host/db"
    });
    assert.equal(out.msg.includes("jane@example.com"), false);
    assert.equal(out.msg.includes("postgresql://"), false);
    assert.equal(out.msg.includes("Bearer supersecrettokenvalue"), false);
    assert.equal(out.msg.includes(logger.REDACT), true);
  });

  it("redacts Error messages without throwing", () => {
    const err = new Error("fail token=abc and email a@b.co");
    const out = logger.redact(err);
    assert.equal(out.name, "Error");
    assert.equal(typeof out.message, "string");
    assert.equal(out.message.includes("a@b.co"), false);
  });
});

describe("evaluateReadiness", () => {
  it("file-json mode is always ready", async () => {
    const r = await evaluateReadiness({ usePostgres: false });
    assert.equal(r.ready, true);
    assert.equal(r.statusCode, 200);
    assert.equal(r.storage, "file-json");
  });

  it("fails when pool is missing", async () => {
    const r = await evaluateReadiness({
      usePostgres: true,
      getPool: () => null
    });
    assert.equal(r.ready, false);
    assert.equal(r.statusCode, 503);
    assert.equal(r.error, "pool_not_ready");
  });

  it("fails when db query throws", async () => {
    const r = await evaluateReadiness({
      usePostgres: true,
      getPool: () => ({
        query: async () => {
          throw new Error("ECONNREFUSED");
        }
      })
    });
    assert.equal(r.ready, false);
    assert.equal(r.error, "db_unavailable");
    assert.equal(r.checks.db.ok, false);
  });

  it("fails when migrations pending", async () => {
    const r = await evaluateReadiness({
      usePostgres: true,
      getPool: () => ({ query: async () => ({ rows: [{ "?column?": 1 }] }) }),
      getMigrationStatus: async () => ({
        ok: false,
        schemaVersion: "003",
        pendingCount: 1
      })
    });
    assert.equal(r.ready, false);
    assert.equal(r.error, "migrations_pending");
    assert.equal(r.pendingCount, 1);
  });

  it("succeeds when db + migrations ok", async () => {
    const r = await evaluateReadiness({
      usePostgres: true,
      getPool: () => ({ query: async () => ({ rows: [{ "?column?": 1 }] }) }),
      getMigrationStatus: async () => ({
        ok: true,
        schemaVersion: "004",
        pendingCount: 0
      }),
      domainContractVersion: "v1"
    });
    assert.equal(r.ready, true);
    assert.equal(r.statusCode, 200);
    assert.equal(r.schemaVersion, "004");
    assert.equal(r.domainContractVersion, "v1");
    assert.equal(r.checks.db.ok, true);
    assert.equal(r.checks.migrations.ok, true);
  });

  it("optional jobs check does not fail readiness by default", async () => {
    const r = await evaluateReadiness({
      usePostgres: true,
      getPool: () => ({ query: async () => ({ rows: [] }) }),
      getMigrationStatus: async () => ({ ok: true, schemaVersion: "004", pendingCount: 0 }),
      checkJobs: async () => ({ ok: false, error: "jobs_dead_threshold", dead: 99 }),
      checkJobsEnabled: false
    });
    assert.equal(r.ready, true);
    assert.equal(r.checks.jobs.required, false);
    assert.equal(r.checks.jobs.ok, false);
  });

  it("required jobs check fails readiness when unhealthy", async () => {
    const r = await evaluateReadiness({
      usePostgres: true,
      getPool: () => ({ query: async () => ({ rows: [] }) }),
      getMigrationStatus: async () => ({ ok: true, schemaVersion: "004", pendingCount: 0 }),
      checkJobs: async () => ({ ok: false, error: "jobs_dead_threshold", dead: 99 }),
      checkJobsEnabled: true
    });
    assert.equal(r.ready, false);
    assert.equal(r.error, "jobs_dead_threshold");
  });
});

describe("defaultJobsCheck", () => {
  it("aggregates status counts and respects dead threshold", async () => {
    const prev = process.env.READY_JOBS_DEAD_MAX;
    process.env.READY_JOBS_DEAD_MAX = "2";
    try {
      const pool = {
        query: async () => ({
          rows: [
            { status: "pending", n: 1 },
            { status: "dead", n: 3 },
            { status: "succeeded", n: 10 }
          ]
        })
      };
      const out = await defaultJobsCheck(pool);
      assert.equal(out.dead, 3);
      assert.equal(out.pending, 1);
      assert.equal(out.ok, false);
      assert.equal(out.error, "jobs_dead_threshold");
    } finally {
      if (prev === undefined) delete process.env.READY_JOBS_DEAD_MAX;
      else process.env.READY_JOBS_DEAD_MAX = prev;
    }
  });
});

describe("metrics + release + alerts stub", () => {
  beforeEach(() => {
    metrics.reset();
    alerts.resetDedupe();
    resetReleaseCache();
  });

  afterEach(() => {
    metrics.reset();
    alerts.resetDedupe();
    resetReleaseCache();
    delete process.env.GIT_SHA;
    delete process.env.ALERT_WEBHOOK_URL;
  });

  it("snapshot includes release and counters", () => {
    process.env.GIT_SHA = "deadbeefcafebabe";
    resetReleaseCache();
    metrics.inc("http_requests_total", 2);
    const snap = metrics.snapshot();
    assert.equal(snap.ok, true);
    assert.equal(snap.counters.http_requests_total, 2);
    assert.equal(snap.release.gitSha, "deadbeefcafebabe");
    assert.equal(snap.release.service, "aitookmyjob");
  });

  it("alerts without webhook are skipped after log", async () => {
    delete process.env.ALERT_WEBHOOK_URL;
    const r = await alerts.notify({
      type: "test_alert",
      message: "hello",
      severity: "warning"
    });
    assert.equal(r.sent, false);
    assert.equal(r.skipped, "no_webhook");
    assert.ok(metrics.getCounter("alerts_total") >= 1);
  });

  it("getRelease reads package version", () => {
    const r = getRelease();
    assert.equal(typeof r.version, "string");
    assert.ok(r.version.length > 0);
  });
});
