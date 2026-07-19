/**
 * Insider signal public + submit routes.
 * Public GET returns summary + verificationLevel only — never raw evidence or authors.
 *
 * Mount: /api/signals
 * Admin review: routes/admin.js under /api/admin/signals*
 *
 * Bead: aitj-z8q.9
 */

"use strict";

const express = require("express");
const router = express.Router();
const insider = require("../lib/insider");
const ctx = require("../lib/context");
const { INSIDER_SIGNAL_STATUS } = require("../lib/domain-contract");

function storageOptions() {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool(),
    useMemory: !ctx.usePostgres
  };
}

function sanitizeBody(body = {}) {
  const out = { ...body };
  if (out.companyName) out.companyName = ctx.sanitizeText(String(out.companyName));
  if (out.company) out.company = ctx.sanitizeText(String(out.company));
  if (out.companySlug) out.companySlug = ctx.sanitizeText(String(out.companySlug));
  if (out.automationType) out.automationType = ctx.sanitizeText(String(out.automationType));
  if (out.bodyRestricted) out.bodyRestricted = ctx.sanitizeText(String(out.bodyRestricted));
  if (out.body) out.body = ctx.sanitizeText(String(out.body));
  if (out.details) out.details = ctx.sanitizeText(String(out.details));
  if (out.summaryPublic) out.summaryPublic = ctx.sanitizeText(String(out.summaryPublic));
  if (Array.isArray(out.rolesAffected)) {
    out.rolesAffected = out.rolesAffected.map((r) => ctx.sanitizeText(String(r)));
  }
  return out;
}

// ── Public: list / get published summaries only ─────────────────────────────

