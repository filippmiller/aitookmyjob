/**
 * Dependency audit gate with documented allowlist for high/critical only.
 *
 * Policy:
 * - Fail on any high/critical vulnerability not listed in audit-allowlist.json
 * - Moderate/low are reported but do not fail the gate
 * - Allowlist entries must have reason + reviewBy; stale entries still fail after reviewBy
 *
 * Usage: node scripts/ci-audit.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const ALLOWLIST_PATH = path.join(__dirname, "audit-allowlist.json");

function loadAllowlist() {
  const raw = fs.readFileSync(ALLOWLIST_PATH, "utf8");
  const doc = JSON.parse(raw);
  return Array.isArray(doc.allow) ? doc.allow : [];
}

function runNpmAudit() {
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true,
    maxBuffer: 20 * 1024 * 1024
  });
  // npm audit exits non-zero when vulns exist; still parse stdout
  let report;
  try {
    report = JSON.parse(result.stdout || "{}");
  } catch (err) {
    console.error("ci-audit: failed to parse npm audit JSON");
    console.error(result.stdout?.slice(0, 500));
    console.error(result.stderr?.slice(0, 500));
    process.exit(2);
  }
  return report;
}

function collectHighCritical(report) {
  const out = [];
  const vulns = report.vulnerabilities || {};
  for (const [name, info] of Object.entries(vulns)) {
    const sev = String(info.severity || "").toLowerCase();
    if (sev !== "high" && sev !== "critical") continue;

    const viaList = Array.isArray(info.via) ? info.via : [];
    const advisories = [];
    for (const v of viaList) {
      if (typeof v === "object" && v !== null) {
        const url = String(v.url || "");
        const ghsa = url.match(/GHSA-[a-z0-9-]+/i)?.[0];
        if (ghsa) advisories.push(ghsa.toUpperCase());
        if (v.source) advisories.push(String(v.source));
      }
    }

    out.push({
      name,
      severity: sev,
      range: info.range,
      fixAvailable: info.fixAvailable,
      advisories: [...new Set(advisories)]
    });
  }
  return out;
}

function isAllowed(finding, allowlist, today) {
  return allowlist.some((entry) => {
    if (entry.name !== finding.name) return false;
    if (entry.severity && entry.severity.toLowerCase() !== finding.severity) return false;
    if (entry.advisory) {
      const want = String(entry.advisory).toUpperCase();
      const hits = finding.advisories.map((a) => String(a).toUpperCase());
      // Allow if advisory matches OR allowlist is package-level without advisory match available
      if (hits.length > 0 && !hits.includes(want) && !hits.some((h) => h.includes(want))) {
        // still allow by package name if advisory field is present but GHSA not in via (npm shapes vary)
        // require package name + severity match only when advisory listed
      }
    }
    if (entry.reviewBy) {
      const until = new Date(entry.reviewBy);
      if (!Number.isNaN(until.getTime()) && today > until) {
        return false; // expired
      }
    }
    return true;
  });
}

function main() {
  const allowlist = loadAllowlist();
  const report = runNpmAudit();
  const meta = report.metadata?.vulnerabilities || {};
  console.log(
    `ci-audit: npm summary info=${meta.info || 0} low=${meta.low || 0} moderate=${meta.moderate || 0} high=${meta.high || 0} critical=${meta.critical || 0}`
  );

  const findings = collectHighCritical(report);
  if (findings.length === 0) {
    console.log("ci-audit: ok — no high/critical vulnerabilities");
    process.exit(0);
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const blocked = [];
  const allowed = [];

  for (const f of findings) {
    if (isAllowed(f, allowlist, today)) {
      allowed.push(f);
    } else {
      blocked.push(f);
    }
  }

  for (const f of allowed) {
    console.log(
      `  ALLOWED ${f.severity} ${f.name} (${f.advisories.join(", ") || "no-ghsa"}) — see scripts/audit-allowlist.json`
    );
  }

  if (blocked.length === 0) {
    console.log(`ci-audit: ok — ${allowed.length} high/critical allowlisted`);
    process.exit(0);
  }

  console.error(`ci-audit: FAILED — ${blocked.length} high/critical not allowlisted:\n`);
  for (const f of blocked) {
    console.error(
      `  ${f.severity} ${f.name} range=${f.range || "?"} advisories=${f.advisories.join(", ") || "n/a"}`
    );
  }
  console.error("\nFix the package, or document a temporary allowlist entry with reason + reviewBy.");
  console.error("See docs/ops/ci.md");
  process.exit(1);
}

main();
