/**
 * Versioned PostgreSQL migration runner for aitookmyjob.
 * Bead: aitj-z8q.4
 *
 * Migrations live in /migrations as numbered *.js modules exporting:
 *   { version: "001", name: "short_snake", up(client), down?(client) }
 *
 * Each migration runs inside a single transaction. On failure the transaction
 * is rolled back and schema_migrations is not updated — no partial apply.
 *
 * Boot policy: auto-migrate on app start (see initStorage). Documented in
 * docs/ops/migrations.md.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum TEXT NULL
);
`;

/**
 * Advisory lock key serializing concurrent migration runners (aitj-z8q.30).
 * Stable 64-bit signed int derived from a namespaced string, so every replica
 * of this app contends on the same database-wide lock.
 */
const MIGRATION_LOCK_ID = crypto
  .createHash("sha256")
  .update("aitookmyjob:migrate")
  .digest()
  .readBigInt64BE(0)
  .toString();

/**
 * Take a session-level PostgreSQL advisory lock on `client`. Blocks until the
 * lock is free. The lock belongs to the connection, so it must be acquired and
 * released on the SAME client that runs the migrations.
 */
async function acquireMigrationLock(client) {
  await client.query("SELECT pg_advisory_lock($1::bigint);", [MIGRATION_LOCK_ID]);
}

/**
 * Release the advisory lock and verify that this session owned it.
 *
 * An unlock failure must cause the pool client to be evicted: returning a
 * still-locked session to the pool can make later acquisitions re-entrant and
 * leave the lock held indefinitely.
 */
async function releaseMigrationLock(client) {
  const result = await client.query(
    "SELECT pg_advisory_unlock($1::bigint) AS unlocked;",
    [MIGRATION_LOCK_ID]
  );
  if (result.rows?.[0]?.unlocked !== true) {
    throw new Error("PostgreSQL migration advisory lock was not released");
  }
}

/**
 * Release the session lock and return or evict the pool client. Cleanup errors
 * are surfaced after a successful operation, but never replace the original
 * migration/rollback error.
 */
async function finalizeMigrationClient(client, lockHeld, operationError) {
  let cleanupError = null;
  if (lockHeld) {
    try {
      await releaseMigrationLock(client);
    } catch (err) {
      cleanupError = err;
    }
  }

  try {
    // node-postgres destroys the pooled connection when release receives an
    // error, ensuring a possibly still-locked session is never reused.
    client.release(cleanupError || undefined);
  } catch (err) {
    cleanupError ||= err;
  }

  if (cleanupError && !operationError) throw cleanupError;
}

/**
 * Load migration modules from disk, sorted by version filename prefix.
 * @returns {Array<{ version: string, name: string, up: Function, down?: Function, file: string, checksum: string }>}
 */
function loadMigrations(dir = MIGRATIONS_DIR) {
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{3,}[_-].+\.js$/.test(f))
    .sort((a, b) => a.localeCompare(b, "en"));

  const seen = new Set();
  const migrations = [];

  for (const file of files) {
    const full = path.join(dir, file);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mod = require(full);
    const version = String(mod.version || file.match(/^(\d+)/)?.[1] || "");
    const name = String(mod.name || file.replace(/\.js$/, ""));
    if (!version) {
      throw new Error(`Migration file ${file} is missing a version`);
    }
    if (typeof mod.up !== "function") {
      throw new Error(`Migration ${file} must export async function up(client)`);
    }
    if (seen.has(version)) {
      throw new Error(`Duplicate migration version: ${version} (${file})`);
    }
    seen.add(version);

    const raw = fs.readFileSync(full, "utf8");
    const checksum = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);

    migrations.push({
      version,
      name,
      up: mod.up,
      down: typeof mod.down === "function" ? mod.down : null,
      file,
      checksum
    });
  }

  return migrations;
}

