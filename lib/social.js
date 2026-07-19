/**
 * Social & support interactions — comments, follows, blocks, saves,
 * reactions, groups, reputation, reports. Memory store for unit tests /
 * JSON-fallback; PostgreSQL when DATABASE_URL is set.
 *
 * Bead: aitj-z8q.11
 */

"use strict";

const { customAlphabet } = require("nanoid");

const idGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const commentId = () => `cmt_${idGen()}`;
const reactionId = () => `rxn_${idGen()}`;
const groupId = () => `grp_${idGen()}`;
const repId = () => `rep_${idGen()}`;
const reportId = () => `srep_${idGen()}`;

// ── Domain constants ────────────────────────────────────────────────────────

const COMMENT_STATUS = Object.freeze({
  PENDING: "pending",
  PUBLISHED: "published",
  HIDDEN: "hidden",
  DELETED: "deleted"
});

const COMMENT_TARGET_TYPES = Object.freeze([
  "story",
  "vent",
  "news",
  "topic",
  "comment"
]);

const REACTION_TYPES = Object.freeze([
  "solidarity",
  "strength",
  "gratitude",
  "helpful",
  "witness",
  "celebrate"
]);

const REACTION_TARGET_TYPES = Object.freeze([
  "story",
  "vent",
  "news",
  "topic",
  "comment",
  "reply"
]);

const SAVE_TARGET_TYPES = Object.freeze([
  "story",
  "vent",
  "news",
  "topic",
  "resource",
  "opportunity"
]);

const GROUP_TYPES = Object.freeze(["professional", "regional", "interest"]);

const GROUP_STATUS = Object.freeze({
  DRAFT: "draft",
  OPEN: "open",
  CLOSED: "closed",
  ARCHIVED: "archived",
  DELETED: "deleted"
});

const REPUTATION_POINTS = Object.freeze({
  helpful_reaction: 2,
  helpful_comment: 1,
  report_upheld: -5,
  report_dismissed: 0,
  moderation_bonus: 5,
  moderation_penalty: -10,
  group_contribution: 1
});

/** Abuse / rate limits (sliding window, per user). */
const RATE_LIMITS = Object.freeze({
  comment: { max: 30, windowMs: 60 * 60 * 1000 },
  reaction: { max: 60, windowMs: 60 * 60 * 1000 },
  follow: { max: 50, windowMs: 60 * 60 * 1000 },
  block: { max: 20, windowMs: 24 * 60 * 60 * 1000 },
  save: { max: 100, windowMs: 60 * 60 * 1000 },
  report: { max: 15, windowMs: 24 * 60 * 60 * 1000 },
  group_join: { max: 20, windowMs: 60 * 60 * 1000 }
});

const MENTION_RE = /@([a-zA-Z0-9_-]{2,32})/g;

// ── Memory stores ───────────────────────────────────────────────────────────

const memory = {
  comments: new Map(),
  follows: new Map(), // key: follower::followee
  blocks: new Map(),
  saves: new Map(), // key: user::type::id
  reactions: new Map(),
  groups: new Map(),
  groupMembers: new Map(), // key: group::user
  reputation: new Map(),
  reports: new Map(),
  /** @type {Map<string, number[]>} key: action:userId -> timestamps */
  rateBuckets: new Map()
};

function memoryReset() {
  for (const m of Object.values(memory)) m.clear();
}

function nowIso() {
  return new Date().toISOString();
}

function pairKey(a, b) {
  return `${a}::${b}`;
}

function saveKey(userId, targetType, targetId) {
  return `${userId}::${targetType}::${targetId}`;
}

// ── Pool helpers (mirror notifications.js) ──────────────────────────────────

function resolvePool(options = {}) {
  if (options.pool) return options.pool;
  if (typeof options.getPool === "function") {
    try {
      return options.getPool() || null;
    } catch (_e) {
      return null;
    }
  }
  return null;
}

function usePg(options = {}) {
  if (options.useMemory === true) return false;
  if (options.usePostgres === false) return false;
  const pool = resolvePool(options);
  if (pool) return true;
  if (options.usePostgres === true) return true;
  try {
    // eslint-disable-next-line global-require
    const ctx = require("./context");
    return Boolean(ctx.usePostgres && ctx.getPgPool && ctx.getPgPool());
  } catch (_e) {
    return false;
  }
}

function getPoolOrThrow(options = {}) {
  const pool = resolvePool(options);
  if (pool) return pool;
  // eslint-disable-next-line global-require
  const ctx = require("./context");
  const p = ctx.getPgPool();
  if (!p) throw new Error("PostgreSQL pool not initialized");
  return p;
}

async function audit(action, fields = {}, options = {}) {
  try {
    // eslint-disable-next-line global-require
    const ctx = require("./context");
    if (typeof ctx.storageAudit === "function") {
      await ctx.storageAudit({
        action,
        actorId: fields.actorId || null,
        targetType: fields.targetType || null,
        targetId: fields.targetId || null,
        metadata: fields.metadata || {},
        ip: fields.ip || ""
      });
    }
  } catch (_e) {
    /* audit must not break interaction */
  }
}

// ── Rate limiting ───────────────────────────────────────────────────────────

/**
 * Check and record a rate-limited action.
 * @returns {{ allowed: boolean, remaining: number, retryAfterMs?: number }}
 */
