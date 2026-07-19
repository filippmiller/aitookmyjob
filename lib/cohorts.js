/**
 * Cohorts, buddy matching, mentors, and events.
 * Memory store for unit tests / JSON-fallback; PostgreSQL when DATABASE_URL is set.
 *
 * Bead: aitj-z8q.14
 */

"use strict";

const { customAlphabet } = require("nanoid");
const { COHORT_STATUS, canTransition } = require("./domain-contract");

const idGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const cohortId = () => `cohort-${idGen()}`;
const buddyId = () => `buddy_${idGen()}`;
const eventId = () => `cevt_${idGen()}`;
const outcomeId = () => `cout_${idGen()}`;

// ── Domain constants ────────────────────────────────────────────────────────

const MEMBER_ROLES = Object.freeze(["member", "facilitator", "mentor"]);
const MEMBER_STATUS = Object.freeze({
  ACTIVE: "active",
  WAITLISTED: "waitlisted",
  LEFT: "left",
  REMOVED: "removed",
  BANNED: "banned",
  COMPLETED: "completed"
});

const WAITLIST_STATUS = Object.freeze({
  WAITING: "waiting",
  PROMOTED: "promoted",
  CANCELLED: "cancelled"
});

const BUDDY_STATUS = Object.freeze({
  PROPOSED: "proposed",
  ACTIVE: "active",
  COMPLETED: "completed",
  DISSOLVED: "dissolved"
});

const MENTOR_STATUS = Object.freeze({
  OPEN: "open",
  PAUSED: "paused",
  CLOSED: "closed"
});

const EVENT_STATUS = Object.freeze({
  SCHEDULED: "scheduled",
  CANCELLED: "cancelled",
  COMPLETED: "completed"
});

const OUTCOME_TYPES = Object.freeze([
  "completion",
  "early_exit",
  "goal_met",
  "goal_partial",
  "needs_support"
]);

const RATE_LIMITS = Object.freeze({
  join: { max: 15, windowMs: 60 * 60 * 1000 },
  create: { max: 10, windowMs: 24 * 60 * 60 * 1000 },
  event: { max: 30, windowMs: 24 * 60 * 60 * 1000 }
});

const JOINABLE_STATUSES = Object.freeze([
  COHORT_STATUS.OPEN,
  COHORT_STATUS.FULL,
  COHORT_STATUS.IN_PROGRESS
]);

// ── Memory stores ───────────────────────────────────────────────────────────

const memory = {
  cohorts: new Map(),
  members: new Map(), // key: cohort::user
  waitlist: new Map(), // key: cohort::user
  buddies: new Map(),
  mentors: new Map(), // key: userId
  events: new Map(),
  outcomes: new Map(),
  /** @type {Map<string, number[]>} */
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

// ── Pool helpers ────────────────────────────────────────────────────────────

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
    return Boolean(ctx.usePostgres && ctx.getPgPool?.());
  } catch (_e) {
    return false;
  }
}

function getPoolOrThrow(options = {}) {
  const pool = resolvePool(options);
  if (pool) return pool;
  try {
    // eslint-disable-next-line global-require
    const ctx = require("./context");
    const p = ctx.getPgPool?.();
    if (p) return p;
  } catch (_e) {
    /* ignore */
  }
  throw new Error("PostgreSQL pool required");
}

async function audit(action, payload) {
  try {
    // eslint-disable-next-line global-require
    const ctx = require("./context");
    if (typeof ctx.storageAudit === "function") {
      await ctx.storageAudit({
        action,
        actorId: payload.actorId || "system",
        targetType: payload.targetType || "cohort",
        targetId: payload.targetId || "",
        metadata: payload.metadata || {},
        ip: payload.ip || ""
      });
    }
  } catch (_e) {
    /* audit must not break product path */
  }
}

// ── Rate limit ──────────────────────────────────────────────────────────────

function checkRateLimit(action, userId, options = {}) {
  if (options.skipRateLimit) return { allowed: true };
  const cfg = RATE_LIMITS[action];
  if (!cfg) return { allowed: true };
  const key = `${action}:${userId}`;
  const now = Date.now();
  const bucket = memory.rateBuckets.get(key) || [];
  const fresh = bucket.filter((t) => now - t < cfg.windowMs);
  if (fresh.length >= cfg.max) {
    const retryAfterMs = cfg.windowMs - (now - fresh[0]);
    memory.rateBuckets.set(key, fresh);
    return { allowed: false, retryAfterMs };
  }
  fresh.push(now);
  memory.rateBuckets.set(key, fresh);
  return { allowed: true };
}

// ── Mappers ─────────────────────────────────────────────────────────────────

function mapCohort(r) {
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    description: r.description || "",
    profession: r.profession,
    country: r.country || "global",
    language: r.language || "en",
    capacity: Number(r.capacity ?? 10),
    enrolled: Number(r.enrolled ?? 0),
    startsAt: r.startsAt ?? r.starts_at ?? "",
    endsAt: r.endsAt ?? r.ends_at ?? "",
    status: r.status || COHORT_STATUS.OPEN,
    facilitatorId: r.facilitatorId ?? r.facilitator_id ?? null,
    scheduleNotes: r.scheduleNotes ?? r.schedule_notes ?? "",
    visibility: r.visibility || "public",
    waitlistEnabled:
      r.waitlistEnabled != null
        ? Boolean(r.waitlistEnabled)
        : r.waitlist_enabled != null
          ? Boolean(r.waitlist_enabled)
          : true,
    buddyMatchingEnabled:
      r.buddyMatchingEnabled != null
        ? Boolean(r.buddyMatchingEnabled)
        : r.buddy_matching_enabled != null
          ? Boolean(r.buddy_matching_enabled)
          : true,
    createdBy: r.createdBy ?? r.created_by ?? "system",
    createdAt: r.createdAt ?? r.created_at ?? null,
    updatedAt: r.updatedAt ?? r.updated_at ?? null
  };
}

function mapMember(r) {
  if (!r) return null;
  return {
    cohortId: r.cohortId ?? r.cohort_id,
    userId: r.userId ?? r.user_id,
    role: r.role || "member",
    status: r.status || MEMBER_STATUS.ACTIVE,
    joinedAt: r.joinedAt ?? r.joined_at ?? null,
    leftAt: r.leftAt ?? r.left_at ?? null,
    notes: r.notes || ""
  };
}

function mapWaitlist(r) {
  if (!r) return null;
  return {
    cohortId: r.cohortId ?? r.cohort_id,
    userId: r.userId ?? r.user_id,
    position: Number(r.position ?? 0),
    status: r.status || WAITLIST_STATUS.WAITING,
    createdAt: r.createdAt ?? r.created_at ?? null,
    updatedAt: r.updatedAt ?? r.updated_at ?? null
  };
}

function mapBuddy(r) {
  if (!r) return null;
  return {
    id: r.id,
    cohortId: r.cohortId ?? r.cohort_id,
    userAId: r.userAId ?? r.user_a_id,
    userBId: r.userBId ?? r.user_b_id,
    status: r.status || BUDDY_STATUS.ACTIVE,
    matchedBy: r.matchedBy ?? r.matched_by ?? "system",
    notes: r.notes || "",
    matchedAt: r.matchedAt ?? r.matched_at ?? null,
    dissolvedAt: r.dissolvedAt ?? r.dissolved_at ?? null
  };
}

