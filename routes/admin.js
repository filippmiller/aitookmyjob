const express = require("express");
const router = express.Router();
const {
  requireAdminOrToken,
  requireAdminRole,
  requireSuperadmin,
  requireMinRole,
  requireConfirm,
  requireAuth,
  canAssignRole,
  hasAdminRole,
  effectiveRole
} = require("../middleware/auth");
const ctx = require("../lib/context");
const jobs = require("../lib/jobs");
const insider = require("../lib/insider");
const notifications = require("../lib/notifications");
const adminOps = require("../lib/admin-ops");
const social = require("../lib/social");
const metrics = require("../lib/metrics");
const readiness = require("../lib/readiness");
const { getRelease } = require("../lib/release");
const { adminRouter: resourcesAdminRouter } = require("./resources");
const { adminRouter: newsAdminRouter } = require("./news");
const {
  INSIDER_SIGNAL_STATUS,
  EVIDENCE_STATUS,
  VERIFICATION_LEVEL,
  APPEAL_STATUS,
  CRISIS_CASE_STATUS,
  SLA_STATE,
  TAKEDOWN_STATUS,
  SANCTION_TYPE,
  valuesOf
} = require("../lib/domain-contract");

// Verified catalog CRUD for admins/trusted curators (aitj-z8q.12)
router.use(resourcesAdminRouter);
// Community news moderate/correct/reject + submissions (aitj-z8q.10)
router.use(newsAdminRouter);

function opsOptions() {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool(),
    useMemory: !ctx.usePostgres,
    dataDir: ctx.dataDir,
    scoreModeration: ctx.scoreModeration,
    getCrisisResources: ctx.getCrisisResources
  };
}

function socialOptions(req) {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool(),
    useMemory: !ctx.usePostgres,
    ip: req?.ip
  };
}

router.get("/overview", async (req, res) => {
  if (!(ctx.hasAdminToken(req) || ctx.hasModeratorRole(req.user))) { res.status(401).json({ message: "Unauthorized" }); return; }
  const stories = await ctx.storageGetStories();
  const published = stories.filter((s) => s.status === "published");
  const pending = stories.filter((s) => s.status === "pending");
  const queue = await ctx.storageGetModerationQueue();
  const users = await ctx.storageGetUsers();
  const [appealsOpen, crisisOpen, takedownsPending] = await Promise.all([
    adminOps.listAppeals({ status: "submitted", limit: 1 }, opsOptions()),
    adminOps.listCrisisCases({ status: "open", limit: 1 }, opsOptions()),
    adminOps.listTakedownsAdmin({ status: "pending", limit: 1 }, opsOptions())
  ]);
  res.json({
    moderation: { pendingStories: pending.length, publishedStories: published.length, queueItems: queue.length },
    users: { registeredEstimate: users.length || (published.length * 3 + pending.length) },
    ops: {
      appealsOpen: appealsOpen.total,
      crisisOpen: crisisOpen.total,
      takedownsPending: takedownsPending.total
    },
    system: { uptime: process.uptime(), timestamp: new Date().toISOString() },
    actorRole: effectiveRole(req)
  });
});

router.get("/moderation/queue", requireAdminOrToken, async (req, res) => {
  res.json({ queue: await ctx.storageGetModerationQueue() });
});

async function getAnomalySignals(req, res) {
  const now = Date.now();
  const from = new Date(now - 24 * 3600 * 1000).toISOString();
  const events = await ctx.storageGetAuditRange(from, new Date(now).toISOString());
  const byIp = new Map();
  for (const ev of events) { if (!ev.ip) continue; byIp.set(ev.ip, (byIp.get(ev.ip) || 0) + 1); }
  const signals = [...byIp.entries()]
    .filter(([, count]) => count >= 20)
    .map(([ip, count]) => ({
      severity: count >= 50 ? "high" : "medium",
      type: "ip_activity_spike",
      summary: `IP ${ip} produced ${count} events in 24h`,
      count, createdAt: new Date().toISOString()
    }));
  res.json({ window: "24h", signals });
}

router.get("/anomalies", requireAdminOrToken, async (req, res) => {
  const now = Date.now();
  const from = new Date(now - 24 * 3600 * 1000).toISOString();
  const events = await ctx.storageGetAuditRange(from, new Date(now).toISOString());
  const byIp = new Map();
  const byActor = new Map();
  for (const ev of events) {
    if (!ev.ip) continue;
    byIp.set(ev.ip, (byIp.get(ev.ip) || 0) + 1);
    if (ev.actorId) byActor.set(ev.actorId, (byActor.get(ev.actorId) || 0) + 1);
  }
  const noisyIps = [...byIp.entries()].filter(([, count]) => count >= 20).map(([ip, count]) => ({ ip, count }));
  const noisyActors = [...byActor.entries()].filter(([, count]) => count >= 15).map(([actorId, count]) => ({ actorId, count }));
  res.json({ window: "24h", anomalies: [...noisyIps.map((x) => ({ type: "ip_activity_spike", ...x })), ...noisyActors.map((x) => ({ type: "actor_activity_spike", ...x }))] });
});

router.get("/anomaly/signals", requireAdminOrToken, getAnomalySignals);
router.get("/anomalies/signals", requireAdminOrToken, getAnomalySignals);

// /news/* admin endpoints live on newsAdminRouter (aitj-z8q.10)

router.post("/moderation/:id/action", requireAdminOrToken, async (req, res) => {
  const parsed = ctx.moderationActionSchema.safeParse({ action: req.body.action, reason: ctx.sanitizeText(req.body.reason || "") });
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
  const ok = await ctx.storageModerationAction(req.params.id, parsed.data.action, parsed.data.reason);
  if (!ok) { res.status(404).json({ message: "Queue entry not found" }); return; }
  await ctx.storageAudit({ action: "moderation.action", actorId: req.user?.id || "admin-token", targetType: "queue_entry", targetId: req.params.id, metadata: parsed.data, ip: req.ip });
  if (String(req.params.id).startsWith("story:")) {
    const storyKey = String(req.params.id).split(":")[1];
    const current = (await ctx.storageGetStories()).find((s) => s.id === storyKey);
    if (current) {
      await ctx.storageInsertStoryVersion({ id: ctx.auditId(), storyId: storyKey, versionNo: 2, payload: { status: current.status, moderationReason: parsed.data.reason }, createdBy: req.user?.id || "admin-token", createdAt: new Date().toISOString() });
    }
    await ctx.storageInsertTransparencyEvent({ id: ctx.auditId(), eventType: "moderation", status: parsed.data.action, details: { entryId: req.params.id, reason: parsed.data.reason }, createdAt: new Date().toISOString() });
    if (parsed.data.action === "approve" && req.app?.locals?.publishActivity) {
      req.app.locals.publishActivity({
        type: "story.published",
        title: "Story published",
        detail: current ? `${current.profession || "Worker"} · ${current.country || "global"}` : storyKey,
        href: `/story/${storyKey}`
      });
    }
  }
  if (String(req.params.id).startsWith("vent:")) {
    const ventKey = String(req.params.id).split(":")[1];
    const vent = await ctx.storageGetVentById(ventKey);
    await ctx.storageInsertTransparencyEvent({
      id: ctx.auditId(),
      eventType: "moderation",
      status: parsed.data.action,
      details: { entryId: req.params.id, reason: parsed.data.reason, publicationIntent: "vent" },
      createdAt: new Date().toISOString()
    });
    if (parsed.data.action === "approve" && req.app?.locals?.publishActivity) {
      req.app.locals.publishActivity({
        type: "vent.published",
        title: "Vent published",
        detail: vent ? `${vent.country || "global"} · ${vent.desiredResponse || "empathy"}` : ventKey,
        href: `/#vents`
      });
    }
  }
  if (String(req.params.id).startsWith("report:")) {
    await ctx.storageInsertTransparencyEvent({
      id: ctx.auditId(),
      eventType: "moderation",
      status: parsed.data.action,
      details: { entryId: req.params.id, reason: parsed.data.reason, type: "report" },
      createdAt: new Date().toISOString()
    });
  }
  res.json({ ok: true });
});