router.get("/", async (req, res) => {
  try {
    const companySlug = req.query.company || req.query.companySlug
      ? ctx.sanitizeText(String(req.query.company || req.query.companySlug))
      : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const result = await insider.listPublicSummaries(
      { companySlug, limit, offset },
      storageOptions()
    );
    for (const s of result.signals) {
      insider.assertPublicSafe(s);
    }
    res.json({
      signals: result.signals,
      total: result.total,
      limit,
      offset
    });
  } catch (err) {
    console.error("list public signals failed:", err);
    res.status(500).json({ message: "Failed to list signals" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const summary = await insider.getPublicSummary(req.params.id, storageOptions());
    if (!summary) {
      // Do not leak existence of non-public signals
      res.status(404).json({ message: "Signal not found" });
      return;
    }
    insider.assertPublicSafe(summary);
    res.json({ signal: summary });
  } catch (err) {
    console.error("get public signal failed:", err);
    res.status(500).json({ message: "Failed to get signal" });
  }
});

// ── Submit (authenticated or anonymous with tracking code) ──────────────────

router.post("/", async (req, res) => {
  try {
    const body = sanitizeBody(req.body || {});
    const v = insider.validateSignalInput(body);
    if (!v.ok) {
      res.status(422).json({ message: "Validation failed", errors: v.errors });
      return;
    }
    const submitNow = Boolean(body.submit);
    const signal = await insider.createSignal(
      {
        ...v.normalized,
        authorId: req.user?.id || null,
        status: INSIDER_SIGNAL_STATUS.DRAFT
      },
      storageOptions()
    );

    let current = signal;
    if (submitNow) {
      current = await insider.transitionSignal(
        signal.id,
        INSIDER_SIGNAL_STATUS.SUBMITTED,
        storageOptions()
      );
    }

    await ctx.storageAudit({
      action: "insider_signal.create",
      actorId: req.user?.id || "anonymous",
      targetType: "insider_signal",
      targetId: current.id,
      metadata: {
        companySlug: current.companySlug,
        status: current.status,
        hasTrackingCode: Boolean(current.trackingCode)
      },
      ip: req.ip
    });

    // Response: never echo bodyRestricted to non-owner; for submitter return tracking + id
    res.status(201).json({
      ok: true,
      id: current.id,
      status: current.status,
      trackingCode: current.trackingCode || undefined,
      companySlug: current.companySlug,
      verificationLevel: current.verificationLevel,
      // Submitter may see their restricted body on create only via this private response
      rolesAffected: current.rolesAffected,
      automationType: current.automationType,
      eventDate: current.eventDate
    });
  } catch (err) {
    if (err.code === "VALIDATION" || err.code === "INVALID_VISIBILITY") {
      res.status(422).json({ message: err.message });
      return;
    }
    console.error("create signal failed:", err);
    res.status(500).json({ message: "Failed to create signal" });
  }
});

router.post("/:id/submit", async (req, res) => {
  try {
    const s = await insider.getSignal(req.params.id, storageOptions());
    if (!s) {
      res.status(404).json({ message: "Signal not found" });
      return;
    }
    // Owner: author match or tracking code
    const tracking = req.body?.trackingCode || req.headers["x-tracking-code"];
    const isAuthor = req.user && s.authorId && req.user.id === s.authorId;
    const isTracker = tracking && s.trackingCode && tracking === s.trackingCode;
    const isStaff = ctx.hasAdminToken(req) || ctx.hasModeratorRole(req.user);
    if (!isAuthor && !isTracker && !isStaff) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }
    const updated = await insider.transitionSignal(
      s.id,
      INSIDER_SIGNAL_STATUS.SUBMITTED,
      storageOptions()
    );
    await ctx.storageAudit({
      action: "insider_signal.submit",
      actorId: req.user?.id || "tracking",
      targetType: "insider_signal",
      targetId: s.id,
      metadata: { from: s.status, to: updated.status },
      ip: req.ip
    });
    res.json({ ok: true, id: updated.id, status: updated.status });
  } catch (err) {
    if (err.code === "ILLEGAL_TRANSITION") {
      res.status(409).json({ message: err.message });
      return;
    }
    console.error("submit signal failed:", err);
    res.status(500).json({ message: "Failed to submit signal" });
  }
});

/**
 * Attach protected evidence. Response is metadata-only (never raw bytes/storage key).
 * Auth: author, tracking code, or staff.
 */
router.post("/:id/evidence", async (req, res) => {
  try {
    const s = await insider.getSignal(req.params.id, storageOptions());
    if (!s) {
      res.status(404).json({ message: "Signal not found" });
      return;
    }
    const tracking = req.body?.trackingCode || req.headers["x-tracking-code"];
    const isAuthor = req.user && s.authorId && req.user.id === s.authorId;
    const isTracker = tracking && s.trackingCode && tracking === s.trackingCode;
    const isStaff = ctx.hasAdminToken(req) || ctx.hasModeratorRole(req.user);
    if (!isAuthor && !isTracker && !isStaff) {
      res.status(403).json({ message: "Forbidden" });
      return;
    }

    const filenameOriginal = ctx.sanitizeText(
      String(req.body?.filename || req.body?.filenameOriginal || "upload.bin")
    );
    const contentType = ctx.sanitizeText(
      String(req.body?.contentType || "application/octet-stream")
    );
    const sizeBytes = Math.max(0, Number(req.body?.sizeBytes || 0));
    // Optional base64 body ref is accepted as opaque storage pointer only — never listed publicly.
    const bodyRef = req.body?.bodyRef ? String(req.body.bodyRef).slice(0, 200) : null;
    const metadata =
      req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    const result = await insider.attachEvidence(
      s.id,
      {
        uploaderId: req.user?.id || null,
        filenameOriginal,
        contentType,
        sizeBytes,
        sha256: req.body?.sha256 ? String(req.body.sha256).slice(0, 64) : null,
        metadata,
        bodyRef
      },
      { ...storageOptions(), actorId: req.user?.id || "anonymous", ip: req.ip }
    );

    // Explicitly no storageKey / bodyRef in response
    const safe = {
      id: result.evidence.id,
      status: result.evidence.status,
      contentType: result.evidence.contentType,
      filenameStored: result.evidence.filenameStored,
      sizeBytes: result.evidence.sizeBytes,
      metadataStripped: result.evidence.metadataStripped,
      removedKeys: result.removedKeys
    };
    insider.assertPublicSafe(safe);

    res.status(201).json({ ok: true, evidence: safe });
  } catch (err) {
    if (err.code === "INVALID_STATUS" || err.code === "INVALID_VISIBILITY") {
      res.status(409).json({ message: err.message });
      return;
    }
    console.error("attach evidence failed:", err);
    res.status(500).json({ message: "Failed to attach evidence" });
  }
});

/**
 * Owner status check via tracking code (no author leak on public surfaces).
 * Does not return bodyRestricted or evidence.
 */
router.get("/:id/status", async (req, res) => {
  try {
    const s = await insider.getSignal(req.params.id, storageOptions());
    if (!s) {
      res.status(404).json({ message: "Signal not found" });
      return;
    }
    const tracking = req.query.trackingCode || req.headers["x-tracking-code"];
    const isAuthor = req.user && s.authorId && req.user.id === s.authorId;
    const isTracker = tracking && s.trackingCode && tracking === s.trackingCode;
    const isStaff = ctx.hasAdminToken(req) || ctx.hasModeratorRole(req.user);

    if (isAuthor || isTracker || isStaff) {
      res.json({
        id: s.id,
        status: s.status,
        verificationLevel: s.verificationLevel,
        companySlug: s.companySlug,
        submittedAt: s.submittedAt,
        publishedAt: s.publishedAt
      });
      return;
    }

    // Unauthenticated strangers only see public summary shape if published
    const summary = await insider.getPublicSummary(s.id, storageOptions());
    if (!summary) {
      res.status(404).json({ message: "Signal not found" });
      return;
    }
    res.json({
      id: summary.id,
      status: summary.status,
      verificationLevel: summary.verificationLevel
    });
  } catch (err) {
    console.error("signal status failed:", err);
    res.status(500).json({ message: "Failed to get status" });
  }
});

// Intentionally NO public evidence list route — P-EVIDENCE-PUBLIC

module.exports = router;
