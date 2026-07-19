/**
 * Insider signals + evidence privacy / lifecycle unit tests (in-memory).
 * Run: npm run test:insider
 *
 * Covers:
 * - P-EVIDENCE-PUBLIC: evidence never listable on public surface
 * - Public summary has verificationLevel, no authors/evidence blobs
 * - Status transitions + legal_hold blocks delete
 * - Metadata stripping / redaction hooks
 * - Two reports linked without exposing authors
 * - Evidence access is audited
 *
 * Bead: aitj-z8q.9
 */

"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const insider = require("../lib/insider");
const domain = require("../lib/domain-contract");
const { loadMigrations } = require("../lib/migrate");

const mem = { useMemory: true };

beforeEach(() => {
  insider.memoryReset();
});

describe("migration 005 present", () => {
  it("loads 005_insider_signals", () => {
    const migrations = loadMigrations();
    const m = migrations.find((x) => x.version === "005");
    assert.ok(m, "005 migration missing");
    assert.equal(m.name, "insider_signals");
    assert.equal(typeof m.up, "function");
  });
});

describe("P-EVIDENCE-PUBLIC — evidence never publicly listable", () => {
  it("contract + helper agree for every evidence status", () => {
    assert.equal(insider.evidenceNeverPubliclyListable(), true);
    for (const s of domain.valuesOf(domain.EVIDENCE_STATUS)) {
      assert.equal(domain.isPubliclyListable("evidence", s), false, s);
    }
  });

  it("public list never includes evidence entities or blob fields", async () => {
    const a = await insider.createSignal(
      {
        companyName: "Acme AI",
        rolesAffected: ["support agent"],
        automationType: "llm_chatbot",
        eventDate: "2026-03-01",
        bodyRestricted: "secret internal detail",
        authorId: "user_alice"
      },
      mem
    );
    await insider.transitionSignal(a.id, "submitted", mem);
    await insider.transitionSignal(a.id, "under_review", mem);
    await insider.transitionSignal(
      a.id,
      "published_summary",
      { ...mem, summaryPublic: "Acme automated support roles." }
    );
    await insider.attachEvidence(
      a.id,
      {
        filenameOriginal: "memo.pdf",
        contentType: "application/pdf",
        sizeBytes: 1200,
        metadata: { gps: { lat: 1 }, title: "ok" },
        bodyRef: "blob://raw-never-public"
      },
      mem
    );

    const { signals } = await insider.listPublicSummaries({}, mem);
    assert.equal(signals.length, 1);
    const pub = signals[0];
    assert.equal(pub.verificationLevel, "uncorroborated");
    assert.ok(pub.summary);
    assert.equal(pub.authorId, undefined);
    assert.equal(pub.bodyRestricted, undefined);
    assert.equal(pub.evidence, undefined);
    assert.equal(pub.storageKey, undefined);
    assert.equal(pub.trackingCode, undefined);
    insider.assertPublicSafe(pub);
    assert.throws(
      () =>
        insider.assertPublicSafe({
          id: "x",
          authorId: "leaked"
        }),
      { code: "PUBLIC_LEAK" }
    );
  });

  it("getPublicSummary returns null for non-published statuses", async () => {
    const s = await insider.createSignal(
      { companyName: "Beta Corp", rolesAffected: ["analyst"] },
      mem
    );
    assert.equal(await insider.getPublicSummary(s.id, mem), null);
    await insider.transitionSignal(s.id, "submitted", mem);
    assert.equal(await insider.getPublicSummary(s.id, mem), null);
  });
});

describe("company-linked report fields", () => {
  it("stores roles, automation type, date, confidence, verification", async () => {
    const s = await insider.createSignal(
      {
        companySlug: "globex",
        companyName: "Globex",
        rolesAffected: ["QA", "support"],
        automationType: "rpa",
        eventDate: "2026-01-15",
        confidence: 0.72,
        verificationLevel: "single_source",
        bodyRestricted: "internal only"
      },
      mem
    );
    assert.equal(s.companySlug, "globex");
    assert.deepEqual(s.rolesAffected, ["QA", "support"]);
    assert.equal(s.automationType, "rpa");
    assert.equal(s.eventDate, "2026-01-15");
    assert.equal(s.confidence, 0.72);
    assert.equal(s.verificationLevel, "single_source");
    assert.equal(s.status, "draft");
    assert.ok(s.bodyRestricted);
  });
});