function mapMentor(r) {
  if (!r) return null;
  let expertise = r.expertise;
  let availability = r.availability;
  let languages = r.languages;
  if (typeof expertise === "string") {
    try {
      expertise = JSON.parse(expertise);
    } catch (_e) {
      expertise = [];
    }
  }
  if (typeof availability === "string") {
    try {
      availability = JSON.parse(availability);
    } catch (_e) {
      availability = {};
    }
  }
  if (typeof languages === "string") {
    try {
      languages = JSON.parse(languages);
    } catch (_e) {
      languages = ["en"];
    }
  }
  return {
    userId: r.userId ?? r.user_id,
    displayName: r.displayName ?? r.display_name ?? "",
    bio: r.bio || "",
    expertise: Array.isArray(expertise) ? expertise : [],
    availability: availability && typeof availability === "object" ? availability : {},
    status: r.status || MENTOR_STATUS.OPEN,
    maxMentees: Number(r.maxMentees ?? r.max_mentees ?? 3),
    currentMentees: Number(r.currentMentees ?? r.current_mentees ?? 0),
    languages: Array.isArray(languages) ? languages : ["en"],
    region: r.region || "global",
    createdAt: r.createdAt ?? r.created_at ?? null,
    updatedAt: r.updatedAt ?? r.updated_at ?? null
  };
}

function mapEvent(r) {
  if (!r) return null;
  return {
    id: r.id,
    cohortId: r.cohortId ?? r.cohort_id,
    title: r.title,
    description: r.description || "",
    startsAt: r.startsAt ?? r.starts_at,
    endsAt: r.endsAt ?? r.ends_at ?? null,
    location: r.location || "",
    meetingUrl: r.meetingUrl ?? r.meeting_url ?? "",
    status: r.status || EVENT_STATUS.SCHEDULED,
    reminderOffsetMinutes: Number(
      r.reminderOffsetMinutes ?? r.reminder_offset_minutes ?? 60
    ),
    reminderSentAt: r.reminderSentAt ?? r.reminder_sent_at ?? null,
    createdBy: r.createdBy ?? r.created_by,
    createdAt: r.createdAt ?? r.created_at ?? null,
    updatedAt: r.updatedAt ?? r.updated_at ?? null
  };
}

function mapOutcome(r) {
  if (!r) return null;
  return {
    id: r.id,
    cohortId: r.cohortId ?? r.cohort_id,
    userId: r.userId ?? r.user_id,
    outcomeType: r.outcomeType ?? r.outcome_type,
    notes: r.notes || "",
    followUpSentAt: r.followUpSentAt ?? r.follow_up_sent_at ?? null,
    createdAt: r.createdAt ?? r.created_at ?? null
  };
}

// ── Harassment / block helpers ──────────────────────────────────────────────

async function isBlockedEither(userA, userB, options = {}) {
  if (!userA || !userB || userA === userB) return false;
  try {
    // eslint-disable-next-line global-require
    const social = require("./social");
    return await social.isBlockedEither(userA, userB, options);
  } catch (_e) {
    return false;
  }
}

/**
 * Active members the actor cannot safely interact with (blocks either way).
 */
async function blockedMemberIds(cohortId, actorId, options = {}) {
  const members = await listMembers({ cohortId, status: MEMBER_STATUS.ACTIVE }, options);
  const blocked = [];
  for (const m of members) {
    if (m.userId === actorId) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await isBlockedEither(actorId, m.userId, options)) blocked.push(m.userId);
  }
  return blocked;
}

// ── Cohort CRUD ─────────────────────────────────────────────────────────────

async function createCohort(input, options = {}) {
  const title = String(input.title || "").trim();
  const profession = String(input.profession || "").trim();
  const capacity = Number(input.capacity || 0);
  const createdBy = input.createdBy || input.created_by || "system";

  if (title.length < 8) return { ok: false, reason: "title_too_short" };
  if (profession.length < 2) return { ok: false, reason: "profession_required" };
  if (!Number.isFinite(capacity) || capacity < 2) {
    return { ok: false, reason: "capacity_min_2" };
  }

  const rl = checkRateLimit("create", createdBy, options);
  if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };

  const status = input.status || COHORT_STATUS.OPEN;
  if (!Object.values(COHORT_STATUS).includes(status)) {
    return { ok: false, reason: "invalid_status" };
  }

  const row = {
    id: input.id || cohortId(),
    title,
    description: String(input.description || "").trim(),
    profession,
    country: input.country || "global",
    language: input.language || "en",
    capacity: Math.min(500, Math.floor(capacity)),
    enrolled: 0,
    startsAt: String(input.startsAt || input.starts_at || ""),
    endsAt: String(input.endsAt || input.ends_at || ""),
    status,
    facilitatorId: input.facilitatorId || input.facilitator_id || createdBy || null,
    scheduleNotes: String(input.scheduleNotes || input.schedule_notes || ""),
    visibility: input.visibility || "public",
    waitlistEnabled:
      input.waitlistEnabled != null
        ? Boolean(input.waitlistEnabled)
        : input.waitlist_enabled != null
          ? Boolean(input.waitlist_enabled)
          : true,
    buddyMatchingEnabled:
      input.buddyMatchingEnabled != null
        ? Boolean(input.buddyMatchingEnabled)
        : input.buddy_matching_enabled != null
          ? Boolean(input.buddy_matching_enabled)
          : true,
    createdBy,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO cohorts (
         id, title, profession, country, capacity, enrolled, starts_at, status,
         description, facilitator_id, schedule_notes, ends_at, visibility,
         waitlist_enabled, buddy_matching_enabled, language, created_by,
         created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,0,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()
       );`,
      [
        row.id,
        row.title,
        row.profession,
        row.country,
        row.capacity,
        row.startsAt,
        row.status,
        row.description,
        row.facilitatorId,
        row.scheduleNotes,
        row.endsAt,
        row.visibility,
        row.waitlistEnabled,
        row.buddyMatchingEnabled,
        row.language,
        row.createdBy
      ]
    );
    if (row.facilitatorId) {
      await pool.query(
        `INSERT INTO cohort_members (cohort_id, user_id, role, status, joined_at)
         VALUES ($1,$2,'facilitator','active',NOW())
         ON CONFLICT (cohort_id, user_id) DO UPDATE SET
           role = 'facilitator', status = 'active', left_at = NULL;`,
        [row.id, row.facilitatorId]
      );
      await pool.query(
        `UPDATE cohorts SET enrolled = (
           SELECT COUNT(*)::int FROM cohort_members
           WHERE cohort_id = $1 AND status = 'active'
         ), updated_at = NOW() WHERE id = $1;`,
        [row.id]
      );
      row.enrolled = 1;
    }
  } else {
    memory.cohorts.set(row.id, { ...row });
    if (row.facilitatorId) {
      memory.members.set(pairKey(row.id, row.facilitatorId), {
        cohortId: row.id,
        userId: row.facilitatorId,
        role: "facilitator",
        status: MEMBER_STATUS.ACTIVE,
        joinedAt: nowIso(),
        leftAt: null,
        notes: ""
      });
      row.enrolled = 1;
      memory.cohorts.set(row.id, { ...row });
    }
  }

  await audit("cohort.create", {
    actorId: createdBy,
    targetId: row.id,
    metadata: { profession: row.profession, capacity: row.capacity },
    ip: options.ip
  });

  return { ok: true, cohort: mapCohort(row) };
}

async function getCohort(id, options = {}) {
  if (!id) return null;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(`SELECT * FROM cohorts WHERE id = $1;`, [id]);
    return mapCohort(res.rows[0]);
  }
  return mapCohort(memory.cohorts.get(id) || null);
}

async function listCohorts(filters = {}, options = {}) {
  const {
    country,
    profession,
    status,
    language,
    includeNonPublic = false
  } = filters;

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const clauses = ["status <> 'cancelled'"];
    const params = [];
    if (!includeNonPublic) {
      clauses.push(`status = ANY($${params.length + 1}::text[])`);
      params.push([...JOINABLE_STATUSES, COHORT_STATUS.COMPLETED]);
      clauses.push(`visibility IN ('public', 'community')`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (country) {
      params.push(country);
      clauses.push(`(country = $${params.length} OR country = 'global')`);
    }
    if (profession) {
      params.push(`%${profession}%`);
      clauses.push(`profession ILIKE $${params.length}`);
    }
    if (language) {
      params.push(language);
      clauses.push(`language = $${params.length}`);
    }
    const res = await pool.query(
      `SELECT * FROM cohorts WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC LIMIT 100;`,
      params
    );
    return res.rows.map(mapCohort);
  }

  return [...memory.cohorts.values()]
    .filter((c) => {
      if (c.status === COHORT_STATUS.CANCELLED) return false;
      if (!includeNonPublic) {
        if (!JOINABLE_STATUSES.includes(c.status) && c.status !== COHORT_STATUS.COMPLETED) {
          return false;
        }
        if (c.visibility === "restricted") return false;
      }
      if (status && c.status !== status) return false;
      if (country && c.country !== country && c.country !== "global") return false;
      if (
        profession &&
        !String(c.profession).toLowerCase().includes(String(profession).toLowerCase())
      ) {
        return false;
      }
      if (language && c.language !== language) return false;
      return true;
    })
    .map(mapCohort)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function updateCohort(id, patch, options = {}) {
  const existing = await getCohort(id, options);
  if (!existing) return { ok: false, reason: "not_found" };

  if (patch.status && patch.status !== existing.status) {
    if (!canTransition("cohort", existing.status, patch.status)) {
      return { ok: false, reason: "invalid_transition" };
    }
  }

  const next = {
    ...existing,
    title: patch.title != null ? String(patch.title).trim() : existing.title,
    description:
      patch.description != null ? String(patch.description).trim() : existing.description,
    profession:
      patch.profession != null ? String(patch.profession).trim() : existing.profession,
    country: patch.country != null ? patch.country : existing.country,
    language: patch.language != null ? patch.language : existing.language,
    capacity:
      patch.capacity != null
        ? Math.min(500, Math.max(2, Math.floor(Number(patch.capacity))))
        : existing.capacity,
    startsAt:
      patch.startsAt != null || patch.starts_at != null
        ? String(patch.startsAt ?? patch.starts_at)
        : existing.startsAt,
    endsAt:
      patch.endsAt != null || patch.ends_at != null
        ? String(patch.endsAt ?? patch.ends_at)
        : existing.endsAt,
    status: patch.status != null ? patch.status : existing.status,
    facilitatorId:
      patch.facilitatorId != null || patch.facilitator_id != null
        ? patch.facilitatorId ?? patch.facilitator_id
        : existing.facilitatorId,
    scheduleNotes:
      patch.scheduleNotes != null || patch.schedule_notes != null
        ? String(patch.scheduleNotes ?? patch.schedule_notes)
        : existing.scheduleNotes,
    visibility: patch.visibility != null ? patch.visibility : existing.visibility,
    waitlistEnabled:
      patch.waitlistEnabled != null || patch.waitlist_enabled != null
        ? Boolean(patch.waitlistEnabled ?? patch.waitlist_enabled)
        : existing.waitlistEnabled,
    buddyMatchingEnabled:
      patch.buddyMatchingEnabled != null || patch.buddy_matching_enabled != null
        ? Boolean(patch.buddyMatchingEnabled ?? patch.buddy_matching_enabled)
        : existing.buddyMatchingEnabled,
    updatedAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE cohorts SET
         title = $2, description = $3, profession = $4, country = $5, language = $6,
         capacity = $7, starts_at = $8, ends_at = $9, status = $10,
         facilitator_id = $11, schedule_notes = $12, visibility = $13,
         waitlist_enabled = $14, buddy_matching_enabled = $15, updated_at = NOW()
       WHERE id = $1;`,
      [
        id,
        next.title,
        next.description,
        next.profession,
        next.country,
        next.language,
        next.capacity,
        next.startsAt,
        next.endsAt,
        next.status,
        next.facilitatorId,
        next.scheduleNotes,
        next.visibility,
        next.waitlistEnabled,
        next.buddyMatchingEnabled
      ]
    );
  } else {
    memory.cohorts.set(id, { ...next });
  }

  await audit("cohort.update", {
    actorId: options.actorId || "system",
    targetId: id,
    metadata: { status: next.status },
    ip: options.ip
  });

  return { ok: true, cohort: mapCohort(next) };
}