function checkRateLimit(action, userId, options = {}) {
  if (options.skipRateLimit) return { allowed: true, remaining: 999 };
  const cfg = RATE_LIMITS[action];
  if (!cfg) return { allowed: true, remaining: 999 };
  const key = `${action}:${userId}`;
  const now = Date.now();
  let bucket = memory.rateBuckets.get(key) || [];
  bucket = bucket.filter((t) => now - t < cfg.windowMs);
  if (bucket.length >= cfg.max) {
    const oldest = bucket[0] || now;
    memory.rateBuckets.set(key, bucket);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, cfg.windowMs - (now - oldest))
    };
  }
  bucket.push(now);
  memory.rateBuckets.set(key, bucket);
  return { allowed: true, remaining: cfg.max - bucket.length };
}

// ── Mentions ────────────────────────────────────────────────────────────────

function extractMentions(body) {
  if (!body || typeof body !== "string") return [];
  const found = new Set();
  let m;
  const re = new RegExp(MENTION_RE.source, "g");
  while ((m = re.exec(body)) !== null) {
    found.add(m[1].toLowerCase());
  }
  return [...found];
}

// ── Blocks ──────────────────────────────────────────────────────────────────

async function blockUser({ blockerId, blockedId, reason = "" }, options = {}) {
  if (!blockerId || !blockedId) return { ok: false, reason: "missing_ids" };
  if (blockerId === blockedId) return { ok: false, reason: "cannot_block_self" };
  const rl = checkRateLimit("block", blockerId, options);
  if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `INSERT INTO blocks (blocker_id, blocked_id, reason, created_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING
       RETURNING blocker_id, blocked_id, reason, created_at;`,
      [blockerId, blockedId, String(reason || "").slice(0, 500)]
    );
    // Also remove follows both ways
    await pool.query(
      `DELETE FROM follows WHERE
         (follower_id = $1 AND followee_id = $2) OR
         (follower_id = $2 AND followee_id = $1);`,
      [blockerId, blockedId]
    );
    const created = res.rowCount > 0;
    await audit("social.block", {
      actorId: blockerId,
      targetType: "user",
      targetId: blockedId,
      metadata: { reason: String(reason || "").slice(0, 200), created },
      ip: options.ip
    });
    return {
      ok: true,
      created,
      block: {
        blockerId,
        blockedId,
        reason: String(reason || "").slice(0, 500),
        createdAt: res.rows[0]?.created_at
          ? new Date(res.rows[0].created_at).toISOString()
          : nowIso()
      }
    };
  }

  const key = pairKey(blockerId, blockedId);
  const created = !memory.blocks.has(key);
  if (created) {
    memory.blocks.set(key, {
      blockerId,
      blockedId,
      reason: String(reason || "").slice(0, 500),
      createdAt: nowIso()
    });
  }
  memory.follows.delete(pairKey(blockerId, blockedId));
  memory.follows.delete(pairKey(blockedId, blockerId));
  await audit("social.block", {
    actorId: blockerId,
    targetType: "user",
    targetId: blockedId,
    metadata: { created },
    ip: options.ip
  });
  return { ok: true, created, block: memory.blocks.get(key) };
}

async function unblockUser({ blockerId, blockedId }, options = {}) {
  if (!blockerId || !blockedId) return { ok: false, reason: "missing_ids" };
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      "DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2;",
      [blockerId, blockedId]
    );
    await audit("social.unblock", {
      actorId: blockerId,
      targetType: "user",
      targetId: blockedId,
      metadata: { removed: res.rowCount > 0 },
      ip: options.ip
    });
    return { ok: true, removed: res.rowCount > 0 };
  }
  const key = pairKey(blockerId, blockedId);
  const removed = memory.blocks.delete(key);
  await audit("social.unblock", {
    actorId: blockerId,
    targetType: "user",
    targetId: blockedId,
    metadata: { removed },
    ip: options.ip
  });
  return { ok: true, removed };
}

async function isBlocked(blockerId, blockedId, options = {}) {
  if (!blockerId || !blockedId) return false;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      "SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2 LIMIT 1;",
      [blockerId, blockedId]
    );
    return res.rows.length > 0;
  }
  return memory.blocks.has(pairKey(blockerId, blockedId));
}

/** Either direction — used for reads and notifications. */
async function isBlockedEither(userA, userB, options = {}) {
  if (!userA || !userB || userA === userB) return false;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)
       LIMIT 1;`,
      [userA, userB]
    );
    return res.rows.length > 0;
  }
  return (
    memory.blocks.has(pairKey(userA, userB)) ||
    memory.blocks.has(pairKey(userB, userA))
  );
}

async function listBlocks(blockerId, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT blocker_id, blocked_id, reason, created_at
       FROM blocks WHERE blocker_id = $1 ORDER BY created_at DESC;`,
      [blockerId]
    );
    return res.rows.map((r) => ({
      blockerId: r.blocker_id,
      blockedId: r.blocked_id,
      reason: r.reason || "",
      createdAt: new Date(r.created_at).toISOString()
    }));
  }
  return [...memory.blocks.values()].filter((b) => b.blockerId === blockerId);
}

/**
 * Filter list of items by author field, removing blocked relationships.
 * @param {string|null} viewerId
 * @param {object[]} items
 * @param {string} authorField
 */