router.get("/expression/reports", requireAdminOrToken, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const reports = await ctx.storageGetExpressionReports({ status, limit: 200 });
  res.json({ reports, total: reports.length });
});

router.get("/expression/vents", requireAdminOrToken, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  let vents = await ctx.storageGetVents();
  if (status) vents = vents.filter((v) => v.status === status);
  res.json({
    vents: vents.slice(0, 200).map((v) => ({
      id: v.id,
      status: v.status,
      title: v.title,
      body: v.body,
      publicationIntent: v.publicationIntent,
      desiredResponse: v.desiredResponse,
      visibility: v.visibility,
      country: v.country,
      submittedBy: v.submittedBy,
      createdAt: v.createdAt,
      moderation: v.moderation
    })),
    total: vents.length
  });
});

router.get("/moderation/:id/scores", requireAdminOrToken, async (req, res) => {
  const [kind, id] = String(req.params.id || "").split(":");
  if (kind !== "story" || !id) { res.status(422).json({ message: "Use id format story:<storyId>" }); return; }
  const story = (await ctx.storageGetStories()).find((s) => s.id === id);
  if (!story) { res.status(404).json({ message: "Story not found" }); return; }
  res.json({ id: `story:${story.id}`, status: story.status, moderation: story.moderation || {} });
});

// ── Durable jobs (aitj-z8q.5) ──

function jobsOptions() {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool(),
    useMemory: !ctx.usePostgres
  };
}

router.get("/jobs", requireAdminOrToken, async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const type = req.query.type ? String(req.query.type) : undefined;
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
  const offset = Math.max(Number(req.query.offset || 0), 0);
  try {
    const result = await jobs.listJobs({ status, type, limit, offset }, jobsOptions());
    res.json({
      jobs: result.jobs,
      total: result.total,
      limit,
      offset,
      handlers: jobs.listHandlers(),
      storage: ctx.usePostgres ? "postgres" : "memory"
    });
  } catch (err) {
    console.error("admin list jobs failed:", err);
    res.status(500).json({ message: "Failed to list jobs" });
  }
});

router.get("/jobs/:id", requireAdminOrToken, async (req, res) => {
  try {
    const job = await jobs.getJob(req.params.id, jobsOptions());
    if (!job) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    const runs = await jobs.getJobRuns(req.params.id, jobsOptions());
    res.json({ job, runs });
  } catch (err) {
    console.error("admin get job failed:", err);
    res.status(500).json({ message: "Failed to get job" });
  }
});

router.post("/jobs/:id/retry", requireAdminOrToken, async (req, res) => {
  try {
    const existing = await jobs.getJob(req.params.id, jobsOptions());
    if (!existing) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    const out = await jobs.retry(req.params.id, jobsOptions());
    if (!out) {
      res.status(404).json({ message: "Job not found" });
      return;
    }
    await ctx.storageAudit({
      action: "jobs.retry",
      actorId: req.user?.id || "admin-token",
      targetType: "job",
      targetId: req.params.id,
      metadata: { retried: out.retried, reason: out.reason || null, status: out.job?.status },
      ip: req.ip
    });
    if (!out.retried) {
      res.status(409).json({ ok: false, message: out.reason || "Job cannot be retried", job: out.job });
      return;
    }
    res.json({ ok: true, job: out.job });
  } catch (err) {
    console.error("admin retry job failed:", err);
    res.status(500).json({ message: "Failed to retry job" });
  }
});

router.post("/jobs", requireAdminOrToken, async (req, res) => {
  const type = ctx.sanitizeText(req.body?.type || "");
  if (!type) {
    res.status(422).json({ message: "type is required" });
    return;
  }
  try {
    const { job, created } = await jobs.enqueue(
      {
        type,
        payload: req.body?.payload && typeof req.body.payload === "object" ? req.body.payload : {},
        idempotencyKey: req.body?.idempotencyKey || req.body?.idempotency_key || null,
        runAt: req.body?.runAt || req.body?.run_at || null,
        maxAttempts: req.body?.maxAttempts || req.body?.max_attempts,
        timeoutMs: req.body?.timeoutMs || req.body?.timeout_ms
      },
      jobsOptions()
    );
    await ctx.storageAudit({
      action: "jobs.enqueue",
      actorId: req.user?.id || "admin-token",
      targetType: "job",
      targetId: job.id,
      metadata: { type, created, idempotencyKey: job.idempotencyKey },
      ip: req.ip
    });
    res.status(created ? 201 : 200).json({ ok: true, created, job });
  } catch (err) {
    console.error("admin enqueue job failed:", err);
    res.status(500).json({ message: "Failed to enqueue job" });
  }
});

router.post("/sanctions", requireAdminOrToken, requireMinRole("admin"), async (req, res) => {
  const parsed = ctx.sanctionSchema.safeParse({
    targetUserId: ctx.sanitizeText(req.body.targetUserId),
    type: ctx.sanitizeText(req.body.type),
    reason: ctx.sanitizeText(req.body.reason),
    durationDays: typeof req.body.durationDays === "number" ? req.body.durationDays : Number(req.body.durationDays || 0) || undefined
  });
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
  // Ban / suspend are destructive — require confirm: true
  if (parsed.data.type === "ban" || parsed.data.type === "suspend") {
    if (req.body?.confirm !== true) {
      res.status(422).json({ message: "Destructive action requires confirm: true", code: "CONFIRM_REQUIRED" });
      return;
    }
  }
  const targetUser = await ctx.storageGetUserById(parsed.data.targetUserId);
  if (!targetUser) { res.status(404).json({ message: "Target user not found" }); return; }
  const now = Date.now();
  const duration = (parsed.data.durationDays || 0) * 24 * 3600 * 1000;
  const patch = {};
  if (parsed.data.type === "mute" && duration > 0) patch.mutedUntil = new Date(now + duration).toISOString();
  if ((parsed.data.type === "suspend" || parsed.data.type === "ban") && duration > 0) patch.bannedUntil = new Date(now + duration).toISOString();
  if (parsed.data.type === "ban" && !duration) patch.bannedUntil = new Date("2099-12-31T00:00:00.000Z").toISOString();
  if (parsed.data.type === "warn") patch.mutedUntil = targetUser.mutedUntil || null;
  if (Object.keys(patch).length) {
    const updated = await ctx.storageUpdateUserSanction(targetUser.id, patch);
    if (!updated) { res.status(500).json({ message: "Could not update user sanction" }); return; }
  }
  const sanctionEntry = {
    id: ctx.sanctionId(), targetUserId: targetUser.id, type: parsed.data.type,
    reason: parsed.data.reason, durationDays: parsed.data.durationDays || null,
    createdBy: req.user?.id || "admin-token", createdAt: new Date().toISOString()
  };
  await ctx.storageInsertSanction(sanctionEntry);
  await ctx.storageAudit({ action: "sanction.create", actorId: req.user?.id || "admin-token", targetType: "user", targetId: targetUser.id, metadata: { ...sanctionEntry, confirmed: req.body?.confirm === true }, ip: req.ip });
  await ctx.storageInsertTransparencyEvent({ id: ctx.auditId(), eventType: "sanction", status: parsed.data.type, details: { targetUserId: targetUser.id, reason: parsed.data.reason, durationDays: parsed.data.durationDays || null }, createdAt: sanctionEntry.createdAt });
  res.status(201).json({ id: sanctionEntry.id });
});

