/**
 * Expression & publication-intent unit tests (aitj-z8q.8).
 * Run: node --test tests/expression.test.js
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");

const expression = require("../lib/expression");
const domain = require("../lib/domain-contract");

describe("expression modes & intent mapping", () => {
  it("lists all six publication intents", () => {
    const modes = expression.listModes();
    assert.equal(modes.length, 6);
    const ids = modes.map((m) => m.id).sort();
    assert.deepEqual(ids, [
      "advice_request",
      "good_news",
      "news_share",
      "story",
      "vent",
      "warn"
    ].sort());
  });

  it("maps vent → vent entity and story-like intents → story", () => {
    assert.equal(expression.entityForIntent("vent"), "vent");
    assert.equal(expression.isVentIntent("vent"), true);
    for (const intent of expression.STORY_LIKE_INTENTS) {
      assert.equal(expression.entityForIntent(intent), "story");
      assert.equal(expression.isStoryLikeIntent(intent), true);
    }
  });

  it("defaults desired response from domain contract", () => {
    assert.equal(expression.defaultDesiredResponse("vent"), "empathy");
    assert.equal(expression.defaultDesiredResponse("story"), "witness");
    assert.equal(expression.defaultDesiredResponse("advice_request"), "advice");
    assert.equal(expression.defaultDesiredResponse("warn"), "share");
    assert.equal(expression.defaultDesiredResponse("good_news"), "celebrate");
    assert.equal(expression.defaultDesiredResponse("news_share"), "discuss");
  });
});

describe("normalizeAuthorControls", () => {
  it("accepts valid controls and fills defaults", () => {
    const out = expression.normalizeAuthorControls({ publicationIntent: "vent" });
    assert.equal(out.ok, true);
    assert.equal(out.controls.publicationIntent, "vent");
    assert.equal(out.controls.desiredResponse, "empathy");
    assert.equal(out.controls.visibility, "community");
    assert.equal(out.controls.anonymityMode, "anonymous");
    assert.equal(out.controls.advicePermission, "closed");
    assert.equal(out.controls.retentionPreference, "30d");
    assert.equal(out.controls.primaryEntity, "vent");
  });

  it("rejects unknown intent", () => {
    const out = expression.normalizeAuthorControls({ publicationIntent: "rant" });
    assert.equal(out.ok, false);
    assert.ok(out.errors.some((e) => e.field === "publicationIntent"));
  });

  it("accepts author overrides within enums", () => {
    const out = expression.normalizeAuthorControls({
      publicationIntent: "story",
      desiredResponse: "none",
      visibility: "private",
      anonymityMode: "anonymous",
      advicePermission: "closed",
      retentionPreference: "90d"
    });
    assert.equal(out.ok, true);
    assert.equal(out.controls.desiredResponse, "none");
    assert.equal(out.controls.visibility, "private");
    assert.equal(out.controls.retentionPreference, "90d");
  });
});

describe("response policy — support without forced action", () => {
  it("empathy and none never force action CTAs", () => {
    assert.equal(expression.forcesActionContent("empathy"), false);
    assert.equal(expression.forcesActionContent("none"), false);
    assert.equal(expression.forcesActionContent("witness"), false);
    assert.equal(expression.forcesActionContent("celebrate"), false);
    const empathy = expression.responsePromptPolicy("empathy");
    assert.equal(empathy.showCtaBanner, false);
    assert.equal(empathy.showAdviceForm, false);
    const none = expression.responsePromptPolicy("none");
    assert.equal(none.showReactions, false);
    assert.equal(none.showCtaBanner, false);
  });

  it("advice may show advice form but not forced CTA banner", () => {
    const policy = expression.responsePromptPolicy("advice");
    assert.equal(policy.showAdviceForm, true);
    assert.equal(policy.showCtaBanner, false);
  });
});

describe("validateVentPayload", () => {
  it("requires body length for submit", () => {
    const bad = expression.validateVentPayload({ body: "short" });
    assert.equal(bad.ok, false);
    const ok = expression.validateVentPayload({
      body: "This is long enough to be a real vent.",
      publicationIntent: "vent"
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.data.publicationIntent, "vent");
    assert.equal(ok.data.visibility, "community");
  });

  it("allows short draft body", () => {
    const out = expression.validateVentPayload({ body: "x" }, { asDraft: true });
    assert.equal(out.ok, true);
  });
});

describe("preview builder", () => {
  it("builds preview with response policy", () => {
    const preview = expression.buildExpressionPreview({
      kind: "vent",
      publicationIntent: "vent",
      desiredResponse: "empathy",
      body: "I needed to say this somewhere safe.",
      anonymityMode: "anonymous"
    });
    assert.equal(preview.modeLabel, "Vent");
    assert.equal(preview.displayName, "Anonymous");
    assert.equal(preview.forcesActionContent, false);
    assert.equal(preview.responsePolicy.showCtaBanner, false);
  });
});

describe("status transitions at expression boundaries", () => {
  it("allows draft → pending → published for vents", () => {
    assert.equal(expression.canTransition("vent", "draft", "pending"), true);
    assert.equal(expression.canTransition("vent", "pending", "published"), true);
    assert.equal(expression.canTransition("vent", "published", "hidden"), true);
    assert.equal(expression.canTransition("vent", "published", "deleted"), true);
  });

  it("allows draft → pending for stories", () => {
    assert.equal(expression.canTransition("story", "draft", "pending"), true);
    assert.equal(expression.canTransition("story", "published", "deleted"), true);
  });

  it("initialStatusForSubmit respects draft and risk", () => {
    assert.equal(
      expression.initialStatusForSubmit({ asDraft: true, riskBand: "low", entity: "vent" }),
      "draft"
    );
    assert.equal(
      expression.initialStatusForSubmit({ asDraft: false, riskBand: "low", entity: "vent" }),
      "pending"
    );
    assert.equal(
      expression.initialStatusForSubmit({ asDraft: false, riskBand: "high", entity: "story" }),
      "rejected"
    );
  });
});

describe("publicVent masking", () => {
  it("masks anonymous display name", () => {
    const pub = expression.publicVent({
      id: "v1",
      body: "hello world vent text",
      status: "published",
      anonymityMode: "anonymous",
      displayName: "Secret Person",
      company: "Acme",
      desiredResponse: "empathy",
      visibility: "community",
      metrics: { views: 3 }
    });
    assert.equal(pub.displayName, "Anonymous");
    assert.equal(pub.company, null);
    assert.equal(pub.responsePolicy.showCtaBanner, false);
  });
});

describe("expression storage (JSON fallback)", () => {
  it("vent create → moderate → report → follow-up → delete", async () => {
    const ctx = require("../lib/context");
    // Ensure JSON files exist (dev without DATABASE_URL)
    if (!fs.existsSync(ctx.dataDir)) fs.mkdirSync(ctx.dataDir, { recursive: true });
    for (const name of ["vents.json", "expression-reports.json", "expression-followups.json"]) {
      const p = path.join(ctx.dataDir, name);
      if (!fs.existsSync(p)) fs.writeFileSync(p, "[]");
    }

    const vent = ctx.buildVentRecord(
      {
        body: "I just needed to vent about the layoff without anyone telling me to upskill.",
        desiredResponse: "empathy",
        advicePermission: "closed",
        anonymityMode: "anonymous",
        visibility: "community",
        retentionPreference: "30d",
        country: "us",
        language: "en",
        displayName: "Anon"
      },
      "user_test",
      { riskBand: "low" },
      "pending"
    );
    assert.equal(vent.publicationIntent, "vent");
    assert.equal(vent.status, "pending");
    await ctx.storageInsertVent(vent);
    const loaded = await ctx.storageGetVentById(vent.id);
    assert.ok(loaded);
    assert.equal(loaded.body.includes("upskill"), true);

    expression.assertCanTransition("vent", loaded.status, "published");
    const published = await ctx.storagePatchVent(vent.id, () => ({ status: "published" }));
    assert.equal(published.status, "published");

    const report = await ctx.storageInsertExpressionReport({
      targetType: "vent",
      targetId: vent.id,
      reason: "spam test",
      reporterId: "user_other"
    });
    assert.equal(report.status, "open");

    const fu = await ctx.storageInsertExpressionFollowup({
      targetType: "vent",
      targetId: vent.id,
      body: "Still feeling this a week later.",
      createdBy: "user_test"
    });
    assert.ok(fu.id);
    const followups = await ctx.storageGetExpressionFollowups("vent", vent.id);
    assert.ok(followups.length >= 1);

    expression.assertCanTransition("vent", "published", "deleted");
    const deleted = await ctx.storagePatchVent(vent.id, () => ({ status: "deleted" }));
    assert.equal(deleted.status, "deleted");

    const queue = await ctx.storageGetModerationQueue();
    assert.ok(Array.isArray(queue));
  });
});

describe("migration 005 is loadable", () => {
  it("is present after 004 in loadMigrations", () => {
    const { loadMigrations } = require("../lib/migrate");
    const migrations = loadMigrations();
    const versions = migrations.map((m) => m.version);
    assert.ok(versions.includes("005"));
    const m005 = migrations.find((m) => m.version === "005");
    assert.equal(m005.name, "expression_flows");
    assert.equal(typeof m005.up, "function");
  });
});

describe("domain contract API boundaries include expression", () => {
  it("lists /api/expression and /api/vents", () => {
    const mounts = domain.API_BOUNDARIES.map((b) => b.mount);
    assert.ok(mounts.includes("/api/expression"));
    assert.ok(mounts.includes("/api/vents"));
  });
});
