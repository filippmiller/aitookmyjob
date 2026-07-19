/**
 * Lightweight secret pattern scan for CI (no external binary required).
 * Complements optional gitleaks action. Fails on high-confidence matches.
 *
 * Usage: node scripts/ci-secret-scan.js
 * Exit 0 = clean, 1 = findings
 */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "playwright-report",
  "test-results",
  "coverage",
  ".tmp",
  "data",
  ".beads"
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "ci-secret-scan.js",
  "audit-allowlist.json"
]);

const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".map",
  ".lock",
  ".db",
  ".sqlite"
]);

/** High-confidence patterns only — avoid noisy false positives. */
const PATTERNS = [
  {
    id: "aws-access-key",
    re: /AKIA[0-9A-Z]{16}/g,
    description: "AWS access key id"
  },
  {
    id: "aws-secret-key",
    re: /(?:aws)?_?secret(?:_?access)?_?key["'\s:=]+["']?([A-Za-z0-9/+=]{40})/gi,
    description: "AWS secret access key assignment"
  },
  {
    id: "private-key",
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    description: "PEM/OpenSSH private key block"
  },
  {
    id: "github-pat",
    re: /ghp_[A-Za-z0-9]{36,}/g,
    description: "GitHub personal access token"
  },
  {
    id: "github-oauth",
    re: /gho_[A-Za-z0-9]{36,}/g,
    description: "GitHub OAuth token"
  },
  {
    id: "slack-token",
    re: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    description: "Slack token"
  },
  {
    id: "stripe-live",
    re: /sk_live_[A-Za-z0-9]{20,}/g,
    description: "Stripe live secret key"
  },
  {
    id: "generic-api-key-assignment",
    re: /(?:api[_-]?key|auth[_-]?token|access[_-]?token|secret[_-]?key)\s*[:=]\s*["']([A-Za-z0-9_\-]{32,})["']/gi,
    description: "Hard-coded API key / token assignment"
  },
  {
    id: "postgres-url-password",
    re: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/gi,
    description: "Postgres connection string with embedded password"
  }
];

/**
 * Relative path prefixes (posix) that may contain placeholder / CI-only credentials.
 * Not real production secrets.
 */
const ALLOWLIST_PATH_PREFIXES = [
  ".env.example",
  "docs/ops/",
  ".github/workflows/",
  "tests/",
  "scripts/audit-allowlist.json",
  "scripts/ci-secret-scan.js",
  "scripts/ci-audit.js",
  "scripts/deploy-smoke.js"
];

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith(".tmp");
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".") && ent.name !== ".github" && ent.name !== ".env.example") {
      if (ent.isDirectory() && ent.name !== ".github") continue;
    }
    if (ent.isDirectory()) {
      if (shouldSkipDir(ent.name)) continue;
      walk(path.join(dir, ent.name), out);
      continue;
    }
    if (SKIP_FILES.has(ent.name)) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (SKIP_EXTENSIONS.has(ext)) continue;
    out.push(path.join(dir, ent.name));
  }
  return out;
}

function relPosix(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function isAllowlistedPath(filePath) {
  const rel = relPosix(filePath);
  return ALLOWLIST_PATH_PREFIXES.some((p) => {
    if (p.endsWith("/")) return rel.startsWith(p) || rel === p.slice(0, -1);
    return rel === p || rel.startsWith(p + "/");
  });
}

function isPlaceholderValue(match) {
  const s = String(match).toLowerCase();
  return (
    s.includes("change-me") ||
    s.includes("example") ||
    s.includes("your-") ||
    s.includes("xxx") ||
    s.includes("placeholder") ||
    s.includes("dummy") ||
    s.includes("test") ||
    s.includes("fake") ||
    s.includes("password") ||
    s.includes("aitj_ci") ||
    s.includes("://user:pass") ||
    s.includes("://u:p@") ||
    s.includes("localhost")
  );
}

function scanFile(filePath) {
  let text;
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > 1_500_000) return [];
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  // Skip binary-ish
  if (text.includes("\u0000")) return [];

  const findings = [];
  const rel = path.relative(ROOT, filePath);

  // Entire allowlisted paths are skipped for fixture/docs/CI noise patterns only.
  // Real key material (PEM, GitHub PAT, AWS AKIA, Stripe live) still fails everywhere.
  const softOnlyInAllowlisted = new Set([
    "postgres-url-password",
    "generic-api-key-assignment",
    "aws-secret-key"
  ]);

  for (const pattern of PATTERNS) {
    pattern.re.lastIndex = 0;
    let m;
    while ((m = pattern.re.exec(text)) !== null) {
      if (isPlaceholderValue(m[0])) continue;
      if (isAllowlistedPath(filePath) && softOnlyInAllowlisted.has(pattern.id)) continue;
      const line = text.slice(0, m.index).split(/\r?\n/).length;
      findings.push({
        file: rel,
        line,
        id: pattern.id,
        description: pattern.description,
        snippet: m[0].slice(0, 24) + (m[0].length > 24 ? "…" : "")
      });
    }
  }
  return findings;
}

function main() {
  const files = walk(ROOT);
  const all = [];
  for (const f of files) {
    all.push(...scanFile(f));
  }

  if (all.length === 0) {
    console.log(`secret-scan: ok (${files.length} files scanned)`);
    process.exit(0);
  }

  console.error(`secret-scan: FAILED — ${all.length} finding(s)\n`);
  for (const f of all) {
    console.error(`  ${f.file}:${f.line}  [${f.id}] ${f.description}  match=${f.snippet}`);
  }
  console.error("\nRemove secrets from the tree or rotate them. See docs/ops/ci.md.");
  process.exit(1);
}

main();