// ── Insider signals admin review (aitj-z8q.9) ──

function insiderOptions() {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool(),
    useMemory: !ctx.usePostgres
  };
}

function actorId(req) {
  return req.user?.id || "admin-token";
}

router.get("/signals", requireAdminOrToken, async (req, res) => {
  try {
    const status = req.query.status ? ctx.sanitizeText(String(req.query.status)) : undefined;
    const companySlug = req.query.company || req.query.companySlug
      ? ctx.sanitizeText(String(req.query.company || req.query.companySlug))
      : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 200);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const result = await insider.listSignals(
      { status, companySlug, limit, offset },
      insiderOptions()
    );
    res.json({
      signals: result.signals.map((s) => insider.toStaffSignal(s)),
      total: result.total,
      limit,
      offset
    });
  } catch (err) {
    console.error("admin list signals failed:", err);
    res.status(500).json({ message: "Failed to list signals" });
  }
});

router.get("/signals/:id", requireAdminOrToken, async (req, res) => {
  try {
    const s = await insider.getSignal(req.params.id, insiderOptions());
    if (!s) {
      res.status(404).json({ message: "Signal not found" });
      return;
    }
    const evidenceRows = await insider.listEvidenceForSignal(s.id, insiderOptions());
    // Metadata only — no storage keys on list
    const evidence = evidenceRows.map((e) => insider.toEvidenceStaffMeta(e));
    const links = await insider.listLinkedSignals(s.id, insiderOptions());
    // links contain peerSignalId only (no authors)
    res.json({
      signal: insider.toStaffSignal(s),
      evidence,
      links
    });
  } catch (err) {
    console.error("admin get signal failed:", err);
    res.status(500).json({ message: "Failed to get signal" });
  }
});

router.post("/signals/:id/status", requireAdminOrToken, async (req, res) => {
  const toStatus = ctx.sanitizeText(String(req.body?.status || ""));
  if (!toStatus || !valuesOf(INSIDER_SIGNAL_STATUS).includes(toStatus)) {
    res.status(422).json({ message: "Invalid status", allowed: valuesOf(INSIDER_SIGNAL_STATUS) });
    return;
  }
  try {
    const opts = {
      ...insiderOptions(),
      summaryPublic: req.body?.summaryPublic
        ? ctx.sanitizeText(String(req.body.summaryPublic))
        : undefined,
      verificationLevel: req.body?.verificationLevel
        ? ctx.sanitizeText(String(req.body.verificationLevel))
        : undefined
    };
    const updated = await insider.transitionSignal(req.params.id, toStatus, opts);
    await ctx.storageAudit({
      action: "insider_signal.status",
      actorId: actorId(req),
      targetType: "insider_signal",
      targetId: req.params.id,
      metadata: { status: updated.status, verificationLevel: updated.verificationLevel },
      ip: req.ip
    });
    res.json({ ok: true, signal: insider.toStaffSignal(updated) });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "ILLEGAL_TRANSITION" || err.code === "LEGAL_HOLD" || err.code === "INVALID_STATUS") {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    console.error("admin signal status failed:", err);
    res.status(500).json({ message: "Failed to update signal status" });
  }
});

router.post("/signals/:id/verification", requireAdminOrToken, async (req, res) => {
  const level = ctx.sanitizeText(String(req.body?.verificationLevel || req.body?.level || ""));
  if (!valuesOf(VERIFICATION_LEVEL).includes(level)) {
    res.status(422).json({ message: "Invalid verificationLevel", allowed: valuesOf(VERIFICATION_LEVEL) });
    return;
  }
  try {
    const updated = await insider.setVerificationLevel(req.params.id, level, insiderOptions());
    await ctx.storageAudit({
      action: "insider_signal.verification",
      actorId: actorId(req),
      targetType: "insider_signal",
      targetId: req.params.id,
      metadata: { verificationLevel: level },
      ip: req.ip
    });
    res.json({ ok: true, signal: insider.toStaffSignal(updated) });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    console.error("admin signal verification failed:", err);
    res.status(500).json({ message: "Failed to set verification level" });
  }
});

router.post("/signals/:id/summary", requireAdminOrToken, async (req, res) => {
  try {
    const summaryPublic = ctx.sanitizeText(String(req.body?.summaryPublic || req.body?.summary || ""));
    const updated = await insider.updateSignalFields(
      req.params.id,
      { summaryPublic },
      { ...insiderOptions(), staff: true }
    );
    await ctx.storageAudit({
      action: "insider_signal.summary",
      actorId: actorId(req),
      targetType: "insider_signal",
      targetId: req.params.id,
      metadata: { summaryLen: summaryPublic.length },
      ip: req.ip
    });
    res.json({ ok: true, signal: insider.toStaffSignal(updated) });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    console.error("admin signal summary failed:", err);
    res.status(500).json({ message: "Failed to update summary" });
  }
});

/** Link two independent reports without exposing authors. */
router.post("/signals/:id/link", requireAdminOrToken, async (req, res) => {
  const peerId = ctx.sanitizeText(String(req.body?.peerSignalId || req.body?.signalId || ""));
  if (!peerId) {
    res.status(422).json({ message: "peerSignalId is required" });
    return;
  }
  try {
    const result = await insider.linkSignals(
      req.params.id,
      peerId,
      {
        linkedBy: actorId(req),
        reason: ctx.sanitizeText(String(req.body?.reason || ""))
      },
      insiderOptions()
    );
    // Response deliberately omits author ids of either report
    await ctx.storageAudit({
      action: "insider_signal.link",
      actorId: actorId(req),
      targetType: "signal_link",
      targetId: result.link.id,
      metadata: {
        signalIdA: result.link.signalIdA,
        signalIdB: result.link.signalIdB,
        created: result.created
      },
      ip: req.ip
    });
    res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      link: {
        id: result.link.id,
        signalIdA: result.link.signalIdA,
        signalIdB: result.link.signalIdB,
        reason: result.link.reason,
        createdAt: result.link.createdAt
      }
    });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "INVALID_LINK") {
      res.status(422).json({ message: err.message });
      return;
    }
    console.error("admin link signals failed:", err);
    res.status(500).json({ message: "Failed to link signals" });
  }
});

router.post("/signals/:id/legal-hold", requireAdminOrToken, async (req, res) => {
  try {
    const updated = await insider.placeLegalHold(req.params.id, insiderOptions());
    await ctx.storageAudit({
      action: "insider_signal.legal_hold",
      actorId: actorId(req),
      targetType: "insider_signal",
      targetId: req.params.id,
      metadata: { status: updated.status, reason: ctx.sanitizeText(String(req.body?.reason || "")) },
      ip: req.ip
    });
    res.json({ ok: true, signal: insider.toStaffSignal(updated) });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "ILLEGAL_TRANSITION" || err.code === "INVALID_STATUS") {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    console.error("admin legal hold failed:", err);
    res.status(500).json({ message: "Failed to place legal hold" });
  }
});

