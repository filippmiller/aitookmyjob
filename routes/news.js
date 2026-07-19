/**
 * Community-grounded news API (aitj-z8q.10).
 *
 * Public list/get/search, user submit + discuss, moderator correct/reject.
 * Admin router mounted under /api/admin.
 */

"use strict";

const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const ctx = require("../lib/context");
const { ingestNews } = require("../lib/news-ingest");
const {
  NEWS_STATUS,
  NEWS_SUBMISSION_STATUS,
  NEWS_SOURCE_STATUS
} = require("../lib/domain-contract");

function publicNewsFields(item) {
  if (!item) return null;
  return {
    id: item.id,
    title: item.title,
    source: item.source,
    url: item.url,
    canonicalUrl: item.canonicalUrl,
    publishedAt: item.publishedAt,
    region: item.region,
    language: item.language,
    summary: item.summary,
    status: item.status,
    relevanceScore: item.relevanceScore,
    entities: item.entities || {
      companies: item.companies || [],
      professions: item.professions || [],
      regions: []
    },
    companies: item.companies || [],
    professions: item.professions || [],
    correctionNote: item.correctionNote || "",
    sourceStatus: item.sourceStatus || NEWS_SOURCE_STATUS.UNKNOWN,
    discussionTopicId: item.discussionTopicId || null,
    discoveredAt: item.discoveredAt,
    updatedAt: item.updatedAt
  };
}

// ── Public list / search ────────────────────────────────────────────────────

router.get("/api/news", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const limit = Math.min(Math.max(Number(req.query.limit || 24), 1), 100);
  const company = ctx.sanitizeText(req.query.company || "");
  const profession = ctx.sanitizeText(req.query.profession || "");
  const q = ctx.sanitizeText(req.query.q || req.query.query || "");
  const news = await ctx.storageGetNews({
    country,
    limit,
    status: NEWS_STATUS.PUBLISHED,
    company,
    profession,
    q
  });
  res.json({
    country,
    company: company || undefined,
    profession: profession || undefined,
    q: q || undefined,
    news: news.map(publicNewsFields)
  });
});

router.get("/api/news/search", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const limit = Math.min(Math.max(Number(req.query.limit || 24), 1), 100);
  const company = ctx.sanitizeText(req.query.company || "");
  const profession = ctx.sanitizeText(req.query.profession || "");
  const q = ctx.sanitizeText(req.query.q || req.query.query || "");
  const news = await ctx.storageGetNews({
    country,
    limit,
    status: NEWS_STATUS.PUBLISHED,
    company,
    profession,
    q
  });
  res.json({
    country,
    filters: { company: company || null, profession: profession || null, q: q || null },
    news: news.map(publicNewsFields)
  });
});

// ── User submit (static path before /:id) ───────────────────────────────────