async function recountEnrolled(cohortId, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE cohorts SET enrolled = (
         SELECT COUNT(*)::int FROM cohort_members
         WHERE cohort_id = $1 AND status = 'active'
       ), updated_at = NOW()
       WHERE id = $1
       RETURNING enrolled, capacity, status, waitlist_enabled;`,
      [cohortId]
    );
    return res.rows[0]
      ? {
          enrolled: Number(res.rows[0].enrolled),
          capacity: Number(res.rows[0].capacity),
          status: res.rows[0].status,
          waitlistEnabled: Boolean(res.rows[0].waitlist_enabled)
        }
      : null;
  }
  const c = memory.cohorts.get(cohortId);
  if (!c) return null;
  c.enrolled = [...memory.members.values()].filter(
    (m) => m.cohortId === cohortId && m.status === MEMBER_STATUS.ACTIVE
  ).length;
  memory.cohorts.set(cohortId, c);
  return {
    enrolled: c.enrolled,
    capacity: c.capacity,
    status: c.status,
    waitlistEnabled: c.waitlistEnabled
  };
}

/**
 * Sync open/full status from capacity after join/leave/promote.
 */
async function syncCapacityStatus(cohortId, options = {}) {
  const counts = await recountEnrolled(cohortId, options);
  if (!counts) return null;
  const cohort = await getCohort(cohortId, options);
  if (!cohort) return counts;

  let nextStatus = cohort.status;
  if (
    cohort.status === COHORT_STATUS.OPEN ||
    cohort.status === COHORT_STATUS.FULL
  ) {
    if (counts.enrolled >= counts.capacity) nextStatus = COHORT_STATUS.FULL;
    else nextStatus = COHORT_STATUS.OPEN;
  }

  if (nextStatus !== cohort.status) {
    await updateCohort(cohortId, { status: nextStatus }, { ...options, actorId: "system" });
  }
  return { ...counts, status: nextStatus };
}

// ── Membership ──────────────────────────────────────────────────────────────

async function getMembership(cohortId, userId, options = {}) {
  if (!cohortId || !userId) return null;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM cohort_members WHERE cohort_id = $1 AND user_id = $2;`,
      [cohortId, userId]
    );
    return mapMember(res.rows[0]);
  }
  return mapMember(memory.members.get(pairKey(cohortId, userId)) || null);
}

async function listMembers({ cohortId, status } = {}, options = {}) {
  if (!cohortId) return [];
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    if (status) {
      const res = await pool.query(
        `SELECT * FROM cohort_members WHERE cohort_id = $1 AND status = $2
         ORDER BY joined_at ASC;`,
        [cohortId, status]
      );
      return res.rows.map(mapMember);
    }
    const res = await pool.query(
      `SELECT * FROM cohort_members WHERE cohort_id = $1 ORDER BY joined_at ASC;`,
      [cohortId]
    );
    return res.rows.map(mapMember);
  }
  return [...memory.members.values()]
    .filter((m) => m.cohortId === cohortId && (!status || m.status === status))
    .map(mapMember)
    .sort((a, b) => String(a.joinedAt || "").localeCompare(String(b.joinedAt || "")));
}

async function isFacilitatorOrAdmin(cohort, userId, options = {}) {
  if (!userId) return false;
  if (options.isAdmin) return true;
  if (cohort?.facilitatorId && cohort.facilitatorId === userId) return true;
  const m = await getMembership(cohort.id, userId, options);
  return Boolean(m && m.status === MEMBER_STATUS.ACTIVE && m.role === "facilitator");
}