async function filterBlockedAuthors(viewerId, items, authorField = "createdBy", options = {}) {
  if (!viewerId || !items?.length) return items || [];
  const out = [];
  for (const item of items) {
    const author = item[authorField];
    if (!author || author === viewerId) {
      out.push(item);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (!(await isBlockedEither(viewerId, author, options))) {
      out.push(item);
    }
  }
  return out;
}

// ── Follows ─────────────────────────────────────────────────────────────────

async function followUser({ followerId, followeeId }, options = {}) {
  if (!followerId || !followeeId) return { ok: false, reason: "missing_ids" };
  if (followerId === followeeId) return { ok: false, reason: "cannot_follow_self" };
  const rl = checkRateLimit("follow", followerId, options);
  if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };

  if (await isBlockedEither(followerId, followeeId, options)) {
    return { ok: false, reason: "blocked" };
  }

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `INSERT INTO follows (follower_id, followee_id, created_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (follower_id, followee_id) DO NOTHING
       RETURNING follower_id, followee_id, created_at;`,
      [followerId, followeeId]
    );
    const created = res.rowCount > 0;
    await audit("social.follow", {
      actorId: followerId,
      targetType: "user",
      targetId: followeeId,
      metadata: { created },
      ip: options.ip
    });
    return {
      ok: true,
      created,
      follow: {
        followerId,
        followeeId,
        createdAt: res.rows[0]?.created_at
          ? new Date(res.rows[0].created_at).toISOString()
          : nowIso()
      }
    };
  }

  const key = pairKey(followerId, followeeId);
  const created = !memory.follows.has(key);
  if (created) {
    memory.follows.set(key, { followerId, followeeId, createdAt: nowIso() });
  }
  await audit("social.follow", {
    actorId: followerId,
    targetType: "user",
    targetId: followeeId,
    metadata: { created },
    ip: options.ip
  });
  return { ok: true, created, follow: memory.follows.get(key) };
}

async function unfollowUser({ followerId, followeeId }, options = {}) {
  if (!followerId || !followeeId) return { ok: false, reason: "missing_ids" };
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      "DELETE FROM follows WHERE follower_id = $1 AND followee_id = $2;",
      [followerId, followeeId]
    );
    await audit("social.unfollow", {
      actorId: followerId,
      targetType: "user",
      targetId: followeeId,
      metadata: { removed: res.rowCount > 0 },
      ip: options.ip
    });
    return { ok: true, removed: res.rowCount > 0 };
  }
  const removed = memory.follows.delete(pairKey(followerId, followeeId));
  await audit("social.unfollow", {
    actorId: followerId,
    targetType: "user",
    targetId: followeeId,
    metadata: { removed },
    ip: options.ip
  });
  return { ok: true, removed };
}

async function isFollowing(followerId, followeeId, options = {}) {
  if (!followerId || !followeeId) return false;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      "SELECT 1 FROM follows WHERE follower_id = $1 AND followee_id = $2 LIMIT 1;",
      [followerId, followeeId]
    );
    return res.rows.length > 0;
  }
  return memory.follows.has(pairKey(followerId, followeeId));
}

async function listFollowing(followerId, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT follower_id, followee_id, created_at FROM follows
       WHERE follower_id = $1 ORDER BY created_at DESC;`,
      [followerId]
    );
    return res.rows.map((r) => ({
      followerId: r.follower_id,
      followeeId: r.followee_id,
      createdAt: new Date(r.created_at).toISOString()
    }));
  }
  return [...memory.follows.values()].filter((f) => f.followerId === followerId);
}

async function listFollowers(followeeId, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT follower_id, followee_id, created_at FROM follows
       WHERE followee_id = $1 ORDER BY created_at DESC;`,
      [followeeId]
    );
    return res.rows.map((r) => ({
      followerId: r.follower_id,
      followeeId: r.followee_id,
      createdAt: new Date(r.created_at).toISOString()
    }));
  }
  return [...memory.follows.values()].filter((f) => f.followeeId === followeeId);
}

// ── Saves ───────────────────────────────────────────────────────────────────

async function saveContent({ userId, targetType, targetId }, options = {}) {
  if (!userId || !targetType || !targetId) return { ok: false, reason: "missing_fields" };
  if (!SAVE_TARGET_TYPES.includes(targetType)) return { ok: false, reason: "invalid_target_type" };
  const rl = checkRateLimit("save", userId, options);
  if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `INSERT INTO content_saves (user_id, target_type, target_id, created_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (user_id, target_type, target_id) DO NOTHING
       RETURNING user_id, target_type, target_id, created_at;`,
      [userId, targetType, targetId]
    );
    const created = res.rowCount > 0;
    await audit("social.save", {
      actorId: userId,
      targetType,
      targetId,
      metadata: { created },
      ip: options.ip
    });
    return {
      ok: true,
      created,
      save: {
        userId,
        targetType,
        targetId,
        createdAt: res.rows[0]?.created_at
          ? new Date(res.rows[0].created_at).toISOString()
          : nowIso()
      }
    };
  }

  const key = saveKey(userId, targetType, targetId);
  const created = !memory.saves.has(key);
  if (created) {
    memory.saves.set(key, { userId, targetType, targetId, createdAt: nowIso() });
  }
  await audit("social.save", {
    actorId: userId,
    targetType,
    targetId,
    metadata: { created },
    ip: options.ip
  });
  return { ok: true, created, save: memory.saves.get(key) };
}

