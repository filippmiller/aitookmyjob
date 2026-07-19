/**
 * Expression & publication-intent API (aitj-z8q.8).
 *
 * Modes: vent | story | advice_request | warn | good_news | news_share
 * Lifecycle: draft → preview → publish(submit) → edit → delete → report → follow-up
 * Vents: /api/vents*; unified: /api/expression*
 */

"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const ctx = require("../lib/context");
const expression = require("../lib/expression");
const jobs = require("../lib/jobs");

const submitLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

function jobsOptions() {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool(),
    useMemory: !ctx.usePostgres
  };
}

async function enqueueStub(type, payload, idempotencyKey) {
  try {
    return await jobs.enqueue(
      { type, payload, idempotencyKey, maxAttempts: 3 },
      jobsOptions()
    );
  } catch (err) {
    console.warn(`[expression] enqueue ${type} failed:`, err.message || err);
    return null;
  }
}

async function trackAnalytics(eventName, record, extra = {}) {
  const payload = expression.analyticsEventPayload(eventName, record, extra);
  await enqueueStub(
    expression.ANALYTICS_JOB_TYPE,
    payload,
    `analytics:${eventName}:${record.id || "none"}:${Date.now()}`
  );
  return payload;
}

async function enqueueNotification(type, record, recipientId = null) {
  const payload = expression.notificationPayload(type, record, recipientId);
  await enqueueStub(
    expression.NOTIFICATION_JOB_TYPE,
    payload,
    `notify:${type}:${record.id || "none"}:${recipientId || "broadcast"}`
  );
  return payload;
}

function publishActivity(req, event) {
  if (req.app?.locals?.publishActivity) req.app.locals.publishActivity(event);
}

function isModerator(user) {
  return ctx.hasModeratorRole(user);
}

function canViewVent(vent, user) {
  if (!vent || vent.status === expression.VENT_STATUS.DELETED) return false;
  if (vent.status === expression.VENT_STATUS.PUBLISHED) {
    if (vent.visibility === expression.VISIBILITY.PUBLIC) return true;
    if (vent.visibility === expression.VISIBILITY.COMMUNITY) return Boolean(user);
    if (vent.visibility === expression.VISIBILITY.PRIVATE) {
      return Boolean(user && (vent.submittedBy === user.id || isModerator(user)));
    }
    if (vent.visibility === expression.VISIBILITY.RESTRICTED) {
      return Boolean(user && (vent.submittedBy === user.id || isModerator(user)));
    }
    return true;
  }
  // draft/pending/rejected/hidden: owner or staff
  return Boolean(user && (vent.submittedBy === user.id || isModerator(user)));
}

function canViewStory(story, user) {
  if (!story || story.status === expression.STORY_STATUS.DELETED) return false;
  if (story.status === expression.STORY_STATUS.PUBLISHED) {
    if (story.visibility === expression.VISIBILITY.COMMUNITY) return Boolean(user);
    if (story.visibility === expression.VISIBILITY.PRIVATE || story.visibility === expression.VISIBILITY.RESTRICTED) {
      return Boolean(user && (story.submittedBy === user.id || isModerator(user)));
    }
    return true;
  }
  return Boolean(user && (story.submittedBy === user.id || isModerator(user)));
}

function publicStoryWithExpression(story) {
  const masked = ctx.maskStoryByPrivacy(ctx.ensureStoryDefaults(story));
  const metrics = masked.metrics || {};
  return {
    id: masked.id,
    kind: "story",
    name: masked.name,
    country: masked.country,
    language: masked.language,
    profession: masked.profession,
    company: masked.company,
    laidOffAt: masked.laidOffAt,
    foundNewJob: Boolean(masked.foundNewJob),
    reason: masked.reason,
    story: masked.story,
    status: masked.status,
    estimatedLayoffs: Number(masked.estimatedLayoffs || 1),
    createdAt: masked.createdAt,
    updatedAt: masked.updatedAt,
    publicationIntent: masked.publicationIntent || expression.PUBLICATION_INTENT.STORY,
    desiredResponse: masked.desiredResponse || expression.DESIRED_RESPONSE.WITNESS,
    advicePermission: masked.advicePermission || expression.ADVICE_PERMISSION.OPEN,
    anonymityMode: masked.anonymityMode || expression.ANONYMITY_MODE.ALIAS,
    visibility: masked.visibility || expression.VISIBILITY.PUBLIC,
    retentionPreference: masked.retentionPreference || expression.RETENTION_PREFERENCE.INDEFINITE,
    metrics: {
      views: Number(metrics.views || 0),
      meToo: Number(metrics.meToo || 0),
      commentsCount: Number(metrics.commentsCount || 0),
      reactions: metrics.reactions || {}
    },
    responsePolicy: expression.responsePromptPolicy(masked.desiredResponse),
    confidenceScore: ctx.computeConfidenceScore(masked)
  };
}