async function joinCohort({ cohortId, userId, role = "member" }, options = {}) {
  if (!cohortId || !userId) return { ok: false, reason: "missing_fields" };
  if (!MEMBER_ROLES.includes(role)) return { ok: false, reason: "invalid_role" };

  const rl = checkRateLimit("join", userId, options);
  if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };

  const cohort = await getCohort(cohortId, options);
  if (!cohort) return { ok: false, reason: "not_found" };
  if (!JOINABLE_STATUSES.includes(cohort.status) && cohort.status !== COHORT_STATUS.FULL) {
    // FULL is joinable via waitlist only
    if (cohort.status !== COHORT_STATUS.FULL) {
      return { ok: false, reason: "not_joinable" };
    }
  }
  if (
    cohort.status === COHORT_STATUS.COMPLETED ||
    cohort.status === COHORT_STATUS.CANCELLED ||
    cohort.status === COHORT_STATUS.DRAFT
  ) {
    return { ok: false, reason: "not_joinable" };
  }

  const existing = await getMembership(cohortId, userId, options);
  if (existing?.status === MEMBER_STATUS.BANNED) {
    return { ok: false, reason: "banned" };
  }
  if (existing?.status === MEMBER_STATUS.ACTIVE) {
    return { ok: true, alreadyMember: true, membership: existing, waitlisted: false };
  }

  // Harassment: refuse join if blocked with facilitator (hard gate)
  if (cohort.facilitatorId && (await isBlockedEither(userId, cohort.facilitatorId, options))) {
    return { ok: false, reason: "blocked" };
  }

  const counts = await recountEnrolled(cohortId, options);
  const atCapacity = counts && counts.enrolled >= counts.capacity;

  // Already waitlisted and still full → leave them on the waitlist
  if (existing?.status === MEMBER_STATUS.WAITLISTED && atCapacity) {
    return { ok: true, alreadyMember: false, waitlisted: true, membership: existing };
  }

  if (atCapacity) {
    if (!cohort.waitlistEnabled) {
      return { ok: false, reason: "full" };
    }
    return addToWaitlist({ cohortId, userId }, options);
  }

  // Room available: promote waitlisted members or enroll new joiners

  const membership = {
    cohortId,
    userId,
    role: role === "facilitator" ? "facilitator" : role === "mentor" ? "mentor" : "member",
    status: MEMBER_STATUS.ACTIVE,
    joinedAt: nowIso(),
    leftAt: null,
    notes: ""
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO cohort_members (cohort_id, user_id, role, status, joined_at)
       VALUES ($1,$2,$3,'active',NOW())
       ON CONFLICT (cohort_id, user_id) DO UPDATE SET
         status = 'active', role = EXCLUDED.role, left_at = NULL, joined_at = NOW()
       WHERE cohort_members.status NOT IN ('banned');`,
      [cohortId, userId, membership.role]
    );
    // Cancel any waitlist row
    await pool.query(
      `UPDATE cohort_waitlist SET status = 'promoted', updated_at = NOW()
       WHERE cohort_id = $1 AND user_id = $2 AND status = 'waiting';`,
      [cohortId, userId]
    );
  } else {
    memory.members.set(pairKey(cohortId, userId), membership);
    const wl = memory.waitlist.get(pairKey(cohortId, userId));
    if (wl && wl.status === WAITLIST_STATUS.WAITING) {
      wl.status = WAITLIST_STATUS.PROMOTED;
      wl.updatedAt = nowIso();
    }
  }

  await syncCapacityStatus(cohortId, options);
  await audit("cohort.join", {
    actorId: userId,
    targetId: cohortId,
    metadata: { role: membership.role },
    ip: options.ip
  });

  return {
    ok: true,
    alreadyMember: false,
    waitlisted: false,
    membership: mapMember(membership)
  };
}

async function addToWaitlist({ cohortId, userId }, options = {}) {
  const cohort = await getCohort(cohortId, options);
  if (!cohort) return { ok: false, reason: "not_found" };
  if (!cohort.waitlistEnabled) return { ok: false, reason: "waitlist_disabled" };

  let position = 1;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const maxPos = await pool.query(
      `SELECT COALESCE(MAX(position), 0)::int AS m FROM cohort_waitlist
       WHERE cohort_id = $1 AND status = 'waiting';`,
      [cohortId]
    );
    position = Number(maxPos.rows[0]?.m || 0) + 1;
    await pool.query(
      `INSERT INTO cohort_waitlist (cohort_id, user_id, position, status, created_at, updated_at)
       VALUES ($1,$2,$3,'waiting',NOW(),NOW())
       ON CONFLICT (cohort_id, user_id) DO UPDATE SET
         status = 'waiting',
         position = CASE
           WHEN cohort_waitlist.status = 'waiting' THEN cohort_waitlist.position
           ELSE EXCLUDED.position
         END,
         updated_at = NOW()
       RETURNING *;`,
      [cohortId, userId, position]
    );
    await pool.query(
      `INSERT INTO cohort_members (cohort_id, user_id, role, status, joined_at)
       VALUES ($1,$2,'member','waitlisted',NOW())
       ON CONFLICT (cohort_id, user_id) DO UPDATE SET
         status = 'waitlisted', left_at = NULL
       WHERE cohort_members.status NOT IN ('banned', 'active');`,
      [cohortId, userId]
    );
    await syncCapacityStatus(cohortId, options);
  } else {
    const waiting = [...memory.waitlist.values()].filter(
      (w) => w.cohortId === cohortId && w.status === WAITLIST_STATUS.WAITING
    );
    position =
      waiting.reduce((m, w) => Math.max(m, Number(w.position) || 0), 0) + 1;
    memory.waitlist.set(pairKey(cohortId, userId), {
      cohortId,
      userId,
      position,
      status: WAITLIST_STATUS.WAITING,
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    const existing = memory.members.get(pairKey(cohortId, userId));
    if (!existing || existing.status !== MEMBER_STATUS.BANNED) {
      memory.members.set(pairKey(cohortId, userId), {
        cohortId,
        userId,
        role: "member",
        status: MEMBER_STATUS.WAITLISTED,
        joinedAt: nowIso(),
        leftAt: null,
        notes: ""
      });
    }
    await syncCapacityStatus(cohortId, options);
  }

  await audit("cohort.waitlist", {
    actorId: userId,
    targetId: cohortId,
    metadata: { position },
    ip: options.ip
  });

  return {
    ok: true,
    waitlisted: true,
    position,
    membership: mapMember({
      cohortId,
      userId,
      role: "member",
      status: MEMBER_STATUS.WAITLISTED,
      joinedAt: nowIso()
    })
  };
}

async function listWaitlist(cohortId, options = {}) {
  if (!cohortId) return [];
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM cohort_waitlist
       WHERE cohort_id = $1 AND status = 'waiting'
       ORDER BY position ASC, created_at ASC;`,
      [cohortId]
    );
    return res.rows.map(mapWaitlist);
  }
  return [...memory.waitlist.values()]
    .filter((w) => w.cohortId === cohortId && w.status === WAITLIST_STATUS.WAITING)
    .map(mapWaitlist)
    .sort((a, b) => a.position - b.position);
}

async function leaveCohort({ cohortId, userId }, options = {}) {
  if (!cohortId || !userId) return { ok: false, reason: "missing_fields" };

  const existing = await getMembership(cohortId, userId, options);
  if (!existing || !["active", "waitlisted"].includes(existing.status)) {
    // also cancel waitlist if present
    await cancelWaitlist({ cohortId, userId }, options);
    return { ok: true, removed: false };
  }

  const wasActive = existing.status === MEMBER_STATUS.ACTIVE;

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE cohort_members SET status = 'left', left_at = NOW()
       WHERE cohort_id = $1 AND user_id = $2 AND status IN ('active', 'waitlisted');`,
      [cohortId, userId]
    );
    await pool.query(
      `UPDATE cohort_waitlist SET status = 'cancelled', updated_at = NOW()
       WHERE cohort_id = $1 AND user_id = $2 AND status = 'waiting';`,
      [cohortId, userId]
    );
  } else {
    existing.status = MEMBER_STATUS.LEFT;
    existing.leftAt = nowIso();
    memory.members.set(pairKey(cohortId, userId), existing);
    const wl = memory.waitlist.get(pairKey(cohortId, userId));
    if (wl && wl.status === WAITLIST_STATUS.WAITING) {
      wl.status = WAITLIST_STATUS.CANCELLED;
      wl.updatedAt = nowIso();
    }
  }

  // Dissolve active buddy pairs involving this user
  await dissolveUserBuddies(cohortId, userId, options);

  await syncCapacityStatus(cohortId, options);

  if (wasActive) {
    await promoteNextFromWaitlist(cohortId, options);
  }

  await audit("cohort.leave", {
    actorId: userId,
    targetId: cohortId,
    ip: options.ip
  });

  return { ok: true, removed: true };
}

async function cancelWaitlist({ cohortId, userId }, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE cohort_waitlist SET status = 'cancelled', updated_at = NOW()
       WHERE cohort_id = $1 AND user_id = $2 AND status = 'waiting';`,
      [cohortId, userId]
    );
  } else {
    const wl = memory.waitlist.get(pairKey(cohortId, userId));
    if (wl) {
      wl.status = WAITLIST_STATUS.CANCELLED;
      wl.updatedAt = nowIso();
    }
  }
}

