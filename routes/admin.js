const express = require("express");
const router = express.Router();
const { requireAdminOrToken } = require("../middleware/auth");
const ctx = require("../lib/context");

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
  res.json({ ok: true });
});

router.get("/moderation/:id/scores", requireAdminOrToken, async (req, res) => {
  const [kind, id] = String(req.params.id || "").split(":");
  if (kind !== "story" || !id) { res.status(422).json({ message: "Use id format story:<storyId>" }); return; }
  const story = (await ctx.storageGetStories()).find((s) => s.id === id);
  if (!story) { res.status(404).json({ message: "Story not found" }); return; }
  res.json({ id: `story:${story.id}`, status: story.status, moderation: story.moderation || {} });
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

module.exports = router;
