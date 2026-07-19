/**
 * deploy-smoke unit tests (offline).
 * Run: node --test tests/deploy-smoke.test.js
 *
 * Regression coverage for aitj-z8q.31: check predicates must return literal
 * `true` (poll rejects truthy non-boolean values like arrays), and the
 * /api/meta predicate must accept the real response shape.
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { CHECKS, poll } = require("../scripts/deploy-smoke");

function checkByName(fragment) {
  const c = CHECKS.find((x) => x.name.includes(fragment));
  assert.ok(c, `check containing "${fragment}" exists`);
  return c;
}

describe("check predicates return literal true on valid responses", () => {
  it("GET /live", () => {
    const c = checkByName("/live");
    assert.strictEqual(c.check({ status: 200, body: { ok: true, live: true } }), true);
  });

  it("GET /health", () => {
    const c = checkByName("/health");
    assert.strictEqual(
      c.check({ status: 200, body: { ok: true, service: "aitookmyjob" } }),
      true
    );
  });

  it("GET /ready", () => {
    const c = checkByName("/ready");
    assert.strictEqual(c.check({ status: 200, body: { ready: true } }), true);
  });

  it("GET /api/meta — real response shape (countries array + domainContractVersion)", () => {
    const c = checkByName("/api/meta");
    const realBody = {
      countries: ["us", "de", "ua"],
      languages: ["en", "de"],
      roles: ["user", "admin"],
      schemaVersion: "015",
      domainContractVersion: "1.0.0",
      storage: "postgres",
      release: "abc123"
    };
    // Regression (aitj-z8q.31): predicate previously returned r.body.countries
    // (a truthy array), which poll() rejected because it requires === true.
    assert.strictEqual(c.check({ status: 200, body: realBody }), true);
  });

  it("GET /api/meta — accepts body with only domainContractVersion", () => {
    const c = checkByName("/api/meta");
    assert.strictEqual(c.check({ status: 200, body: { domainContractVersion: "1.0.0" } }), true);
  });

  it("GET /api/stories — array and wrapped shapes", () => {
    const c = checkByName("/api/stories");
    assert.strictEqual(c.check({ status: 200, body: [] }), true);
    assert.strictEqual(c.check({ status: 200, body: { items: [] } }), true);
    assert.strictEqual(c.check({ status: 200, body: { stories: [{ id: 1 }] } }), true);
    assert.strictEqual(c.check({ status: 200, body: { total: 0 } }), true);
  });

  it("GET /api/stats", () => {
    const c = checkByName("/api/stats");
    assert.strictEqual(c.check({ status: 200, body: { stories: 0 } }), true);
  });

  it("GET / (homepage)", () => {
    const c = checkByName("(homepage)");
    const html = `<!DOCTYPE html><html lang="en"><head><title>x</title></head><body>${"p".repeat(300)}</body></html>`;
    assert.strictEqual(c.check({ status: 200, text: html }), true);
  });

  it("every check returns literal true or a string — never another truthy type", () => {
    const fixtures = {
      "/live": { status: 200, body: { live: true } },
      "/health": { status: 200, body: { ok: true, service: "aitookmyjob" } },
      "/ready": { status: 200, body: { ready: true } },
      "/api/meta": { status: 200, body: { countries: ["us"] } },
      "/api/stories": { status: 200, body: { items: [] } },
      "/api/stats": { status: 200, body: {} },
      "(homepage)": { status: 200, text: `<html>${"x".repeat(300)}</html>` }
    };
    for (const c of CHECKS) {
      const key = Object.keys(fixtures).find((k) => c.name.includes(k));
      assert.ok(key, `fixture for ${c.name}`);
      const result = c.check(fixtures[key]);
      assert.ok(
        result === true || typeof result === "string",
        `${c.name} returned ${Object.prototype.toString.call(result)}`
      );
    }
  });
});

describe("check predicates reject invalid responses with an error string", () => {
  it("non-200 statuses fail", () => {
    for (const c of CHECKS) {
      const r =
        c.kind === "text"
          ? { status: 503, text: "<html>down</html>" }
          : { status: 503, body: { ok: false } };
      assert.strictEqual(typeof c.check(r), "string", `${c.name} on 503`);
    }
  });

  it("GET /api/meta — missing body fields fails", () => {
    const c = checkByName("/api/meta");
    assert.strictEqual(typeof c.check({ status: 200, body: null }), "string");
    assert.strictEqual(typeof c.check({ status: 200, body: {} }), "string");
  });

  it("GET / (homepage) — short/non-html body fails", () => {
    const c = checkByName("(homepage)");
    assert.strictEqual(typeof c.check({ status: 200, text: "ok" }), "string");
  });
});

describe("poll() strictness", () => {
  it("resolves when check returns literal true", async () => {
    const value = await poll(
      "t-ok",
      async () => ({ status: 200 }),
      () => true,
      { retries: 1, pollMs: 1 }
    );
    assert.deepEqual(value, { status: 200 });
  });

  it("rejects truthy non-boolean check results (regression aitj-z8q.31)", async () => {
    await assert.rejects(
      poll("t-array", async () => ({}), () => ["us", "de"], { retries: 2, pollMs: 1 }),
      /t-array: check failed/
    );
  });

  it("surfaces the last error string after retries are exhausted", async () => {
    let calls = 0;
    await assert.rejects(
      poll(
        "t-err",
        async () => {
          calls += 1;
          return {};
        },
        () => "still broken",
        { retries: 3, pollMs: 1 }
      ),
      /t-err: still broken/
    );
    assert.strictEqual(calls, 3);
  });

  it("retries until the check passes", async () => {
    let calls = 0;
    const value = await poll(
      "t-eventual",
      async () => {
        calls += 1;
        return calls;
      },
      (n) => (n >= 2 ? true : `n=${n}`),
      { retries: 5, pollMs: 1 }
    );
    assert.strictEqual(value, 2);
  });
});