async function unsaveContent({ userId, targetType, targetId }, options = {}) {
  if (!userId || !targetType || !targetId) return { ok: false, reason: "missing_fields" };
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `DELETE FROM content_saves
       WHERE user_id = $1 AND target_type = $2 AND target_id = $3;`,
      [userId, targetType, targetId]
    );
    await audit("social.unsave", {
      actorId: userId,
      targetType,
      targetId,
      metadata: { removed: res.rowCount > 0 },
      ip: options.ip
    });
    return { ok: true, removed: res.rowCount > 0 };
  }
  const removed = memory.saves.delete(saveKey(userId, targetType, targetId));
  await audit("social.unsave", {
    actorId: userId,
    targetType,
    targetId,
    metadata: { removed },
    ip: options.ip
  });
  return { ok: true, removed };
}

async function listSaves(userId, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT user_id, target_type, target_id, created_at FROM content_saves
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200;`,
      [userId]
    );
    return res.rows.map((r) => ({
      userId: r.user_id,
      targetType: r.target_type,
      targetId: r.target_id,
      createdAt: new Date(r.created_at).toISOString()
    }));
  }
  return [...memory.saves.values()]
    .filter((s) => s.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ── Reactions ───────────────────────────────────────────────────────────────

function mapReactionRow(r) {
  return {
    id: r.id,
    userId: r.user_id ?? r.userId,
    targetType: r.target_type ?? r.targetType,
    targetId: r.target_id ?? r.targetId,
    reactionType: r.reaction_type ?? r.reactionType,
    createdAt: r.created_at
      ? new Date(r.created_at).toISOString()
      : r.createdAt || nowIso()
  };
}

async function addReaction(
  { userId, targetType, targetId, reactionType, contentAuthorId = null },
  options = {}
) {
  if (!userId || !targetType || !targetId || !reactionType) {
    return { ok: false, reason: "missing_fields" };
  }
  if (!REACTION_TARGET_TYPES.includes(targetType)) {
    return { ok: false, reason: "invalid_target_type" };
  }
  if (!REACTION_TYPES.includes(reactionType)) {
    return { ok: false, reason: "invalid_reaction_type" };
  }
  const rl = checkRateLimit("reaction", userId, options);
  if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };

  if (contentAuthorId && (await isBlockedEither(userId, contentAuthorId, options))) {
    return { ok: false, reason: "blocked" };
  }

  let reaction;
  let created = false;

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const id = reactionId();
    const res = await pool.query(
      `INSERT INTO reactions (id, user_id, target_type, target_id, reaction_type, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (user_id, target_type, target_id, reaction_type) DO NOTHING
       RETURNING *;`,
      [id, userId, targetType, targetId, reactionType]
    );
    if (res.rows[0]) {
      created = true;
      reaction = mapReactionRow(res.rows[0]);
    } else {
      const existing = await pool.query(
        `SELECT * FROM reactions
         WHERE user_id = $1 AND target_type = $2 AND target_id = $3 AND reaction_type = $4;`,
        [userId, targetType, targetId, reactionType]
      );
      reaction = mapReactionRow(existing.rows[0]);
    }
  } else {
    const uniq = `${userId}::${targetType}::${targetId}::${reactionType}`;
    if (memory.reactions.has(uniq)) {
      reaction = memory.reactions.get(uniq);
    } else {
      reaction = {
        id: reactionId(),
        userId,
        targetType,
        targetId,
        reactionType,
        createdAt: nowIso()
      };
      memory.reactions.set(uniq, reaction);
      created = true;
    }
  }

  await audit("social.reaction", {
    actorId: userId,
    targetType,
    targetId,
    metadata: { reactionType, created },
    ip: options.ip
  });

  // Helpfulness reputation for content author
  if (
    created &&
    contentAuthorId &&
    contentAuthorId !== userId &&
    (reactionType === "helpful" || reactionType === "gratitude")
  ) {
    await recordReputation(
      {
        userId: contentAuthorId,
        actorId: userId,
        sourceType: targetType,
        sourceId: targetId,
        eventType: "helpful_reaction",
        points: REPUTATION_POINTS.helpful_reaction
      },
      options
    );
  }

  return { ok: true, created, reaction };
}

async function removeReaction({ userId, targetType, targetId, reactionType }, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `DELETE FROM reactions
       WHERE user_id = $1 AND target_type = $2 AND target_id = $3 AND reaction_type = $4;`,
      [userId, targetType, targetId, reactionType]
    );
    await audit("social.reaction.remove", {
      actorId: userId,
      targetType,
      targetId,
      metadata: { reactionType, removed: res.rowCount > 0 },
      ip: options.ip
    });
    return { ok: true, removed: res.rowCount > 0 };
  }
  const uniq = `${userId}::${targetType}::${targetId}::${reactionType}`;
  const removed = memory.reactions.delete(uniq);
  return { ok: true, removed };
}

async function listReactions(targetType, targetId, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM reactions WHERE target_type = $1 AND target_id = $2
       ORDER BY created_at ASC;`,
      [targetType, targetId]
    );
    return res.rows.map(mapReactionRow);
  }
  return [...memory.reactions.values()].filter(
    (r) => r.targetType === targetType && r.targetId === targetId && r.id && r.userId
  );
}