router.post("/api/news/submit", requireAuth, async (req, res) => {
  if (ctx.isAccountMuted?.(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const url = ctx.sanitizeText(req.body?.url || "");
  if (!url || url.length < 8) {
    res.status(422).json({ message: "A valid article URL is required" });
    return;
  }
  const result = await ctx.storageCreateNewsSubmission({
    url,
    title: ctx.sanitizeText(req.body?.title || ""),
    source: ctx.sanitizeText(req.body?.source || ""),
    summary: ctx.sanitizeText(req.body?.summary || ""),
    commentary: ctx.sanitizeText(req.body?.commentary || req.body?.body || ""),
    companies: req.body?.companies,
    professions: req.body?.professions,
    region: req.body?.region || req.body?.country,
    language: req.body?.language,
    submittedBy: req.user.id
  });
  if (!result.ok) {
    res.status(422).json({ message: result.reason === "invalid_url" ? "Invalid URL" : "Could not submit" });
    return;
  }
  await ctx.storageAudit({
    action: "news.submission.create",
    actorId: req.user.id,
    targetType: "news_submission",
    targetId: result.submission.id,
    metadata: {
      url: result.submission.canonicalUrl,
      companies: result.submission.companies,
      professions: result.submission.professions
    },
    ip: req.ip
  });
  res.status(201).json({
    ok: true,
    submission: {
      id: result.submission.id,
      status: result.submission.status,
      url: result.submission.canonicalUrl,
      companies: result.submission.companies,
      professions: result.submission.professions
    }
  });
});

// ── Detail + discuss ────────────────────────────────────────────────────────

router.get("/api/news/:id", async (req, res) => {
  const item = await ctx.storageGetNewsById(req.params.id);
  if (!item) {
    res.status(404).json({ message: "News item not found" });
    return;
  }
  const discussions = await ctx.storageGetNewsDiscussions(item.id, { limit: 50 });
  res.json({
    news: publicNewsFields(item),
    discussions: discussions.map((d) => ({
      id: d.id,
      body: d.body,
      createdBy: d.createdBy,
      createdAt: d.createdAt
    }))
  });
});

router.get("/api/news/:id/discussions", async (req, res) => {
  const item = await ctx.storageGetNewsById(req.params.id);
  if (!item) {
    res.status(404).json({ message: "News item not found" });
    return;
  }
  const discussions = await ctx.storageGetNewsDiscussions(item.id, {
    limit: Number(req.query.limit || 50)
  });
  res.json({
    newsItemId: item.id,
    discussions: discussions.map((d) => ({
      id: d.id,
      body: d.body,
      createdBy: d.createdBy,
      createdAt: d.createdAt
    }))
  });
});

router.post("/api/news/:id/discussions", requireAuth, async (req, res) => {
  if (ctx.isAccountMuted?.(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const body = ctx.sanitizeText(req.body?.body || req.body?.comment || "");
  if (body.length < 2) {
    res.status(422).json({ message: "Comment body is required" });
    return;
  }
  const result = await ctx.storageInsertNewsDiscussion({
    newsItemId: req.params.id,
    body,
    createdBy: req.user.id
  });
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 422;
    res.status(status).json({
      message: result.reason === "not_found"
        ? "News item not found"
        : result.reason === "rejected_item"
          ? "Cannot discuss a rejected item"
          : "Could not post discussion"
    });
    return;
  }
  await ctx.storageAudit({
    action: "news.discussion.create",
    actorId: req.user.id,
    targetType: "news_discussion",
    targetId: result.discussion.id,
    metadata: { newsItemId: req.params.id },
    ip: req.ip
  });
  res.status(201).json({
    ok: true,
    discussion: {
      id: result.discussion.id,
      newsItemId: result.discussion.newsItemId,
      body: result.discussion.body,
      createdAt: result.discussion.createdAt
    }
  });
});

// ── Admin / moderator ───────────────────────────────────────────────────────

function requireModOrAdmin(req, res, next) {
  if (ctx.hasAdminToken(req) || ctx.hasModeratorRole(req.user)) {
    next();
    return;
  }
  res.status(401).json({ message: "Unauthorized" });
}

const adminRouter = express.Router();

adminRouter.use(requireModOrAdmin);

adminRouter.get("/news/items", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
  const status = ctx.sanitizeText(req.query.status || NEWS_STATUS.PUBLISHED);
  const company = ctx.sanitizeText(req.query.company || "");
  const profession = ctx.sanitizeText(req.query.profession || "");
  const news = await ctx.storageGetNews({
    country,
    limit,
    status,
    company,
    profession,
    includeMerged: String(req.query.includeMerged || "") === "true"
  });
  res.json({ country, status, news });
});

adminRouter.get("/news/submissions", async (req, res) => {
  const status = req.query.status ? ctx.sanitizeText(req.query.status) : NEWS_SUBMISSION_STATUS.PENDING;
  const submissions = await ctx.storageGetNewsSubmissions({
    status: status === "all" ? null : status,
    limit: Number(req.query.limit || 50)
  });
  res.json({ submissions });
});

adminRouter.post("/news/submissions/:id/approve", async (req, res) => {
  const result = await ctx.storageModerateNewsSubmission(req.params.id, "approve", {
    actorId: req.user?.id || "admin-token"
  });
  if (!result.ok) {
    res.status(result.reason === "not_found" ? 404 : 422).json({
      message: result.reason || "Could not approve",
      ...result
    });
    return;
  }
  await ctx.storageAudit({
    action: "news.submission.approve",
    actorId: req.user?.id || "admin-token",
    targetType: "news_submission",
    targetId: req.params.id,
    metadata: { newsItemId: result.newsItemId },
    ip: req.ip
  });
  res.json({ ok: true, ...result });
});

adminRouter.post("/news/submissions/:id/reject", async (req, res) => {
  const result = await ctx.storageModerateNewsSubmission(req.params.id, "reject", {
    actorId: req.user?.id || "admin-token",
    reason: ctx.sanitizeText(req.body?.reason || "")
  });
  if (!result.ok) {
    res.status(result.reason === "not_found" ? 404 : 422).json({
      message: result.reason || "Could not reject",
      ...result
    });
    return;
  }
  await ctx.storageAudit({
    action: "news.submission.reject",
    actorId: req.user?.id || "admin-token",
    targetType: "news_submission",
    targetId: req.params.id,
    metadata: { reason: req.body?.reason || "" },
    ip: req.ip
  });
  res.json({ ok: true, ...result });
});

adminRouter.post("/news/:id/correct", async (req, res) => {
  const result = await ctx.storageCorrectNewsItem(
    req.params.id,
    {
      title: req.body?.title,
      summary: req.body?.summary,
      companies: req.body?.companies,
      professions: req.body?.professions,
      regions: req.body?.regions,
      correctionNote: req.body?.correctionNote || req.body?.note || req.body?.reason,
      status: req.body?.status
    },
    req.user?.id || "admin-token"
  );
  if (!result.ok) {
    res.status(result.reason === "not_found" ? 404 : 422).json({
      message: result.reason || "Could not correct",
      ...result
    });
    return;
  }
  await ctx.storageAudit({
    action: "news.correct",
    actorId: req.user?.id || "admin-token",
    targetType: "news_items",
    targetId: req.params.id,
    metadata: {
      correctionNote: result.item?.correctionNote,
      status: result.item?.status,
      companies: result.item?.companies,
      professions: result.item?.professions
    },
    ip: req.ip
  });
  res.json({ ok: true, news: publicNewsFields(result.item) });
});

adminRouter.post("/news/:id/reject", async (req, res) => {
  const result = await ctx.storageRejectNewsItem(
    req.params.id,
    ctx.sanitizeText(req.body?.reason || "Rejected by moderator"),
    req.user?.id || "admin-token"
  );
  if (!result.ok) {
    res.status(result.reason === "not_found" ? 404 : 422).json({
      message: result.reason || "Could not reject",
      ...result
    });
    return;
  }
  await ctx.storageAudit({
    action: "news.reject",
    actorId: req.user?.id || "admin-token",
    targetType: "news_items",
    targetId: req.params.id,
    metadata: { reason: req.body?.reason || "" },
    ip: req.ip
  });
  res.json({ ok: true, news: publicNewsFields(result.item) });
});

adminRouter.post("/news/ingest", async (req, res) => {
  const result = await ingestNews(ctx, {
    daysBack: Number(req.body?.daysBack || req.query.daysBack || process.env.NEWS_INGEST_DAYS_BACK || 14),
    maxRecords: Number(req.body?.maxRecords || req.query.maxRecords || process.env.NEWS_INGEST_MAX_RECORDS || 25)
  });
  await ctx.storageAudit({
    action: "news.ingest",
    actorId: req.user?.id || "admin-token",
    targetType: "news_items",
    targetId: "gdelt+rss",
    metadata: result,
    ip: req.ip
  });
  if ((result.inserted || result.updated) && req.app?.locals?.publishActivity) {
    req.app.locals.publishActivity({
      type: "news.ingested",
      title: "News feed refreshed",
      detail: `${result.inserted} new headlines, ${result.updated} updated, ${result.merged || 0} merged`,
      href: "#news"
    });
  }
  res.json({ ok: true, ...result });
});

adminRouter.post("/news/source-check", async (req, res) => {
  const jobs = require("../lib/jobs");
  const newsId = req.body?.newsId || req.body?.news_id || null;
  try {
    const { job, created } = await jobs.enqueue(
      {
        type: "news.source_check",
        payload: {
          newsId,
          limit: Number(req.body?.limit || 50),
          reason: req.body?.reason || "admin"
        },
        idempotencyKey: newsId
          ? `news.source_check:${newsId}:${new Date().toISOString().slice(0, 13)}`
          : `news.source_check:batch:${new Date().toISOString().slice(0, 13)}`,
        maxAttempts: 2,
        timeoutMs: 120_000
      },
      {
        usePostgres: ctx.usePostgres,
        getPool: () => ctx.getPgPool?.() || null,
        useMemory: !ctx.usePostgres
      }
    );
    await ctx.storageAudit({
      action: "news.source_check.enqueue",
      actorId: req.user?.id || "admin-token",
      targetType: "job",
      targetId: job.id,
      metadata: { newsId, created },
      ip: req.ip
    });
    res.status(created ? 201 : 200).json({ ok: true, created, job });
  } catch (err) {
    console.error("enqueue news.source_check failed:", err);
    res.status(500).json({ message: err.message || "Failed to enqueue source check" });
  }
});

adminRouter.get("/news/source-health", async (req, res) => {
  const rows = await ctx.storageGetNewsSourceHealth({
    limit: Number(req.query.limit || 50)
  });
  res.json({ sources: rows });
});

module.exports = router;
module.exports.adminRouter = adminRouter;
module.exports.publicNewsFields = publicNewsFields;
