/**
 * Storage routing tests (aitj-z8q.3) — offline only.
 *
 * Verifies:
 *   - Without DATABASE_URL: JSON fallback writes are allowed
 *   - With DATABASE_URL: writeJsonArray / lockedJsonUpdate / writeStories refuse
 *   - Storage surface exports PG-backed write helpers for remaining entities
 *   - Subscriber insert reports duplicates (JSON path concurrency-safe mutex)
 *   - Petition sign duplicate flag (JSON path)
 *
 * Live PG concurrency: set RUN_PG_STORAGE_TESTS=1 and DATABASE_URL.
 * Run: npm run test:storage
 */

"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CONTEXT_PATH = path.join(__dirname, "..", "lib", "context.js");
const STORAGE_PATH = path.join(__dirname, "..", "lib", "storage.js");

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
    if (envPatch.DATABASE_URL === undefined || envPatch.DATABASE_URL === null || envPatch.DATABASE_URL === "") {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = envPatch.DATABASE_URL;
    }
  }
  clearModule(CONTEXT_PATH);
  clearModule(STORAGE_PATH);
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
      clearModule(STORAGE_PATH);
    }
  };
}

describe("storage routing — JSON fallback without DATABASE_URL", () => {
  let handle;
  let tmpDir;
  let tmpFile;

  before(() => {
    handle = loadContext({ DATABASE_URL: "" });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitj-storage-"));
    tmpFile = path.join(tmpDir, "sample.json");
  });

  after(() => {
    handle.restore();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_e) {
      /* ignore */
    }
  });

  it("usePostgres is false", () => {
    assert.equal(handle.ctx.usePostgres, false);
  });

  it("writeJsonArray is allowed and persists", () => {
    handle.ctx.writeJsonArray(tmpFile, [{ id: 1 }]);
    const raw = fs.readFileSync(tmpFile, "utf8");
    assert.deepEqual(JSON.parse(raw), [{ id: 1 }]);
  });

  it("lockedJsonUpdate mutates under mutex", async () => {
    handle.ctx.writeJsonArray(tmpFile, []);
    await handle.ctx.lockedJsonUpdate(tmpFile, (rows) => {
      rows.push({ id: "a" });
      rows.push({ id: "b" });
    });
    assert.equal(handle.ctx.readJsonArray(tmpFile).length, 2);
  });

  it("concurrent lockedJsonUpdate serializes without losing writes", async () => {
    handle.ctx.writeJsonArray(tmpFile, []);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        handle.ctx.lockedJsonUpdate(tmpFile, (rows) => {
          rows.push({ n: i });
        })
      )
    );
    assert.equal(handle.ctx.readJsonArray(tmpFile).length, 20);
  });

  it("storageInsertSubscriber reports duplicate emails", async () => {
    // Uses real data/subscribers path only when no DATABASE_URL — isolate via locked path
    // by inserting twice through the public API with a unique email.
    const email = `routing-test-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    const entry = {
      id: `sub-test-${Date.now()}`,
      email,
      subscribedAt: new Date().toISOString(),
      country: "global",
      language: "en"
    };
    const first = await handle.ctx.storageInsertSubscriber(entry);
    assert.equal(first.duplicate, false);
    assert.ok(first.entry);
    const second = await handle.ctx.storageInsertSubscriber({ ...entry, id: `${entry.id}-2` });
    assert.equal(second.duplicate, true);
  });

  it("storageSignPetition marks duplicate votes", async () => {
    const petitions = await handle.ctx.storageGetPetitions("visitor-hash-routing");
    assert.ok(petitions.length >= 1);
    const id = petitions[0].id;
    const hash = `voter-routing-${Date.now()}`;
    const a = await handle.ctx.storageSignPetition(id, hash);
    assert.ok(a);
    assert.equal(a.duplicate, false);
    const b = await handle.ctx.storageSignPetition(id, hash);
    assert.ok(b);
    assert.equal(b.duplicate, true);
  });
});

describe("storage routing — refuse JSON writes with DATABASE_URL", () => {
  let handle;
  let tmpFile;

  before(() => {
    // Point at a fake URL — we never connect; only exercise the write guard.
    handle = loadContext({ DATABASE_URL: "postgres://localhost:5432/aitj_routing_guard" });
    tmpFile = path.join(os.tmpdir(), `aitj-guard-${Date.now()}.json`);
  });

  after(() => {
    handle.restore();
    try {
      fs.unlinkSync(tmpFile);
    } catch (_e) {
      /* ignore */
    }
  });

  it("usePostgres is true", () => {
    assert.equal(handle.ctx.usePostgres, true);
  });

  it("writeJsonArray throws", () => {
    assert.throws(
      () => handle.ctx.writeJsonArray(tmpFile, []),
      /refused JSON file write while DATABASE_URL is set/
    );
  });

  it("writeStories throws", () => {
    assert.throws(
      () => handle.ctx.writeStories([]),
      /refused JSON file write/
    );
  });

  it("lockedJsonUpdate rejects", async () => {
    await assert.rejects(
      () => handle.ctx.lockedJsonUpdate(tmpFile, (rows) => rows.push(1)),
      /refused JSON file write/
    );
  });

  it("assertJsonFallbackAllowed throws with context", () => {
    assert.throws(
      () => handle.ctx.assertJsonFallbackAllowed("test-op"),
      /test-op/
    );
  });
});

describe("storage surface — remaining write entities exported", () => {
  let handle;

  before(() => {
    handle = loadContext({ DATABASE_URL: "" });
  });

  after(() => {
    handle.restore();
  });

  it("exports helpers for all previously JSON-only write entities", () => {
    const required = [
      "storageGetResources",
      "storageUpsertResource",
      "storageGetCohorts",
      "storageInsertCohort",
      "storageGetCompanyBoards",
      "storageInsertCompanyBoard",
      "storageGetAnonymousInbox",
      "storageInsertAnonymousInbox",
      "storageGetTakedowns",
      "storageInsertTakedown",
      "storageGetSubscribers",
      "storageCountSubscribers",
      "storageInsertSubscriber",
      "storageUpdateForumTopic",
      "storageDeleteForumTopic",
      "storageGetPetitions",
      "storageSignPetition",
      "storageUpsertBoundaryPollVote",
      "storageInsertStory",
      "storageInsertUser",
      "storageAudit"
    ];
    for (const name of required) {
      assert.equal(typeof handle.ctx[name], "function", name);
    }
  });

  it("lib/storage.js re-exports the same write surface", () => {
    clearModule(STORAGE_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const storage = require(STORAGE_PATH);
    assert.equal(typeof storage.storageInsertSubscriber, "function");
    assert.equal(typeof storage.storageInsertAnonymousInbox, "function");
    assert.equal(typeof storage.storageInsertCohort, "function");
    assert.equal(typeof storage.storageInsertCompanyBoard, "function");
    assert.equal(typeof storage.storageInsertTakedown, "function");
    assert.equal(typeof storage.assertJsonFallbackAllowed, "function");
  });
});

describe("migration 003 present for remaining entities", () => {
  it("plan includes 003 when nothing applied", () => {
    const { planMigrations, loadMigrations } = require("../lib/migrate");
    const all = loadMigrations();
    assert.ok(all.some((m) => m.version === "003" && m.name === "remaining_write_entities"));
    const plan = planMigrations([]);
    assert.ok(plan.pending.some((p) => p.version === "003"));
  });
});
