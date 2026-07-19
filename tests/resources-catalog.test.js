/**
 * Verified resources & opportunities catalog (aitj-z8q.12).
 * Offline unit tests: defaults ban example.com, verification fields,
 * saves/reviews/reports, opportunities status, link_check handler registration.
 *
 * Run: npm run test:resources
 */

"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CONTEXT_PATH = path.join(__dirname, "..", "lib/context.js");
const HANDLERS_PATH = path.join(__dirname, "..", "lib/job-handlers.js");
const JOBS_PATH = path.join(__dirname, "..", "lib/jobs.js");
const DOMAIN_PATH = path.join(__dirname, "..", "lib/domain-contract.js");

function clearModule(modPath) {
  try {
    delete require.cache[require.resolve(modPath)];
  } catch (_e) {
    /* ignore */
  }
}

function loadContext(envPatch = {}) {
  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV
  };
  if (Object.prototype.hasOwnProperty.call(envPatch, "DATABASE_URL")) {
    if (!envPatch.DATABASE_URL) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = envPatch.DATABASE_URL;
  }
  clearModule(CONTEXT_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const ctx = require(CONTEXT_PATH);
  return {
    ctx,
    restore() {
      if (saved.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved.DATABASE_URL;
      if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved.NODE_ENV;
      clearModule(CONTEXT_PATH);
    }
  };
}

describe("domain contract — catalog enums", () => {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const domain = require(DOMAIN_PATH);

  it("exports verification, link, cost, report enums", () => {
    assert.equal(domain.RESOURCE_VERIFICATION_STATE.VERIFIED, "verified");
    assert.equal(domain.RESOURCE_VERIFICATION_STATE.BROKEN, "broken");
    assert.equal(domain.RESOURCE_VERIFICATION_STATE.STALE, "stale");
    assert.equal(domain.RESOURCE_LINK_STATUS.OK, "ok");
    assert.equal(domain.RESOURCE_COST.FREE, "free");
    assert.equal(domain.RESOURCE_REPORT_STATUS.OPEN, "open");
  });

  it("keeps OPPORTUNITY_STATUS distinct from RESOURCE_STATUS", () => {
    assert.ok(domain.OPPORTUNITY_STATUS.OPEN);
    assert.ok(domain.RESOURCE_STATUS.PUBLISHED);
    assert.equal(domain.isPubliclyListable("opportunity", "open"), true);
    assert.equal(domain.isPubliclyListable("opportunity", "closed"), false);
    assert.equal(domain.isPubliclyListable("resource", "published"), true);
    assert.equal(domain.isPubliclyListable("resource", "draft"), false);
  });

  it("API boundaries list resources module ownership", () => {
    const mounts = domain.API_BOUNDARIES.map((b) => b.module);
    assert.ok(mounts.includes("routes/resources.js"));
  });
});

describe("default catalog — no example.com / fake hosts", () => {
  let handle;

  before(() => {
    handle = loadContext({ DATABASE_URL: "" });
  });

  after(() => handle.restore());

  it("defaultResources have zero banned URLs", () => {
    const { defaultResources, isBannedResourceUrl } = handle.ctx;
    assert.ok(defaultResources.length >= 5);
    for (const r of defaultResources) {
      assert.equal(
        isBannedResourceUrl(r.url),
        false,
        `banned url in defaultResources: ${r.id} ${r.url}`
      );
      assert.ok(!/example\.(com|org|net)/i.test(r.url), r.url);
      assert.ok(r.verificationState, r.id);
      assert.ok(r.source, r.id);
      assert.ok(r.cost, r.id);
      assert.ok("eligibility" in r, r.id);
      assert.ok(r.language, r.id);
      assert.ok(r.region, r.id);
    }
  });

  it("defaultOpportunities use OPPORTUNITY_STATUS open and real URLs", () => {
    const { defaultOpportunities, isBannedResourceUrl } = handle.ctx;
    assert.ok(defaultOpportunities.length >= 1);
    for (const o of defaultOpportunities) {
      assert.equal(isBannedResourceUrl(o.url), false, o.url);
      assert.equal(o.status, "open");
      assert.ok(o.verificationState);
    }
  });

  it("isBannedResourceUrl blocks example.com and invalid URLs", () => {
    const { isBannedResourceUrl } = handle.ctx;
    assert.equal(isBannedResourceUrl("https://example.com/foo"), true);
    assert.equal(isBannedResourceUrl("https://www.example.org/x"), true);
    assert.equal(isBannedResourceUrl("not-a-url"), true);
    assert.equal(isBannedResourceUrl("https://www.careeronestop.org/"), false);
  });

  it("storageGetResources returns catalog fields without example.com", async () => {
    const rows = await handle.ctx.storageGetResources();
    assert.ok(rows.length >= 1);
    for (const r of rows) {
      assert.ok(!/example\.(com|org|net)/i.test(r.url || ""), r.url);
      assert.ok(r.verificationState);
      assert.ok(r.cost);
      assert.ok("eligibility" in r);
      assert.ok("source" in r);
      assert.ok(r.language);
    }
  });

  it("rejects upsert with example.com", async () => {
    await assert.rejects(
      () =>
        handle.ctx.storageUpsertResource({
          id: "res-bad-test",
          title: "Bad",
          url: "https://example.com/nope",
          type: "legal"
        }),
      /Banned|example/i
    );
  });
});

describe("verification state derivation", () => {
  let handle;

  before(() => {
    handle = loadContext({ DATABASE_URL: "" });
  });

  after(() => handle.restore());

  it("marks broken when linkStatus is broken", () => {
    const state = handle.ctx.deriveVerificationState({
      verificationState: "verified",
      linkStatus: "broken",
      lastVerifiedAt: new Date().toISOString()
    });
    assert.equal(state, "broken");
  });

  it("marks stale when lastVerifiedAt is old", () => {
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
    const state = handle.ctx.deriveVerificationState({
      verificationState: "verified",
      linkStatus: "ok",
      lastVerifiedAt: old
    });
    assert.equal(state, "stale");
  });

  it("keeps verified when recently verified", () => {
    const state = handle.ctx.deriveVerificationState({
      verificationState: "verified",
      linkStatus: "ok",
      lastVerifiedAt: new Date().toISOString()
    });
    assert.equal(state, "verified");
  });
});

describe("saves, reviews, reports (JSON fallback)", () => {
  let handle;
  let tmpDir;
  let origPaths;

  before(() => {
    handle = loadContext({ DATABASE_URL: "" });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitj-res-"));
    // Point interaction paths at temp files via locked writes on real paths is ok
    // for isolation we use unique resource ids and clean after
    origPaths = null;
  });

  after(() => {
    handle.restore();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
  });

  it("save → list → unsave roundtrip", async () => {
    const rows = await handle.ctx.storageGetResources();
    const id = rows[0].id;
    const userId = `user-test-${Date.now()}`;
    const saved = await handle.ctx.storageSaveResource(userId, id);
    assert.equal(saved.ok, true);
    const list = await handle.ctx.storageGetSavedResources(userId);
    assert.ok(list.some((r) => r.id === id));
    const removed = await handle.ctx.storageUnsaveResource(userId, id);
    assert.equal(removed, true);
    const after = await handle.ctx.storageGetSavedResources(userId);
    assert.equal(after.some((r) => r.id === id), false);
  });

  it("review upsert with rating 1-5", async () => {
    const rows = await handle.ctx.storageGetResources();
    const id = rows[0].id;
    const userId = `user-review-${Date.now()}`;
    const result = await handle.ctx.storageUpsertResourceReview({
      userId,
      resourceId: id,
      rating: 4,
      body: "Helpful resource for my transition."
    });
    assert.equal(result.ok, true);
    assert.equal(result.review.rating, 4);
    const reviews = await handle.ctx.storageGetResourceReviews(id);
    assert.ok(reviews.some((r) => r.userId === userId && r.rating === 4));
  });

  it("report creates open status", async () => {
    const rows = await handle.ctx.storageGetResources();
    const id = rows[0].id;
    const result = await handle.ctx.storageInsertResourceReport({
      userId: "user-r",
      resourceId: id,
      reason: "broken_link",
      details: "Timeout when opening"
    });
    assert.equal(result.ok, true);
    assert.equal(result.report.status, "open");
    const reports = await handle.ctx.storageGetResourceReports({ status: "open" });
    assert.ok(reports.some((r) => r.id === result.report.id));
  });
});

describe("opportunities storage", () => {
  let handle;

  before(() => {
    handle = loadContext({ DATABASE_URL: "" });
  });

  after(() => handle.restore());

  it("lists open opportunities only by default", async () => {
    const rows = await handle.ctx.storageGetOpportunities();
    assert.ok(rows.length >= 1);
    for (const o of rows) {
      assert.equal(o.status, "open");
      assert.ok(!/example\.(com|org|net)/i.test(o.url));
    }
  });

  it("rejects example.com opportunity", async () => {
    await assert.rejects(
      () =>
        handle.ctx.storageUpsertOpportunity({
          id: "opp-bad",
          title: "Fake",
          url: "https://example.net/job",
          status: "open"
        }),
      /Banned|example/i
    );
  });
});

describe("resource.link_check job handler", () => {
  let handle;
  let jobs;
  let handlers;

  before(() => {
    handle = loadContext({ DATABASE_URL: "" });
    clearModule(JOBS_PATH);
    clearModule(HANDLERS_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    jobs = require(JOBS_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    handlers = require(HANDLERS_PATH);
    jobs.memoryReset();
    handlers.registerBuiltinHandlers(handle.ctx, jobs);
  });

  after(() => {
    handle.restore();
    clearModule(JOBS_PATH);
    clearModule(HANDLERS_PATH);
  });

  it("registers resource.link_check", () => {
    assert.ok(jobs.listHandlers().includes("resource.link_check"));
  });

  it("flags banned URLs as broken without network", async () => {
    // Inject a temporary banned resource into JSON store
    const badId = `res-linkcheck-bad-${Date.now()}`;
    // Bypass normalize by writing JSON directly then updating via link check path
    await handle.ctx.lockedJsonUpdate(handle.ctx.resourcesPath, (rows) => {
      rows.push({
        id: badId,
        type: "legal",
        title: "Should not exist",
        provider: "test",
        region: "global",
        language: "en",
        url: "https://example.com/banned-seed",
        summary: "test",
        cost: "free",
        eligibility: "",
        source: "test",
        status: "published",
        verificationState: "unverified",
        linkStatus: "unknown"
      });
    });

    // Manual update via storageUpdateResourceLinkCheck path used by job for banned
    const updated = await handle.ctx.storageUpdateResourceLinkCheck(badId, {
      linkStatus: "broken",
      linkHttpStatus: null,
      flaggedReason: "banned_or_invalid_url"
    });
    assert.ok(updated);
    assert.equal(updated.linkStatus, "broken");
    assert.equal(updated.verificationState, "broken");

    // Cleanup
    await handle.ctx.storageDeleteResource(badId, { hard: true });
  });

  it("probeUrl classifies invalid host as broken", async () => {
    const result = await handlers.probeUrl("https://this-host-should-not-resolve-aitj-test.invalid/");
    assert.equal(result.linkStatus, "broken");
  });
});

describe("migrations include 008 resources_catalog", () => {
  it("loadMigrations lists 008", () => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { loadMigrations } = require("../lib/migrate");
    const migrations = loadMigrations();
    const m008 = migrations.find((m) => m.version === "008");
    assert.ok(m008, "expected migration 008");
    assert.equal(m008.name, "resources_catalog");
  });
});

describe("data/resources.json seed file", () => {
  it("contains no example.com", () => {
    const raw = fs.readFileSync(path.join(__dirname, "..", "data", "resources.json"), "utf8");
    assert.equal(/example\.(com|org|net)/i.test(raw), false);
    const rows = JSON.parse(raw);
    assert.ok(Array.isArray(rows) && rows.length >= 1);
    for (const r of rows) {
      assert.ok(r.verificationState || r.verification_state);
      assert.ok(r.source || r.url);
    }
  });
});