async function countReactions(targetType, targetId, options = {}) {
  const rows = await listReactions(targetType, targetId, options);
  const counts = {};
  for (const t of REACTION_TYPES) counts[t] = 0;
  for (const r of rows) {
    if (counts[r.reactionType] != null) counts[r.reactionType] += 1;
  }
  return counts;
}

// ── Comments ────────────────────────────────────────────────────────────────

function mapCommentRow(r) {
  const mentions =
    typeof r.mentions === "string"
      ? JSON.parse(r.mentions)
      : r.mentions || [];
  return {
    id: r.id,
    targetType: r.target_type ?? r.targetType,
    targetId: r.target_id ?? r.targetId,
    parentId: r.parent_id ?? r.parentId ?? null,
    body: r.body,
    country: r.country || "global",
    language: r.language || "en",
    status: r.status || COMMENT_STATUS.PUBLISHED,
    createdBy: r.created_by ?? r.createdBy,
    mentions: Array.isArray(mentions) ? mentions : [],
    createdAt: r.created_at
      ? new Date(r.created_at).toISOString()
      : r.createdAt || nowIso(),
    updatedAt: r.updated_at
      ? new Date(r.updated_at).toISOString()
      : r.updatedAt || null
  };
}

/**
 * Create a threaded comment. parentId optional for nesting.
 * mentions extracted from @handles in body; mention user ids may be passed.
 */
async function createComment(input, options = {}) {
  const {
    targetType,
    targetId,
    parentId = null,
    body,
    createdBy,
    country = "global",
    language = "en",
    mentionUserIds = []
  } = input;

  if (!targetType || !targetId || !body || !createdBy) {
    return { ok: false, reason: "missing_fields" };
  }
  if (!COMMENT_TARGET_TYPES.includes(targetType)) {
    return { ok: false, reason: "invalid_target_type" };
  }
  const text = String(body).trim().slice(0, 4000);
  if (text.length < 1) return { ok: false, reason: "empty_body" };

  const rl = checkRateLimit("comment", createdBy, options);
  if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };

  if (parentId) {
    const parent = await getComment(parentId, options);
    if (!parent || parent.status === COMMENT_STATUS.DELETED) {
      return { ok: false, reason: "parent_not_found" };
    }
    if (await isBlockedEither(createdBy, parent.createdBy, options)) {
      return { ok: false, reason: "blocked" };
    }
  }

  const handles = extractMentions(text);
  const mentions = [...new Set([...(mentionUserIds || []), ...handles])].slice(0, 20);

  const row = {
    id: commentId(),
    targetType,
    targetId,
    parentId: parentId || null,
    body: text,
    country,
    language,
    status: COMMENT_STATUS.PUBLISHED,
    createdBy,
    mentions,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `INSERT INTO comments (
         id, target_type, target_id, parent_id, body, country, language,
         status, created_by, mentions, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW(),NOW())
       RETURNING *;`,
      [
        row.id,
        row.targetType,
        row.targetId,
        row.parentId,
        row.body,
        row.country,
        row.language,
        row.status,
        row.createdBy,
        JSON.stringify(row.mentions)
      ]
    );
    const comment = mapCommentRow(res.rows[0]);
    await audit("social.comment.create", {
      actorId: createdBy,
      targetType,
      targetId,
      metadata: { commentId: comment.id, parentId: comment.parentId, mentions: comment.mentions },
      ip: options.ip
    });
    return { ok: true, comment };
  }

  memory.comments.set(row.id, row);
  await audit("social.comment.create", {
    actorId: createdBy,
    targetType,
    targetId,
    metadata: { commentId: row.id, parentId: row.parentId },
    ip: options.ip
  });
  return { ok: true, comment: { ...row } };
}

async function getComment(id, options = {}) {
  if (!id) return null;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query("SELECT * FROM comments WHERE id = $1;", [id]);
    return res.rows[0] ? mapCommentRow(res.rows[0]) : null;
  }
  const c = memory.comments.get(id);
  return c ? { ...c } : null;
}

async function listComments(
  { targetType, targetId, viewerId = null, includeDeleted = false } = {},
  options = {}
) {
  let rows;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM comments
       WHERE target_type = $1 AND target_id = $2
         AND ($3::boolean OR status <> 'deleted')
       ORDER BY created_at ASC
       LIMIT 500;`,
      [targetType, targetId, includeDeleted]
    );
    rows = res.rows.map(mapCommentRow);
  } else {
    rows = [...memory.comments.values()]
      .filter(
        (c) =>
          c.targetType === targetType &&
          c.targetId === targetId &&
          (includeDeleted || c.status !== COMMENT_STATUS.DELETED)
      )
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  if (viewerId) {
    rows = await filterBlockedAuthors(viewerId, rows, "createdBy", options);
  }
  return rows;
}

/**
 * Build nested tree from flat comments (parentId links).
 */
function nestComments(flat) {
  const byId = new Map();
  const roots = [];
  for (const c of flat) {
    byId.set(c.id, { ...c, children: [] });
  }
  for (const c of byId.values()) {
    if (c.parentId && byId.has(c.parentId)) {
      byId.get(c.parentId).children.push(c);
    } else {
      roots.push(c);
    }
  }
  return roots;
}

async function deleteComment({ id, actorId, isModerator = false }, options = {}) {
  const existing = await getComment(id, options);
  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.createdBy !== actorId && !isModerator) {
    return { ok: false, reason: "forbidden" };
  }
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE comments SET status = 'deleted', updated_at = NOW() WHERE id = $1;`,
      [id]
    );
  } else {
    const c = memory.comments.get(id);
    if (c) {
      c.status = COMMENT_STATUS.DELETED;
      c.updatedAt = nowIso();
    }
  }
  await audit("social.comment.delete", {
    actorId,
    targetType: "comment",
    targetId: id,
    metadata: { previousStatus: existing.status },
    ip: options.ip
  });
  return { ok: true };
}

