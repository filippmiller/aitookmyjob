/**
 * Domain contract pure tests — run with: npm run test:domain
 * Uses node:test + node:assert (Node >= 20).
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const d = require("../lib/domain-contract");

describe("domain-contract version & freezes", () => {
  it("exports version 1.0.0", () => {
    assert.equal(d.DOMAIN_CONTRACT_VERSION, "1.0.0");
  });

  it("freezes status enums", () => {
    assert.throws(() => {
      d.STORY_STATUS.NEW = "new";
    }, TypeError);
  });
});

describe("assertValidStatus — rejects free-form / ambiguous statuses", () => {
  it("accepts known story statuses", () => {
    assert.equal(d.assertValidStatus("story", "pending"), "pending");
    assert.equal(d.assertValidStatus("story", d.STORY_STATUS.PUBLISHED), "published");
  });

  it("rejects empty, null-like, and invented strings", () => {
    assert.throws(() => d.assertValidStatus("story", ""), { code: "INVALID_STATUS" });
    assert.throws(() => d.assertValidStatus("story", "live"), { code: "INVALID_STATUS" });
    assert.throws(() => d.assertValidStatus("story", "PENDING"), { code: "INVALID_STATUS" });
    assert.throws(() => d.assertValidStatus("story", "approved"), { code: "INVALID_STATUS" });
    assert.throws(() => d.assertValidStatus("story", "active"), { code: "INVALID_STATUS" });
  });

  it("rejects unknown entity", () => {
    assert.throws(() => d.assertValidStatus("widget", "open"), { code: "UNKNOWN_ENTITY" });
  });

  it("isValidStatus mirrors assert for all lifecycle entities", () => {
    for (const entity of Object.keys(d.STATUS_ENUMS)) {
      const statuses = d.valuesOf(d.STATUS_ENUMS[entity]);
      assert.ok(statuses.length > 0, entity);
      for (const s of statuses) {
        assert.equal(d.isValidStatus(entity, s), true, `${entity}:${s}`);
      }
      assert.equal(d.isValidStatus(entity, "not-a-real-status"), false);
    }
  });
});

describe("canTransition — story lifecycle", () => {
  it("allows draft → pending → published", () => {
    assert.equal(d.canTransition("story", "draft", "pending"), true);
    assert.equal(d.canTransition("story", "pending", "published"), true);
  });

  it("allows pending → rejected and rejected → pending resubmit", () => {
    assert.equal(d.canTransition("story", "pending", "rejected"), true);
    assert.equal(d.canTransition("story", "rejected", "pending"), true);
  });

  it("forbids published → pending and deleted → published", () => {
    assert.equal(d.canTransition("story", "published", "pending"), false);
    assert.equal(d.canTransition("story", "deleted", "published"), false);
  });

  it("allows same-state no-op", () => {
    assert.equal(d.canTransition("story", "published", "published"), true);
  });

  it("rejects same-state no-op for invalid statuses", () => {
    assert.equal(d.canTransition("story", "live", "live"), false);
    assert.equal(d.canTransition("story", "approved", "approved"), false);
  });

  it("assertCanTransition throws on illegal edge", () => {
    assert.throws(
      () => d.assertCanTransition("story", "published", "pending"),
      { code: "ILLEGAL_TRANSITION" }
    );
  });
});

describe("canTransition — insider signal legal hold", () => {
  it("blocks delete from legal_hold (D-LEGAL-HOLD)", () => {
    assert.equal(
      d.canTransition("insider_signal", "legal_hold", "deleted"),
      false
    );
    assert.equal(d.isLegalHoldBlockingDelete("insider_signal", "legal_hold"), true);
  });

  it("allows staff exit from legal_hold to under_review", () => {
    assert.equal(
      d.canTransition("insider_signal", "legal_hold", "under_review"),
      true
    );
  });
});

describe("canTransition — evidence never skips to public-ish states", () => {
  it("has no published status", () => {
    assert.equal(d.isValidStatus("evidence", "published"), false);
  });

  it("uploaded → scanning → available path works", () => {
    assert.equal(d.canTransition("evidence", "uploaded", "scanning"), true);
    assert.equal(d.canTransition("evidence", "scanning", "available"), true);
  });
});

describe("privacy invariants", () => {
  it("evaluates all PRIVACY_INVARIANTS to true", () => {
    const results = d.evaluatePrivacyInvariants();
    for (const [id, ok] of Object.entries(results)) {
      assert.equal(ok, true, id);
    }
  });

  it("P-EVIDENCE-PUBLIC: evidence never listable", () => {
    for (const s of d.valuesOf(d.EVIDENCE_STATUS)) {
      assert.equal(d.isPubliclyListable("evidence", s), false);
    }
  });

  it("P-VIS-EVIDENCE: public/community visibility forbidden", () => {
    assert.equal(d.isVisibilityAllowed("evidence", "public"), false);
    assert.equal(d.isVisibilityAllowed("evidence", "community"), false);
    assert.equal(d.isVisibilityAllowed("evidence", "restricted"), true);
  });

  it("P-STORY-PUBLIC-STATUS: only published is public listable", () => {
    assert.equal(d.isPubliclyListable("story", "published"), true);
    assert.equal(d.isPubliclyListable("story", "pending"), false);
    assert.equal(d.isPubliclyListable("story", "rejected"), false);
    assert.equal(d.isPubliclyListable("story", "deleted"), false);
    assert.equal(d.isPubliclyListable("story", "draft"), false);
  });

  it("notifications are not publicly listable", () => {
    for (const s of d.valuesOf(d.NOTIFICATION_STATUS)) {
      assert.equal(d.isPubliclyListable("notification", s), false);
    }
  });
});

describe("deletion cascade rules", () => {
  it("D-USER-CASCADE lists expected child effects", () => {
    const plan = d.planDeletion("user_account", null, { trigger: "account_delete" });
    assert.equal(plan.allowed, true);
    const children = plan.effects.map((e) => e.child);
    assert.ok(children.includes("story"));
    assert.ok(children.includes("vent"));
    assert.ok(children.includes("insider_signal"));
    assert.ok(children.includes("evidence"));
    assert.ok(children.includes("notification"));
  });

  it("D-STORY-CASCADE schedules evidence purge and closes moderation", () => {
    const plan = d.planDeletion("story", "deleted");
    assert.equal(plan.allowed, true);
    const actions = plan.effects.map((e) => `${e.child}:${e.action}`);
    assert.ok(actions.includes("evidence:schedule_purge"));
    assert.ok(actions.includes("moderation_case:close"));
    assert.ok(actions.includes("outcome:hide"));
  });

  it("D-SIGNAL-CASCADE schedules evidence purge unless legal hold path", () => {
    const plan = d.planDeletion("insider_signal", "deleted");
    assert.equal(plan.allowed, true);
    assert.ok(
      plan.effects.some(
        (e) => e.child === "evidence" && e.action === "schedule_purge_unless_legal_hold"
      )
    );
  });

  it("legal hold blocks deletion plan", () => {
    const plan = d.planDeletion("insider_signal", "legal_hold");
    assert.equal(plan.allowed, false);
    assert.match(plan.reason, /legal.?hold/i);
  });

  it("published story can plan transition to deleted with cascades", () => {
    const plan = d.planDeletion("story", "published");
    assert.equal(plan.allowed, true);
    assert.equal(plan.toStatus, "deleted");
    assert.ok(plan.effects.length >= 1);
  });

  it("cascade registry has required ids", () => {
    const ids = d.DELETION_CASCADES.map((c) => c.id);
    assert.ok(ids.includes("D-USER-CASCADE"));
    assert.ok(ids.includes("D-STORY-CASCADE"));
    assert.ok(ids.includes("D-SIGNAL-CASCADE"));
    assert.ok(ids.includes("D-TOPIC-CASCADE"));
  });
});

describe("retention rules structured", () => {
  it("returns purge windows for core entities", () => {
    assert.equal(d.getRetentionRule("story").purgeDays, 30);
    assert.equal(d.getRetentionRule("evidence").purgeDays, 90);
    assert.equal(d.getRetentionRule("evidence").legalHoldBlocksPurge, true);
    assert.equal(d.getRetentionRule("discussion_reply").purgeDays, 14);
  });
});

describe("publication intents & outcomes", () => {
  it("default desired response by intent", () => {
    assert.equal(d.defaultDesiredResponse("vent"), "empathy");
    assert.equal(d.defaultDesiredResponse("story"), "witness");
    assert.equal(d.defaultDesiredResponse("advice_request"), "advice");
  });

  it("maps foundNewJob boolean to outcome enum", () => {
    assert.equal(d.outcomeFromFoundNewJob(true), "found");
    assert.equal(d.outcomeFromFoundNewJob(false), "searching");
  });

  it("moderation action maps to content status (no free-form)", () => {
    assert.equal(d.moderationActionToContentStatus("approve"), "published");
    assert.equal(d.moderationActionToContentStatus("reject"), "rejected");
    assert.throws(() => d.moderationActionToContentStatus("maybe"), {
      code: "INVALID_MODERATION_ACTION"
    });
  });
});

describe("legacy gap documentation", () => {
  it("legacy story statuses are a subset of contract", () => {
    for (const s of d.LEGACY_STORY_STATUSES) {
      assert.equal(d.isValidStatus("story", s), true);
    }
    assert.ok(d.LEGACY_GAPS.story.contractExtra.includes("draft"));
    assert.ok(d.LEGACY_GAPS.story.contractExtra.includes("deleted"));
  });
});

describe("entity & relationship coverage", () => {
  const required = [
    "publication_intent",
    "story",
    "vent",
    "insider_signal",
    "evidence",
    "news",
    "discussion_topic",
    "discussion_reply",
    "resource",
    "opportunity",
    "cohort",
    "notification",
    "moderation_case",
    "appeal",
    "outcome"
  ];

  it("ENTITY enum includes complete-product set", () => {
    const values = d.valuesOf(d.ENTITY);
    for (const name of required) {
      assert.ok(values.includes(name), name);
    }
  });

  it("lifecycle entities have transitions", () => {
    const withStatus = required.filter((e) => e !== "publication_intent");
    for (const e of withStatus) {
      assert.ok(d.TRANSITIONS[e], `transitions for ${e}`);
      assert.ok(d.STATUS_ENUMS[e], `status enum for ${e}`);
    }
  });

  it("API boundaries reference story and forum modules", () => {
    const modules = d.API_BOUNDARIES.map((b) => b.module);
    assert.ok(modules.some((m) => m.includes("stories")));
    assert.ok(modules.some((m) => m.includes("forum")));
    assert.ok(modules.some((m) => m.includes("auth")));
  });
});