/**
 * Ensure schema_migrations tracking table exists (not versioned itself —
 * bootstrap only; CREATE IF NOT EXISTS is idempotent).
 */
async function ensureMigrationsTable(client) {
  await client.query(SCHEMA_MIGRATIONS_DDL);
}

async function getAppliedRows(client) {
  await ensureMigrationsTable(client);
  const res = await client.query(
    "SELECT version, name, applied_at, checksum FROM schema_migrations ORDER BY version ASC;"
  );
  return res.rows.map((r) => ({
    version: r.version,
    name: r.name,
    appliedAt: r.applied_at,
    checksum: r.checksum
  }));
}

/**
 * Compute migration status without applying anything.
 * @param {import('pg').Pool|import('pg').PoolClient} pool
 * @param {{ migrationsDir?: string }} [options]
 */
async function getMigrationStatus(pool, options = {}) {
  const migrations = loadMigrations(options.migrationsDir || MIGRATIONS_DIR);
  const client = typeof pool.connect === "function" ? await pool.connect() : null;
  const queryTarget = client || pool;

  try {
    const applied = await getAppliedRows(queryTarget);
    const appliedSet = new Set(applied.map((a) => a.version));
    const pending = migrations.filter((m) => !appliedSet.has(m.version));
    const latestApplied = applied.length ? applied[applied.length - 1].version : null;
    const latestAvailable = migrations.length
      ? migrations[migrations.length - 1].version
      : null;

    return {
      ok: pending.length === 0,
      latestApplied,
      latestAvailable,
      current: latestApplied,
      schemaVersion: latestApplied,
      appliedCount: applied.length,
      pendingCount: pending.length,
      applied,
      pending: pending.map((m) => ({
        version: m.version,
        name: m.name,
        file: m.file,
        checksum: m.checksum
      })),
      migrations: migrations.map((m) => ({
        version: m.version,
        name: m.name,
        file: m.file,
        applied: appliedSet.has(m.version)
      }))
    };
  } finally {
    if (client) client.release();
  }
}

/**
 * Apply all pending migrations, each in its own transaction.
 * Serialized across processes with a PostgreSQL advisory lock (aitj-z8q.30):
 * the lock is held on the migration client for the whole run and always
 * released (including on failure) before the client is returned to the pool.
 * @param {import('pg').Pool} pool
 * @param {{ migrationsDir?: string, logger?: { info?: Function, error?: Function }, dryRun?: boolean }} [options]
 */
async function migrate(pool, options = {}) {
  const log = options.logger || console;
  const info = typeof log.info === "function" ? log.info.bind(log) : log.log?.bind(log) || (() => {});
  const migrations = loadMigrations(options.migrationsDir || MIGRATIONS_DIR);

  if (options.dryRun) {
    const status = await getMigrationStatus(pool, options);
    return {
      dryRun: true,
      applied: [],
      pending: status.pending,
      current: status.current,
      schemaVersion: status.schemaVersion
    };
  }

  const client = await pool.connect();
  const appliedNow = [];
  let lockHeld = false;
  let operationError = null;

  try {
    // Serialize concurrent runners (aitj-z8q.30): pending-set computation and
    // application must be atomic across replicas, otherwise two runners pick
    // the same plan and one crashes on the schema_migrations unique key.
    await acquireMigrationLock(client);
    lockHeld = true;

    await ensureMigrationsTable(client);
    const already = await getAppliedRows(client);
    const appliedSet = new Set(already.map((a) => a.version));

    for (const m of migrations) {
      if (appliedSet.has(m.version)) continue;

      info(`[migrate] applying ${m.version}_${m.name}…`);
      await client.query("BEGIN");
      try {
        await m.up(client);
        await client.query(
          `INSERT INTO schema_migrations (version, name, checksum, applied_at)
           VALUES ($1, $2, $3, NOW());`,
          [m.version, m.name, m.checksum]
        );
        await client.query("COMMIT");
        appliedNow.push({ version: m.version, name: m.name, checksum: m.checksum });
        appliedSet.add(m.version);
        info(`[migrate] applied ${m.version}_${m.name}`);
      } catch (err) {
        await client.query("ROLLBACK");
        const wrapped = new Error(
          `Migration ${m.version} (${m.name}) failed and was rolled back: ${err.message}`
        );
        wrapped.cause = err;
        wrapped.migrationVersion = m.version;
        throw wrapped;
      }
    }

    const remaining = migrations.filter((m) => !appliedSet.has(m.version));
    const latestApplied = migrations
      .filter((m) => appliedSet.has(m.version))
      .map((m) => m.version)
      .pop() || null;

    return {
      dryRun: false,
      applied: appliedNow,
      pending: remaining.map((m) => ({
        version: m.version,
        name: m.name,
        file: m.file,
        checksum: m.checksum
      })),
      current: latestApplied,
      schemaVersion: latestApplied,
      ok: remaining.length === 0
    };
  } catch (err) {
    operationError = err;
    throw err;
  } finally {
    await finalizeMigrationClient(client, lockHeld, operationError);
  }
}

