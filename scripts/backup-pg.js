#!/usr/bin/env node
/**
 * PostgreSQL logical backup via pg_dump (preferred) or documented fallback.
 * Bead: aitj-z8q.6
 *
 * Usage:
 *   npm run db:backup
 *   node scripts/backup-pg.js [--out dir] [--format custom|plain]
 *
 * Never prints DATABASE_URL. Exit 0 on success.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

function parseArgs(argv) {
  const out = {
    outDir: process.env.BACKUP_DIR || path.join(__dirname, "..", "backups"),
    format: process.env.BACKUP_FORMAT || "custom" // custom → .dump, plain → .sql
  };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      out.outDir = argv[++i];
    } else if (argv[i] === "--format" && argv[i + 1]) {
      out.format = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      out.help = true;
    }
  }
  return out;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage: node scripts/backup-pg.js [--out dir] [--format custom|plain]
Requires DATABASE_URL and pg_dump on PATH (or PG_DUMP env).`);
    process.exit(0);
  }

  const databaseUrl = process.env.DATABASE_URL || "";
  if (!databaseUrl) {
    console.error(JSON.stringify({ ok: false, error: "DATABASE_URL not set" }));
    process.exit(1);
  }

  const format = args.format === "plain" ? "plain" : "custom";
  const ext = format === "plain" ? "sql" : "dump";
  fs.mkdirSync(args.outDir, { recursive: true });
  const file = path.join(args.outDir, `aitookmyjob-${stamp()}.${ext}`);
  const pgDump = process.env.PG_DUMP || "pg_dump";

  const dumpArgs =
    format === "plain"
      ? ["--no-owner", "--no-acl", "--format=plain", `--file=${file}`, databaseUrl]
      : ["--no-owner", "--no-acl", "--format=custom", "--compress=6", `--file=${file}`, databaseUrl];

  const result = spawnSync(pgDump, dumpArgs, {
    encoding: "utf8",
    env: process.env,
    windowsHide: true
  });

  if (result.error || result.status !== 0) {
    const msg = result.error
      ? result.error.message
      : (result.stderr || result.stdout || "pg_dump failed").trim();
    // Never echo connection string if pg_dump leaked it.
    const safe = msg.replace(databaseUrl, "[REDACTED]");
    console.error(
      JSON.stringify({
        ok: false,
        error: "pg_dump_failed",
        message: safe,
        hint: "Install PostgreSQL client tools and ensure pg_dump is on PATH, or set PG_DUMP=/path/to/pg_dump"
      })
    );
    process.exit(1);
  }

  const stat = fs.statSync(file);
  console.log(
    JSON.stringify({
      ok: true,
      file,
      bytes: stat.size,
      format,
      createdAt: new Date().toISOString()
    })
  );
}

main();