router.post("/signals/:id/release-hold", requireAdminOrToken, async (req, res) => {
  const toStatus = ctx.sanitizeText(
    String(req.body?.status || INSIDER_SIGNAL_STATUS.UNDER_REVIEW)
  );
  try {
    const updated = await insider.releaseLegalHold(req.params.id, toStatus, {
      ...insiderOptions(),
      summaryPublic: req.body?.summaryPublic
        ? ctx.sanitizeText(String(req.body.summaryPublic))
        : undefined
    });
    await ctx.storageAudit({
      action: "insider_signal.release_hold",
      actorId: actorId(req),
      targetType: "insider_signal",
      targetId: req.params.id,
      metadata: { status: updated.status },
      ip: req.ip
    });
    res.json({ ok: true, signal: insider.toStaffSignal(updated) });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "ILLEGAL_TRANSITION" || err.code === "INVALID_STATUS") {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    console.error("admin release hold failed:", err);
    res.status(500).json({ message: "Failed to release legal hold" });
  }
});

router.post("/signals/:id/delete", requireAdminOrToken, requireConfirm, async (req, res) => {
  try {
    const updated = await insider.softDeleteSignal(req.params.id, insiderOptions());
    await ctx.storageAudit({
      action: "insider_signal.delete",
      actorId: actorId(req),
      targetType: "insider_signal",
      targetId: req.params.id,
      metadata: { status: updated.status, purgeAfter: updated.purgeAfter, confirmed: true },
      ip: req.ip
    });
    res.json({ ok: true, signal: insider.toStaffSignal(updated) });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "LEGAL_HOLD" || err.code === "ILLEGAL_TRANSITION") {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    console.error("admin delete signal failed:", err);
    res.status(500).json({ message: "Failed to delete signal" });
  }
});

/** Privileged evidence access — always audited; never a public surface. */
router.get("/evidence/:id", requireAdminOrToken, async (req, res) => {
  try {
    const includeStorageKey = String(req.query.download || "") === "1";
    const meta = await insider.accessEvidence(
      req.params.id,
      {
        actorId: actorId(req),
        action: includeStorageKey ? "download" : "view",
        reason: ctx.sanitizeText(String(req.query.reason || "admin_review")),
        ip: req.ip,
        includeStorageKey
      },
      insiderOptions()
    );
    res.json({ evidence: meta });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "PURGED") {
      res.status(410).json({ message: err.message, code: "PURGED" });
      return;
    }
    console.error("admin evidence access failed:", err);
    res.status(500).json({ message: "Failed to access evidence" });
  }
});

router.get("/evidence/:id/access-log", requireAdminOrToken, async (req, res) => {
  try {
    const log = await insider.listEvidenceAccessLog(
      req.params.id,
      { limit: Math.min(Math.max(Number(req.query.limit || 100), 1), 500) },
      insiderOptions()
    );
    res.json({ evidenceId: req.params.id, accessLog: log });
  } catch (err) {
    console.error("admin evidence access log failed:", err);
    res.status(500).json({ message: "Failed to list access log" });
  }
});

router.post("/evidence/:id/status", requireAdminOrToken, async (req, res) => {
  const toStatus = ctx.sanitizeText(String(req.body?.status || ""));
  if (!valuesOf(EVIDENCE_STATUS).includes(toStatus)) {
    res.status(422).json({ message: "Invalid evidence status", allowed: valuesOf(EVIDENCE_STATUS) });
    return;
  }
  try {
    const updated = await insider.transitionEvidence(req.params.id, toStatus, {
      ...insiderOptions(),
      actorId: actorId(req),
      reason: ctx.sanitizeText(String(req.body?.reason || "")),
      redactionNotes: req.body?.redactionNotes
        ? ctx.sanitizeText(String(req.body.redactionNotes))
        : undefined,
      ip: req.ip
    });
    res.json({ ok: true, evidence: updated });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "ILLEGAL_TRANSITION" || err.code === "INVALID_STATUS") {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    console.error("admin evidence status failed:", err);
    res.status(500).json({ message: "Failed to update evidence status" });
  }
});

router.post("/evidence/:id/redact", requireAdminOrToken, async (req, res) => {
  try {
    const ev = await insider.getEvidence(req.params.id, insiderOptions());
    if (!ev) {
      res.status(404).json({ message: "Evidence not found" });
      return;
    }
    // Transition toward redacted if not already
    let updated = ev;
    if (ev.status !== EVIDENCE_STATUS.REDACTED && ev.status !== EVIDENCE_STATUS.PURGED) {
      // available|restricted → redacted
      if (ev.status === EVIDENCE_STATUS.UPLOADED || ev.status === EVIDENCE_STATUS.SCANNING) {
        // move through available first if needed — domain allows uploaded→scanning→available
        // For staff redaction shortcut: if canTransition to redacted use it; else step
        const d = require("../lib/domain-contract");
        if (d.canTransition("evidence", ev.status, EVIDENCE_STATUS.REDACTED)) {
          updated = await insider.transitionEvidence(req.params.id, EVIDENCE_STATUS.REDACTED, {
            ...insiderOptions(),
            actorId: actorId(req),
            reason: "redact",
            redactionNotes: ctx.sanitizeText(String(req.body?.notes || "")),
            ip: req.ip
          });
        } else if (d.canTransition("evidence", ev.status, EVIDENCE_STATUS.AVAILABLE)) {
          await insider.transitionEvidence(req.params.id, EVIDENCE_STATUS.AVAILABLE, {
            ...insiderOptions(),
            actorId: actorId(req),
            reason: "prep_redact",
            ip: req.ip
          });
          updated = await insider.transitionEvidence(req.params.id, EVIDENCE_STATUS.REDACTED, {
            ...insiderOptions(),
            actorId: actorId(req),
            reason: "redact",
            redactionNotes: ctx.sanitizeText(String(req.body?.notes || "")),
            ip: req.ip
          });
        } else if (d.canTransition("evidence", ev.status, EVIDENCE_STATUS.SCANNING)) {
          await insider.transitionEvidence(req.params.id, EVIDENCE_STATUS.SCANNING, {
            ...insiderOptions(),
            actorId: actorId(req),
            reason: "prep_redact",
            ip: req.ip
          });
          await insider.transitionEvidence(req.params.id, EVIDENCE_STATUS.AVAILABLE, {
            ...insiderOptions(),
            actorId: actorId(req),
            reason: "prep_redact",
            ip: req.ip
          });
          updated = await insider.transitionEvidence(req.params.id, EVIDENCE_STATUS.REDACTED, {
            ...insiderOptions(),
            actorId: actorId(req),
            reason: "redact",
            redactionNotes: ctx.sanitizeText(String(req.body?.notes || "")),
            ip: req.ip
          });
        } else {
          res.status(409).json({ message: `Cannot redact from status ${ev.status}` });
          return;
        }
      } else {
        updated = await insider.transitionEvidence(req.params.id, EVIDENCE_STATUS.REDACTED, {
          ...insiderOptions(),
          actorId: actorId(req),
          reason: "redact",
          redactionNotes: ctx.sanitizeText(String(req.body?.notes || "")),
          ip: req.ip
        });
      }
    } else {
      updated = insider.toEvidenceStaffMeta(ev);
    }
    res.json({ ok: true, evidence: updated });
  } catch (err) {
    if (err.code === "ILLEGAL_TRANSITION") {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    console.error("admin evidence redact failed:", err);
    res.status(500).json({ message: "Failed to redact evidence" });
  }
});


// ── Notification deliveries (aitj-z8q.15) ──

function notifOptions() {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool(),
    useMemory: !ctx.usePostgres,
    sendTelegram: (chatId, text) => ctx.sendTelegramMessage(chatId, text),
    jobsOptions: {
      usePostgres: ctx.usePostgres,
      getPool: () => ctx.getPgPool(),
      useMemory: !ctx.usePostgres
    }
  };
}