describe("status transitions + legal hold + retention", () => {
  it("draft → submitted → under_review → published_summary", async () => {
    const s = await insider.createSignal({ companyName: "Co" }, mem);
    let cur = await insider.transitionSignal(s.id, "submitted", mem);
    assert.equal(cur.status, "submitted");
    assert.ok(cur.submittedAt);
    cur = await insider.transitionSignal(cur.id, "under_review", mem);
    assert.equal(cur.status, "under_review");
    cur = await insider.transitionSignal(cur.id, "published_summary", {
      ...mem,
      summaryPublic: "Public summary text",
      verificationLevel: "multi_source"
    });
    assert.equal(cur.status, "published_summary");
    assert.equal(cur.verificationLevel, "multi_source");
    assert.ok(cur.publishedAt);
    const pub = await insider.getPublicSummary(cur.id, mem);
    assert.equal(pub.verificationLevel, "multi_source");
    assert.equal(pub.summary, "Public summary text");
  });

  it("legal_hold blocks delete (D-LEGAL-HOLD)", async () => {
    const s = await insider.createSignal({ companyName: "HoldCo" }, mem);
    await insider.transitionSignal(s.id, "submitted", mem);
    await insider.transitionSignal(s.id, "under_review", mem);
    const held = await insider.placeLegalHold(s.id, mem);
    assert.equal(held.status, "legal_hold");

    await assert.rejects(
      () => insider.softDeleteSignal(s.id, mem),
      { code: "LEGAL_HOLD" }
    );
    await assert.rejects(
      () => insider.transitionSignal(s.id, "deleted", mem),
      (err) => err.code === "ILLEGAL_TRANSITION" || err.code === "LEGAL_HOLD"
    );

    const released = await insider.releaseLegalHold(s.id, "under_review", mem);
    assert.equal(released.status, "under_review");
  });

  it("soft delete schedules purge_after from retention rule", async () => {
    const s = await insider.createSignal({ companyName: "DelCo" }, mem);
    await insider.transitionSignal(s.id, "submitted", mem);
    // submitted → deleted allowed
    const del = await insider.softDeleteSignal(s.id, mem);
    assert.equal(del.status, "deleted");
    assert.ok(del.deletedAt);
    assert.ok(del.purgeAfter);
    const rule = domain.getRetentionRule("insider_signal");
    assert.equal(rule.purgeDays, 30);
    assert.equal(rule.legalHoldBlocksPurge, true);
  });

  it("rejects illegal free-form status via domain assert", () => {
    assert.throws(
      () => domain.assertCanTransition("insider_signal", "draft", "live"),
      { code: "INVALID_STATUS" }
    );
  });
});

describe("metadata stripping / redaction hooks", () => {
  it("stripMetadata removes GPS/EXIF/PII keys", () => {
    const { stripped, removedKeys } = insider.stripMetadata({
      title: "doc",
      gps: { lat: 12, lon: 34 },
      exif: { Make: "Canon" },
      email: "a@b.com",
      safe: "keep"
    });
    assert.equal(stripped.title, "doc");
    assert.equal(stripped.safe, "keep");
    assert.equal(stripped.gps, undefined);
    assert.equal(stripped.exif, undefined);
    assert.equal(stripped.email, undefined);
    assert.ok(removedKeys.includes("gps") || removedKeys.includes("email"));
  });

  it("attachEvidence strips metadata and redacts filename", async () => {
    const s = await insider.createSignal({ companyName: "MetaCo" }, mem);
    const result = await insider.attachEvidence(
      s.id,
      {
        filenameOriginal: "John_Doe_SSN_scan.pdf",
        contentType: "application/pdf",
        sizeBytes: 99,
        metadata: {
          gpsLatitude: 40.7,
          author: "John Doe",
          pages: 3
        }
      },
      mem
    );
    assert.equal(result.evidence.metadataStripped, true);
    assert.equal(result.evidence.metadata.gpsLatitude, undefined);
    assert.equal(result.evidence.metadata.author, undefined);
    assert.equal(result.evidence.metadata.pages, 3);
    assert.match(result.evidence.filenameStored, /^redacted_[a-f0-9]+\.pdf$/);
    assert.ok(result.removedKeys.length >= 1);
    // staff meta without includeStorageKey has no storageKey
    assert.equal(result.evidence.storageKey, undefined);
  });

  it("redact transition clears sensitive presentation", async () => {
    const s = await insider.createSignal({ companyName: "RedCo" }, mem);
    const { evidence } = await insider.attachEvidence(
      s.id,
      { filenameOriginal: "secret.docx", metadata: { phone: "555", label: "x" } },
      mem
    );
    // uploaded → scanning → available → redacted
    await insider.transitionEvidence(evidence.id, "scanning", { ...mem, actorId: "admin" });
    await insider.transitionEvidence(evidence.id, "available", { ...mem, actorId: "admin" });
    const red = await insider.transitionEvidence(evidence.id, "redacted", {
      ...mem,
      actorId: "admin",
      redactionNotes: "PII removed"
    });
    assert.equal(red.status, "redacted");
    assert.equal(red.redactionNotes, "PII removed");
  });
});