// ── Modes & meta ──

router.get("/api/expression/modes", (_req, res) => {
  res.json({
    modes: expression.listModes(),
    desiredResponses: expression.valuesOf(expression.DESIRED_RESPONSE),
    anonymityModes: expression.valuesOf(expression.ANONYMITY_MODE),
    advicePermissions: expression.valuesOf(expression.ADVICE_PERMISSION),
    visibilities: expression.valuesOf(expression.VISIBILITY),
    retentionPreferences: expression.valuesOf(expression.RETENTION_PREFERENCE),
    domainContractVersion: ctx.DOMAIN_CONTRACT_VERSION
  });
});

// ── Preview (no persistence) ──

router.post("/api/expression/preview", (req, res) => {
  const controls = expression.normalizeAuthorControls(req.body);
  if (!controls.ok) {
    res.status(422).json({ message: "Validation failed", errors: controls.errors });
    return;
  }
  const { publicationIntent } = controls.controls;
  if (expression.isVentIntent(publicationIntent)) {
    const prepared = expression.validateVentPayload({ ...req.body, ...controls.controls }, { asDraft: true });
    if (!prepared.ok) {
      res.status(422).json({ message: "Validation failed", errors: prepared.errors });
      return;
    }
    const preview = expression.buildExpressionPreview({
      kind: "vent",
      ...prepared.data
    });
    trackAnalytics(expression.ANALYTICS_EVENTS.PREVIEWED, { id: "preview", ...prepared.data });
    res.json({ preview });
    return;
  }
  // Story-like: allow lighter preview without full NDA for draft preview
  const body = req.body || {};
  const preview = expression.buildExpressionPreview({
    kind: "story",
    publicationIntent,
    desiredResponse: controls.controls.desiredResponse,
    anonymityMode: controls.controls.anonymityMode,
    advicePermission: controls.controls.advicePermission,
    visibility: controls.controls.visibility,
    retentionPreference: controls.controls.retentionPreference,
    name: ctx.sanitizeText(body.name || "Author"),
    reason: ctx.sanitizeText(body.reason || body.title || ""),
    story: ctx.sanitizeText(body.story || body.body || body.commentary || ""),
    title: ctx.sanitizeText(body.title || body.reason || "")
  });
  trackAnalytics(expression.ANALYTICS_EVENTS.PREVIEWED, { id: "preview", publicationIntent });
  res.json({ preview });
});

// ── Create expression (draft or submit) ──