router.get("/notifications/deliveries", requireAdminOrToken, async (req, res) => {
  try {
    const result = await notifications.listDeliveries(
      {
        status: req.query.status ? String(req.query.status) : undefined,
        templateKey: req.query.templateKey || req.query.template_key || undefined,
        channel: req.query.channel ? String(req.query.channel) : undefined,
        limit: req.query.limit,
        offset: req.query.offset
      },
      notifOptions()
    );
    res.json({
      deliveries: result.deliveries.map(notifications.deliveryToPublic),
      total: result.total,
      emailProvider: notifications.resolveEmailProvider(),
      smtpConfigured: notifications.smtpConfigured()
    });
  } catch (err) {
    console.error("admin list notification deliveries failed:", notifications.redactEmailsInText(err.message || err));
    res.status(500).json({ message: "Failed to list notification deliveries" });
  }
});

router.get("/notifications/deliveries/:id", requireAdminOrToken, async (req, res) => {
  try {
    const delivery = await notifications.getDelivery(req.params.id, notifOptions());
    if (!delivery) {
      res.status(404).json({ message: "Delivery not found" });
      return;
    }
    res.json({ delivery: notifications.deliveryToPublic(delivery) });
  } catch (err) {
    console.error("admin get notification delivery failed:", notifications.redactEmailsInText(err.message || err));
    res.status(500).json({ message: "Failed to get notification delivery" });
  }
});

router.post("/notifications/deliveries/:id/retry", requireAdminOrToken, async (req, res) => {
  try {
    const enqueue = req.body?.enqueue !== false;
    const out = await notifications.retryDelivery(req.params.id, {
      ...notifOptions(),
      enqueue
    });
    if (!out.ok && out.reason === "not_found") {
      res.status(404).json({ message: "Delivery not found" });
      return;
    }
    if (!out.ok && out.reason === "already_delivered") {
      res.status(409).json({
        ok: false,
        message: "Already delivered",
        delivery: notifications.deliveryToPublic(out.delivery)
      });
      return;
    }
    await ctx.storageAudit({
      action: "notification.retry",
      actorId: req.user?.id || "admin-token",
      targetType: "notification_delivery",
      targetId: req.params.id,
      metadata: {
        enqueued: Boolean(out.enqueued),
        status: out.delivery?.status || out.result?.delivery?.status || null
      },
      ip: req.ip
    });
    res.json({
      ok: true,
      enqueued: Boolean(out.enqueued),
      delivery: notifications.deliveryToPublic(out.delivery || out.result?.delivery),
      job: out.job || null
    });
  } catch (err) {
    console.error("admin retry notification failed:", notifications.redactEmailsInText(err.message || err));
    res.status(500).json({ message: "Failed to retry notification delivery" });
  }
});

/** Bounce webhook hook — provider adapters POST here (admin auth). */
router.post("/notifications/webhooks/bounce", requireAdminOrToken, async (req, res) => {
  try {
    const email = req.body?.email ? ctx.normalizeEmail(req.body.email) : null;
    const messageId = req.body?.messageId || req.body?.message_id || null;
    const reason = ctx.sanitizeText(req.body?.reason || "bounce");
    const out = await notifications.handleBounce({ email, messageId, reason }, notifOptions());
    await ctx.storageAudit({
      action: "notification.bounce",
      actorId: req.user?.id || "admin-token",
      targetType: "notification_delivery",
      targetId: messageId || "bounce",
      metadata: {
        matched: out.matched || 0,
        emailHash: email ? notifications.hashEmail(email) : null,
        reason
      },
      ip: req.ip
    });
    res.json(out);
  } catch (err) {
    console.error("bounce webhook failed:", notifications.redactEmailsInText(err.message || err));
    res.status(500).json({ message: "Failed to process bounce" });
  }
});

/** Complaint webhook hook — provider adapters POST here (admin auth). */
router.post("/notifications/webhooks/complaint", requireAdminOrToken, async (req, res) => {
  try {
    const email = req.body?.email ? ctx.normalizeEmail(req.body.email) : null;
    const messageId = req.body?.messageId || req.body?.message_id || null;
    const reason = ctx.sanitizeText(req.body?.reason || "complaint");
    const out = await notifications.handleComplaint({ email, messageId, reason }, notifOptions());
    await ctx.storageAudit({
      action: "notification.complaint",
      actorId: req.user?.id || "admin-token",
      targetType: "notification_delivery",
      targetId: messageId || "complaint",
      metadata: {
        matched: out.matched || 0,
        emailHash: email ? notifications.hashEmail(email) : null,
        reason
      },
      ip: req.ip
    });
    res.json(out);
  } catch (err) {
    console.error("complaint webhook failed:", notifications.redactEmailsInText(err.message || err));
    res.status(500).json({ message: "Failed to process complaint" });
  }
});

// ── Unified ops console (aitj-z8q.16) ───────────────────────────────────────

/** Aggregate queue: content moderation + reports + crisis + appeals + takedowns + signals. */
router.get("/queue/unified", requireAdminOrToken, async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
    const [moderation, socialReports, resourceReports, crisis, appeals, takedowns, signals] =
      await Promise.all([
        ctx.storageGetModerationQueue(),
        social.listReports({ status: "open", limit: 50 }, socialOptions(req)).catch(() => []),
        ctx.storageGetResourceReports({ status: "open", limit: 50 }),
        adminOps.listCrisisCases({ status: "open", limit: 50 }, opsOptions()),
        adminOps.listAppeals({ status: "submitted", limit: 50 }, opsOptions()),
        adminOps.listTakedownsAdmin({ status: "pending", limit: 50 }, opsOptions()),
        insider
          .listSignals({ status: INSIDER_SIGNAL_STATUS.SUBMITTED, limit: 50, offset: 0 }, insiderOptions())
          .catch(() => ({ signals: [], total: 0 }))
      ]);

    const items = [];
    for (const q of moderation) {
      items.push({
        id: q.id,
        kind: "moderation",
        type: q.type,
        title: q.title,
        summary: (q.story || "").slice(0, 240),
        status: "pending",
        createdAt: q.createdAt,
        meta: q.moderation || q.metadata || {},
        href: `/api/admin/moderation/queue`
      });
    }
    for (const r of socialReports) {
      items.push({
        id: `social_report:${r.id}`,
        kind: "social_report",
        type: r.targetType,
        title: `Social report · ${r.targetType}:${r.targetId}`,
        summary: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        meta: { details: r.details },
        href: `/api/social/admin/reports`
      });
    }
    for (const r of resourceReports) {
      items.push({
        id: `resource_report:${r.id}`,
        kind: "resource_report",
        type: "resource",
        title: `Resource report · ${r.resourceId || r.id}`,
        summary: r.reason || "",
        status: r.status,
        createdAt: r.createdAt,
        meta: {},
        href: `/api/admin/resources/reports`
      });
    }
    for (const c of crisis.cases) {
      items.push({
        id: `crisis:${c.id}`,
        kind: "crisis",
        type: c.sourceType,
        title: `Crisis · ${c.sourceType}:${c.sourceId}`,
        summary: c.excerpt,
        status: c.status,
        slaState: c.slaState,
        slaDueAt: c.slaDueAt,
        createdAt: c.createdAt,
        meta: { riskScore: c.riskScore },
        href: `/api/admin/crisis/${c.id}`
      });
    }
    for (const a of appeals.appeals) {
      items.push({
        id: `appeal:${a.id}`,
        kind: "appeal",
        type: a.targetType,
        title: `Appeal · ${a.targetType}:${a.targetId}`,
        summary: a.reason,
        status: a.status,
        slaState: a.slaState,
        slaDueAt: a.slaDueAt,
        createdAt: a.createdAt,
        meta: {},
        href: `/api/admin/appeals/${a.id}`
      });
    }
    for (const t of takedowns.takedowns) {
      items.push({
        id: `takedown:${t.id}`,
        kind: "takedown",
        type: "legal",
        title: `Takedown · ${t.targetUrl}`,
        summary: t.reason,
        status: t.status,
        createdAt: t.createdAt,
        meta: { legalBasis: t.legalBasis },
        href: `/api/admin/takedowns`
      });
    }
    for (const s of signals.signals || []) {
      items.push({
        id: `signal:${s.id}`,
        kind: "insider_signal",
        type: "signal",
        title: `Insider signal · ${s.companySlug || s.id}`,
        summary: (s.summaryPublic || s.status || "").slice(0, 240),
        status: s.status,
        createdAt: s.createdAt,
        meta: { verificationLevel: s.verificationLevel },
        href: `/api/admin/signals/${s.id}`
      });
    }

    items.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({
      items: items.slice(0, limit),
      total: items.length,
      counts: {
        moderation: moderation.length,
        socialReports: socialReports.length,
        resourceReports: resourceReports.length,
        crisis: crisis.total,
        appeals: appeals.total,
        takedowns: takedowns.total,
        signals: signals.total || (signals.signals || []).length
      }
    });
  } catch (err) {
    console.error("unified queue failed:", err);
    res.status(500).json({ message: "Failed to build unified queue" });
  }
});

