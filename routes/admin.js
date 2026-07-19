const express = require("express");
const router = express.Router();
const { requireAdminOrToken } = require("../middleware/auth");
const ctx = require("../lib/context");
const jobs = require("../lib/jobs");
const insider = require("../lib/insider");
const notifications = require("../lib/notifications");
const { adminRouter: resourcesAdminRouter } = require("./resources");
const { adminRouter: newsAdminRouter } = require("./news");
const {
  INSIDER_SIGNAL_STATUS,
  EVIDENCE_STATUS,
  VERIFICATION_LEVEL,
  valuesOf
} = require("../lib/domain-contract");

// Verified catalog CRUD for admins/trusted curators (aitj-z8q.12)
router.use(resourcesAdminRouter);
// Community news moderate/correct/reject + submissions (aitj-z8q.10)
router.use(newsAdminRouter);

router.get("/overview", async (req, res) => {
  if (!(ctx.hasAdminToken(req) || ctx.hasModeratorRole(req.user))) { res.status(401).json({ message: "Unauthorized" }); return; }
  const stories = await ctx.storageGetStories();
  const published = stories.filter((s) => s.status === "published");
  const pending = stories.filter((s) => s.status === "pending");
  const queue = await ctx.storageGetModerationQueue();
  const users = await ctx.storageGetUsers();
  res.json({
    moderation: { pendingStories: pending.length, publishedStories: published.length, queueItems: queue.length },
    users: { registeredEstimate: users.length || (published.length * 3 + pending.length) },
    system: { uptime: process.uptime(), timestamp: new Date().toISOString() }
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

router.post("/sanctions", requireAdminOrToken, async (req, res) => {
  const parsed = ctx.sanctionSchema.safeParse({
    targetUserId: ctx.sanitizeText(req.body.targetUserId),
    type: ctx.sanitizeText(req.body.type),
    reason: ctx.sanitizeText(req.body.reason),
    durationDays: typeof req.body.durationDays === "number" ? req.body.durationDays : Number(req.body.durationDays || 0) || undefined
  });
  if (!parsed.success) { res.status(422).json({ message: "Validation failed" }); return; }
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
  await ctx.storageAudit({ action: "sanction.create", actorId: req.user?.id || "admin-token", targetType: "user", targetId: targetUser.id, metadata: sanctionEntry, ip: req.ip });
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

router.post("/signals/:id/delete", requireAdminOrToken, async (req, res) => {
  try {
    const updated = await insider.softDeleteSignal(req.params.id, insiderOptions());
    await ctx.storageAudit({
      action: "insider_signal.delete",
      actorId: actorId(req),
      targetType: "insider_signal",
      targetId: req.params.id,
      metadata: { status: updated.status, purgeAfter: updated.purgeAfter },
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


module.exports = router;