// ── Groups ──────────────────────────────────────────────────────────────────

function slugify(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

function mapGroupRow(r) {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    type: r.type,
    profession: r.profession || "",
    region: r.region || "global",
    description: r.description || "",
    status: r.status || GROUP_STATUS.OPEN,
    createdBy: r.created_by ?? r.createdBy,
    memberCount: Number(r.member_count ?? r.memberCount ?? 0),
    createdAt: r.created_at
      ? new Date(r.created_at).toISOString()
      : r.createdAt || nowIso(),
    updatedAt: r.updated_at
      ? new Date(r.updated_at).toISOString()
      : r.updatedAt || null
  };
}

async function createGroup(input, options = {}) {
  const {
    name,
    type = "interest",
    profession = "",
    region = "global",
    description = "",
    createdBy
  } = input;
  if (!name || !createdBy) return { ok: false, reason: "missing_fields" };
  if (!GROUP_TYPES.includes(type)) return { ok: false, reason: "invalid_type" };

  const baseSlug = slugify(name) || `group-${idGen().slice(0, 8)}`;
  const slug = `${baseSlug}-${idGen().slice(0, 6)}`;
  const group = {
    id: groupId(),
    name: String(name).trim().slice(0, 120),
    slug,
    type,
    profession: String(profession || "").slice(0, 120),
    region: String(region || "global").toLowerCase().slice(0, 32),
    description: String(description || "").slice(0, 2000),
    status: GROUP_STATUS.OPEN,
    createdBy,
    memberCount: 1,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO social_groups (
         id, name, slug, type, profession, region, description,
         status, created_by, member_count, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,NOW(),NOW());`,
      [
        group.id,
        group.name,
        group.slug,
        group.type,
        group.profession,
        group.region,
        group.description,
        group.status,
        group.createdBy
      ]
    );
    await pool.query(
      `INSERT INTO group_members (group_id, user_id, role, status, joined_at)
       VALUES ($1,$2,'owner','active',NOW());`,
      [group.id, createdBy]
    );
  } else {
    memory.groups.set(group.id, group);
    memory.groupMembers.set(pairKey(group.id, createdBy), {
      groupId: group.id,
      userId: createdBy,
      role: "owner",
      status: "active",
      joinedAt: nowIso()
    });
  }

  await audit("social.group.create", {
    actorId: createdBy,
    targetType: "group",
    targetId: group.id,
    metadata: { type: group.type, region: group.region, profession: group.profession },
    ip: options.ip
  });
  return { ok: true, group };
}

async function listGroups({ type, region, profession, status = "open" } = {}, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const clauses = ["status = $1"];
    const params = [status || GROUP_STATUS.OPEN];
    if (type) {
      params.push(type);
      clauses.push(`type = $${params.length}`);
    }
    if (region) {
      params.push(region);
      clauses.push(`(region = $${params.length} OR region = 'global')`);
    }
    if (profession) {
      params.push(profession);
      clauses.push(`profession ILIKE $${params.length}`);
    }
    const res = await pool.query(
      `SELECT * FROM social_groups WHERE ${clauses.join(" AND ")}
       ORDER BY member_count DESC, created_at DESC LIMIT 100;`,
      params
    );
    return res.rows.map(mapGroupRow);
  }
  return [...memory.groups.values()]
    .filter((g) => {
      if (status && g.status !== status) return false;
      if (type && g.type !== type) return false;
      if (region && g.region !== region && g.region !== "global") return false;
      if (profession && !String(g.profession).toLowerCase().includes(String(profession).toLowerCase())) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.memberCount - a.memberCount);
}

async function joinGroup({ groupId: gid, userId }, options = {}) {
  if (!gid || !userId) return { ok: false, reason: "missing_fields" };
  const rl = checkRateLimit("group_join", userId, options);
  if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const g = await pool.query(
      "SELECT * FROM social_groups WHERE id = $1 AND status = 'open';",
      [gid]
    );
    if (!g.rows[0]) return { ok: false, reason: "not_found" };
    const res = await pool.query(
      `INSERT INTO group_members (group_id, user_id, role, status, joined_at)
       VALUES ($1,$2,'member','active',NOW())
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         status = 'active', left_at = NULL, joined_at = NOW()
       WHERE group_members.status <> 'banned'
       RETURNING *;`,
      [gid, userId]
    );
    if (!res.rows[0]) return { ok: false, reason: "banned_or_conflict" };
    await pool.query(
      `UPDATE social_groups SET member_count = (
         SELECT COUNT(*)::int FROM group_members WHERE group_id = $1 AND status = 'active'
       ), updated_at = NOW() WHERE id = $1;`,
      [gid]
    );
    await audit("social.group.join", {
      actorId: userId,
      targetType: "group",
      targetId: gid,
      ip: options.ip
    });
    return { ok: true, created: true };
  }

  const group = memory.groups.get(gid);
  if (!group || group.status !== GROUP_STATUS.OPEN) return { ok: false, reason: "not_found" };
  const key = pairKey(gid, userId);
  const existing = memory.groupMembers.get(key);
  if (existing?.status === "banned") return { ok: false, reason: "banned" };
  memory.groupMembers.set(key, {
    groupId: gid,
    userId,
    role: existing?.role || "member",
    status: "active",
    joinedAt: nowIso()
  });
  group.memberCount = [...memory.groupMembers.values()].filter(
    (m) => m.groupId === gid && m.status === "active"
  ).length;
  await audit("social.group.join", {
    actorId: userId,
    targetType: "group",
    targetId: gid,
    ip: options.ip
  });
  return { ok: true, created: true };
}

async function leaveGroup({ groupId: gid, userId }, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE group_members SET status = 'left', left_at = NOW()
       WHERE group_id = $1 AND user_id = $2 AND status = 'active';`,
      [gid, userId]
    );
    await pool.query(
      `UPDATE social_groups SET member_count = (
         SELECT COUNT(*)::int FROM group_members WHERE group_id = $1 AND status = 'active'
       ), updated_at = NOW() WHERE id = $1;`,
      [gid]
    );
    await audit("social.group.leave", {
      actorId: userId,
      targetType: "group",
      targetId: gid,
      metadata: { removed: res.rowCount > 0 },
      ip: options.ip
    });
    return { ok: true, removed: res.rowCount > 0 };
  }
  const key = pairKey(gid, userId);
  const m = memory.groupMembers.get(key);
  if (!m || m.status !== "active") return { ok: true, removed: false };
  m.status = "left";
  m.leftAt = nowIso();
  const group = memory.groups.get(gid);
  if (group) {
    group.memberCount = [...memory.groupMembers.values()].filter(
      (x) => x.groupId === gid && x.status === "active"
    ).length;
  }
  return { ok: true, removed: true };
}