// ── Appeals ──────────────────────────────────────────────────────────────────

router.get("/appeals", requireAdminOrToken, async (req, res) => {
  try {
    const result = await adminOps.listAppeals(
      {
        status: req.query.status ? String(req.query.status) : undefined,
        slaState: req.query.slaState || req.query.sla_state || undefined,
        limit: req.query.limit,
        offset: req.query.offset
      },
      opsOptions()
    );
    res.json({
      appeals: result.appeals,
      total: result.total,
      statuses: valuesOf(APPEAL_STATUS),
      slaStates: valuesOf(SLA_STATE)
    });
  } catch (err) {
    console.error("list appeals failed:", err);
    res.status(500).json({ message: "Failed to list appeals" });
  }
});

router.get("/appeals/:id", requireAdminOrToken, async (req, res) => {
  const appeal = await adminOps.getAppeal(req.params.id, opsOptions());
  if (!appeal) {
    res.status(404).json({ message: "Appeal not found" });
    return;
  }
  res.json({ appeal });
});

router.post("/appeals/:id/status", requireAdminOrToken, async (req, res) => {
  const toStatus = ctx.sanitizeText(String(req.body?.status || ""));
  if (!valuesOf(APPEAL_STATUS).includes(toStatus)) {
    res.status(422).json({ message: "Invalid status", allowed: valuesOf(APPEAL_STATUS) });
    return;
  }
  // Overturn / uphold are destructive resolutions
  if (toStatus === APPEAL_STATUS.OVERTURNED || toStatus === APPEAL_STATUS.UPHELD) {
    if (req.body?.confirm !== true) {
      res.status(422).json({ message: "Destructive action requires confirm: true", code: "CONFIRM_REQUIRED" });
      return;
    }
  }
  try {
    const updated = await adminOps.transitionAppeal(
      req.params.id,
      toStatus,
      {
        actorId: actorId(req),
        note: ctx.sanitizeText(String(req.body?.note || req.body?.resolutionNote || "")),
        assignedTo: req.body?.assignedTo
          ? ctx.sanitizeText(String(req.body.assignedTo))
          : undefined
      },
      opsOptions()
    );
    await ctx.storageAudit({
      action: "appeal.status",
      actorId: actorId(req),
      targetType: "appeal",
      targetId: req.params.id,
      metadata: { status: updated.status, slaState: updated.slaState, confirmed: req.body?.confirm === true },
      ip: req.ip
    });
    res.json({ ok: true, appeal: updated });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "ILLEGAL_TRANSITION" || err.code === "INVALID_STATUS") {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    console.error("appeal status failed:", err);
    res.status(500).json({ message: "Failed to update appeal" });
  }
});

// ── Crisis ───────────────────────────────────────────────────────────────────

router.get("/crisis", requireAdminOrToken, async (req, res) => {
  try {
    const result = await adminOps.listCrisisCases(
      {
        status: req.query.status ? String(req.query.status) : undefined,
        slaState: req.query.slaState || req.query.sla_state || undefined,
        limit: req.query.limit,
        offset: req.query.offset
      },
      opsOptions()
    );
    res.json({
      cases: result.cases,
      total: result.total,
      statuses: valuesOf(CRISIS_CASE_STATUS),
      slaStates: valuesOf(SLA_STATE)
    });
  } catch (err) {
    console.error("list crisis failed:", err);
    res.status(500).json({ message: "Failed to list crisis cases" });
  }
});

router.get("/crisis/:id", requireAdminOrToken, async (req, res) => {
  const c = await adminOps.getCrisisCase(req.params.id, opsOptions());
  if (!c) {
    res.status(404).json({ message: "Crisis case not found" });
    return;
  }
  res.json({ case: c, resources: ctx.getCrisisResources(c.country) });
});

router.post("/crisis", requireAdminOrToken, async (req, res) => {
  try {
    const sourceType = ctx.sanitizeText(String(req.body?.sourceType || req.body?.source_type || "content"));
    const sourceId = ctx.sanitizeText(String(req.body?.sourceId || req.body?.source_id || ""));
    if (!sourceId) {
      res.status(422).json({ message: "sourceId is required" });
      return;
    }
    const created = await adminOps.createCrisisCase(
      {
        sourceType,
        sourceId,
        country: ctx.normalizeCountry(req.body?.country || "global"),
        excerpt: ctx.sanitizeText(String(req.body?.excerpt || "")),
        riskScore: Number(req.body?.riskScore || 1),
        resourcesOffered: ctx.getCrisisResources(ctx.normalizeCountry(req.body?.country || "global"))
      },
      opsOptions()
    );
    await ctx.storageAudit({
      action: "crisis.create",
      actorId: actorId(req),
      targetType: "crisis_case",
      targetId: created.id,
      metadata: { sourceType, sourceId },
      ip: req.ip
    });
    res.status(201).json({ ok: true, case: created });
  } catch (err) {
    console.error("create crisis failed:", err);
    res.status(500).json({ message: "Failed to create crisis case" });
  }
});

