/**
 * Resources & opportunities catalog API (aitj-z8q.12).
 *
 * Public list/match, user save/review/report, and (via admin mount)
 * trusted curator supply management.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const ctx = require("../lib/context");
const {
  RESOURCE_STATUS,
  OPPORTUNITY_STATUS,
  RESOURCE_VERIFICATION_STATE
} = require("../lib/domain-contract");
const { customAlphabet } = require("nanoid");

const resourceIdGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 12);

function publicResourceFields(r) {
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    provider: r.provider,
    region: r.region,
    language: r.language,
    url: r.url,
    summary: r.summary,
    cost: r.cost,
    eligibility: r.eligibility,
    source: r.source,
    status: r.status,
    verificationState: r.verificationState,
    lastVerifiedAt: r.lastVerifiedAt,
    linkStatus: r.linkStatus,
    flagged: r.verificationState === "broken" || r.verificationState === "stale" || r.linkStatus === "broken",
    savedAt: r.savedAt || undefined
  };
}

function publicOpportunityFields(o) {
  if (!o) return null;
  return {
    id: o.id,
    type: o.type,
    title: o.title,
    provider: o.provider,
    region: o.region,
    language: o.language,
    url: o.url,
    summary: o.summary,
    cost: o.cost,
    eligibility: o.eligibility,
    source: o.source,
    status: o.status,
    verificationState: o.verificationState,
    lastVerifiedAt: o.lastVerifiedAt,
    linkStatus: o.linkStatus,
    profession: o.profession,
    closesAt: o.closesAt,
    flagged: o.verificationState === "broken" || o.verificationState === "stale" || o.linkStatus === "broken"
  };
}

function filterByCountry(rows, country) {
  return rows.filter((x) => x.region === "global" || x.region === country);
}

// ── Public resources ────────────────────────────────────────────────────────

router.get("/api/resources", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const type = ctx.sanitizeText(req.query.type || "").toLowerCase();
  const verification = ctx.sanitizeText(req.query.verification || "").toLowerCase();
  const language = req.query.language ? ctx.normalizeLanguage(req.query.language) : null;
  const includeFlagged = String(req.query.includeFlagged || "true").toLowerCase() !== "false";
  let rows = await ctx.storageGetResources();
  rows = filterByCountry(rows, country);
  if (type) rows = rows.filter((r) => String(r.type).toLowerCase() === type);
  if (verification) rows = rows.filter((r) => r.verificationState === verification);
  if (language) rows = rows.filter((r) => r.language === language);
  if (!includeFlagged) {
    rows = rows.filter(
      (r) =>
        r.verificationState !== RESOURCE_VERIFICATION_STATE.BROKEN &&
        r.linkStatus !== "broken"
    );
  }
  res.json({
    country,
    resources: rows.map(publicResourceFields)
  });
});

router.get("/api/resources/match", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const profession = ctx.sanitizeText(req.query.profession || "").toLowerCase();
  const months = Number(req.query.months || 0);
  const rows = await ctx.storageGetResources();
  const matched = rows.filter((r) => {
    const regionOk = r.region === "global" || r.region === country;
    const professionOk =
      !profession || `${r.title} ${r.summary} ${r.type} ${r.eligibility}`.toLowerCase().includes(profession);
    const urgencyBoost = months >= 6 ? r.type === "jobs" || r.type === "reskilling" : true;
    const notBroken = r.verificationState !== "broken" && r.linkStatus !== "broken";
    return regionOk && professionOk && urgencyBoost && notBroken;
  });
  res.json({
    country,
    profession,
    months,
    resources: matched.map(publicResourceFields)
  });
});

router.get("/api/resources/saved", requireAuth, async (req, res) => {
  const saved = await ctx.storageGetSavedResources(req.user.id);
  res.json({ resources: saved.map(publicResourceFields) });
});

router.get("/api/resources/:id", async (req, res) => {
  const row = await ctx.storageGetResourceById(req.params.id);
  if (!row) {
    res.status(404).json({ message: "Resource not found" });
    return;
  }
  const reviews = await ctx.storageGetResourceReviews(row.id, { limit: 20 });
  res.json({
    resource: publicResourceFields(row),
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      createdAt: r.createdAt
    }))
  });
});

router.post("/api/resources/:id/save", requireAuth, async (req, res) => {
  const result = await ctx.storageSaveResource(req.user.id, req.params.id);
  if (!result.ok) {
    res.status(404).json({ message: "Resource not found" });
    return;
  }
  await ctx.storageAudit({
    action: "resource.save",
    actorId: req.user.id,
    targetType: "resource",
    targetId: req.params.id,
    metadata: { created: result.created },
    ip: req.ip
  });
  res.status(result.created ? 201 : 200).json({ ok: true, ...result });
});

router.delete("/api/resources/:id/save", requireAuth, async (req, res) => {
  const removed = await ctx.storageUnsaveResource(req.user.id, req.params.id);
  if (removed) {
    await ctx.storageAudit({
      action: "resource.unsave",
      actorId: req.user.id,
      targetType: "resource",
      targetId: req.params.id,
      metadata: {},
      ip: req.ip
    });
  }
  res.json({ ok: true, removed });
});

router.get("/api/resources/:id/reviews", async (req, res) => {
  const resource = await ctx.storageGetResourceById(req.params.id);
  if (!resource) {
    res.status(404).json({ message: "Resource not found" });
    return;
  }
  const reviews = await ctx.storageGetResourceReviews(req.params.id, {
    limit: Number(req.query.limit || 50)
  });
  res.json({
    resourceId: req.params.id,
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      body: r.body,
      createdAt: r.createdAt
    }))
  });
});

router.post("/api/resources/:id/reviews", requireAuth, async (req, res) => {
  const result = await ctx.storageUpsertResourceReview({
    userId: req.user.id,
    resourceId: req.params.id,
    rating: req.body?.rating,
    body: ctx.sanitizeText(req.body?.body || "")
  });
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 422;
    res.status(status).json({ message: result.reason === "not_found" ? "Resource not found" : "Invalid rating (1-5)" });
    return;
  }
  await ctx.storageAudit({
    action: "resource.review",
    actorId: req.user.id,
    targetType: "resource",
    targetId: req.params.id,
    metadata: { rating: result.review.rating },
    ip: req.ip
  });
  res.status(201).json({ ok: true, review: result.review });
});

router.post("/api/resources/:id/report", async (req, res) => {
  const reason = ctx.sanitizeText(req.body?.reason || "");
  const details = ctx.sanitizeText(req.body?.details || "");
  if (reason.length < 3) {
    res.status(422).json({ message: "Reason is required (min 3 chars)" });
    return;
  }
  const result = await ctx.storageInsertResourceReport({
    userId: req.user?.id || null,
    resourceId: req.params.id,
    reason,
    details
  });
  if (!result.ok) {
    res.status(result.reason === "not_found" ? 404 : 422).json({
      message: result.reason === "not_found" ? "Resource not found" : "Invalid report"
    });
    return;
  }
  await ctx.storageAudit({
    action: "resource.report",
    actorId: req.user?.id || "anonymous",
    targetType: "resource",
    targetId: req.params.id,
    metadata: { reportId: result.report.id, reason },
    ip: req.ip
  });
  res.status(201).json({ ok: true, reportId: result.report.id, status: result.report.status });
});

// ── Public opportunities (OPPORTUNITY_STATUS) ───────────────────────────────

router.get("/api/opportunities", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const profession = ctx.sanitizeText(req.query.profession || "").toLowerCase();
  let rows = await ctx.storageGetOpportunities();
  rows = filterByCountry(rows, country);
  if (profession) {
    rows = rows.filter((o) =>
      `${o.title} ${o.summary} ${o.profession} ${o.eligibility}`.toLowerCase().includes(profession)
    );
  }
  res.json({
    country,
    opportunities: rows.map(publicOpportunityFields)
  });
});

router.get("/api/opportunities/:id", async (req, res) => {
  const row = await ctx.storageGetOpportunityById(req.params.id);
  if (!row) {
    res.status(404).json({ message: "Opportunity not found" });
    return;
  }
  res.json({ opportunity: publicOpportunityFields(row) });
});

// ── Admin / trusted curator CRUD (mounted under /api/admin) ─────────────────

function requireTrustedOrAdmin(req, res, next) {
  if (ctx.hasAdminToken(req) || ctx.hasTrustedCuratorRole(req.user)) {
    next();
    return;
  }
  res.status(401).json({ message: "Unauthorized" });
}

const adminRouter = express.Router();

adminRouter.use(requireTrustedOrAdmin);

adminRouter.get("/resources", async (req, res) => {
  const rows = await ctx.storageGetResources({ includeNonPublic: true });
  res.json({ resources: rows });
});

// Static path segments before /resources/:id
adminRouter.get("/resources/reports", async (req, res) => {
  const reports = await ctx.storageGetResourceReports({
    status: req.query.status ? String(req.query.status) : undefined,
    limit: Number(req.query.limit || 50)
  });
  res.json({ reports });
});

adminRouter.post("/resources/reports/:id/resolve", async (req, res) => {
  const report = await ctx.storageResolveResourceReport(req.params.id, {
    status: req.body?.status || "resolved",
    resolvedBy: req.user?.id || "admin-token"
  });
  if (!report) {
    res.status(404).json({ message: "Report not found" });
    return;
  }
  res.json({ ok: true, report });
});

adminRouter.post("/resources/link-check", async (req, res) => {
  const jobs = require("../lib/jobs");
  const resourceId = req.body?.resourceId || req.body?.resource_id || null;
  try {
    const { job, created } = await jobs.enqueue(
      {
        type: "resource.link_check",
        payload: {
          resourceId,
          limit: Number(req.body?.limit || 50),
          reason: req.body?.reason || "admin"
        },
        idempotencyKey: resourceId
          ? `resource.link_check:${resourceId}:${new Date().toISOString().slice(0, 13)}`
          : `resource.link_check:batch:${new Date().toISOString().slice(0, 13)}`,
        maxAttempts: 3,
        timeoutMs: 120_000
      },
      {
        usePostgres: ctx.usePostgres,
        getPool: () => ctx.getPgPool(),
        useMemory: !ctx.usePostgres
      }
    );
    await ctx.storageAudit({
      action: "resource.link_check.enqueue",
      actorId: req.user?.id || "admin-token",
      targetType: "job",
      targetId: job.id,
      metadata: { resourceId, created },
      ip: req.ip
    });
    res.status(created ? 201 : 200).json({ ok: true, created, job });
  } catch (err) {
    console.error("enqueue resource.link_check failed:", err);
    res.status(500).json({ message: "Failed to enqueue link check" });
  }
});

adminRouter.post("/resources", async (req, res) => {
  try {
    const id = ctx.sanitizeText(req.body?.id || "") || `res-${resourceIdGen()}`;
    const row = await ctx.storageUpsertResource({
      id,
      type: ctx.sanitizeText(req.body?.type || "reskilling"),
      title: ctx.sanitizeText(req.body?.title || ""),
      provider: ctx.sanitizeText(req.body?.provider || ""),
      region: ctx.normalizeCountry(req.body?.region || "global"),
      language: ctx.normalizeLanguage(req.body?.language || "en"),
      url: String(req.body?.url || "").trim(),
      summary: ctx.sanitizeText(req.body?.summary || ""),
      cost: req.body?.cost,
      eligibility: ctx.sanitizeText(req.body?.eligibility || ""),
      source: ctx.sanitizeText(req.body?.source || req.body?.url || ""),
      status: req.body?.status || RESOURCE_STATUS.PUBLISHED,
      verificationState: req.body?.verificationState || RESOURCE_VERIFICATION_STATE.UNVERIFIED,
      lastVerifiedAt: req.body?.lastVerifiedAt || null,
      createdBy: req.user?.id || "admin-token"
    });
    await ctx.storageAudit({
      action: "resource.create",
      actorId: req.user?.id || "admin-token",
      targetType: "resource",
      targetId: row.id,
      metadata: { title: row.title },
      ip: req.ip
    });
    res.status(201).json({ ok: true, resource: row });
  } catch (err) {
    const status = err.code === "BANNED_RESOURCE_URL" || err.code === "INVALID_STATUS" || err.code === "VALIDATION" ? 422 : 500;
    res.status(status).json({ message: err.message || "Failed to create resource" });
  }
});

adminRouter.patch("/resources/:id", async (req, res) => {
  try {
    const existing = await ctx.storageGetResourceById(req.params.id, { includeNonPublic: true });
    if (!existing) {
      res.status(404).json({ message: "Resource not found" });
      return;
    }
    const patch = { ...existing, ...req.body, id: existing.id };
    if (req.body?.region) patch.region = ctx.normalizeCountry(req.body.region);
    if (req.body?.language) patch.language = ctx.normalizeLanguage(req.body.language);
    if (req.body?.title) patch.title = ctx.sanitizeText(req.body.title);
    if (req.body?.provider != null) patch.provider = ctx.sanitizeText(req.body.provider);
    if (req.body?.summary != null) patch.summary = ctx.sanitizeText(req.body.summary);
    if (req.body?.eligibility != null) patch.eligibility = ctx.sanitizeText(req.body.eligibility);
    if (req.body?.source != null) patch.source = ctx.sanitizeText(req.body.source);
    if (req.body?.url != null) patch.url = String(req.body.url).trim();
    const row = await ctx.storageUpsertResource(patch);
    await ctx.storageAudit({
      action: "resource.update",
      actorId: req.user?.id || "admin-token",
      targetType: "resource",
      targetId: row.id,
      metadata: { fields: Object.keys(req.body || {}) },
      ip: req.ip
    });
    res.json({ ok: true, resource: row });
  } catch (err) {
    const status = err.code === "BANNED_RESOURCE_URL" || err.code === "INVALID_STATUS" || err.code === "VALIDATION" ? 422 : 500;
    res.status(status).json({ message: err.message || "Failed to update resource" });
  }
});

adminRouter.post("/resources/:id/verify", async (req, res) => {
  const existing = await ctx.storageGetResourceById(req.params.id, { includeNonPublic: true });
  if (!existing) {
    res.status(404).json({ message: "Resource not found" });
    return;
  }
  const now = new Date().toISOString();
  const row = await ctx.storageUpsertResource({
    ...existing,
    verificationState: RESOURCE_VERIFICATION_STATE.VERIFIED,
    lastVerifiedAt: now,
    linkStatus: existing.linkStatus === "broken" ? "unknown" : existing.linkStatus,
    flaggedReason: ""
  });
  await ctx.storageAudit({
    action: "resource.verify",
    actorId: req.user?.id || "admin-token",
    targetType: "resource",
    targetId: row.id,
    metadata: { lastVerifiedAt: now },
    ip: req.ip
  });
  res.json({ ok: true, resource: row });
});

adminRouter.delete("/resources/:id", async (req, res) => {
  // Destructive: require confirm:true (body) or ?confirm=true
  const confirmed =
    req.body?.confirm === true ||
    String(req.query.confirm || "").toLowerCase() === "true";
  if (!confirmed) {
    res.status(422).json({
      message: "Destructive action requires confirm: true",
      code: "CONFIRM_REQUIRED"
    });
    return;
  }
  const hard = String(req.query.hard || "false").toLowerCase() === "true";
  const removed = await ctx.storageDeleteResource(req.params.id, { hard });
  if (!removed) {
    res.status(404).json({ message: "Resource not found" });
    return;
  }
  await ctx.storageAudit({
    action: hard ? "resource.hard_delete" : "resource.delete",
    actorId: req.user?.id || "admin-token",
    targetType: "resource",
    targetId: req.params.id,
    metadata: { hard, confirmed: true },
    ip: req.ip
  });
  res.json({ ok: true });
});

adminRouter.get("/opportunities", async (req, res) => {
  const rows = await ctx.storageGetOpportunities({ includeNonPublic: true });
  res.json({ opportunities: rows });
});

adminRouter.post("/opportunities", async (req, res) => {
  try {
    const id = ctx.sanitizeText(req.body?.id || "") || `opp-${resourceIdGen()}`;
    const row = await ctx.storageUpsertOpportunity({
      id,
      type: ctx.sanitizeText(req.body?.type || "job"),
      title: ctx.sanitizeText(req.body?.title || ""),
      provider: ctx.sanitizeText(req.body?.provider || ""),
      region: ctx.normalizeCountry(req.body?.region || "global"),
      language: ctx.normalizeLanguage(req.body?.language || "en"),
      url: String(req.body?.url || "").trim(),
      summary: ctx.sanitizeText(req.body?.summary || ""),
      cost: req.body?.cost,
      eligibility: ctx.sanitizeText(req.body?.eligibility || ""),
      source: ctx.sanitizeText(req.body?.source || req.body?.url || ""),
      status: req.body?.status || OPPORTUNITY_STATUS.OPEN,
      verificationState: req.body?.verificationState || RESOURCE_VERIFICATION_STATE.UNVERIFIED,
      profession: ctx.sanitizeText(req.body?.profession || ""),
      closesAt: req.body?.closesAt || null,
      createdBy: req.user?.id || "admin-token"
    });
    await ctx.storageAudit({
      action: "opportunity.create",
      actorId: req.user?.id || "admin-token",
      targetType: "opportunity",
      targetId: row.id,
      metadata: { title: row.title },
      ip: req.ip
    });
    res.status(201).json({ ok: true, opportunity: row });
  } catch (err) {
    const status = err.code === "BANNED_RESOURCE_URL" || err.code === "INVALID_STATUS" || err.code === "VALIDATION" ? 422 : 500;
    res.status(status).json({ message: err.message || "Failed to create opportunity" });
  }
});

adminRouter.patch("/opportunities/:id", async (req, res) => {
  try {
    const existing = await ctx.storageGetOpportunityById(req.params.id, { includeNonPublic: true });
    if (!existing) {
      res.status(404).json({ message: "Opportunity not found" });
      return;
    }
    const patch = { ...existing, ...req.body, id: existing.id };
    if (req.body?.title) patch.title = ctx.sanitizeText(req.body.title);
    if (req.body?.region) patch.region = ctx.normalizeCountry(req.body.region);
    if (req.body?.url != null) patch.url = String(req.body.url).trim();
    const row = await ctx.storageUpsertOpportunity(patch);
    await ctx.storageAudit({
      action: "opportunity.update",
      actorId: req.user?.id || "admin-token",
      targetType: "opportunity",
      targetId: row.id,
      metadata: { fields: Object.keys(req.body || {}) },
      ip: req.ip
    });
    res.json({ ok: true, opportunity: row });
  } catch (err) {
    const status = err.code === "BANNED_RESOURCE_URL" || err.code === "INVALID_STATUS" || err.code === "VALIDATION" ? 422 : 500;
    res.status(status).json({ message: err.message || "Failed to update opportunity" });
  }
});

adminRouter.delete("/opportunities/:id", async (req, res) => {
  const confirmed =
    req.body?.confirm === true ||
    String(req.query.confirm || "").toLowerCase() === "true";
  if (!confirmed) {
    res.status(422).json({
      message: "Destructive action requires confirm: true",
      code: "CONFIRM_REQUIRED"
    });
    return;
  }
  const hard = String(req.query.hard || "false").toLowerCase() === "true";
  const removed = await ctx.storageDeleteOpportunity(req.params.id, { hard });
  if (!removed) {
    res.status(404).json({ message: "Opportunity not found" });
    return;
  }
  await ctx.storageAudit({
    action: hard ? "opportunity.hard_delete" : "opportunity.delete",
    actorId: req.user?.id || "admin-token",
    targetType: "opportunity",
    targetId: req.params.id,
    metadata: { hard, confirmed: true },
    ip: req.ip
  });
  res.json({ ok: true });
});

module.exports = router;
module.exports.adminRouter = adminRouter;
module.exports.publicResourceFields = publicResourceFields;
module.exports.publicOpportunityFields = publicOpportunityFields;