// ── Reputation ──────────────────────────────────────────────────────────────

async function recordReputation(input, options = {}) {
  const {
    userId,
    actorId = null,
    sourceType = "",
    sourceId = "",
    eventType,
    points,
    metadata = {}
  } = input;
  if (!userId || !eventType) return { ok: false, reason: "missing_fields" };
  const pts =
    points != null
      ? Number(points)
      : REPUTATION_POINTS[eventType] != null
        ? REPUTATION_POINTS[eventType]
        : 0;

  const event = {
    id: repId(),
    userId,
    actorId,
    sourceType,
    sourceId,
    eventType,
    points: pts,
    metadata,
    createdAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO reputation_events (
         id, user_id, actor_id, source_type, source_id, event_type, points, metadata, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,NOW());`,
      [
        event.id,
        event.userId,
        event.actorId,
        event.sourceType,
        event.sourceId,
        event.eventType,
        event.points,
        JSON.stringify(event.metadata)
      ]
    );
  } else {
    memory.reputation.set(event.id, event);
  }

  await audit("social.reputation", {
    actorId: actorId || "system",
    targetType: "user",
    targetId: userId,
    metadata: { eventType, points: pts, sourceType, sourceId },
    ip: options.ip
  });
  return { ok: true, event };
}

async function getReputationScore(userId, options = {}) {
  if (!userId) return { userId, score: 0, events: 0 };
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT COALESCE(SUM(points),0)::int AS score, COUNT(*)::int AS events
       FROM reputation_events WHERE user_id = $1;`,
      [userId]
    );
    return {
      userId,
      score: res.rows[0]?.score || 0,
      events: res.rows[0]?.events || 0
    };
  }
  const events = [...memory.reputation.values()].filter((e) => e.userId === userId);
  return {
    userId,
    score: events.reduce((s, e) => s + Number(e.points || 0), 0),
    events: events.length
  };
}

// ── Reports ─────────────────────────────────────────────────────────────────

async function reportContent(input, options = {}) {
  const {
    reporterId = null,
    targetType,
    targetId,
    reason,
    details = ""
  } = input;
  if (!targetType || !targetId || !reason) return { ok: false, reason: "missing_fields" };
  if (reporterId) {
    const rl = checkRateLimit("report", reporterId, options);
    if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };
  }

  const report = {
    id: reportId(),
    reporterId,
    targetType,
    targetId,
    reason: String(reason).trim().slice(0, 200),
    details: String(details || "").trim().slice(0, 2000),
    status: "open",
    createdAt: nowIso(),
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: ""
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO social_reports (
         id, reporter_id, target_type, target_id, reason, details, status, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'open',NOW());`,
      [
        report.id,
        report.reporterId,
        report.targetType,
        report.targetId,
        report.reason,
        report.details
      ]
    );
  } else {
    memory.reports.set(report.id, report);
  }

  await audit("social.report", {
    actorId: reporterId || "anonymous",
    targetType,
    targetId,
    metadata: { reportId: report.id, reason: report.reason },
    ip: options.ip
  });
  return { ok: true, report };
}

async function listReports({ status = "open", limit = 50 } = {}, options = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM social_reports
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY created_at DESC LIMIT $2;`,
      [status || null, lim]
    );
    return res.rows.map((r) => ({
      id: r.id,
      reporterId: r.reporter_id,
      targetType: r.target_type,
      targetId: r.target_id,
      reason: r.reason,
      details: r.details || "",
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
      resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null,
      resolvedBy: r.resolved_by,
      resolutionNote: r.resolution_note || ""
    }));
  }
  return [...memory.reports.values()]
    .filter((r) => !status || r.status === status)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, lim);
}