router.post("/crisis/:id/status", requireAdminOrToken, async (req, res) => {
  const toStatus = ctx.sanitizeText(String(req.body?.status || ""));
  if (!valuesOf(CRISIS_CASE_STATUS).includes(toStatus)) {
    res.status(422).json({ message: "Invalid status", allowed: valuesOf(CRISIS_CASE_STATUS) });
    return;
  }
  if (toStatus === CRISIS_CASE_STATUS.RESOLVED || toStatus === CRISIS_CASE_STATUS.FALSE_POSITIVE) {
    if (req.body?.confirm !== true) {
      res.status(422).json({ message: "Destructive action requires confirm: true", code: "CONFIRM_REQUIRED" });
      return;
    }
  }
  try {
    const updated = await adminOps.transitionCrisisCase(
      req.params.id,
      toStatus,
      {
        actorId: actorId(req),
        notes: ctx.sanitizeText(String(req.body?.notes || req.body?.note || "")),
        assignedTo: req.body?.assignedTo
          ? ctx.sanitizeText(String(req.body.assignedTo))
          : undefined
      },
      opsOptions()
    );
    await ctx.storageAudit({
      action: "crisis.status",
      actorId: actorId(req),
      targetType: "crisis_case",
      targetId: req.params.id,
      metadata: { status: updated.status, slaState: updated.slaState, confirmed: req.body?.confirm === true },
      ip: req.ip
    });
    res.json({ ok: true, case: updated });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "ILLEGAL_TRANSITION" || err.code === "INVALID_STATUS") {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    console.error("crisis status failed:", err);
    res.status(500).json({ message: "Failed to update crisis case" });
  }
});

/** Scan recent pending content for crisis keywords and open cases. */
router.post("/crisis/scan", requireAdminOrToken, async (req, res) => {
  try {
    const stories = (await ctx.storageGetStories()).filter((s) => s.status === "pending").slice(0, 50);
    const vents = (await ctx.storageGetVents()).filter((v) => v.status === "pending").slice(0, 50);
    const opened = [];
    for (const s of stories) {
      const score = s.moderation || ctx.scoreModeration({ story: s.story, reason: s.reason });
      const out = await adminOps.ensureCrisisFromModeration(
        {
          sourceType: "story",
          sourceId: s.id,
          text: s.story,
          country: s.country,
          score
        },
        opsOptions()
      );
      if (out?.created) opened.push(out.case);
    }
    for (const v of vents) {
      const score = v.moderation || ctx.scoreModeration({ story: v.body, reason: "" });
      const out = await adminOps.ensureCrisisFromModeration(
        {
          sourceType: "vent",
          sourceId: v.id,
          text: v.body,
          country: v.country,
          score
        },
        opsOptions()
      );
      if (out?.created) opened.push(out.case);
    }
    await ctx.storageAudit({
      action: "crisis.scan",
      actorId: actorId(req),
      targetType: "crisis_case",
      targetId: "batch",
      metadata: { opened: opened.length },
      ip: req.ip
    });
    res.json({ ok: true, opened: opened.length, cases: opened });
  } catch (err) {
    console.error("crisis scan failed:", err);
    res.status(500).json({ message: "Failed to scan for crisis content" });
  }
});

// ── Sanctions list ───────────────────────────────────────────────────────────

router.get("/sanctions", requireAdminOrToken, async (req, res) => {
  try {
    const result = await adminOps.listSanctions(
      {
        targetUserId: req.query.userId || req.query.targetUserId || undefined,
        limit: req.query.limit,
        offset: req.query.offset
      },
      opsOptions()
    );
    res.json({
      sanctions: result.sanctions,
      total: result.total,
      types: valuesOf(SANCTION_TYPE)
    });
  } catch (err) {
    console.error("list sanctions failed:", err);
    res.status(500).json({ message: "Failed to list sanctions" });
  }
});

// ── Takedowns ────────────────────────────────────────────────────────────────

router.get("/takedowns", requireAdminOrToken, async (req, res) => {
  try {
    const result = await adminOps.listTakedownsAdmin(
      {
        status: req.query.status ? String(req.query.status) : undefined,
        limit: req.query.limit,
        offset: req.query.offset
      },
      opsOptions()
    );
    res.json({
      takedowns: result.takedowns,
      total: result.total,
      statuses: valuesOf(TAKEDOWN_STATUS)
    });
  } catch (err) {
    console.error("list takedowns failed:", err);
    res.status(500).json({ message: "Failed to list takedowns" });
  }
});

router.post("/takedowns/:id/resolve", requireAdminOrToken, requireMinRole("admin"), async (req, res) => {
  const status = ctx.sanitizeText(String(req.body?.status || ""));
  if (!valuesOf(TAKEDOWN_STATUS).includes(status)) {
    res.status(422).json({ message: "Invalid status", allowed: valuesOf(TAKEDOWN_STATUS) });
    return;
  }
  if (status === TAKEDOWN_STATUS.ACCEPTED || status === TAKEDOWN_STATUS.COMPLETED) {
    if (req.body?.confirm !== true) {
      res.status(422).json({ message: "Destructive action requires confirm: true", code: "CONFIRM_REQUIRED" });
      return;
    }
  }
  try {
    const updated = await adminOps.resolveTakedown(
      req.params.id,
      {
        status,
        note: ctx.sanitizeText(String(req.body?.note || req.body?.resolutionNote || "")),
        actorId: actorId(req)
      },
      opsOptions()
    );
    await ctx.storageAudit({
      action: "takedown.resolve",
      actorId: actorId(req),
      targetType: "takedown",
      targetId: req.params.id,
      metadata: { status: updated.status, confirmed: req.body?.confirm === true },
      ip: req.ip
    });
    res.json({ ok: true, takedown: updated });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      res.status(404).json({ message: err.message });
      return;
    }
    if (err.code === "ILLEGAL_TRANSITION" || err.code === "INVALID_STATUS") {
      res.status(409).json({ message: err.message, code: err.code });
      return;
    }
    console.error("takedown resolve failed:", err);
    res.status(500).json({ message: "Failed to resolve takedown" });
  }
});

// ── Reports (aggregated) ─────────────────────────────────────────────────────

router.get("/reports", requireAdminOrToken, async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : "open";
    const [expression, socialReports, resourceReports] = await Promise.all([
      ctx.storageGetExpressionReports({ status: status === "open" ? "open" : status, limit: 100 }),
      social.listReports({ status: status === "open" ? "open" : status, limit: 100 }, socialOptions(req)).catch(() => []),
      ctx.storageGetResourceReports({ status: status === "open" ? "open" : undefined, limit: 100 })
    ]);
    res.json({
      expression,
      social: socialReports,
      resources: resourceReports,
      totals: {
        expression: expression.length,
        social: socialReports.length,
        resources: resourceReports.length
      }
    });
  } catch (err) {
    console.error("list reports failed:", err);
    res.status(500).json({ message: "Failed to list reports" });
  }
});

router.post("/reports/expression/:id/resolve", requireAdminOrToken, async (req, res) => {
  const status = ctx.sanitizeText(String(req.body?.status || "resolved"));
  if (!["resolved", "dismissed", "open"].includes(status)) {
    res.status(422).json({ message: "status must be resolved|dismissed|open" });
    return;
  }
  const updated = await ctx.storageUpdateExpressionReport(req.params.id, {
    status,
    resolution: ctx.sanitizeText(String(req.body?.note || req.body?.resolution || ""))
  });
  if (!updated) {
    res.status(404).json({ message: "Report not found" });
    return;
  }
  await ctx.storageAudit({
    action: "expression.report.resolve",
    actorId: actorId(req),
    targetType: "expression_report",
    targetId: req.params.id,
    metadata: { status },
    ip: req.ip
  });
  res.json({ ok: true, report: updated });
});

