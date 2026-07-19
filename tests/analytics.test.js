/**
 * Product analytics, k-anonymity, funnels, deletion cascade (aitj-z8q.18).
 * Run: npm run test:analytics
 */

"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const ANALYTICS_PATH = path.join(__dirname, "..", "lib/analytics.js");
const PRIVACY_PATH = path.join(__dirname, "..", "lib/privacy.js");
const HANDLERS_PATH = path.join(__dirname, "..", "lib/job-handlers.js");
const JOBS_PATH = path.join(__dirname, "..", "lib/jobs.js");

function clearModule(modPath) {
  try {
    delete require.cache[require.resolve(modPath)];
  } catch (_e) {
    /* ignore */
  }
}

function loadAnalytics() {
  clearModule(ANALYTICS_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(ANALYTICS_PATH);
}

describe("analytics event catalog", () => {
  it("exports north-star events and funnels", () => {
    const a = loadAnalytics();
    const cat = a.eventCatalog();
    assert.ok(cat.events["expression.submitted"]);
    assert.ok(cat.events["outcome.found_job"]);
    assert.ok(Array.isArray(cat.funnels.expression));
    assert.equal(cat.kDefault, 5);
  });
});

describe("track + dedupe (memory)", () => {
  beforeEach(() => {
    const a = loadAnalytics();
    a.memoryReset();
  });

  it("records events and dedupes by key", async () => {
    const a = loadAnalytics();
    const r1 = await a.track({
      eventName: a.EVENT_NAMES.EXPRESSION_SUBMITTED,
      subjectId: "st1",
      userId: "u1",
      dedupeKey: "expr:submitted:st1"
    });
    assert.equal(r1.created, true);
    const r2 = await a.track({
      eventName: a.EVENT_NAMES.EXPRESSION_SUBMITTED,
      subjectId: "st1",
      userId: "u1",
      dedupeKey: "expr:submitted:st1"
    });
    assert.equal(r2.created, false);
    const listed = await a.listEvents({ includeSeed: true, includeTest: true });
    assert.equal(listed.length, 1);
  });

  it("strips PII-like property keys", async () => {
    const a = loadAnalytics();
    const r = await a.track({
      eventName: a.EVENT_NAMES.AUTH_LOGIN,
      properties: { email: "x@y.com", intent: "story", password: "nope" }
    });
    assert.equal(r.event.properties.email, undefined);
    assert.equal(r.event.properties.password, undefined);
    assert.equal(r.event.properties.intent, "story");
  });

  it("excludes seed/test from default list and funnels", async () => {
    const a = loadAnalytics();
    await a.track({ eventName: a.EVENT_NAMES.SESSION_START, isSeed: true });
    await a.track({ eventName: a.EVENT_NAMES.SESSION_START, isTest: true });
    await a.track({ eventName: a.EVENT_NAMES.SESSION_START });
    await a.track({ eventName: a.EVENT_NAMES.AUTH_REGISTER });
    await a.track({ eventName: a.EVENT_NAMES.EXPRESSION_SUBMITTED });

    const real = await a.listEvents({});
    assert.equal(real.length, 3);

    const f = await a.funnel("activation");
    assert.equal(f.audience.real[0].count, 1);
    assert.equal(f.audience.real[1].count, 1);
    assert.equal(f.audience.real[2].count, 1);
  });
});

describe("k-anonymity aggregates", () => {
  it("suppresses small profession buckets", () => {
    const a = loadAnalytics();
    const stories = [
      { status: "published", profession: "Copywriter", country: "us", laidOffAt: "2026-01" },
      { status: "published", profession: "Copywriter", country: "us", laidOffAt: "2026-01" },
      { status: "published", profession: "Copywriter", country: "us", laidOffAt: "2026-01" },
      { status: "published", profession: "Copywriter", country: "us", laidOffAt: "2026-01" },
      { status: "published", profession: "Copywriter", country: "us", laidOffAt: "2026-01" },
      { status: "published", profession: "Rare Job", country: "us", laidOffAt: "2026-02" },
      { status: "published", profession: "Rare Job", country: "us", laidOffAt: "2026-02" },
      { status: "draft", profession: "Ignored", country: "us", laidOffAt: "2026-03" },
      { status: "published", profession: "Seeded", country: "us", laidOffAt: "2026-01", isSeed: true }
    ];
    const agg = a.publicStoryAggregates(stories, { country: "us", k: 5 });
    assert.equal(agg.totalPublishedStories, 7); // seed excluded; Rare Job kept in total
    const profs = agg.topProfessions.map((p) => p.profession);
    assert.ok(profs.includes("Copywriter"));
    assert.ok(!profs.includes("Rare Job"), "small profession cell suppressed");
    assert.ok(agg.kAnonymity.profession.suppressedBuckets >= 1);
    assert.ok(agg.methodology.suppression.includes("k=5"));
  });

  it("applyKAnonymity nulls counts below k", () => {
    const a = loadAnalytics();
    assert.equal(a.applyKAnonymity(3, 5).suppressed, true);
    assert.equal(a.applyKAnonymity(3, 5).count, null);
    assert.equal(a.applyKAnonymity(5, 5).suppressed, false);
    assert.equal(a.applyKAnonymity(5, 5).count, 5);
  });
});

describe("expression job mapping", () => {
  it("maps expression job payload into track", async () => {
    const a = loadAnalytics();
    a.memoryReset();
    const r = await a.recordExpressionJob(
      {
        event: "expression.published",
        id: "vent_1",
        kind: "vent",
        status: "published",
        publicationIntent: "vent"
      },
      { job: { id: "job1" } }
    );
    assert.equal(r.created, true);
    assert.equal(r.event.eventName, "expression.published");
    assert.equal(r.event.subjectId, "vent_1");
  });
});

describe("analytics.expression handler is not a stub", () => {
  it("registers real recorder", async () => {
    clearModule(HANDLERS_PATH);
    clearModule(JOBS_PATH);
    clearModule(ANALYTICS_PATH);
    const jobs = require(JOBS_PATH);
    const handlers = require(HANDLERS_PATH);
    const analytics = require(ANALYTICS_PATH);
    analytics.memoryReset();

    const ctx = {
      usePostgres: false,
      getPgPool: () => null,
      storageAudit: async () => {}
    };
    handlers.registerBuiltinHandlers(ctx, jobs);
    const fn = jobs.getHandler("analytics.expression");
    assert.equal(typeof fn, "function");
    const out = await fn(
      { event: "expression.submitted", id: "s1", kind: "story", status: "pending" },
      { job: { id: "j1" } }
    );
    assert.equal(out.stub, false);
    assert.equal(out.recorded, true);
    const listed = await analytics.listEvents({ includeTest: true, includeSeed: true });
    assert.ok(listed.some((e) => e.subjectId === "s1"));
  });
});

describe("deleteUserEvents cascade", () => {
  it("removes analytics rows for user", async () => {
    const a = loadAnalytics();
    a.memoryReset();
    await a.track({ eventName: a.EVENT_NAMES.AUTH_LOGIN, userId: "u_del" });
    await a.track({ eventName: a.EVENT_NAMES.AUTH_LOGIN, userId: "u_keep" });
    const del = await a.deleteUserEvents("u_del");
    assert.equal(del.deleted, 1);
    const left = await a.listEvents({ includeTest: true, includeSeed: true });
    assert.equal(left.length, 1);
    assert.equal(left[0].userId, "u_keep");
  });
});

describe("privacy export (offline)", () => {
  it("builds export without password hashes", async () => {
    clearModule(PRIVACY_PATH);
    const privacy = require(PRIVACY_PATH);
    const ctx = {
      usePostgres: false,
      getPgPool: () => null,
      storageGetUserById: async (id) => ({
        id,
        email: "user@example.com",
        role: "user",
        passwordHash: "SECRET_HASH",
        createdAt: "2026-01-01T00:00:00.000Z"
      }),
      storageGetIdentityByUserId: async () => ({ phoneVerified: true, phone: "+15551212" }),
      storageGetTelegramLinkByUserId: async () => null,
      storageGetStories: async () => [
        {
          id: "st1",
          submittedBy: "u1",
          status: "published",
          profession: "Writer",
          story: "hello",
          passwordHash: "should-not-appear"
        }
      ],
      storageGetVents: async () => [],
      storageGetAuditRange: async () => [
        { id: "a1", actorId: "u1", action: "auth.login", metadata: { email: "hide", ok: true }, createdAt: "2026-01-02T00:00:00.000Z" }
      ]
    };
    const exp = await privacy.exportUserData("u1", ctx);
    assert.equal(exp.subject.email, "user@example.com");
    assert.equal(exp.subject.passwordHash, undefined);
    assert.equal(exp.content.stories.length, 1);
    assert.ok(!JSON.stringify(exp).includes("SECRET_HASH"));
    assert.equal(exp.audit[0].metadata.email, undefined);
    assert.equal(exp.audit[0].metadata.ok, true);
  });
});

describe("privacy json cascade anonymizes published stories", () => {
  it("anonymizes published and deletes draft", async () => {
    clearModule(PRIVACY_PATH);
    clearModule(ANALYTICS_PATH);
    const privacy = require(PRIVACY_PATH);
    const analytics = require(ANALYTICS_PATH);
    analytics.memoryReset();
    await analytics.track({ eventName: "auth.login", userId: "u_anon" });

    const stories = [
      { id: "p1", submittedBy: "u_anon", status: "published", name: "Alice", company: "Acme" },
      { id: "d1", submittedBy: "u_anon", status: "draft", name: "Alice", company: "Acme" },
      { id: "o1", submittedBy: "other", status: "published", name: "Bob", company: "Beta" }
    ];
    const users = [{ id: "u_anon", email: "a@b.c" }, { id: "other", email: "o@b.c" }];
    const identities = [{ userId: "u_anon" }];
    const telegram = [{ userId: "u_anon" }];

    const files = {
      stories,
      users,
      identities,
      telegram
    };

    const ctx = {
      usePostgres: false,
      getPgPool: () => null,
      lockedJsonUpdate: async (filePath, mutate) => {
        if (String(filePath).includes("stories")) mutate(files.stories);
        else if (String(filePath).includes("users")) mutate(files.users);
        else if (String(filePath).includes("auth")) mutate(files.identities);
        else if (String(filePath).includes("telegram")) mutate(files.telegram);
      },
      storiesPath: "stories.json",
      usersPath: "users.json",
      authIdentitiesPath: "auth.json",
      telegramLinksPath: "telegram.json"
    };

    const result = await privacy.deleteAccountCascade("u_anon", ctx);
    assert.equal(result.ok, true);
    assert.equal(result.effects.storiesAnonymized, 1);
    assert.equal(result.effects.storiesDeleted, 1);
    assert.equal(result.effects.analyticsDeleted, 1);
    const pub = files.stories.find((s) => s.id === "p1");
    assert.equal(pub.submittedBy, null);
    assert.equal(pub.name, privacy.ANON_LABEL);
    assert.ok(!files.stories.find((s) => s.id === "d1"));
    assert.ok(files.stories.find((s) => s.id === "o1"));
    assert.ok(!files.users.find((u) => u.id === "u_anon"));
  });
});