async function resolveReport(
  { id, resolverId, status = "resolved", note = "" },
  options = {}
) {
  if (!["resolved", "dismissed", "in_review"].includes(status)) {
    return { ok: false, reason: "invalid_status" };
  }
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE social_reports SET
         status = $2,
         resolved_at = CASE WHEN $2 IN ('resolved','dismissed') THEN NOW() ELSE resolved_at END,
         resolved_by = $3,
         resolution_note = $4
       WHERE id = $1
       RETURNING *;`,
      [id, status, resolverId, String(note || "").slice(0, 1000)]
    );
    if (!res.rows[0]) return { ok: false, reason: "not_found" };
    await audit("social.report.resolve", {
      actorId: resolverId,
      targetType: "social_report",
      targetId: id,
      metadata: { status, note: String(note || "").slice(0, 200) },
      ip: options.ip
    });
    return { ok: true };
  }
  const r = memory.reports.get(id);
  if (!r) return { ok: false, reason: "not_found" };
  r.status = status;
  r.resolvedBy = resolverId;
  r.resolutionNote = String(note || "").slice(0, 1000);
  if (status === "resolved" || status === "dismissed") r.resolvedAt = nowIso();
  await audit("social.report.resolve", {
    actorId: resolverId,
    targetType: "social_report",
    targetId: id,
    metadata: { status },
    ip: options.ip
  });
  return { ok: true };
}

// ── Notification helpers (mentions / replies) ───────────────────────────────

/**
 * Enqueue social notification if prefs allow and not blocked.
 * Uses notifications.enqueueNotification + follow_up/social templates.
 */
async function maybeNotifySocial(
  {
    recipientUserId,
    recipientEmail = null,
    kind, // 'mention' | 'reply' | 'follow'
    actorId,
    targetType,
    targetId,
    preview = ""
  },
  options = {}
) {
  if (!recipientUserId || recipientUserId === actorId) {
    return { skipped: true, reason: "self_or_missing" };
  }
  if (await isBlockedEither(recipientUserId, actorId, options)) {
    return { skipped: true, reason: "blocked" };
  }

  try {
    // eslint-disable-next-line global-require
    const notifications = require("./notifications");
    // eslint-disable-next-line global-require
    const ctx = require("./context");

    let email = recipientEmail;
    if (!email && typeof ctx.storageGetUserById === "function") {
      const user = await ctx.storageGetUserById(recipientUserId);
      email = user?.email || null;
    }
    if (!email) return { skipped: true, reason: "no_email" };

    const templateKey =
      kind === "mention"
        ? notifications.TEMPLATE_KEYS.SOCIAL_MENTION || "social.mention"
        : kind === "follow"
          ? notifications.TEMPLATE_KEYS.SOCIAL_FOLLOW || "social.follow"
          : notifications.TEMPLATE_KEYS.SOCIAL_REPLY || "social.reply";

    const idempotencyKey = `social:${kind}:${actorId}:${targetType}:${targetId}:${recipientUserId}`;

    const out = await notifications.enqueueNotification(
      {
        channel: notifications.CHANNEL.EMAIL,
        templateKey,
        recipientEmail: email,
        recipientUserId,
        idempotencyKey,
        templateVars: {
          actorId,
          targetType,
          targetId,
          preview: String(preview || "").slice(0, 200),
          kind
        }
      },
      options
    );
    return { skipped: false, deliveryId: out.delivery?.id, created: out.created };
  } catch (err) {
    console.warn(
      "[social] maybeNotifySocial failed:",
      err instanceof Error ? err.message : String(err)
    );
    return { skipped: true, reason: "enqueue_failed" };
  }
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  COMMENT_STATUS,
  COMMENT_TARGET_TYPES,
  REACTION_TYPES,
  REACTION_TARGET_TYPES,
  SAVE_TARGET_TYPES,
  GROUP_TYPES,
  GROUP_STATUS,
  REPUTATION_POINTS,
  RATE_LIMITS,

  extractMentions,
  checkRateLimit,
  memoryReset,

  blockUser,
  unblockUser,
  isBlocked,
  isBlockedEither,
  listBlocks,
  filterBlockedAuthors,

  followUser,
  unfollowUser,
  isFollowing,
  listFollowing,
  listFollowers,

  saveContent,
  unsaveContent,
  listSaves,

  addReaction,
  removeReaction,
  listReactions,
  countReactions,

  createComment,
  getComment,
  listComments,
  nestComments,
  deleteComment,

  createGroup,
  listGroups,
  joinGroup,
  leaveGroup,

  recordReputation,
  getReputationScore,

  reportContent,
  listReports,
  resolveReport,

  maybeNotifySocial
};