router.post("/reports/social/:id/resolve", requireAdminOrToken, async (req, res) => {
  const status = ctx.sanitizeText(String(req.body?.status || "resolved"));
  const result = await social.resolveReport(
    {
      id: req.params.id,
      resolverId: actorId(req),
      status,
      note: ctx.sanitizeText(String(req.body?.note || ""))
    },
    socialOptions(req)
  );
  if (!result.ok) {
    res.status(result.reason === "not_found" ? 404 : 422).json({ message: result.reason || "Failed" });
    return;
  }
  res.json({ ok: true });
});

// ── Users / roles ────────────────────────────────────────────────────────────

router.get("/users", requireAdminOrToken, requireMinRole("admin"), async (req, res) => {
  try {
    const users = await ctx.storageGetUsers();
    const q = String(req.query.q || "").toLowerCase().trim();
    const role = req.query.role ? String(req.query.role) : null;
    let rows = users.map((u) => adminOps.publicUser(u));
    if (q) {
      rows = rows.filter(
        (u) =>
          String(u.email || "").toLowerCase().includes(q) ||
          String(u.id || "").toLowerCase().includes(q)
      );
    }
    if (role) rows = rows.filter((u) => u.role === role);
    rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    res.json({
      users: rows.slice(0, limit),
      total: rows.length,
      roles: ctx.roles
    });
  } catch (err) {
    console.error("list users failed:", err);
    res.status(500).json({ message: "Failed to list users" });
  }
});

router.post(
  "/users/:id/role",
  requireAdminOrToken,
  requireMinRole("admin"),
  requireConfirm,
  async (req, res) => {
    const role = ctx.sanitizeText(String(req.body?.role || ""));
    if (!adminOps.STAFF_ROLES.has(role)) {
      res.status(422).json({ message: "Invalid role", allowed: [...adminOps.STAFF_ROLES] });
      return;
    }
    if (!canAssignRole(req, role)) {
      res.status(403).json({
        message: "Not allowed to assign this role",
        code: "RBAC_DENIED"
      });
      return;
    }
    try {
      const updated = await adminOps.updateUserRole(req.params.id, role, opsOptions());
      await ctx.storageAudit({
        action: "user.role",
        actorId: actorId(req),
        targetType: "user",
        targetId: req.params.id,
        metadata: { role, confirmed: true },
        ip: req.ip
      });
      res.json({ ok: true, user: updated });
    } catch (err) {
      if (err.code === "NOT_FOUND") {
        res.status(404).json({ message: err.message });
        return;
      }
      if (err.code === "INVALID_ROLE") {
        res.status(422).json({ message: err.message });
        return;
      }
      console.error("user role failed:", err);
      res.status(500).json({ message: "Failed to update role" });
    }
  }
);

router.post(
  "/users/:id/delete",
  requireAdminOrToken,
  requireSuperadmin,
  requireConfirm,
  async (req, res) => {
    const user = await ctx.storageGetUserById(req.params.id);
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }
    await ctx.storageDeleteUser(req.params.id);
    await ctx.storageAudit({
      action: "user.delete",
      actorId: actorId(req),
      targetType: "user",
      targetId: req.params.id,
      metadata: { email: user.email, confirmed: true },
      ip: req.ip
    });
    res.json({ ok: true });
  }
);

// ── Companies ────────────────────────────────────────────────────────────────

router.get("/companies", requireAdminOrToken, async (req, res) => {
  try {
    const stories = await ctx.storageGetStories();
    const boards = await ctx.storageGetCompanyBoards();
    const published = stories.filter((s) => s.status === "published");
    const top = ctx.getTopCompanies(published, "global");
    res.json({
      topCompanies: top,
      boards,
      totalStories: published.length
    });
  } catch (err) {
    console.error("list companies failed:", err);
    res.status(500).json({ message: "Failed to list companies" });
  }
});

// ── Audit log ────────────────────────────────────────────────────────────────

router.get("/audit", requireAdminOrToken, requireMinRole("admin"), async (req, res) => {
  try {
    const hours = Math.min(Math.max(Number(req.query.hours || 24), 1), 720);
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600 * 1000);
    const events = await ctx.storageGetAuditRange(from.toISOString(), to.toISOString());
    const limit = Math.min(Math.max(Number(req.query.limit || 100), 1), 500);
    res.json({
      events: events.slice(-limit).reverse(),
      total: events.length,
      from: from.toISOString(),
      to: to.toISOString()
    });
  } catch (err) {
    console.error("audit list failed:", err);
    res.status(500).json({ message: "Failed to list audit events" });
  }
});

// ── System health ────────────────────────────────────────────────────────────

router.get("/health", requireAdminOrToken, async (req, res) => {
  try {
    const ready = await readiness.evaluateReadiness({
      usePostgres: ctx.usePostgres,
      getPool: () => ctx.getPgPool(),
      getMigrationStatus: async (pool) => {
        try {
          const migrate = require("../lib/migrate");
          return migrate.getMigrationStatus(pool);
        } catch {
          return { ok: true, schemaVersion: ctx.getSchemaVersion(), pendingCount: 0 };
        }
      },
      checkJobsEnabled: String(process.env.READY_CHECK_JOBS || "false").toLowerCase() === "true",
      domainContractVersion: ctx.DOMAIN_CONTRACT_VERSION
    });
    let jobStats = null;
    try {
      const listed = await jobs.listJobs({ limit: 1, offset: 0 }, jobsOptions());
      jobStats = { total: listed.total, handlers: jobs.listHandlers() };
    } catch {
      jobStats = { total: null };
    }
    const snap = typeof metrics.snapshot === "function" ? metrics.snapshot() : {};
    res.json({
      ready,
      release: getRelease(),
      storage: ctx.usePostgres ? "postgres" : "file-json",
      schemaVersion: ctx.getSchemaVersion(),
      domainContractVersion: ctx.DOMAIN_CONTRACT_VERSION,
      uptimeSec: process.uptime(),
      jobs: jobStats,
      metrics: snap,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("admin health failed:", err);
    res.status(500).json({ message: "Failed to evaluate health" });
  }
});

// ── Public appeals (authenticated) — mounted separately ──────────────────────

const appealsPublicRouter = express.Router();

appealsPublicRouter.post("/", requireAuth, async (req, res) => {
  const targetType = ctx.sanitizeText(String(req.body?.targetType || req.body?.target_type || ""));
  const targetId = ctx.sanitizeText(String(req.body?.targetId || req.body?.target_id || ""));
  const reason = ctx.sanitizeText(String(req.body?.reason || ""));
  if (!targetType || !targetId || reason.length < 5) {
    res.status(422).json({ message: "targetType, targetId, and reason (≥5 chars) required" });
    return;
  }
  try {
    const appeal = await adminOps.createAppeal(
      {
        appellantUserId: req.user.id,
        targetType,
        targetId,
        reason
      },
      opsOptions()
    );
    await ctx.storageAudit({
      action: "appeal.submit",
      actorId: req.user.id,
      targetType: "appeal",
      targetId: appeal.id,
      metadata: { targetType, targetId },
      ip: req.ip
    });
    res.status(201).json({
      id: appeal.id,
      status: appeal.status,
      slaDueAt: appeal.slaDueAt,
      slaState: appeal.slaState
    });
  } catch (err) {
    console.error("submit appeal failed:", err);
    res.status(500).json({ message: "Failed to submit appeal" });
  }
});

appealsPublicRouter.get("/mine", requireAuth, async (req, res) => {
  const result = await adminOps.listAppeals({ limit: 100 }, opsOptions());
  const mine = result.appeals.filter((a) => a.appellantUserId === req.user.id);
  res.json({ appeals: mine, total: mine.length });
});

module.exports = router;
module.exports.appealsPublicRouter = appealsPublicRouter;