describe("evidence access audited; raw never public", () => {
  it("accessEvidence writes access log", async () => {
    const s = await insider.createSignal({ companyName: "AudCo" }, mem);
    const { evidence } = await insider.attachEvidence(
      s.id,
      { filenameOriginal: "a.bin", sizeBytes: 10 },
      mem
    );
    await insider.accessEvidence(
      evidence.id,
      { actorId: "mod_1", action: "view", reason: "review", ip: "1.2.3.4" },
      mem
    );
    const log = await insider.listEvidenceAccessLog(evidence.id, {}, mem);
    assert.ok(log.length >= 2); // upload + view
    const view = log.find((e) => e.action === "view");
    assert.ok(view);
    assert.equal(view.actorId, "mod_1");
    assert.equal(view.ip, "1.2.3.4");
  });

  it("purged evidence cannot be accessed", async () => {
    const s = await insider.createSignal({ companyName: "PurgeCo" }, mem);
    const { evidence } = await insider.attachEvidence(
      s.id,
      { filenameOriginal: "x.bin" },
      mem
    );
    await insider.transitionEvidence(evidence.id, "purged", { ...mem, actorId: "admin" });
    await assert.rejects(
      () =>
        insider.accessEvidence(
          evidence.id,
          { actorId: "admin", action: "view" },
          mem
        ),
      { code: "PURGED" }
    );
  });
});

describe("link two independent reports without exposing authors", () => {
  it("links peer ids only; public summary shows count not authors", async () => {
    const a = await insider.createSignal(
      {
        companyName: "LinkCo",
        authorId: "author_a",
        rolesAffected: ["ops"]
      },
      mem
    );
    const b = await insider.createSignal(
      {
        companyName: "LinkCo",
        authorId: "author_b",
        rolesAffected: ["ops"]
      },
      mem
    );
    assert.notEqual(a.authorId, b.authorId);

    const { link, created } = await insider.linkSignals(
      a.id,
      b.id,
      { linkedBy: "mod_1", reason: "same layoff wave" },
      mem
    );
    assert.equal(created, true);
    assert.ok(link.signalIdA);
    assert.ok(link.signalIdB);
    // ordered pair
    assert.ok(link.signalIdA < link.signalIdB);

    const peers = await insider.listLinkedSignals(a.id, mem);
    assert.equal(peers.length, 1);
    assert.equal(peers[0].peerSignalId, b.id);
    assert.equal(peers[0].authorId, undefined);
    assert.equal(peers[0].author_id, undefined);

    // Publish both; public summaries show linkedReportCount, not authors
    for (const id of [a.id, b.id]) {
      await insider.transitionSignal(id, "submitted", mem);
      await insider.transitionSignal(id, "under_review", mem);
      await insider.transitionSignal(id, "published_summary", {
        ...mem,
        summaryPublic: "Linked report summary"
      });
    }
    const pubA = await insider.getPublicSummary(a.id, mem);
    assert.equal(pubA.linkedReportCount, 1);
    assert.equal(pubA.authorId, undefined);
    insider.assertPublicSafe(pubA);

    // Idempotent second link
    const again = await insider.linkSignals(b.id, a.id, { linkedBy: "mod_1" }, mem);
    assert.equal(again.created, false);
  });
});

describe("domain-contract status machine coverage for signals/evidence", () => {
  it("evidence has empty public listable set", () => {
    assert.deepEqual(domain.PUBLIC_LISTABLE_STATUSES.evidence, []);
  });

  it("insider public listable is published_summary only", () => {
    assert.deepEqual(domain.PUBLIC_LISTABLE_STATUSES.insider_signal, [
      "published_summary"
    ]);
  });

  it("verification level is explicit enum", () => {
    for (const v of domain.valuesOf(domain.VERIFICATION_LEVEL)) {
      assert.equal(typeof v, "string");
    }
  });
});
