#!/usr/bin/env node
/**
 * PostgreSQL restore from pg_dump custom (.dump) or plain (.sql) backup.
 * Bead: aitj-z8q.6
 *
 * Usage:
 *   node scripts/restore-pg.js --file backups/aitookmyjob-….dump
 *   node scripts/restore-pg.js --file backups/….sql --yes
 *
 * DESTRUCTIVE on the target database. Requires --yes (or RESTORE_CONFIRM=yes).
 * Never prints DATABASE_URL.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function parseArgs(argv) {
  const out = { file: null, yes: false, clean: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file" && argv[i + 1]) out.file = argv[++i];
    else if (argv[i] === "--yes") out.yes = true;
    else if (argv[i] === "--no-clean") out.clean = false;
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.file) {
    console.log(`Usage: node scripts/restore-pg.js --file <backup.dump|backup.sql> --yes
Optional: --no-clean (skip --clean on pg_restore).
Env: RESTORE_CONFIRM=yes, PG_RESTORE / PSQL paths.`);
    process.exit(args.help ? 0 : 1);
  }

  const confirmed = args.yes || String(process.env.RESTORE_CONFIRM || "").toLowerCase() === "yes";
  if (!confirmed) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "confirm_required",
        message: "Pass --yes or RESTORE_CONFIRM=yes (destructive)"
      })
    );
    process.exit(2);
  }

  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    console.error(JSON.stringify({ ok: false, error: "DATABASE_URL not set" }));
    process.exit(1);
  }

  const file = path.resolve(args.file);
  if (!fs.existsSync(file)) {
    console.error(JSON.stringify({ ok: false, error: "file_not_found", file }));
    process.exit(1);
  }

  const isPlain = file.endsWith(".sql");
  let result;
  if (isPlain) {
    const psql = process.env.PSQL || "psql";
    result = spawnSync(psql, [databaseUrl, "-v", "ON_ERROR_STOP=1", "-f", file], {
      encoding: "utf8",
      env: process.env,
      windowsHide: true
    });
  } else {
    const pgRestore = process.env.PG_RESTORE || "pg_restore";
    const restoreArgs = [
      "--no-owner",
      "--no-acl",
      "--dbname",
      databaseUrl,
      ...(args.clean ? ["--clean", "--if-exists"] : []),
      file
    ];
    result = spawnSync(pgRestore, restoreArgs, {
      encoding: "utf8",
      env: process.env,
      windowsHide: true
    });
  }

  if (result.error || result.status !== 0) {
    const raw = result.error
      ? result.error.message
      : (result.stderr || result.stdout || "restore failed").trim();
    const safe = raw.replace(databaseUrl, "[REDACTED]");
    console.error(JSON.stringify({ ok: false, error: "restore_failed", message: safe }));
    process.exit(1);
  }

  console.log(
    JSON.stringify({
      ok: true,
      file,
      format: isPlain ? "plain" : "custom",
      restoredAt: new Date().toISOString()
    })
  );
}

main();