router.post("/api/expression", submitLimiter, async (req, res) => {
  if (req.user && ctx.isAccountMuted(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const asDraft = req.body.asDraft === true || req.body.asDraft === "true" || req.body.status === "draft";
  const controls = expression.normalizeAuthorControls(req.body);
  if (!controls.ok) {
    res.status(422).json({ message: "Validation failed", errors: controls.errors });
    return;
  }

  const { publicationIntent, primaryEntity } = controls.controls;

  if (expression.isVentIntent(publicationIntent)) {
    const prepared = expression.validateVentPayload({ ...req.body, ...controls.controls }, { asDraft });
    if (!prepared.ok) {
      res.status(422).json({ message: "Validation failed", errors: prepared.errors });
      return;
    }
    const moderation = ctx.scoreModeration({ reason: prepared.data.title || "", story: prepared.data.body });
    const initialStatus = expression.initialStatusForSubmit({
      asDraft,
      riskBand: moderation.riskBand,
      entity: expression.ENTITY.VENT
    });
    try {
      expression.assertValidStatus(expression.ENTITY.VENT, initialStatus);
    } catch (err) {
      res.status(500).json({ message: err.message });
      return;
    }
    // Anonymous vents allowed; drafts require auth so author can resume
    if (asDraft && !req.user) {
      res.status(401).json({ message: "Authentication required to save drafts" });
      return;
    }
    const vent = ctx.buildVentRecord(prepared.data, req.user?.id || null, moderation, initialStatus);
    await ctx.storageInsertVent(vent);
    await ctx.storageAudit({
      action: asDraft ? "vent.draft" : "vent.submit",
      actorId: req.user?.id || null,
      targetType: "vent",
      targetId: vent.id,
      metadata: { publicationIntent, desiredResponse: vent.desiredResponse, moderation, status: vent.status },
      ip: req.ip
    });
    await trackAnalytics(
      asDraft ? expression.ANALYTICS_EVENTS.DRAFT_SAVED : expression.ANALYTICS_EVENTS.SUBMITTED,
      vent
    );
    if (!asDraft) {
      await enqueueNotification("expression.submitted", vent, null);
      publishActivity(req, {
        type: "vent.submitted",
        title: asDraft ? "Vent draft saved" : "Vent submitted",
        detail: `${vent.country} · ${vent.desiredResponse}`,
        href: `/#vent-${vent.id}`
      });
    }
    res.status(initialStatus === expression.VENT_STATUS.REJECTED ? 202 : 201).json({
      message: asDraft
        ? "Vent draft saved"
        : initialStatus === expression.VENT_STATUS.REJECTED
          ? "Vent auto-flagged for high-risk review"
          : "Vent submitted for moderation",
      kind: "vent",
      id: vent.id,
      status: vent.status,
      publicationIntent: vent.publicationIntent,
      desiredResponse: vent.desiredResponse,
      visibility: vent.visibility,
      retentionPreference: vent.retentionPreference,
      advicePermission: vent.advicePermission,
      anonymityMode: vent.anonymityMode,
      responsePolicy: expression.responsePromptPolicy(vent.desiredResponse),
      moderation,
      crisisResources: moderation.crisis ? ctx.getCrisisResources(vent.country) : []
    });
    return;
  }

  // Story-like intents
  if (asDraft && !req.user) {
    res.status(401).json({ message: "Authentication required to save drafts" });
    return;
  }

  // For drafts, relax NDA; for submit keep existing NDA gate
  const prepared = ctx.buildStoryPayload(req, { skipNda: asDraft });
  if (!prepared.ok) {
    // news_share may use commentary field
    if (publicationIntent === expression.PUBLICATION_INTENT.NEWS_SHARE) {
      const commentary = ctx.sanitizeText(req.body.story || req.body.commentary || req.body.body || "");
      const title = ctx.sanitizeText(req.body.reason || req.body.title || "News share");
      if (commentary.length < (asDraft ? 1 : 20)) {
        res.status(422).json({
          message: "Validation failed",
          errors: [{ field: "story", message: "Commentary is required for news share" }]
        });
        return;
      }
      // synthesize minimal story fields
      req.body = {
        ...req.body,
        name: ctx.sanitizeText(req.body.name || "Author"),
        profession: ctx.sanitizeText(req.body.profession || "Worker"),
        company: ctx.sanitizeText(req.body.company || "Undisclosed"),
        laidOffAt: ctx.sanitizeText(req.body.laidOffAt || new Date().toISOString().slice(0, 7)),
        reason: title.slice(0, 240),
        story: commentary,
        foundNewJob: req.body.foundNewJob === true || req.body.foundNewJob === "true",
        ndaConfirmed: true,
        country: req.body.country || "global",
        language: req.body.language || "en"
      };
      const retry = ctx.buildStoryPayload(req, { skipNda: true });
      if (!retry.ok) {
        res.status(422).json({ message: "Validation failed", errors: retry.errors });
        return;
      }
      await createStoryExpression(req, res, retry.data, controls.controls, asDraft);
      return;
    }
    res.status(422).json({ message: "Validation failed", errors: prepared.errors });
    return;
  }
  await createStoryExpression(req, res, prepared.data, controls.controls, asDraft);
});

async function createStoryExpression(req, res, parsedData, controls, asDraft) {
  // Authenticated story submit historically required verified phone; drafts & intent API allow auth without phone.
  // Keep phone requirement only for non-draft when using legacy path; expression API allows pending without phone for advice/good_news/etc.
  const moderation = ctx.scoreModeration(parsedData);
  const initialStatus = expression.initialStatusForSubmit({
    asDraft,
    riskBand: moderation.riskBand,
    entity: expression.ENTITY.STORY
  });
  try {
    expression.assertValidStatus(expression.ENTITY.STORY, initialStatus);
  } catch (err) {
    res.status(500).json({ message: err.message });
    return;
  }

  // Map anonymity into privacy nameDisplay when not provided
  if (!parsedData.privacy) parsedData.privacy = {};
  if (controls.anonymityMode === expression.ANONYMITY_MODE.ANONYMOUS) {
    parsedData.privacy.nameDisplay = "anonymous";
  } else if (controls.anonymityMode === expression.ANONYMITY_MODE.IDENTIFIED) {
    parsedData.privacy.nameDisplay = parsedData.privacy.nameDisplay || "first_name";
  }

  const newsUrl = ctx.sanitizeText(req.body.newsUrl || req.body.url || "");
  const newStory = ctx.buildStoryRecord(
    parsedData,
    req.user?.id || null,
    moderation,
    initialStatus,
    { ...controls, newsUrl: newsUrl || null }
  );
  await ctx.storageInsertStory(newStory);
  await ctx.storageInsertStoryVersion({
    id: ctx.auditId(),
    storyId: newStory.id,
    versionNo: 1,
    payload: newStory,
    createdBy: req.user?.id || null,
    createdAt: newStory.createdAt
  });
  await ctx.storageAudit({
    action: asDraft ? "story.draft" : "story.submit.expression",
    actorId: req.user?.id || null,
    targetType: "story",
    targetId: newStory.id,
    metadata: {
      publicationIntent: newStory.publicationIntent,
      desiredResponse: newStory.desiredResponse,
      moderation,
      status: newStory.status
    },
    ip: req.ip
  });
  await trackAnalytics(
    asDraft ? expression.ANALYTICS_EVENTS.DRAFT_SAVED : expression.ANALYTICS_EVENTS.SUBMITTED,
    newStory
  );
  if (!asDraft) {
    await enqueueNotification("expression.submitted", newStory, null);
    if (moderation.riskBand !== "low" && ctx.TELEGRAM_MOD_CHAT_ID) {
      await ctx.sendTelegramMessage(
        ctx.TELEGRAM_MOD_CHAT_ID,
        `New ${newStory.publicationIntent} flagged (${moderation.riskBand})\nID: ${newStory.id}`
      );
    }
    publishActivity(req, {
      type: "expression.submitted",
      title: `${expression.getModeMeta(newStory.publicationIntent)?.label || "Expression"} submitted`,
      detail: `${newStory.profession} · ${newStory.country}`,
      href: `/story/${newStory.id}`
    });
  }
  res.status(initialStatus === expression.STORY_STATUS.REJECTED ? 202 : 201).json({
    message: asDraft
      ? "Draft saved"
      : initialStatus === expression.STORY_STATUS.REJECTED
        ? "Auto-flagged for high-risk review"
        : "Submitted for moderation",
    kind: "story",
    id: newStory.id,
    status: newStory.status,
    publicationIntent: newStory.publicationIntent,
    desiredResponse: newStory.desiredResponse,
    visibility: newStory.visibility,
    advicePermission: newStory.advicePermission,
    anonymityMode: newStory.anonymityMode,
    retentionPreference: newStory.retentionPreference,
    responsePolicy: expression.responsePromptPolicy(newStory.desiredResponse),
    moderation,
    crisisResources: moderation.crisis ? ctx.getCrisisResources(newStory.country) : []
  });
}

// ── Mine (author list) ──

router.get("/api/expression/mine", requireAuth, async (req, res) => {
  const stories = (await ctx.storageGetStories())
    .filter((s) => s.submittedBy === req.user.id && s.status !== expression.STORY_STATUS.DELETED)
    .map((s) => ({
      kind: "story",
      id: s.id,
      status: s.status,
      publicationIntent: s.publicationIntent || expression.PUBLICATION_INTENT.STORY,
      desiredResponse: s.desiredResponse,
      title: s.reason,
      updatedAt: s.updatedAt,
      createdAt: s.createdAt
    }));
  const vents = (await ctx.storageGetVents())
    .filter((v) => v.submittedBy === req.user.id && v.status !== expression.VENT_STATUS.DELETED)
    .map((v) => ({
      kind: "vent",
      id: v.id,
      status: v.status,
      publicationIntent: v.publicationIntent,
      desiredResponse: v.desiredResponse,
      title: v.title || v.body.slice(0, 80),
      updatedAt: v.updatedAt,
      createdAt: v.createdAt
    }));
  const items = [...stories, ...vents].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json({ items, total: items.length });
});

// ── Load single ──

router.get("/api/expression/:kind/:id", async (req, res) => {
  const kind = ctx.sanitizeText(req.params.kind);
  const id = ctx.sanitizeText(req.params.id);
  if (kind === "vent") {
    const vent = await ctx.storageGetVentById(id);
    if (!vent || !canViewVent(vent, req.user)) {
      res.status(404).json({ message: "Vent not found" });
      return;
    }
    const isOwner = req.user && vent.submittedBy === req.user.id;
    res.json({
      item: isOwner || isModerator(req.user) ? { ...vent, kind: "vent" } : expression.publicVent(vent),
      preview: expression.buildExpressionPreview(vent),
      followups: isOwner || isModerator(req.user)
        ? await ctx.storageGetExpressionFollowups("vent", id)
        : []
    });
    return;
  }
  if (kind === "story") {
    const story = (await ctx.storageGetStories()).find((s) => s.id === id);
    if (!story || !canViewStory(story, req.user)) {
      res.status(404).json({ message: "Story not found" });
      return;
    }
    const isOwner = req.user && story.submittedBy === req.user.id;
    res.json({
      item: isOwner || isModerator(req.user) ? ctx.ensureStoryDefaults(story) : publicStoryWithExpression(story),
      preview: expression.buildExpressionPreview(story),
      followups: isOwner || isModerator(req.user)
        ? await ctx.storageGetExpressionFollowups("story", id)
        : []
    });
    return;
  }
  res.status(422).json({ message: "kind must be story or vent" });
});

// ── Publish draft → pending ──

router.post("/api/expression/:kind/:id/publish", requireAuth, submitLimiter, async (req, res) => {
  const kind = ctx.sanitizeText(req.params.kind);
  const id = ctx.sanitizeText(req.params.id);
  if (kind === "vent") {
    const vent = await ctx.storageGetVentById(id);
    if (!vent) {
      res.status(404).json({ message: "Vent not found" });
      return;
    }
    if (vent.submittedBy !== req.user.id && !isModerator(req.user)) {
      res.status(403).json({ message: "Not allowed" });
      return;
    }
    try {
      expression.assertCanTransition(expression.ENTITY.VENT, vent.status, expression.VENT_STATUS.PENDING);
    } catch (err) {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    const updated = await ctx.storagePatchVent(id, () => ({ status: expression.VENT_STATUS.PENDING }));
    await ctx.storageAudit({
      action: "vent.publish",
      actorId: req.user.id,
      targetType: "vent",
      targetId: id,
      metadata: { from: vent.status, to: expression.VENT_STATUS.PENDING },
      ip: req.ip
    });
    await trackAnalytics(expression.ANALYTICS_EVENTS.SUBMITTED, updated);
    await enqueueNotification("expression.submitted", updated, null);
    res.json({ ok: true, kind: "vent", id, status: updated.status });
    return;
  }
  if (kind === "story") {
    const story = (await ctx.storageGetStories()).find((s) => s.id === id);
    if (!story) {
      res.status(404).json({ message: "Story not found" });
      return;
    }
    if (story.submittedBy !== req.user.id && !isModerator(req.user)) {
      res.status(403).json({ message: "Not allowed" });
      return;
    }
    try {
      expression.assertCanTransition(expression.ENTITY.STORY, story.status, expression.STORY_STATUS.PENDING);
    } catch (err) {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    const updated = await ctx.storagePatchStory(id, () => ({ status: expression.STORY_STATUS.PENDING }));
    await ctx.storageAudit({
      action: "story.publish",
      actorId: req.user.id,
      targetType: "story",
      targetId: id,
      metadata: { from: story.status, to: expression.STORY_STATUS.PENDING },
      ip: req.ip
    });
    await trackAnalytics(expression.ANALYTICS_EVENTS.SUBMITTED, updated);
    await enqueueNotification("expression.submitted", updated, null);
    res.json({ ok: true, kind: "story", id, status: updated.status });
    return;
  }
  res.status(422).json({ message: "kind must be story or vent" });
});

// ── Edit ──

router.patch("/api/expression/:kind/:id", requireAuth, async (req, res) => {
  const kind = ctx.sanitizeText(req.params.kind);
  const id = ctx.sanitizeText(req.params.id);

  if (kind === "vent") {
    const vent = await ctx.storageGetVentById(id);
    if (!vent) {
      res.status(404).json({ message: "Vent not found" });
      return;
    }
    if (!expression.authorMayEdit(vent, req.user, expression.ENTITY.VENT) && !isModerator(req.user)) {
      res.status(403).json({ message: "Not allowed to edit" });
      return;
    }
    const bodyText = req.body.body !== undefined ? ctx.sanitizeText(req.body.body) : vent.body;
    if (bodyText.length < 10) {
      res.status(422).json({ message: "Body must be at least 10 characters" });
      return;
    }
    const controls = expression.normalizeAuthorControls(
      { ...req.body, publicationIntent: expression.PUBLICATION_INTENT.VENT },
      expression.PUBLICATION_INTENT.VENT
    );
    if (!controls.ok) {
      res.status(422).json({ message: "Validation failed", errors: controls.errors });
      return;
    }
    // Moderators may not change publicationIntent after non-draft without audit (O3)
    const updated = await ctx.storagePatchVent(id, (current) => ({
      body: bodyText,
      title: req.body.title !== undefined ? ctx.sanitizeText(req.body.title) || null : current.title,
      desiredResponse: controls.controls.desiredResponse,
      advicePermission: controls.controls.advicePermission,
      anonymityMode: controls.controls.anonymityMode,
      visibility: controls.controls.visibility,
      retentionPreference: controls.controls.retentionPreference,
      displayName:
        req.body.name !== undefined || req.body.displayName !== undefined
          ? ctx.sanitizeText(req.body.name || req.body.displayName || current.displayName)
          : current.displayName
    }));
    await ctx.storageAudit({
      action: "vent.edit",
      actorId: req.user.id,
      targetType: "vent",
      targetId: id,
      metadata: {},
      ip: req.ip
    });
    await trackAnalytics(expression.ANALYTICS_EVENTS.EDITED, updated);
    res.json({ ok: true, item: updated });
    return;
  }

  if (kind === "story") {
    const story = (await ctx.storageGetStories()).find((s) => s.id === id);
    if (!story) {
      res.status(404).json({ message: "Story not found" });
      return;
    }
    if (!expression.authorMayEdit(story, req.user, expression.ENTITY.STORY) && !isModerator(req.user)) {
      res.status(403).json({ message: "Not allowed to edit" });
      return;
    }
    const storyText = req.body.story !== undefined ? ctx.sanitizeText(req.body.story) : story.story;
    const reason = req.body.reason !== undefined ? ctx.sanitizeText(req.body.reason) : story.reason;
    if (storyText.length < 40) {
      res.status(422).json({ message: "Story must be at least 40 characters" });
      return;
    }
    let controlsPatch = {};
    if (
      req.body.desiredResponse ||
      req.body.advicePermission ||
      req.body.anonymityMode ||
      req.body.visibility ||
      req.body.retentionPreference
    ) {
      const controls = expression.normalizeAuthorControls({
        ...req.body,
        publicationIntent: story.publicationIntent || expression.PUBLICATION_INTENT.STORY
      });
      if (!controls.ok) {
        res.status(422).json({ message: "Validation failed", errors: controls.errors });
        return;
      }
      controlsPatch = {
        desiredResponse: controls.controls.desiredResponse,
        advicePermission: controls.controls.advicePermission,
        anonymityMode: controls.controls.anonymityMode,
        visibility: controls.controls.visibility,
        retentionPreference: controls.controls.retentionPreference
      };
    }
    const updated = await ctx.storagePatchStory(id, (current) => ({
      story: storyText,
      reason,
      ...controlsPatch,
      name: req.body.name !== undefined ? ctx.sanitizeText(req.body.name) : current.name,
      profession: req.body.profession !== undefined ? ctx.sanitizeText(req.body.profession) : current.profession,
      company: req.body.company !== undefined ? ctx.sanitizeText(req.body.company) : current.company
    }));
    await ctx.storageInsertStoryVersion({
      id: ctx.auditId(),
      storyId: id,
      versionNo: Date.now(),
      payload: { story: storyText, reason, ...controlsPatch },
      createdBy: req.user.id,
      createdAt: new Date().toISOString()
    });
    await ctx.storageAudit({
      action: "story.edit",
      actorId: req.user.id,
      targetType: "story",
      targetId: id,
      metadata: controlsPatch,
      ip: req.ip
    });
    await trackAnalytics(expression.ANALYTICS_EVENTS.EDITED, updated);
    res.json({ ok: true, item: updated });
    return;
  }

  res.status(422).json({ message: "kind must be story or vent" });
});

// ── Soft delete ──

router.delete("/api/expression/:kind/:id", requireAuth, async (req, res) => {
  const kind = ctx.sanitizeText(req.params.kind);
  const id = ctx.sanitizeText(req.params.id);

  if (kind === "vent") {
    const vent = await ctx.storageGetVentById(id);
    if (!vent) {
      res.status(404).json({ message: "Vent not found" });
      return;
    }
    if (!expression.authorMayDelete(vent, req.user) && !isModerator(req.user)) {
      res.status(403).json({ message: "Not allowed" });
      return;
    }
    try {
      expression.assertCanTransition(expression.ENTITY.VENT, vent.status, expression.VENT_STATUS.DELETED);
    } catch (err) {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    const updated = await ctx.storagePatchVent(id, () => ({ status: expression.VENT_STATUS.DELETED }));
    await ctx.storageAudit({
      action: "vent.delete",
      actorId: req.user.id,
      targetType: "vent",
      targetId: id,
      metadata: { from: vent.status },
      ip: req.ip
    });
    await trackAnalytics(expression.ANALYTICS_EVENTS.DELETED, updated);
    res.json({ ok: true, kind: "vent", id, status: expression.VENT_STATUS.DELETED });
    return;
  }

  if (kind === "story") {
    const story = (await ctx.storageGetStories()).find((s) => s.id === id);
    if (!story) {
      res.status(404).json({ message: "Story not found" });
      return;
    }
    if (!expression.authorMayDelete(story, req.user) && !isModerator(req.user)) {
      res.status(403).json({ message: "Not allowed" });
      return;
    }
    try {
      expression.assertCanTransition(expression.ENTITY.STORY, story.status, expression.STORY_STATUS.DELETED);
    } catch (err) {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    const updated = await ctx.storagePatchStory(id, () => ({ status: expression.STORY_STATUS.DELETED }));
    await ctx.storageAudit({
      action: "story.delete",
      actorId: req.user.id,
      targetType: "story",
      targetId: id,
      metadata: { from: story.status },
      ip: req.ip
    });
    await trackAnalytics(expression.ANALYTICS_EVENTS.DELETED, updated);
    res.json({ ok: true, kind: "story", id, status: expression.STORY_STATUS.DELETED });
    return;
  }

  res.status(422).json({ message: "kind must be story or vent" });
});

// ── Report ──

router.post("/api/expression/:kind/:id/report", submitLimiter, async (req, res) => {
  const kind = ctx.sanitizeText(req.params.kind);
  const id = ctx.sanitizeText(req.params.id);
  if (kind !== "story" && kind !== "vent") {
    res.status(422).json({ message: "kind must be story or vent" });
    return;
  }
  const reason = ctx.sanitizeText(req.body.reason || "");
  if (reason.length < 4) {
    res.status(422).json({ message: "Reason is required (min 4 characters)" });
    return;
  }
  if (kind === "story") {
    const story = (await ctx.storageGetStories()).find((s) => s.id === id);
    if (!story) {
      res.status(404).json({ message: "Story not found" });
      return;
    }
  } else {
    const vent = await ctx.storageGetVentById(id);
    if (!vent) {
      res.status(404).json({ message: "Vent not found" });
      return;
    }
  }
  const report = await ctx.storageInsertExpressionReport({
    targetType: kind,
    targetId: id,
    reason,
    details: ctx.sanitizeText(req.body.details || "").slice(0, 1000),
    reporterId: req.user?.id || null,
    status: "open"
  });
  await ctx.storageAudit({
    action: "expression.report",
    actorId: req.user?.id || null,
    targetType: kind,
    targetId: id,
    metadata: { reportId: report.id, reason },
    ip: req.ip
  });
  await trackAnalytics(expression.ANALYTICS_EVENTS.REPORTED, {
    id,
    kind,
    publicationIntent: null
  }, { reportId: report.id });
  await enqueueNotification("expression.reported", { id, kind, publicationIntent: kind, desiredResponse: expression.DESIRED_RESPONSE.NONE }, null);
  res.status(201).json({ ok: true, reportId: report.id, status: report.status });
});

// ── Follow-up ──

router.post("/api/expression/:kind/:id/follow-up", requireAuth, async (req, res) => {
  const kind = ctx.sanitizeText(req.params.kind);
  const id = ctx.sanitizeText(req.params.id);
  const body = ctx.sanitizeText(req.body.body || "");
  if (body.length < 2) {
    res.status(422).json({ message: "Follow-up body is required" });
    return;
  }
  let record = null;
  if (kind === "vent") {
    record = await ctx.storageGetVentById(id);
  } else if (kind === "story") {
    record = (await ctx.storageGetStories()).find((s) => s.id === id);
  } else {
    res.status(422).json({ message: "kind must be story or vent" });
    return;
  }
  if (!record) {
    res.status(404).json({ message: "Not found" });
    return;
  }
  if (record.submittedBy !== req.user.id && !isModerator(req.user)) {
    res.status(403).json({ message: "Only the author may add follow-ups" });
    return;
  }

  let outcomeStatus = null;
  if (req.body.outcomeStatus) {
    try {
      const domain = require("../lib/domain-contract");
      outcomeStatus = domain.assertValidStatus(domain.ENTITY.OUTCOME, String(req.body.outcomeStatus));
    } catch (err) {
      res.status(422).json({ message: err.message, code: err.code });
      return;
    }
  }

  const followup = await ctx.storageInsertExpressionFollowup({
    targetType: kind,
    targetId: id,
    body,
    outcomeStatus,
    createdBy: req.user.id
  });

  if (kind === "story" && outcomeStatus) {
    const domain = require("../lib/domain-contract");
    const foundNewJob = domain.foundNewJobFromOutcome(outcomeStatus);
    await ctx.storagePatchStory(id, (s) => ({
      foundNewJob,
      details: { ...s.details, updateLabel: body.slice(0, 200), outcomeStatus }
    }));
  }

  await ctx.storageAudit({
    action: "expression.follow_up",
    actorId: req.user.id,
    targetType: kind,
    targetId: id,
    metadata: { followupId: followup.id, outcomeStatus },
    ip: req.ip
  });
  await trackAnalytics(expression.ANALYTICS_EVENTS.FOLLOW_UP, {
    id,
    kind,
    publicationIntent: record.publicationIntent
  }, { followupId: followup.id });
  res.status(201).json({ ok: true, followup });
});

// ── Vents public list ──

router.get("/api/vents", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 50);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  const country = ctx.normalizeCountry(req.query.country || "global");
  const all = (await ctx.storageGetVents())
    .filter((v) => v.status === expression.VENT_STATUS.PUBLISHED)
    .filter((v) => country === "global" || v.country === country)
    .filter((v) => {
      if (v.visibility === expression.VISIBILITY.PUBLIC) return true;
      if (v.visibility === expression.VISIBILITY.COMMUNITY) return Boolean(req.user);
      return false;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const vents = all.slice(offset, offset + limit).map(expression.publicVent);
  res.json({
    vents,
    total: all.length,
    crisisResources: ctx.getCrisisResources(country),
    note: "Vents default to community visibility; support without forced action content."
  });
});

router.get("/api/vents/:id", async (req, res) => {
  const vent = await ctx.storageGetVentById(ctx.sanitizeText(req.params.id));
  if (!vent || !canViewVent(vent, req.user)) {
    res.status(404).json({ message: "Vent not found" });
    return;
  }
  if (vent.status === expression.VENT_STATUS.PUBLISHED) {
    await ctx.storagePatchVent(vent.id, (v) => ({
      metrics: { ...v.metrics, views: Number(v.metrics?.views || 0) + 1 }
    }));
  }
  res.json(expression.publicVent(vent));
});

// Convenience create at /api/vents
router.post("/api/vents", submitLimiter, async (req, res) => {
  req.body = { ...req.body, publicationIntent: expression.PUBLICATION_INTENT.VENT };
  if (req.user && ctx.isAccountMuted(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const asDraft = req.body.asDraft === true || req.body.asDraft === "true";
  const prepared = expression.validateVentPayload(req.body, { asDraft });
  if (!prepared.ok) {
    res.status(422).json({ message: "Validation failed", errors: prepared.errors });
    return;
  }
  if (asDraft && !req.user) {
    res.status(401).json({ message: "Authentication required to save drafts" });
    return;
  }
  const moderation = ctx.scoreModeration({ reason: prepared.data.title || "", story: prepared.data.body });
  const initialStatus = expression.initialStatusForSubmit({
    asDraft,
    riskBand: moderation.riskBand,
    entity: expression.ENTITY.VENT
  });
  const vent = ctx.buildVentRecord(prepared.data, req.user?.id || null, moderation, initialStatus);
  await ctx.storageInsertVent(vent);
  await ctx.storageAudit({
    action: asDraft ? "vent.draft" : "vent.submit",
    actorId: req.user?.id || null,
    targetType: "vent",
    targetId: vent.id,
    metadata: { moderation, status: vent.status },
    ip: req.ip
  });
  await trackAnalytics(
    asDraft ? expression.ANALYTICS_EVENTS.DRAFT_SAVED : expression.ANALYTICS_EVENTS.SUBMITTED,
    vent
  );
  if (!asDraft) await enqueueNotification("expression.submitted", vent, null);
  res.status(201).json({
    message: asDraft ? "Vent draft saved" : "Vent submitted for moderation",
    kind: "vent",
    id: vent.id,
    status: vent.status,
    desiredResponse: vent.desiredResponse,
    responsePolicy: expression.responsePromptPolicy(vent.desiredResponse),
    moderation
  });
});

module.exports = router;