/**
 * Attempt reverse of the latest applied migration (if it defines down()).
 * Prefer forward-fix in production — see docs/ops/migrations.md.
 */
async function rollbackLast(pool, options = {}) {
  const log = options.logger || console;
  const info = typeof log.info === "function" ? log.info.bind(log) : log.log?.bind(log) || (() => {});
  const migrations = loadMigrations(options.migrationsDir || MIGRATIONS_DIR);
  const byVersion = new Map(migrations.map((m) => [m.version, m]));

  const client = await pool.connect();
  let lockHeld = false;
  let operationError = null;
  try {
    await acquireMigrationLock(client);
    lockHeld = true;

    await ensureMigrationsTable(client);
    const applied = await getAppliedRows(client);
    if (!applied.length) {
      return { rolledBack: null, reason: "no migrations applied" };
    }

    const last = applied[applied.length - 1];
    const mod = byVersion.get(last.version);
    if (!mod || !mod.down) {
      throw new Error(
        `Cannot rollback ${last.version}: migration has no down() — use forward-fix`
      );
    }

    info(`[migrate] rolling back ${last.version}_${last.name}…`);
    await client.query("BEGIN");
    try {
      await mod.down(client);
      await client.query("DELETE FROM schema_migrations WHERE version = $1;", [last.version]);
      await client.query("COMMIT");
      info(`[migrate] rolled back ${last.version}_${last.name}`);
      return { rolledBack: { version: last.version, name: last.name } };
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(
        `Rollback of ${last.version} failed and was rolled back: ${err.message}`
      );
    }
  } catch (err) {
    operationError = err;
    throw err;
  } finally {
    await finalizeMigrationClient(client, lockHeld, operationError);
  }
}

/**
 * Pure helpers for tests (no DB).
 */
function planMigrations(appliedVersions, migrationsDir = MIGRATIONS_DIR) {
  const migrations = loadMigrations(migrationsDir);
  const appliedSet = new Set(appliedVersions);
  return {
    all: migrations.map((m) => ({ version: m.version, name: m.name, file: m.file })),
    pending: migrations
      .filter((m) => !appliedSet.has(m.version))
      .map((m) => ({ version: m.version, name: m.name, file: m.file })),
    applied: migrations
      .filter((m) => appliedSet.has(m.version))
      .map((m) => ({ version: m.version, name: m.name, file: m.file }))
  };
}

module.exports = {
  MIGRATIONS_DIR,
  SCHEMA_MIGRATIONS_DDL,
  MIGRATION_LOCK_ID,
  loadMigrations,
  ensureMigrationsTable,
  getAppliedRows,
  getMigrationStatus,
  acquireMigrationLock,
  releaseMigrationLock,
  migrate,
  rollbackLast,
  planMigrations
};