async function promoteNextFromWaitlist(cohortId, options = {}) {
  const counts = await recountEnrolled(cohortId, options);
  if (!counts || counts.enrolled >= counts.capacity) {
    return { ok: true, promoted: null };
  }

  const waiting = await listWaitlist(cohortId, options);
  if (!waiting.length) return { ok: true, promoted: null };

  const next = waiting[0];
  // Skip if blocked with facilitator
  const cohort = await getCohort(cohortId, options);
  if (
    cohort?.facilitatorId &&
    (await isBlockedEither(next.userId, cohort.facilitatorId, options))
  ) {
    // cancel blocked waitlist entry and try next
    await cancelWaitlist({ cohortId, userId: next.userId }, options);
    if (usePg(options)) {
      const pool = getPoolOrThrow(options);
      await pool.query(
        `UPDATE cohort_members SET status = 'removed', left_at = NOW()
         WHERE cohort_id = $1 AND user_id = $2 AND status = 'waitlisted';`,
        [cohortId, next.userId]
      );
    } else {
      const m = memory.members.get(pairKey(cohortId, next.userId));
      if (m) {
        m.status = MEMBER_STATUS.REMOVED;
        m.leftAt = nowIso();
      }
    }
    return promoteNextFromWaitlist(cohortId, options);
  }

  const joinResult = await joinCohort(
    { cohortId, userId: next.userId },
    { ...options, skipRateLimit: true }
  );

  if (joinResult.ok && !joinResult.waitlisted) {
    await audit("cohort.waitlist.promote", {
      actorId: "system",
      targetId: cohortId,
      metadata: { userId: next.userId, position: next.position },
      ip: options.ip
    });
    return { ok: true, promoted: next.userId };
  }
  return { ok: true, promoted: null };
}

/**
 * Facilitator harassment control: ban or remove a member.
 */
async function moderateMember(
  { cohortId, userId, action, actorId, notes = "" },
  options = {}
) {
  if (!["ban", "remove"].includes(action)) return { ok: false, reason: "invalid_action" };
  const cohort = await getCohort(cohortId, options);
  if (!cohort) return { ok: false, reason: "not_found" };
  if (!(await isFacilitatorOrAdmin(cohort, actorId, options))) {
    return { ok: false, reason: "forbidden" };
  }
  if (userId === actorId) return { ok: false, reason: "cannot_moderate_self" };
  if (userId === cohort.facilitatorId) return { ok: false, reason: "cannot_moderate_facilitator" };

  const nextStatus = action === "ban" ? MEMBER_STATUS.BANNED : MEMBER_STATUS.REMOVED;
  const existing = await getMembership(cohortId, userId, options);
  const wasActive = existing?.status === MEMBER_STATUS.ACTIVE;

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO cohort_members (cohort_id, user_id, role, status, joined_at, left_at, notes)
       VALUES ($1,$2,'member',$3,NOW(),NOW(),$4)
       ON CONFLICT (cohort_id, user_id) DO UPDATE SET
         status = $3, left_at = NOW(), notes = $4;`,
      [cohortId, userId, nextStatus, String(notes || "").slice(0, 500)]
    );
    await pool.query(
      `UPDATE cohort_waitlist SET status = 'cancelled', updated_at = NOW()
       WHERE cohort_id = $1 AND user_id = $2 AND status = 'waiting';`,
      [cohortId, userId]
    );
  } else {
    memory.members.set(pairKey(cohortId, userId), {
      cohortId,
      userId,
      role: existing?.role || "member",
      status: nextStatus,
      joinedAt: existing?.joinedAt || nowIso(),
      leftAt: nowIso(),
      notes: String(notes || "").slice(0, 500)
    });
    const wl = memory.waitlist.get(pairKey(cohortId, userId));
    if (wl) {
      wl.status = WAITLIST_STATUS.CANCELLED;
      wl.updatedAt = nowIso();
    }
  }

  await dissolveUserBuddies(cohortId, userId, options);
  await syncCapacityStatus(cohortId, options);
  if (wasActive) {
    await promoteNextFromWaitlist(cohortId, options);
  }

  await audit(`cohort.member.${action}`, {
    actorId,
    targetId: cohortId,
    metadata: { userId, notes: String(notes || "").slice(0, 200) },
    ip: options.ip
  });

  return { ok: true, status: nextStatus };
}

// ── Buddy matching ──────────────────────────────────────────────────────────

async function listBuddyPairs({ cohortId, userId, status } = {}, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const clauses = [];
    const params = [];
    if (cohortId) {
      params.push(cohortId);
      clauses.push(`cohort_id = $${params.length}`);
    }
    if (userId) {
      params.push(userId);
      clauses.push(`(user_a_id = $${params.length} OR user_b_id = $${params.length})`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const res = await pool.query(
      `SELECT * FROM buddy_pairs ${where} ORDER BY matched_at DESC LIMIT 200;`,
      params
    );
    return res.rows.map(mapBuddy);
  }
  return [...memory.buddies.values()]
    .filter((b) => {
      if (cohortId && b.cohortId !== cohortId) return false;
      if (userId && b.userAId !== userId && b.userBId !== userId) return false;
      if (status && b.status !== status) return false;
      return true;
    })
    .map(mapBuddy);
}

async function createBuddyPair(
  { cohortId, userAId, userBId, matchedBy = "system", notes = "" },
  options = {}
) {
  if (!cohortId || !userAId || !userBId || userAId === userBId) {
    return { ok: false, reason: "invalid_pair" };
  }
  // Normalize order for dedup stability
  const [a, b] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];

  if (await isBlockedEither(a, b, options)) {
    return { ok: false, reason: "blocked" };
  }

  const mA = await getMembership(cohortId, a, options);
  const mB = await getMembership(cohortId, b, options);
  if (mA?.status !== MEMBER_STATUS.ACTIVE || mB?.status !== MEMBER_STATUS.ACTIVE) {
    return { ok: false, reason: "not_active_members" };
  }

  const existing = await listBuddyPairs(
    { cohortId, status: BUDDY_STATUS.ACTIVE },
    options
  );
  const alreadyPaired = new Set();
  for (const p of existing) {
    alreadyPaired.add(p.userAId);
    alreadyPaired.add(p.userBId);
  }
  if (alreadyPaired.has(a) || alreadyPaired.has(b)) {
    return { ok: false, reason: "already_paired" };
  }

  const pair = {
    id: buddyId(),
    cohortId,
    userAId: a,
    userBId: b,
    status: BUDDY_STATUS.ACTIVE,
    matchedBy,
    notes: String(notes || "").slice(0, 500),
    matchedAt: nowIso(),
    dissolvedAt: null
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO buddy_pairs (
         id, cohort_id, user_a_id, user_b_id, status, matched_by, notes, matched_at
       ) VALUES ($1,$2,$3,$4,'active',$5,$6,NOW());`,
      [pair.id, pair.cohortId, pair.userAId, pair.userBId, pair.matchedBy, pair.notes]
    );
  } else {
    memory.buddies.set(pair.id, pair);
  }

  await audit("cohort.buddy.match", {
    actorId: matchedBy,
    targetId: cohortId,
    metadata: { pairId: pair.id, userAId: a, userBId: b },
    ip: options.ip
  });

  return { ok: true, pair: mapBuddy(pair) };
}

