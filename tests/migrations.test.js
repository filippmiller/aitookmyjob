/**
 * Migration runner + integrity tests (offline + optional live PG).
 * Run: npm run test:migrations
 *
 * Offline (always): ordering, idempotency plan, module shape, mock runner.
 * Live (when DATABASE_URL + RUN_PG_MIGRATION_TESTS=1): apply twice, check constraints.
 */

"use strict";

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const os = require("os");
const {
  loadMigrations,
  planMigrations,
  migrate,
  getMigrationStatus,
  ensureMigrationsTable,
  MIGRATION_LOCK_ID,
  MIGRATIONS_DIR
} = require("../lib/migrate");
const {
  STORY_STATUS,
  NEWS_STATUS,
  PETITION_STATUS,
  SANCTION_TYPE,
  valuesOf
} = require("../lib/domain-contract");

describe("loadMigrations — ordering & shape", () => {
  it("loads numbered migrations in ascending version order", () => {
    const migrations = loadMigrations();
    assert.ok(migrations.length >= 2, "expected at least baseline + integrity");
    const versions = migrations.map((m) => m.version);
    const sorted = [...versions].sort((a, b) => a.localeCompare(b, "en"));
    assert.deepEqual(versions, sorted);
  });

  it("requires unique versions and up()", () => {
    const migrations = loadMigrations();
    const seen = new Set();
    for (const m of migrations) {
      assert.ok(m.version, m.file);
      assert.ok(m.name, m.file);
      assert.equal(typeof m.up, "function", m.file);
      assert.ok(!seen.has(m.version), `duplicate ${m.version}`);
      seen.add(m.version);
      assert.match(m.checksum, /^[a-f0-9]{16}$/);
    }
  });

  it("orders 001..015 through analytics_events", () => {
    const migrations = loadMigrations();
    assert.equal(migrations[0].version, "001");
    assert.equal(migrations[0].name, "baseline_schema");
    assert.equal(migrations[1].version, "002");
    assert.equal(migrations[1].name, "integrity_constraints");
    assert.equal(migrations[2].version, "003");
    assert.equal(migrations[2].name, "remaining_write_entities");
    assert.equal(migrations[3].version, "004");
    assert.equal(migrations[3].name, "jobs");
    assert.equal(migrations[4].version, "005");
    assert.equal(migrations[4].name, "expression_flows");
    assert.equal(migrations[5].version, "006");
    assert.equal(migrations[5].name, "insider_signals");
    assert.equal(migrations[6].version, "007");
    assert.equal(migrations[6].name, "notifications");
    assert.equal(migrations[7].version, "008");
    assert.equal(migrations[7].name, "resources_catalog");
    assert.equal(migrations[8].version, "009");
    assert.equal(migrations[8].name, "news_community");
    assert.equal(migrations[9].version, "010");
    assert.equal(migrations[9].name, "social_support");
    assert.equal(migrations[10].version, "011");
    assert.equal(migrations[10].name, "intent_feeds");
    assert.equal(migrations[11].version, "012");
    assert.equal(migrations[11].name, "cohorts_mentors");
    assert.equal(migrations[12].version, "013");
    assert.equal(migrations[12].name, "admin_ops");
    assert.equal(migrations[13].version, "014");
    assert.equal(migrations[13].name, "search_discovery");
    assert.equal(migrations[14].version, "015");
    assert.equal(migrations[14].name, "analytics_events");
  });
});

describe("planMigrations — offline idempotency plan", () => {
  it("with nothing applied, all are pending", () => {
    const plan = planMigrations([]);
    assert.ok(plan.pending.length >= 2);
    assert.equal(plan.applied.length, 0);
  });

  it("with 001 applied, only later migrations pending", () => {
    const plan = planMigrations(["001"]);
    assert.deepEqual(
      plan.pending.map((p) => p.version),
      plan.all.filter((m) => m.version !== "001").map((m) => m.version)
    );
    assert.equal(plan.applied.length, 1);
    assert.equal(plan.applied[0].version, "001");
  });

  it("with all applied, pending is empty (idempotent plan)", () => {
    const all = loadMigrations().map((m) => m.version);
    const plan = planMigrations(all);
    assert.equal(plan.pending.length, 0);
    assert.equal(plan.applied.length, all.length);
  });

  it("re-planning is stable (idempotent)", () => {
    const a = planMigrations(["001"]);
    const b = planMigrations(["001"]);
    assert.deepEqual(a, b);
  });
});

