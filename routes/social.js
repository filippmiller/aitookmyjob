/**
 * Social & support API (aitj-z8q.11).
 *
 * Comments, follows, blocks, saves, reactions, groups, reputation, reports.
 * Mounted at /api/social (plus convenience paths for reactions on content).
 */

"use strict";

const express = require("express");
const router = express.Router();
const { requireAuth, requireAdminOrToken } = require("../middleware/auth");
const ctx = require("../lib/context");
const social = require("../lib/social");

function opts(req) {
  return {
    ip: req.ip || "",
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool?.() || null
  };
}

function rateLimited(res, result) {
  res.setHeader("Retry-After", String(Math.ceil((result.retryAfterMs || 60000) / 1000)));
  res.status(429).json({
    message: "Rate limit exceeded",
    reason: "rate_limited",
    retryAfterMs: result.retryAfterMs || null
  });
}

// ── Comments ────────────────────────────────────────────────────────────────

router.get("/comments", async (req, res) => {
  const targetType = ctx.sanitizeText(req.query.targetType || req.query.target_type || "");
  const targetId = ctx.sanitizeText(req.query.targetId || req.query.target_id || "");
  if (!targetType || !targetId) {
    res.status(422).json({ message: "targetType and targetId required" });
    return;
  }
  if (!social.COMMENT_TARGET_TYPES.includes(targetType)) {
    res.status(422).json({ message: "Invalid targetType" });
    return;
  }
  const viewerId = req.user?.id || null;
  const flat = await social.listComments(
    { targetType, targetId, viewerId },
    opts(req)
  );
  const threaded = String(req.query.threaded || "true").toLowerCase() !== "false";
  res.json({
    targetType,
    targetId,
    comments: threaded ? social.nestComments(flat) : flat,
    total: flat.length
  });
});