async function dissolveBuddyPair({ pairId, actorId }, options = {}) {
  const pairs = await listBuddyPairs({}, options);
  const pair = pairs.find((p) => p.id === pairId);
  if (!pair) {
    // try direct memory/pg
    if (usePg(options)) {
      const pool = getPoolOrThrow(options);
      const res = await pool.query(`SELECT * FROM buddy_pairs WHERE id = $1;`, [pairId]);
      if (!res.rows[0]) return { ok: false, reason: "not_found" };
      await pool.query(
        `UPDATE buddy_pairs SET status = 'dissolved', dissolved_at = NOW() WHERE id = $1;`,
        [pairId]
      );
      return { ok: true, pair: mapBuddy({ ...res.rows[0], status: "dissolved" }) };
    }
    const mem = memory.buddies.get(pairId);
    if (!mem) return { ok: false, reason: "not_found" };
    mem.status = BUDDY_STATUS.DISSOLVED;
    mem.dissolvedAt = nowIso();
    return { ok: true, pair: mapBuddy(mem) };
  }
  if (pair.status === BUDDY_STATUS.DISSOLVED) {
    return { ok: true, pair, already: true };
  }

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE buddy_pairs SET status = 'dissolved', dissolved_at = NOW() WHERE id = $1;`,
      [pairId]
    );
  } else {
    const mem = memory.buddies.get(pairId);
    if (mem) {
      mem.status = BUDDY_STATUS.DISSOLVED;
      mem.dissolvedAt = nowIso();
    }
  }

  await audit("cohort.buddy.dissolve", {
    actorId: actorId || "system",
    targetId: pair.cohortId,
    metadata: { pairId },
    ip: options.ip
  });

  return { ok: true, pair: { ...pair, status: BUDDY_STATUS.DISSOLVED } };
}

async function dissolveUserBuddies(cohortId, userId, options = {}) {
  const pairs = await listBuddyPairs(
    { cohortId, userId, status: BUDDY_STATUS.ACTIVE },
    options
  );
  for (const p of pairs) {
    // eslint-disable-next-line no-await-in-loop
    await dissolveBuddyPair({ pairId: p.id, actorId: "system" }, options);
  }
}

/**
 * Greedy buddy matching for unpaired active members.
 * Skips blocked pairs. Leaves one person unmatched if odd count.
 */
async function matchBuddies({ cohortId, actorId = "system" }, options = {}) {
  const cohort = await getCohort(cohortId, options);
  if (!cohort) return { ok: false, reason: "not_found" };
  if (!cohort.buddyMatchingEnabled) return { ok: false, reason: "disabled" };

  if (actorId !== "system") {
    if (!(await isFacilitatorOrAdmin(cohort, actorId, options))) {
      return { ok: false, reason: "forbidden" };
    }
  }

  const members = await listMembers(
    { cohortId, status: MEMBER_STATUS.ACTIVE },
    options
  );
  const existing = await listBuddyPairs(
    { cohortId, status: BUDDY_STATUS.ACTIVE },
    options
  );
  const paired = new Set();
  for (const p of existing) {
    paired.add(p.userAId);
    paired.add(p.userBId);
  }

  const free = members.map((m) => m.userId).filter((id) => !paired.has(id));
  const created = [];
  const skipped = [];

  while (free.length >= 2) {
    const a = free.shift();
    let matched = false;
    for (let i = 0; i < free.length; i += 1) {
      const b = free[i];
      // eslint-disable-next-line no-await-in-loop
      if (await isBlockedEither(a, b, options)) {
        skipped.push({ userAId: a, userBId: b, reason: "blocked" });
        continue;
      }
      free.splice(i, 1);
      // eslint-disable-next-line no-await-in-loop
      const result = await createBuddyPair(
        { cohortId, userAId: a, userBId: b, matchedBy: actorId },
        options
      );
      if (result.ok) {
        created.push(result.pair);
        matched = true;
      } else {
        skipped.push({ userAId: a, userBId: b, reason: result.reason });
      }
      break;
    }
    if (!matched) {
      skipped.push({ userAId: a, reason: "no_compatible_partner" });
    }
  }

  return {
    ok: true,
    created,
    unmatched: free,
    skipped,
    totalPairs: created.length
  };
}

// ── Mentors ─────────────────────────────────────────────────────────────────

async function upsertMentorProfile(input, options = {}) {
  const userId = input.userId || input.user_id;
  if (!userId) return { ok: false, reason: "missing_user" };

  const profile = {
    userId,
    displayName: String(input.displayName || input.display_name || "").slice(0, 120),
    bio: String(input.bio || "").slice(0, 2000),
    expertise: Array.isArray(input.expertise)
      ? input.expertise.map((x) => String(x).slice(0, 80)).slice(0, 20)
      : [],
    availability:
      input.availability && typeof input.availability === "object"
        ? input.availability
        : {},
    status: Object.values(MENTOR_STATUS).includes(input.status)
      ? input.status
      : MENTOR_STATUS.OPEN,
    maxMentees: Math.min(
      50,
      Math.max(1, Number(input.maxMentees ?? input.max_mentees ?? 3))
    ),
    currentMentees: Math.max(0, Number(input.currentMentees ?? input.current_mentees ?? 0)),
    languages: Array.isArray(input.languages)
      ? input.languages.map((x) => String(x).slice(0, 8)).slice(0, 10)
      : ["en"],
    region: input.region || "global",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO mentor_profiles (
         user_id, display_name, bio, expertise, availability, status,
         max_mentees, current_mentees, languages, region, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9::jsonb,$10,NOW(),NOW()
       )
       ON CONFLICT (user_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         bio = EXCLUDED.bio,
         expertise = EXCLUDED.expertise,
         availability = EXCLUDED.availability,
         status = EXCLUDED.status,
         max_mentees = EXCLUDED.max_mentees,
         languages = EXCLUDED.languages,
         region = EXCLUDED.region,
         updated_at = NOW();`,
      [
        profile.userId,
        profile.displayName,
        profile.bio,
        JSON.stringify(profile.expertise),
        JSON.stringify(profile.availability),
        profile.status,
        profile.maxMentees,
        profile.currentMentees,
        JSON.stringify(profile.languages),
        profile.region
      ]
    );
  } else {
    const prev = memory.mentors.get(userId);
    if (prev) {
      profile.currentMentees = prev.currentMentees;
      profile.createdAt = prev.createdAt;
    }
    memory.mentors.set(userId, profile);
  }

  await audit("mentor.profile.upsert", {
    actorId: userId,
    targetType: "mentor_profile",
    targetId: userId,
    metadata: { status: profile.status },
    ip: options.ip
  });

  return { ok: true, profile: mapMentor(profile) };
}

async function getMentorProfile(userId, options = {}) {
  if (!userId) return null;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(`SELECT * FROM mentor_profiles WHERE user_id = $1;`, [
      userId
    ]);
    return mapMentor(res.rows[0]);
  }
  return mapMentor(memory.mentors.get(userId) || null);
}

async function listMentors(filters = {}, options = {}) {
  const { status = MENTOR_STATUS.OPEN, region, expertise } = filters;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const clauses = ["status = $1"];
    const params = [status];
    if (region) {
      params.push(region);
      clauses.push(`(region = $${params.length} OR region = 'global')`);
    }
    if (expertise) {
      params.push(JSON.stringify([expertise]));
      clauses.push(`expertise @> $${params.length}::jsonb`);
    }
    const res = await pool.query(
      `SELECT * FROM mentor_profiles
       WHERE ${clauses.join(" AND ")}
         AND current_mentees < max_mentees
       ORDER BY updated_at DESC LIMIT 100;`,
      params
    );
    return res.rows.map(mapMentor);
  }
  return [...memory.mentors.values()]
    .filter((m) => {
      if (status && m.status !== status) return false;
      if (region && m.region !== region && m.region !== "global") return false;
      if (expertise && !(m.expertise || []).includes(expertise)) return false;
      if (m.currentMentees >= m.maxMentees) return false;
      return true;
    })
    .map(mapMentor);
}

