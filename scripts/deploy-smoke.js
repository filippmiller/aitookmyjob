/**
 * Production / staging deploy smoke verification.
 * Verifies /ready and critical user-facing reads. No fixed sleeps — uses poll.
 *
 * Usage:
 *   BASE_URL=https://aitookmyjob.filippmiller.com node scripts/deploy-smoke.js
 *   node scripts/deploy-smoke.js https://example.com
 *
 * Exit 0 on all green; exit 1 on any failure. A failed run means the release
 * must not be considered promoted (rollback / do not announce).
 *
 * Contract (aitj-z8q.31): every check predicate returns literal `true` on
 * success or an error string on failure. `poll()` only accepts `=== true`;
 * truthy non-boolean values (arrays, objects) are treated as failures.
 */

"use strict";

const DEFAULT_BASE =
  process.env.BASE_URL ||
  process.env.SMOKE_BASE_URL ||
  "https://aitookmyjob.filippmiller.com";

const baseUrl = (process.argv[2] || DEFAULT_BASE).replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const POLL_MS = Number(process.env.SMOKE_POLL_MS || 500);
const RETRIES = Number(process.env.SMOKE_RETRIES || 8);

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Poll until predicate passes or retries exhausted.
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} fn
 * @param {(value: T) => true | string} check returns literal true or error string
 * @param {{ retries?: number, pollMs?: number }} [options]
 */
async function poll(name, fn, check, options = {}) {
  const retries = Math.max(1, Number(options.retries || RETRIES));
  const pollMs = Math.max(0, Number(options.pollMs ?? POLL_MS));
  let lastErr = "not started";
  for (let i = 0; i < retries; i++) {
    try {
      const value = await fn();
      const result = check(value);
      if (result === true) {
        console.log(`  ok  ${name}`);
        return value;
      }
      lastErr = typeof result === "string" ? result : "check failed";
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
    if (i < retries - 1) await sleep(pollMs);
  }
  throw new Error(`${name}: ${lastErr}`);
}

async function fetchJson(path) {
  const url = `${baseUrl}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "aitookmyjob-deploy-smoke/1" }
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { _raw: text.slice(0, 200) };
    }
    return { status: res.status, body, headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(path) {
  const url = `${baseUrl}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "aitookmyjob-deploy-smoke/1" }
    });
    const text = await res.text();
    return { status: res.status, text, headers: res.headers };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Smoke checks. `kind: "json"` fetches via fetchJson, `"text"` via fetchText.
 * Every `check(r)` MUST return literal `true` on success, error string otherwise
 * (poll requires `result === true`; a truthy array/object fails the run).
 */
const CHECKS = [
  {
    name: "GET /live",
    path: "/live",
    kind: "json",
    check: (r) =>
      r.status === 200 && r.body && r.body.live === true
        ? true
        : `status=${r.status} body=${JSON.stringify(r.body)}`
  },
  {
    name: "GET /health",
    path: "/health",
    kind: "json",
    check: (r) =>
      r.status === 200 && r.body && r.body.ok === true && r.body.service === "aitookmyjob"
        ? true
        : `status=${r.status} body=${JSON.stringify(r.body)}`
  },
  {
    name: "GET /ready",
    path: "/ready",
    kind: "json",
    check: (r) =>
      r.status === 200 && r.body && r.body.ready === true
        ? true
        : `status=${r.status} ready=${r.body?.ready} error=${r.body?.error || ""}`
  },
  {
    name: "GET /api/meta",
    path: "/api/meta",
    kind: "json",
    check: (r) =>
      r.status === 200 &&
      r.body &&
      (Array.isArray(r.body.countries) || Boolean(r.body.domainContractVersion))
        ? true
        : `status=${r.status}`
  },
  {
    name: "GET /api/stories (critical read)",
    path: "/api/stories?limit=5",
    kind: "json",
    check: (r) => {
      if (r.status !== 200) return `status=${r.status}`;
      // Accept array or { items/stories/data }
      const b = r.body;
      if (Array.isArray(b)) return true;
      if (b && (Array.isArray(b.items) || Array.isArray(b.stories) || Array.isArray(b.data))) {
        return true;
      }
      // object with total/count is also fine for empty catalogs
      if (b && typeof b === "object") return true;
      return `unexpected body shape`;
    }
  },
  {
    name: "GET /api/stats (critical read)",
    path: "/api/stats",
    kind: "json",
    check: (r) =>
      r.status === 200 && r.body && typeof r.body === "object"
        ? true
        : `status=${r.status}`
  },
  {
    name: "GET / (homepage)",
    path: "/",
    kind: "text",
    check: (r) =>
      r.status === 200 && r.text && r.text.length > 200 && /html/i.test(r.text.slice(0, 200))
        ? true
        : `status=${r.status} len=${r.text?.length || 0}`
  }
];

async function main() {
  console.log(`deploy-smoke: base=${baseUrl}`);
  const failures = [];

  for (const c of CHECKS) {
    try {
      await poll(
        c.name,
        () => (c.kind === "text" ? fetchText(c.path) : fetchJson(c.path)),
        c.check
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL ${msg}`);
      failures.push(msg);
    }
  }

  if (failures.length) {
    console.error(`\ndeploy-smoke: FAILED (${failures.length}) — do not promote this release`);
    process.exit(1);
  }
  console.log("\ndeploy-smoke: ok — release health verified");
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("deploy-smoke: unexpected error", err);
    process.exit(1);
  });
}

module.exports = {
  CHECKS,
  poll,
  main,
  fetchJson,
  fetchText
};
