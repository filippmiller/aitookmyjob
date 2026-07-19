/**
 * Offline migration integrity check for CI (no database required).
 * Loads migration modules, verifies ordering / shape / plan idempotency.
 *
 * Usage: node scripts/ci-migrate-check.js
 */

"use strict";

const { loadMigrations, planMigrations } = require("../lib/migrate");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const migrations = loadMigrations();
  assert(migrations.length >= 1, "expected at least one migration");

  const versions = migrations.map((m) => m.version);
  const sorted = [...versions].sort((a, b) => a.localeCompare(b, "en"));
  assert(JSON.stringify(versions) === JSON.stringify(sorted), "migrations must be sorted by version");

  const seen = new Set();
  for (const m of migrations) {
    assert(m.version, `missing version: ${m.file}`);
    assert(m.name, `missing name: ${m.file}`);
    assert(typeof m.up === "function", `missing up(): ${m.file}`);
    assert(!seen.has(m.version), `duplicate version ${m.version}`);
    seen.add(m.version);
    assert(/^[a-f0-9]{16}$/.test(m.checksum), `bad checksum ${m.file}`);
  }

  const emptyPlan = planMigrations([]);
  assert(emptyPlan.pending.length === migrations.length, "all should be pending when none applied");
  assert(emptyPlan.applied.length === 0, "applied should be empty");

  const allPlan = planMigrations(versions);
  assert(allPlan.pending.length === 0, "pending should be empty when all applied");
  assert(allPlan.applied.length === migrations.length, "applied count mismatch");

  // Dry-run style summary (same as db:migrate --dry-run intent without DB)
  console.log("ci-migrate-check: ok");
  console.log(`  migrations: ${migrations.length}`);
  console.log(`  latest: ${migrations[migrations.length - 1].version} (${migrations[migrations.length - 1].name})`);
  for (const m of migrations) {
    console.log(`  - ${m.version} ${m.name} checksum=${m.checksum}`);
  }
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error("ci-migrate-check: FAILED", err instanceof Error ? err.message : err);
  process.exit(1);
}