describe("mock client — transactional apply semantics", () => {
  function createMockClient({ failOnVersion } = {}) {
    const applied = [];
    const statements = [];
    let inTx = false;
    let failed = false;

    const client = {
      async query(sql, params) {
        const s = String(sql).trim();
        statements.push(s.slice(0, 80));
        if (/pg_advisory_unlock/i.test(s)) return { rows: [{ unlocked: true }] };
        if (/^BEGIN/i.test(s)) {
          inTx = true;
          return { rows: [] };
        }
        if (/^COMMIT/i.test(s)) {
          inTx = false;
          return { rows: [] };
        }
        if (/^ROLLBACK/i.test(s)) {
          inTx = false;
          failed = true;
          return { rows: [] };
        }
        if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(s)) {
          return { rows: [] };
        }
        if (/FROM schema_migrations/i.test(s) && /SELECT/i.test(s)) {
          return {
            rows: applied.map((v) => ({
              version: v.version,
              name: v.name,
              applied_at: new Date(),
              checksum: v.checksum
            }))
          };
        }
        if (/INSERT INTO schema_migrations/i.test(s)) {
          applied.push({
            version: params[0],
            name: params[1],
            checksum: params[2]
          });
          return { rows: [] };
        }
        // Migration body SQL — success unless configured to fail
        if (failOnVersion && inTx) {
          // detect which migration by last BEGIN… we track via outer
        }
        return { rows: [] };
      }
    };

    return {
      client,
      getApplied: () => applied.slice(),
      statements,
      wasFailed: () => failed,
      pool: {
        async connect() {
          return {
            ...client,
            release() {}
          };
        },
        query: (...args) => client.query(...args)
      }
    };
  }

  it("records migration only after successful up()", async () => {
    const tmpDir = path.join(__dirname, ".tmp-migrations-ok");
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, "001_ok.js");
    fs.writeFileSync(
      file,
      `
      module.exports = {
        version: "001",
        name: "ok",
        async up(client) {
          await client.query("SELECT 1;");
        }
      };
      `
    );

    try {
      const mock = createMockClient();
      // Minimal pool that uses our client
      const pool = {
        async connect() {
          return {
            query: mock.client.query.bind(mock.client),
            release() {}
          };
        }
      };
      const result = await migrate(pool, { migrationsDir: tmpDir, logger: { info() {} } });
      assert.equal(result.ok, true);
      assert.equal(result.applied.length, 1);
      assert.equal(result.schemaVersion, "001");
      assert.equal(mock.getApplied().length, 1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("rolls back and does not record on failed up()", async () => {
    const tmpDir = path.join(__dirname, ".tmp-migrations-fail");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "001_fail.js"),
      `
      module.exports = {
        version: "001",
        name: "fail",
        async up() {
          throw new Error("boom");
        }
      };
      `
    );

    try {
      let rolledBack = false;
      const applied = [];
      const pool = {
        async connect() {
          return {
            async query(sql, params) {
              const s = String(sql);
              if (/pg_advisory_unlock/i.test(s)) return { rows: [{ unlocked: true }] };
              if (/ROLLBACK/i.test(s)) {
                rolledBack = true;
                return { rows: [] };
              }
              if (/FROM schema_migrations/i.test(s) && /SELECT/i.test(s)) {
                return { rows: applied };
              }
              if (/INSERT INTO schema_migrations/i.test(s)) {
                applied.push({
                  version: params[0],
                  name: params[1],
                  applied_at: new Date(),
                  checksum: params[2]
                });
                return { rows: [] };
              }
              return { rows: [] };
            },
            release() {}
          };
        }
      };

      await assert.rejects(
        () => migrate(pool, { migrationsDir: tmpDir, logger: { info() {} } }),
        /failed and was rolled back/
      );
      assert.equal(rolledBack, true);
      assert.equal(applied.length, 0, "schema_migrations must not gain a row on failure");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips already-applied versions (idempotent second run)", async () => {
    const tmpDir = path.join(__dirname, ".tmp-migrations-idem");
    fs.mkdirSync(tmpDir, { recursive: true });
    let upCalls = 0;
    fs.writeFileSync(
      path.join(tmpDir, "001_once.js"),
      `
      module.exports = {
        version: "001",
        name: "once",
        async up() { /* counted externally via re-require is hard; use file flag */ }
      };
      `
    );
    // Use a module that mutates a shared counter via process
    process.__migUpCalls = 0;
    fs.writeFileSync(
      path.join(tmpDir, "001_once.js"),
      `
      module.exports = {
        version: "001",
        name: "once",
        async up() { process.__migUpCalls = (process.__migUpCalls || 0) + 1; }
      };
      `
    );

    // Clear require cache for dynamic modules
    const full = path.join(tmpDir, "001_once.js");
    delete require.cache[require.resolve(full)];

    try {
      const applied = [];
      const pool = {
        async connect() {
          return {
            async query(sql, params) {
              const s = String(sql);
              if (/pg_advisory_unlock/i.test(s)) return { rows: [{ unlocked: true }] };
              if (/FROM schema_migrations/i.test(s) && /SELECT/i.test(s)) {
                return {
                  rows: applied.map((a) => ({
                    version: a.version,
                    name: a.name,
                    applied_at: new Date(),
                    checksum: a.checksum
                  }))
                };
              }
              if (/INSERT INTO schema_migrations/i.test(s)) {
                applied.push({
                  version: params[0],
                  name: params[1],
                  checksum: params[2]
                });
              }
              return { rows: [] };
            },
            release() {}
          };
        }
      };

      const r1 = await migrate(pool, { migrationsDir: tmpDir, logger: { info() {} } });
      assert.equal(r1.applied.length, 1);
      assert.equal(process.__migUpCalls, 1);

      delete require.cache[require.resolve(full)];
      const r2 = await migrate(pool, { migrationsDir: tmpDir, logger: { info() {} } });
      assert.equal(r2.applied.length, 0, "second run applies nothing");
      assert.equal(process.__migUpCalls, 1, "up() not called again");
      assert.equal(r2.schemaVersion, "001");
    } finally {
      delete process.__migUpCalls;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("advisory migration lock — concurrent runners (aitj-z8q.30)", () => {
  /**
   * Shared-state mock pool: every connect() returns a client bound to the same
   * "database". Implements a real async mutex for pg_advisory_lock/unlock and
   * enforces the schema_migrations primary key, so an un-serialized concurrent
   * run would fail exactly like production (23505 on duplicate version insert).
   */
  function createSharedMockDb() {
    const applied = [];
    let lockQueue = Promise.resolve();
    let holderCount = 0;
    let unlockCalls = 0;

    function acquireLock() {
      let releaseNext;
      const next = new Promise((resolve) => {
        releaseNext = resolve;
      });
      const acquired = lockQueue.then(() => {
        holderCount += 1;
        return releaseNext;
      });
      lockQueue = lockQueue.then(() => next);
      return acquired; // resolves with this holder's release function
    }

    function makeClient() {
      let release = null;
      return {
        async query(sql, params) {
          const s = String(sql);
          // Yield so concurrent runners genuinely interleave without a lock.
          await new Promise((r) => setImmediate(r));
          if (/pg_advisory_unlock/i.test(s)) {
            unlockCalls += 1;
            if (release) {
              holderCount -= 1;
              const r = release;
              release = null;
              r();
            }
            return { rows: [{ unlocked: true }] };
          }
          if (/pg_advisory_lock/i.test(s)) {
            release = await acquireLock();
            return { rows: [] };
          }
          if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s.trim())) return { rows: [] };
          if (/CREATE TABLE IF NOT EXISTS schema_migrations/i.test(s)) return { rows: [] };
          if (/FROM schema_migrations/i.test(s) && /SELECT/i.test(s)) {
            return {
              rows: applied.map((a) => ({
                version: a.version,
                name: a.name,
                applied_at: new Date(),
                checksum: a.checksum
              }))
            };
          }
          if (/INSERT INTO schema_migrations/i.test(s)) {
            if (applied.some((a) => a.version === params[0])) {
              const err = new Error(
                'duplicate key value violates unique constraint "schema_migrations_pkey"'
              );
              err.code = "23505";
              throw err;
            }
            applied.push({ version: params[0], name: params[1], checksum: params[2] });
            return { rows: [] };
          }
          return { rows: [] };
        },
        release() {}
      };
    }

    return {
      pool: {
        async connect() {
          return makeClient();
        }
      },
      applied,
      holderCount: () => holderCount,
      unlockCalls: () => unlockCalls
    };
  }

  it("MIGRATION_LOCK_ID is a stable signed 64-bit key derived from a fixed string", () => {
    const crypto = require("crypto");
    const expected = crypto
      .createHash("sha256")
      .update("aitookmyjob:migrate")
      .digest()
      .readBigInt64BE(0)
      .toString();
    assert.equal(MIGRATION_LOCK_ID, expected);
    assert.match(MIGRATION_LOCK_ID, /^-?\d{1,19}$/);
  });

  it("two concurrent runners both succeed; each migration applied exactly once", async () => {
    const tmpDir = path.join(__dirname, ".tmp-migrations-lock");
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, "001_locked.js");
    fs.writeFileSync(
      file,
      `
      module.exports = {
        version: "001",
        name: "locked",
        async up(client) {
          process.__migLockUpCalls = (process.__migLockUpCalls || 0) + 1;
          await client.query("SELECT 1;");
        }
      };
      `
    );
    delete require.cache[require.resolve(file)];
    process.__migLockUpCalls = 0;

    try {
      const db = createSharedMockDb();
      const logger = { info() {} };
      const [r1, r2] = await Promise.all([
        migrate(db.pool, { migrationsDir: tmpDir, logger }),
        migrate(db.pool, { migrationsDir: tmpDir, logger })
      ]);
      assert.equal(r1.ok, true);
      assert.equal(r2.ok, true);
      assert.equal(
        r1.applied.length + r2.applied.length,
        1,
        "exactly one runner applies the migration"
      );
      assert.equal(process.__migLockUpCalls, 1, "up() executed exactly once");
      assert.equal(db.applied.length, 1, "exactly one schema_migrations row");
      assert.equal(db.unlockCalls(), 2, "both runners released the advisory lock");
      assert.equal(db.holderCount(), 0, "no lock holder left");
    } finally {
      delete process.__migLockUpCalls;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("advisory lock is released when a migration fails", async () => {
    const tmpDir = path.join(__dirname, ".tmp-migrations-lock-fail");
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, "001_flaky.js");
    fs.writeFileSync(
      file,
      `
      module.exports = {
        version: "001",
        name: "flaky",
        async up() {
          process.__migFlakyCalls = (process.__migFlakyCalls || 0) + 1;
          if (process.__migFlakyCalls === 1) throw new Error("boom-first-attempt");
        }
      };
      `
    );
    delete require.cache[require.resolve(file)];
    process.__migFlakyCalls = 0;

    try {
      const db = createSharedMockDb();
      const logger = { info() {} };
      await assert.rejects(
        migrate(db.pool, { migrationsDir: tmpDir, logger }),
        /failed and was rolled back/
      );
      assert.equal(db.holderCount(), 0, "lock not held after failure");
      assert.equal(db.unlockCalls(), 1, "unlock issued on failure path");
      assert.equal(db.applied.length, 0, "no schema_migrations row recorded on failure");

      // A subsequent runner can acquire the lock and complete the same plan.
      const second = await migrate(db.pool, { migrationsDir: tmpDir, logger });
      assert.equal(second.ok, true);
      assert.equal(second.applied.length, 1);
      assert.equal(db.applied.length, 1);
      assert.equal(db.holderCount(), 0);
    } finally {
      delete process.__migFlakyCalls;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("evicts the client when advisory unlock returns false", async () => {
    const releaseArgs = [];
    const client = {
      async query(sql) {
        const s = String(sql);
        if (/pg_advisory_unlock/i.test(s)) return { rows: [{ unlocked: false }] };
        if (/pg_advisory_lock/i.test(s)) return { rows: [] };
        if (/FROM schema_migrations/i.test(s) && /SELECT/i.test(s)) return { rows: [] };
        return { rows: [] };
      },
      release(err) {
        releaseArgs.push(err);
      }
    };
    const pool = { async connect() { return client; } };

    await assert.rejects(
      migrate(pool, { migrationsDir: path.join(__dirname, ".missing-migrations"), logger: { info() {} } }),
      /advisory lock was not released/
    );
    assert.equal(releaseArgs.length, 1);
    assert.ok(releaseArgs[0] instanceof Error, "release(error) evicts the pool client");
  });

  it("unlock errors evict the client without masking the migration error", async () => {
    const tmpDir = path.join(__dirname, ".tmp-migrations-unlock-error");
    fs.mkdirSync(tmpDir, { recursive: true });
    const file = path.join(tmpDir, "001_fails.js");
    fs.writeFileSync(
      file,
      `module.exports = {
        version: "001",
        name: "fails",
        async up() { throw new Error("original-migration-error"); }
      };`
    );
    const releaseArgs = [];
    const client = {
      async query(sql) {
        const s = String(sql);
        if (/pg_advisory_unlock/i.test(s)) throw new Error("unlock-error");
        if (/pg_advisory_lock/i.test(s)) return { rows: [] };
        if (/FROM schema_migrations/i.test(s) && /SELECT/i.test(s)) return { rows: [] };
        return { rows: [] };
      },
      release(err) {
        releaseArgs.push(err);
      }
    };
    const pool = { async connect() { return client; } };

    try {
      await assert.rejects(
        migrate(pool, { migrationsDir: tmpDir, logger: { info() {} } }),
        /original-migration-error/
      );
      assert.equal(releaseArgs.length, 1);
      assert.match(releaseArgs[0]?.message || "", /unlock-error/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("integrity contract alignment (static)", () => {
  it("002 references domain-contract status sets", () => {
    const src = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "002_integrity_constraints.js"),
      "utf8"
    );
    assert.match(src, /STORY_STATUS/);
    assert.match(src, /NEWS_STATUS/);
    assert.match(src, /PETITION_STATUS/);
    assert.match(src, /SANCTION_TYPE/);
    assert.match(src, /stories_status_check/);
    assert.match(src, /uq_story_versions_story_version/);
  });

  it("domain enums used by CHECKs are non-empty and include legacy runtime values", () => {
    assert.ok(valuesOf(STORY_STATUS).includes("pending"));
    assert.ok(valuesOf(STORY_STATUS).includes("published"));
    assert.ok(valuesOf(STORY_STATUS).includes("rejected"));
    assert.ok(valuesOf(NEWS_STATUS).includes("published"));
    assert.ok(valuesOf(PETITION_STATUS).includes("open"));
    assert.ok(valuesOf(SANCTION_TYPE).includes("ban"));
  });
});

describe("critical relationship expectations (documented)", () => {
  it("baseline defines FK: auth_identities→users, story_versions→stories, forum_posts→topics, petition_signatures→petitions", () => {
    const src = fs.readFileSync(path.join(MIGRATIONS_DIR, "001_baseline.js"), "utf8");
    assert.match(src, /REFERENCES users\(id\) ON DELETE CASCADE/);
    assert.match(src, /REFERENCES stories\(id\) ON DELETE CASCADE/);
    assert.match(src, /REFERENCES forum_topics\(id\) ON DELETE CASCADE/);
    assert.match(src, /REFERENCES petitions\(id\) ON DELETE CASCADE/);
  });

  it("integrity adds unique (story_id, version_no)", () => {
    const src = fs.readFileSync(
      path.join(MIGRATIONS_DIR, "002_integrity_constraints.js"),
      "utf8"
    );
    assert.match(src, /story_id, version_no/);
  });
});

// ── Optional live PostgreSQL suite ──────────────────────────────────────────

const runLive =
  Boolean(process.env.DATABASE_URL) &&
  String(process.env.RUN_PG_MIGRATION_TESTS || "").toLowerCase() === "1";

describe("live PostgreSQL migrations", { skip: !runLive }, () => {
  let pool;

  before(async () => {
    const { Pool } = require("pg");
    const ssl =
      String(process.env.PG_SSL || "false").toLowerCase() === "true"
        ? {
            rejectUnauthorized:
              String(process.env.PG_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !==
              "false"
          }
        : undefined;
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl, max: 2 });
  });

  after(async () => {
    if (pool) await pool.end().catch(() => {});
  });

  it("migrate is idempotent on live DB", async () => {
    const first = await migrate(pool, { logger: { info() {} } });
    assert.ok(first.schemaVersion);
    const second = await migrate(pool, { logger: { info() {} } });
    assert.equal(second.applied.length, 0);
    assert.equal(second.schemaVersion, first.schemaVersion);
    const status = await getMigrationStatus(pool);
    assert.equal(status.ok, true);
    assert.equal(status.pendingCount, 0);
  });

  it("concurrent runners on live PG both succeed via advisory lock", async () => {
    // Use a unique, genuinely pending migration. Without serialization both
    // runners read it as pending and race on CREATE TABLE/schema_migrations.
    const version = `${Date.now()}${String(process.pid).slice(-4).padStart(4, "0")}`;
    const migrationName = "live_advisory_lock_probe";
    const tableName = `aitj_migration_lock_probe_${version}`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aitj-live-migrations-"));
    const migrationFile = path.join(tmpDir, `${version}_${migrationName}.js`);
    fs.writeFileSync(
      migrationFile,
      `module.exports = {
        version: ${JSON.stringify(version)},
        name: ${JSON.stringify(migrationName)},
        async up(client) {
          await client.query('CREATE TABLE "${tableName}" (id INTEGER PRIMARY KEY);');
          await client.query('INSERT INTO "${tableName}" (id) VALUES (1);');
        }
      };`
    );

    try {
      const [a, b] = await Promise.all([
        migrate(pool, { migrationsDir: tmpDir, logger: { info() {} } }),
        migrate(pool, { migrationsDir: tmpDir, logger: { info() {} } })
      ]);
      assert.equal(a.ok, true);
      assert.equal(b.ok, true);
      assert.equal(a.applied.length + b.applied.length, 1, "migration applied exactly once");

      const applied = await pool.query(
        "SELECT COUNT(*)::int AS count FROM schema_migrations WHERE version = $1 AND name = $2;",
        [version, migrationName]
      );
      assert.equal(applied.rows[0].count, 1, "one migration ledger row recorded");
      const probe = await pool.query(`SELECT COUNT(*)::int AS count FROM "${tableName}";`);
      assert.equal(probe.rows[0].count, 1, "migration body executed exactly once");
    } finally {
      const cleanupErrors = [];
      try {
        await pool.query(`DROP TABLE IF EXISTS "${tableName}";`);
      } catch (err) {
        cleanupErrors.push(err);
      }
      try {
        await pool.query(
          "DELETE FROM schema_migrations WHERE version = $1 AND name = $2;",
          [version, migrationName]
        );
      } catch (err) {
        cleanupErrors.push(err);
      }
      delete require.cache[require.resolve(migrationFile)];
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (cleanupErrors.length) {
        throw new AggregateError(cleanupErrors, "live migration probe cleanup failed");
      }
    }
  });

  it("stories_status_check rejects invalid status", async () => {
    await assert.rejects(async () => {
      await pool.query(
        `INSERT INTO stories (
          id, name, country, language, profession, company, laid_off_at,
          found_new_job, reason, story, status
        ) VALUES (
          'migtest_invalid_status', 'T', 'us', 'en', 'dev', 'Co', '2024-01',
          false, 'reason text', 'story body long enough for constraints', 'not_a_status'
        );`
      );
    }, /stories_status_check|check constraint/i);
  });

  it("story_versions unique (story_id, version_no)", async () => {
    await pool.query(
      `INSERT INTO stories (
        id, name, country, language, profession, company, laid_off_at,
        found_new_job, reason, story, status
      ) VALUES (
        'migtest_story_v', 'T', 'us', 'en', 'dev', 'Co', '2024-01',
        false, 'reason text', 'story body long enough for constraints', 'pending'
      ) ON CONFLICT (id) DO NOTHING;`
    );
    await pool.query(
      `INSERT INTO story_versions (id, story_id, version_no, payload)
       VALUES ('migtest_sv1', 'migtest_story_v', 1, '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING;`
    );
    await assert.rejects(async () => {
      await pool.query(
        `INSERT INTO story_versions (id, story_id, version_no, payload)
         VALUES ('migtest_sv2', 'migtest_story_v', 1, '{}'::jsonb);`
      );
    }, /unique|duplicate/i);

    // cleanup
    await pool.query("DELETE FROM story_versions WHERE story_id = 'migtest_story_v';");
    await pool.query("DELETE FROM stories WHERE id = 'migtest_story_v';");
  });
});
