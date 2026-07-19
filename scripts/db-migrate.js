#!/usr/bin/env node
/**
 * Apply pending PostgreSQL migrations.
 * Usage: npm run db:migrate
 * Requires DATABASE_URL. Never prints connection secrets.
 */

"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { Pool } = require("pg");
const { migrate } = require("../lib/migrate");

async function main() {
  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Migrations require PostgreSQL.");
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
    const dryRun = process.argv.includes("--dry-run");
    const result = await migrate(pool, { logger: console, dryRun });
    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            schemaVersion: result.schemaVersion,
            pending: result.pending
          },
          null,
          2
        )
      );
    } else {
      console.log(
        JSON.stringify(
          {
            ok: result.ok,
            schemaVersion: result.schemaVersion,
            applied: result.applied,
            pendingCount: result.pending.length
          },
          null,
          2
        )
      );
    }
    process.exit(result.ok || dryRun ? 0 : 1);
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