async function setMentorAvailability(
  { userId, availability, status },
  options = {}
) {
  const existing = await getMentorProfile(userId, options);
  if (!existing) return { ok: false, reason: "not_found" };
  return upsertMentorProfile(
    {
      ...existing,
      availability: availability != null ? availability : existing.availability,
      status: status != null ? status : existing.status
    },
    options
  );
}

/**
 * Assign mentor role on a cohort if mentor profile is open and has capacity.
 */
async function assignMentorToCohort(
  { cohortId, mentorUserId, actorId },
  options = {}
) {
  const cohort = await getCohort(cohortId, options);
  if (!cohort) return { ok: false, reason: "not_found" };
  if (!(await isFacilitatorOrAdmin(cohort, actorId, options))) {
    return { ok: false, reason: "forbidden" };
  }
  const profile = await getMentorProfile(mentorUserId, options);
  if (!profile || profile.status !== MENTOR_STATUS.OPEN) {
    return { ok: false, reason: "mentor_unavailable" };
  }
  if (profile.currentMentees >= profile.maxMentees) {
    return { ok: false, reason: "mentor_at_capacity" };
  }
  if (await isBlockedEither(mentorUserId, cohort.facilitatorId, options)) {
    return { ok: false, reason: "blocked" };
  }

  const join = await joinCohort(
    { cohortId, userId: mentorUserId, role: "mentor" },
    { ...options, skipRateLimit: true }
  );
  if (!join.ok && !join.alreadyMember) return join;

  // Force role to mentor if already a member
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE cohort_members SET role = 'mentor', status = 'active', left_at = NULL
       WHERE cohort_id = $1 AND user_id = $2;`,
      [cohortId, mentorUserId]
    );
  } else {
    const m = memory.members.get(pairKey(cohortId, mentorUserId));
    if (m) {
      m.role = "mentor";
      m.status = MEMBER_STATUS.ACTIVE;
      m.leftAt = null;
    }
  }

  // bump current_mentees
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE mentor_profiles
       SET current_mentees = LEAST(max_mentees, current_mentees + 1), updated_at = NOW()
       WHERE user_id = $1;`,
      [mentorUserId]
    );
  } else {
    const p = memory.mentors.get(mentorUserId);
    if (p) p.currentMentees = Math.min(p.maxMentees, p.currentMentees + 1);
  }

  await audit("cohort.mentor.assign", {
    actorId,
    targetId: cohortId,
    metadata: { mentorUserId },
    ip: options.ip
  });

  return { ok: true, mentorUserId };
}

// ── Events ──────────────────────────────────────────────────────────────────

async function createEvent(input, options = {}) {
  const cohortId = input.cohortId || input.cohort_id;
  const title = String(input.title || "").trim();
  const createdBy = input.createdBy || input.created_by;
  const startsAt = input.startsAt || input.starts_at;

  if (!cohortId || !title || title.length < 3) {
    return { ok: false, reason: "validation" };
  }
  if (!startsAt || Number.isNaN(Date.parse(startsAt))) {
    return { ok: false, reason: "invalid_starts_at" };
  }

  const cohort = await getCohort(cohortId, options);
  if (!cohort) return { ok: false, reason: "not_found" };
  if (!(await isFacilitatorOrAdmin(cohort, createdBy, options))) {
    return { ok: false, reason: "forbidden" };
  }

  const rl = checkRateLimit("event", createdBy, options);
  if (!rl.allowed) return { ok: false, reason: "rate_limited", retryAfterMs: rl.retryAfterMs };

  const event = {
    id: input.id || eventId(),
    cohortId,
    title,
    description: String(input.description || "").slice(0, 4000),
    startsAt: new Date(startsAt).toISOString(),
    endsAt: input.endsAt || input.ends_at
      ? new Date(input.endsAt || input.ends_at).toISOString()
      : null,
    location: String(input.location || "").slice(0, 300),
    meetingUrl: String(input.meetingUrl || input.meeting_url || "").slice(0, 500),
    status: EVENT_STATUS.SCHEDULED,
    reminderOffsetMinutes: Math.min(
      10080,
      Math.max(5, Number(input.reminderOffsetMinutes ?? input.reminder_offset_minutes ?? 60))
    ),
    reminderSentAt: null,
    createdBy,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO cohort_events (
         id, cohort_id, title, description, starts_at, ends_at, location,
         meeting_url, status, reminder_offset_minutes, created_by, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9,$10,NOW(),NOW());`,
      [
        event.id,
        event.cohortId,
        event.title,
        event.description,
        event.startsAt,
        event.endsAt,
        event.location,
        event.meetingUrl,
        event.reminderOffsetMinutes,
        event.createdBy
      ]
    );
  } else {
    memory.events.set(event.id, event);
  }

  await audit("cohort.event.create", {
    actorId: createdBy,
    targetId: cohortId,
    metadata: { eventId: event.id, startsAt: event.startsAt },
    ip: options.ip
  });

  return { ok: true, event: mapEvent(event) };
}

async function listEvents({ cohortId, status, upcomingOnly = false } = {}, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const clauses = [];
    const params = [];
    if (cohortId) {
      params.push(cohortId);
      clauses.push(`cohort_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`status = $${params.length}`);
    }
    if (upcomingOnly) {
      clauses.push(`starts_at >= NOW()`);
      if (!status) clauses.push(`status = 'scheduled'`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const res = await pool.query(
      `SELECT * FROM cohort_events ${where} ORDER BY starts_at ASC LIMIT 200;`,
      params
    );
    return res.rows.map(mapEvent);
  }
  const now = Date.now();
  return [...memory.events.values()]
    .filter((e) => {
      if (cohortId && e.cohortId !== cohortId) return false;
      if (status && e.status !== status) return false;
      if (upcomingOnly) {
        if (e.status !== EVENT_STATUS.SCHEDULED) return false;
        if (Date.parse(e.startsAt) < now) return false;
      }
      return true;
    })
    .map(mapEvent)
    .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
}

async function getEvent(eventIdValue, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(`SELECT * FROM cohort_events WHERE id = $1;`, [
      eventIdValue
    ]);
    return mapEvent(res.rows[0]);
  }
  return mapEvent(memory.events.get(eventIdValue) || null);
}

async function cancelEvent({ eventId: eid, actorId }, options = {}) {
  const event = await getEvent(eid, options);
  if (!event) return { ok: false, reason: "not_found" };
  const cohort = await getCohort(event.cohortId, options);
  if (!(await isFacilitatorOrAdmin(cohort, actorId, options))) {
    return { ok: false, reason: "forbidden" };
  }
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE cohort_events SET status = 'cancelled', updated_at = NOW() WHERE id = $1;`,
      [eid]
    );
  } else {
    const e = memory.events.get(eid);
    if (e) {
      e.status = EVENT_STATUS.CANCELLED;
      e.updatedAt = nowIso();
    }
  }
  return { ok: true, event: { ...event, status: EVENT_STATUS.CANCELLED } };
}

/**
 * Find scheduled events due for reminder and mark them (caller enqueues notifications).
 */
async function claimDueEventReminders({ now = new Date(), limit = 50 } = {}, options = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE cohort_events e
       SET reminder_sent_at = NOW(), updated_at = NOW()
       WHERE e.id IN (
         SELECT id FROM cohort_events
         WHERE status = 'scheduled'
           AND reminder_sent_at IS NULL
           AND starts_at > NOW()
           AND starts_at <= NOW() + (reminder_offset_minutes || ' minutes')::interval
         ORDER BY starts_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *;`,
      [limit]
    );
    return res.rows.map(mapEvent);
  }

  const due = [];
  for (const e of memory.events.values()) {
    if (e.status !== EVENT_STATUS.SCHEDULED) continue;
    if (e.reminderSentAt) continue;
    const startMs = Date.parse(e.startsAt);
    if (Number.isNaN(startMs) || startMs <= nowMs) continue;
    const windowMs = (Number(e.reminderOffsetMinutes) || 60) * 60 * 1000;
    if (startMs - nowMs <= windowMs) {
      e.reminderSentAt = nowIso();
      e.updatedAt = nowIso();
      due.push(mapEvent(e));
      if (due.length >= limit) break;
    }
  }
  return due;
}

