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

  try {
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
  } finally {
    client.release();
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
  try {
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
  } finally {
    client.release();
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
  loadMigrations,
  ensureMigrationsTable,
  getAppliedRows,
  getMigrationStatus,
  migrate,
  rollbackLast,
  planMigrations
};