router.post("/comments", requireAuth, async (req, res) => {
  if (ctx.isAccountMuted(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const targetType = ctx.sanitizeText(req.body.targetType || req.body.target_type || "");
  const targetId = ctx.sanitizeText(req.body.targetId || req.body.target_id || "");
  const parentId = ctx.sanitizeText(req.body.parentId || req.body.parent_id || "") || null;
  const body = ctx.sanitizeText(req.body.body || "");
  const mentionUserIds = Array.isArray(req.body.mentionUserIds)
    ? req.body.mentionUserIds.map((x) => ctx.sanitizeText(String(x))).filter(Boolean)
    : [];

  const result = await social.createComment(
    {
      targetType,
      targetId,
      parentId,
      body,
      createdBy: req.user.id,
      country: ctx.normalizeCountry(req.body.country || ctx.defaultCountry),
      language: ctx.normalizeLanguage(req.body.language || ctx.defaultLang),
      mentionUserIds
    },
    opts(req)
  );

  if (!result.ok) {
    if (result.reason === "rate_limited") return rateLimited(res, result);
    if (result.reason === "blocked") {
      res.status(403).json({ message: "Cannot interact due to block" });
      return;
    }
    if (result.reason === "parent_not_found") {
      res.status(404).json({ message: "Parent comment not found" });
      return;
    }
    res.status(422).json({ message: "Validation failed", reason: result.reason });
    return;
  }

  // Notify parent author on reply
  if (result.comment.parentId) {
    const parent = await social.getComment(result.comment.parentId, opts(req));
    if (parent?.createdBy) {
      await social.maybeNotifySocial(
        {
          recipientUserId: parent.createdBy,
          kind: "reply",
          actorId: req.user.id,
          targetType: "comment",
          targetId: result.comment.id,
          preview: result.comment.body
        },
        opts(req)
      );
    }
  }

  // Notify explicit mention user ids
  for (const uid of result.comment.mentions || []) {
    // only notify if it looks like a user id (not a bare handle we can't resolve)
    if (typeof uid === "string" && uid.length >= 8 && !uid.includes(" ")) {
      // eslint-disable-next-line no-await-in-loop
      await social.maybeNotifySocial(
        {
          recipientUserId: uid,
          kind: "mention",
          actorId: req.user.id,
          targetType: result.comment.targetType,
          targetId: result.comment.id,
          preview: result.comment.body
        },
        opts(req)
      );
    }
  }

  res.status(201).json({
    id: result.comment.id,
    targetType: result.comment.targetType,
    targetId: result.comment.targetId,
    parentId: result.comment.parentId,
    status: result.comment.status,
    mentions: result.comment.mentions
  });
});

router.delete("/comments/:id", requireAuth, async (req, res) => {
  const result = await social.deleteComment(
    {
      id: ctx.sanitizeText(req.params.id),
      actorId: req.user.id,
      isModerator: ctx.hasModeratorRole(req.user)
    },
    opts(req)
  );
  if (!result.ok) {
    if (result.reason === "not_found") {
      res.status(404).json({ message: "Comment not found" });
      return;
    }
    if (result.reason === "forbidden") {
      res.status(403).json({ message: "Not authorized" });
      return;
    }
    res.status(422).json({ message: "Failed", reason: result.reason });
    return;
  }
  res.json({ message: "Comment deleted", id: req.params.id });
});

// ── Follows ─────────────────────────────────────────────────────────────────

router.post("/follows/:userId", requireAuth, async (req, res) => {
  const followeeId = ctx.sanitizeText(req.params.userId);
  const result = await social.followUser(
    { followerId: req.user.id, followeeId },
    opts(req)
  );
  if (!result.ok) {
    if (result.reason === "rate_limited") return rateLimited(res, result);
    if (result.reason === "blocked") {
      res.status(403).json({ message: "Cannot follow due to block" });
      return;
    }
    if (result.reason === "cannot_follow_self") {
      res.status(422).json({ message: "Cannot follow yourself" });
      return;
    }
    res.status(422).json({ message: "Failed", reason: result.reason });
    return;
  }
  if (result.created) {
    await social.maybeNotifySocial(
      {
        recipientUserId: followeeId,
        kind: "follow",
        actorId: req.user.id,
        targetType: "user",
        targetId: req.user.id
      },
      opts(req)
    );
  }
  res.status(result.created ? 201 : 200).json({
    ok: true,
    created: result.created,
    followerId: req.user.id,
    followeeId
  });
});

router.delete("/follows/:userId", requireAuth, async (req, res) => {
  const result = await social.unfollowUser(
    { followerId: req.user.id, followeeId: ctx.sanitizeText(req.params.userId) },
    opts(req)
  );
  res.json({ ok: true, removed: result.removed });
});

router.get("/follows/following", requireAuth, async (req, res) => {
  const rows = await social.listFollowing(req.user.id, opts(req));
  res.json({ following: rows });
});

router.get("/follows/followers", requireAuth, async (req, res) => {
  const rows = await social.listFollowers(req.user.id, opts(req));
  res.json({ followers: rows });
});

router.get("/follows/status/:userId", requireAuth, async (req, res) => {
  const other = ctx.sanitizeText(req.params.userId);
  const [following, blocked] = await Promise.all([
    social.isFollowing(req.user.id, other, opts(req)),
    social.isBlockedEither(req.user.id, other, opts(req))
  ]);
  res.json({ following, blocked });
});

// ── Blocks ──────────────────────────────────────────────────────────────────

router.post("/blocks/:userId", requireAuth, async (req, res) => {
  const blockedId = ctx.sanitizeText(req.params.userId);
  const reason = ctx.sanitizeText(req.body?.reason || "");
  const result = await social.blockUser(
    { blockerId: req.user.id, blockedId, reason },
    opts(req)
  );
  if (!result.ok) {
    if (result.reason === "rate_limited") return rateLimited(res, result);
    if (result.reason === "cannot_block_self") {
      res.status(422).json({ message: "Cannot block yourself" });
      return;
    }
    res.status(422).json({ message: "Failed", reason: result.reason });
    return;
  }
  res.status(result.created ? 201 : 200).json({
    ok: true,
    created: result.created,
    blockedId
  });
});

router.delete("/blocks/:userId", requireAuth, async (req, res) => {
  const result = await social.unblockUser(
    { blockerId: req.user.id, blockedId: ctx.sanitizeText(req.params.userId) },
    opts(req)
  );
  res.json({ ok: true, removed: result.removed });
});

router.get("/blocks", requireAuth, async (req, res) => {
  const blocks = await social.listBlocks(req.user.id, opts(req));
  res.json({ blocks });
});

// ── Saves ───────────────────────────────────────────────────────────────────

router.post("/saves", requireAuth, async (req, res) => {
  const targetType = ctx.sanitizeText(req.body.targetType || req.body.target_type || "");
  const targetId = ctx.sanitizeText(req.body.targetId || req.body.target_id || "");
  const result = await social.saveContent(
    { userId: req.user.id, targetType, targetId },
    opts(req)
  );
  if (!result.ok) {
    if (result.reason === "rate_limited") return rateLimited(res, result);
    res.status(422).json({ message: "Failed", reason: result.reason });
    return;
  }
  res.status(result.created ? 201 : 200).json({
    ok: true,
    created: result.created,
    targetType,
    targetId
  });
});

router.delete("/saves", requireAuth, async (req, res) => {
  const targetType = ctx.sanitizeText(
    req.body?.targetType || req.body?.target_type || req.query.targetType || ""
  );
  const targetId = ctx.sanitizeText(
    req.body?.targetId || req.body?.target_id || req.query.targetId || ""
  );
  const result = await social.unsaveContent(
    { userId: req.user.id, targetType, targetId },
    opts(req)
  );
  res.json({ ok: true, removed: result.removed });
});

router.get("/saves", requireAuth, async (req, res) => {
  const saves = await social.listSaves(req.user.id, opts(req));
  res.json({ saves });
});

// ── Reactions ───────────────────────────────────────────────────────────────

router.get("/reactions", async (req, res) => {
  const targetType = ctx.sanitizeText(req.query.targetType || "");
  const targetId = ctx.sanitizeText(req.query.targetId || "");
  if (!targetType || !targetId) {
    res.status(422).json({ message: "targetType and targetId required" });
    return;
  }
  const counts = await social.countReactions(targetType, targetId, opts(req));
  const mine = req.user
    ? (await social.listReactions(targetType, targetId, opts(req)))
        .filter((r) => r.userId === req.user.id)
        .map((r) => r.reactionType)
    : [];
  res.json({ targetType, targetId, counts, mine });
});

router.post("/reactions", requireAuth, async (req, res) => {
  if (ctx.isAccountMuted(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const targetType = ctx.sanitizeText(req.body.targetType || "");
  const targetId = ctx.sanitizeText(req.body.targetId || "");
  const reactionType = ctx.sanitizeText(req.body.reactionType || req.body.type || "");
  const contentAuthorId = ctx.sanitizeText(req.body.contentAuthorId || "") || null;

  const result = await social.addReaction(
    {
      userId: req.user.id,
      targetType,
      targetId,
      reactionType,
      contentAuthorId
    },
    opts(req)
  );
  if (!result.ok) {
    if (result.reason === "rate_limited") return rateLimited(res, result);
    if (result.reason === "blocked") {
      res.status(403).json({ message: "Cannot react due to block" });
      return;
    }
    res.status(422).json({ message: "Failed", reason: result.reason });
    return;
  }
  const counts = await social.countReactions(targetType, targetId, opts(req));
  res.status(result.created ? 201 : 200).json({
    ok: true,
    created: result.created,
    reaction: result.reaction,
    counts
  });
});

router.delete("/reactions", requireAuth, async (req, res) => {
  const targetType = ctx.sanitizeText(
    req.body?.targetType || req.query.targetType || ""
  );
  const targetId = ctx.sanitizeText(req.body?.targetId || req.query.targetId || "");
  const reactionType = ctx.sanitizeText(
    req.body?.reactionType || req.body?.type || req.query.reactionType || ""
  );
  const result = await social.removeReaction(
    { userId: req.user.id, targetType, targetId, reactionType },
    opts(req)
  );
  res.json({ ok: true, removed: result.removed });
});

// ── Groups ──────────────────────────────────────────────────────────────────

router.get("/groups", async (req, res) => {
  const groups = await social.listGroups(
    {
      type: ctx.sanitizeText(req.query.type || "") || undefined,
      region: req.query.region
        ? ctx.normalizeCountry(req.query.region)
        : undefined,
      profession: ctx.sanitizeText(req.query.profession || "") || undefined,
      status: ctx.sanitizeText(req.query.status || "open") || "open"
    },
    opts(req)
  );
  res.json({ groups });
});

router.post("/groups", requireAuth, async (req, res) => {
  if (ctx.isAccountMuted(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const result = await social.createGroup(
    {
      name: ctx.sanitizeText(req.body.name || ""),
      type: ctx.sanitizeText(req.body.type || "interest"),
      profession: ctx.sanitizeText(req.body.profession || ""),
      region: ctx.normalizeCountry(req.body.region || ctx.defaultCountry),
      description: ctx.sanitizeText(req.body.description || ""),
      createdBy: req.user.id
    },
    opts(req)
  );
  if (!result.ok) {
    res.status(422).json({ message: "Failed", reason: result.reason });
    return;
  }
  res.status(201).json({ group: result.group });
});

router.post("/groups/:id/join", requireAuth, async (req, res) => {
  const result = await social.joinGroup(
    { groupId: ctx.sanitizeText(req.params.id), userId: req.user.id },
    opts(req)
  );
  if (!result.ok) {
    if (result.reason === "rate_limited") return rateLimited(res, result);
    if (result.reason === "not_found") {
      res.status(404).json({ message: "Group not found" });
      return;
    }
    res.status(422).json({ message: "Failed", reason: result.reason });
    return;
  }
  res.json({ ok: true, joined: true });
});

router.post("/groups/:id/leave", requireAuth, async (req, res) => {
  const result = await social.leaveGroup(
    { groupId: ctx.sanitizeText(req.params.id), userId: req.user.id },
    opts(req)
  );
  res.json({ ok: true, removed: result.removed });
});

// ── Reputation ──────────────────────────────────────────────────────────────

router.get("/reputation/:userId", async (req, res) => {
  const score = await social.getReputationScore(
    ctx.sanitizeText(req.params.userId),
    opts(req)
  );
  res.json(score);
});

router.get("/reputation/me", requireAuth, async (req, res) => {
  const score = await social.getReputationScore(req.user.id, opts(req));
  res.json(score);
});

// ── Reports ─────────────────────────────────────────────────────────────────

router.post("/reports", requireAuth, async (req, res) => {
  const result = await social.reportContent(
    {
      reporterId: req.user.id,
      targetType: ctx.sanitizeText(req.body.targetType || ""),
      targetId: ctx.sanitizeText(req.body.targetId || ""),
      reason: ctx.sanitizeText(req.body.reason || ""),
      details: ctx.sanitizeText(req.body.details || "")
    },
    opts(req)
  );
  if (!result.ok) {
    if (result.reason === "rate_limited") return rateLimited(res, result);
    res.status(422).json({ message: "Failed", reason: result.reason });
    return;
  }
  res.status(201).json({ id: result.report.id, status: result.report.status });
});

// Admin: list / resolve social reports
router.get("/admin/reports", requireAdminOrToken, async (req, res) => {
  const reports = await social.listReports(
    {
      status: ctx.sanitizeText(req.query.status || "open") || "open",
      limit: Number(req.query.limit) || 50
    },
    opts(req)
  );
  res.json({ reports });
});

router.post("/admin/reports/:id/resolve", requireAdminOrToken, async (req, res) => {
  const result = await social.resolveReport(
    {
      id: ctx.sanitizeText(req.params.id),
      resolverId: req.user?.id || "admin",
      status: ctx.sanitizeText(req.body.status || "resolved"),
      note: ctx.sanitizeText(req.body.note || "")
    },
    opts(req)
  );
  if (!result.ok) {
    res.status(result.reason === "not_found" ? 404 : 422).json({
      message: "Failed",
      reason: result.reason
    });
    return;
  }
  res.json({ ok: true });
});

// ── Meta ────────────────────────────────────────────────────────────────────

router.get("/meta", (_req, res) => {
  res.json({
    reactionTypes: social.REACTION_TYPES,
    commentTargetTypes: social.COMMENT_TARGET_TYPES,
    saveTargetTypes: social.SAVE_TARGET_TYPES,
    groupTypes: social.GROUP_TYPES,
    rateLimits: social.RATE_LIMITS
  });
});

module.exports = router;
