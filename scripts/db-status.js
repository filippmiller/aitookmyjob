#!/usr/bin/env node
/**
 * Print applied / pending migration status.
 * Usage: npm run db:status
 * Requires DATABASE_URL. Never prints connection secrets.
 */

"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { Pool } = require("pg");
const { getMigrationStatus, loadMigrations } = require("../lib/migrate");

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    const local = loadMigrations();
    console.log(
      JSON.stringify(
        {
          ok: false,
          storage: "none",
          error: "DATABASE_URL not set",
          availableMigrations: local.map((m) => ({
            version: m.version,
            name: m.name,
            file: m.file
          }))
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const ssl =
    String(process.env.PG_SSL || "false").toLowerCase() === "true"
      ? {
          rejectUnauthorized:
            String(process.env.PG_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !==
            "false"
        }
      : undefined;

  const pool = new Pool({ connectionString: databaseUrl, ssl, max: 2 });
  try {
    const status = await getMigrationStatus(pool);
    console.log(
      JSON.stringify(
        {
          ok: status.ok,
          schemaVersion: status.schemaVersion,
          latestAvailable: status.latestAvailable,
          appliedCount: status.appliedCount,
          pendingCount: status.pendingCount,
          applied: status.applied,
          pending: status.pending,
          migrations: status.migrations
        },
        null,
        2
      )
    );
    process.exit(status.ok ? 0 : 2);
  } catch (err) {
    console.error("Status check failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