// ── Outcomes / completion ───────────────────────────────────────────────────

async function recordOutcome(input, options = {}) {
  const cohortId = input.cohortId || input.cohort_id;
  const userId = input.userId || input.user_id;
  const outcomeType = input.outcomeType || input.outcome_type || "completion";
  if (!cohortId || !userId) return { ok: false, reason: "missing_fields" };
  if (!OUTCOME_TYPES.includes(outcomeType)) return { ok: false, reason: "invalid_outcome" };

  const outcome = {
    id: input.id || outcomeId(),
    cohortId,
    userId,
    outcomeType,
    notes: String(input.notes || "").slice(0, 2000),
    followUpSentAt: null,
    createdAt: nowIso()
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    try {
      await pool.query(
        `INSERT INTO cohort_outcomes (
           id, cohort_id, user_id, outcome_type, notes, created_at
         ) VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (cohort_id, user_id, outcome_type) DO UPDATE SET
           notes = EXCLUDED.notes
         RETURNING *;`,
        [outcome.id, cohortId, userId, outcomeType, outcome.notes]
      );
    } catch (err) {
      return { ok: false, reason: err.message || "db_error" };
    }
    if (outcomeType === "completion") {
      await pool.query(
        `UPDATE cohort_members SET status = 'completed', left_at = NOW()
         WHERE cohort_id = $1 AND user_id = $2 AND status = 'active';`,
        [cohortId, userId]
      );
    }
  } else {
    memory.outcomes.set(outcome.id, outcome);
    if (outcomeType === "completion") {
      const m = memory.members.get(pairKey(cohortId, userId));
      if (m && m.status === MEMBER_STATUS.ACTIVE) {
        m.status = MEMBER_STATUS.COMPLETED;
        m.leftAt = nowIso();
      }
    }
  }

  await syncCapacityStatus(cohortId, options);

  await audit("cohort.outcome", {
    actorId: options.actorId || userId,
    targetId: cohortId,
    metadata: { userId, outcomeType },
    ip: options.ip
  });

  return { ok: true, outcome: mapOutcome(outcome) };
}

async function listOutcomes({ cohortId, userId } = {}, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const clauses = [];
    const params = [];
    if (cohortId) {
      params.push(cohortId);
      clauses.push(`cohort_id = $${params.length}`);
    }
    if (userId) {
      params.push(userId);
      clauses.push(`user_id = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const res = await pool.query(
      `SELECT * FROM cohort_outcomes ${where} ORDER BY created_at DESC LIMIT 200;`,
      params
    );
    return res.rows.map(mapOutcome);
  }
  return [...memory.outcomes.values()]
    .filter((o) => {
      if (cohortId && o.cohortId !== cohortId) return false;
      if (userId && o.userId !== userId) return false;
      return true;
    })
    .map(mapOutcome);
}

async function markOutcomeFollowUpSent(outcomeIdValue, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `UPDATE cohort_outcomes SET follow_up_sent_at = NOW() WHERE id = $1;`,
      [outcomeIdValue]
    );
    return true;
  }
  const o = memory.outcomes.get(outcomeIdValue);
  if (o) o.followUpSentAt = nowIso();
  return Boolean(o);
}

async function listOutcomesNeedingFollowUp({ limit = 50 } = {}, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM cohort_outcomes
       WHERE follow_up_sent_at IS NULL
       ORDER BY created_at ASC
       LIMIT $1;`,
      [limit]
    );
    return res.rows.map(mapOutcome);
  }
  return [...memory.outcomes.values()]
    .filter((o) => !o.followUpSentAt)
    .slice(0, limit)
    .map(mapOutcome);
}

/**
 * Complete a cohort (facilitator): set status completed, record outcomes for active members.
 */
async function completeCohort({ cohortId, actorId }, options = {}) {
  const cohort = await getCohort(cohortId, options);
  if (!cohort) return { ok: false, reason: "not_found" };
  if (!(await isFacilitatorOrAdmin(cohort, actorId, options))) {
    return { ok: false, reason: "forbidden" };
  }
  const updated = await updateCohort(
    cohortId,
    { status: COHORT_STATUS.COMPLETED },
    { ...options, actorId }
  );
  if (!updated.ok) return updated;

  const members = await listMembers(
    { cohortId, status: MEMBER_STATUS.ACTIVE },
    options
  );
  const outcomes = [];
  for (const m of members) {
    // eslint-disable-next-line no-await-in-loop
    const r = await recordOutcome(
      { cohortId, userId: m.userId, outcomeType: "completion" },
      { ...options, actorId }
    );
    if (r.ok) outcomes.push(r.outcome);
  }

  return { ok: true, cohort: updated.cohort, outcomes };
}

// ── Notification helpers (used by jobs) ─────────────────────────────────────

async function notifyCohortMembers(
  { cohortId, templateKey, templateVars = {}, idempotencyPrefix },
  options = {}
) {
  const members = await listMembers(
    { cohortId, status: MEMBER_STATUS.ACTIVE },
    options
  );
  // eslint-disable-next-line global-require
  const notifications = require("./notifications");
  // eslint-disable-next-line global-require
  const ctx = require("./context");

  let enqueued = 0;
  let skipped = 0;

  for (const m of members) {
    let email = null;
    try {
      if (typeof ctx.storageGetUserById === "function") {
        // eslint-disable-next-line no-await-in-loop
        const user = await ctx.storageGetUserById(m.userId);
        email = user?.email || null;
      }
    } catch (_e) {
      /* ignore */
    }
    if (!email) {
      skipped += 1;
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const out = await notifications.enqueueNotification(
        {
          channel: notifications.CHANNEL.EMAIL,
          templateKey,
          recipientEmail: email,
          recipientUserId: m.userId,
          idempotencyKey: `${idempotencyPrefix}:${m.userId}`,
          templateVars: { ...templateVars, userId: m.userId }
        },
        options
      );
      if (out.created || out.jobCreated) enqueued += 1;
      else skipped += 1;
    } catch (_e) {
      skipped += 1;
    }
  }

  return { enqueued, skipped, members: members.length };
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  MEMBER_ROLES,
  MEMBER_STATUS,
  WAITLIST_STATUS,
  BUDDY_STATUS,
  MENTOR_STATUS,
  EVENT_STATUS,
  OUTCOME_TYPES,
  RATE_LIMITS,
  JOINABLE_STATUSES,

  memoryReset,
  checkRateLimit,

  createCohort,
  getCohort,
  listCohorts,
  updateCohort,
  syncCapacityStatus,
  recountEnrolled,

  getMembership,
  listMembers,
  isFacilitatorOrAdmin,
  joinCohort,
  leaveCohort,
  addToWaitlist,
  listWaitlist,
  promoteNextFromWaitlist,
  moderateMember,
  blockedMemberIds,
  isBlockedEither,

  listBuddyPairs,
  createBuddyPair,
  dissolveBuddyPair,
  matchBuddies,

  upsertMentorProfile,
  getMentorProfile,
  listMentors,
  setMentorAvailability,
  assignMentorToCohort,

  createEvent,
  listEvents,
  getEvent,
  cancelEvent,
  claimDueEventReminders,

  recordOutcome,
  listOutcomes,
  markOutcomeFollowUpSent,
  listOutcomesNeedingFollowUp,
  completeCohort,

  notifyCohortMembers
};
