/**
 * Cohorts, buddy matching, mentors, and events API (aitj-z8q.14).
 *
 * Mounted at /api/cohorts (plus /api/mentors convenience paths).
 */

"use strict";

const express = require("express");
const router = express.Router();
const { requireAuth, requireAdminOrToken } = require("../middleware/auth");
const ctx = require("../lib/context");
const cohorts = require("../lib/cohorts");

function opts(req, extra = {}) {
  return {
    ip: req.ip || "",
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool?.() || null,
    actorId: req.user?.id || "system",
    isAdmin: Boolean(ctx.hasAdminToken?.(req) || ctx.hasModeratorRole?.(req.user)),
    ...extra
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

function fail(res, result, fallbackStatus = 422) {
  if (result.reason === "rate_limited") return rateLimited(res, result);
  if (result.reason === "not_found") {
    res.status(404).json({ message: "Not found", reason: result.reason });
    return;
  }
  if (result.reason === "forbidden") {
    res.status(403).json({ message: "Forbidden", reason: result.reason });
    return;
  }
  if (result.reason === "blocked" || result.reason === "banned") {
    res.status(403).json({ message: "Not allowed", reason: result.reason });
    return;
  }
  if (result.reason === "full") {
    res.status(409).json({ message: "Cohort is full", reason: result.reason });
    return;
  }
  res.status(fallbackStatus).json({ message: "Failed", reason: result.reason });
}

// ── Discover / list / create ────────────────────────────────────────────────

router.get("/", async (req, res) => {
  const country = ctx.normalizeCountry(req.query.country || "global");
  const profession = ctx.sanitizeText(req.query.profession || "");
  const status = ctx.sanitizeText(req.query.status || "");
  const language = ctx.normalizeLanguage?.(req.query.language || "") || undefined;
  const rows = await cohorts.listCohorts(
    {
      country,
      profession: profession || undefined,
      status: status || undefined,
      language: language || undefined
    },
    opts(req)
  );
  // Preserve legacy response shape used by e2e / integrations clients
  res.json({
    country,
    cohorts: rows.filter(
      (c) =>
        (c.country === "global" || c.country === country) &&
        (!profession ||
          String(c.profession || "")
            .toLowerCase()
            .includes(profession.toLowerCase()))
    )
  });
});

router.get("/:id", async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const cohort = await cohorts.getCohort(id, opts(req));
  if (!cohort) {
    res.status(404).json({ message: "Cohort not found" });
    return;
  }
  const members = await cohorts.listMembers(
    { cohortId: id, status: "active" },
    opts(req)
  );
  let viewerMembership = null;
  if (req.user?.id) {
    viewerMembership = await cohorts.getMembership(id, req.user.id, opts(req));
  }
  // Harassment: strip blocked members from public roster for viewer
  let roster = members.map((m) => ({
    userId: m.userId,
    role: m.role,
    joinedAt: m.joinedAt
  }));
  if (req.user?.id) {
    const blocked = await cohorts.blockedMemberIds(id, req.user.id, opts(req));
    const blockedSet = new Set(blocked);
    roster = roster.filter((m) => !blockedSet.has(m.userId));
  }
  res.json({
    cohort,
    members: roster,
    memberCount: members.length,
    membership: viewerMembership
  });
});

router.post("/", requireAuth, async (req, res) => {
  if (ctx.isAccountMuted?.(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const result = await cohorts.createCohort(
    {
      title: ctx.sanitizeText(req.body.title || ""),
      description: ctx.sanitizeText(req.body.description || ""),
      profession: ctx.sanitizeText(req.body.profession || ""),
      country: ctx.normalizeCountry(req.body.country || "global"),
      language: ctx.normalizeLanguage?.(req.body.language || ctx.defaultLang) || "en",
      capacity: Number(req.body.capacity || 0),
      startsAt: ctx.sanitizeText(req.body.startsAt || ""),
      endsAt: ctx.sanitizeText(req.body.endsAt || ""),
      scheduleNotes: ctx.sanitizeText(req.body.scheduleNotes || ""),
      waitlistEnabled:
        req.body.waitlistEnabled != null ? Boolean(req.body.waitlistEnabled) : true,
      buddyMatchingEnabled:
        req.body.buddyMatchingEnabled != null
          ? Boolean(req.body.buddyMatchingEnabled)
          : true,
      facilitatorId: req.user.id,
      createdBy: req.user.id,
      status: "open"
    },
    opts(req)
  );
  if (!result.ok) {
    // Legacy validation: capacity < 5 returned 422 for old clients
    if (result.reason === "capacity_min_2" && Number(req.body.capacity || 0) < 5) {
      res.status(422).json({ message: "Validation failed" });
      return;
    }
    return fail(res, result);
  }
  res.status(201).json(result.cohort);
});

router.patch("/:id", requireAuth, async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const cohort = await cohorts.getCohort(id, opts(req));
  if (!cohort) {
    res.status(404).json({ message: "Cohort not found" });
    return;
  }
  const allowed = await cohorts.isFacilitatorOrAdmin(cohort, req.user.id, opts(req));
  if (!allowed) {
    res.status(403).json({ message: "Facilitator or admin required" });
    return;
  }
  const patch = {};
  for (const key of [
    "title",
    "description",
    "profession",
    "country",
    "language",
    "capacity",
    "startsAt",
    "endsAt",
    "status",
    "scheduleNotes",
    "visibility",
    "waitlistEnabled",
    "buddyMatchingEnabled",
    "facilitatorId"
  ]) {
    if (req.body[key] !== undefined) {
      patch[key] =
        typeof req.body[key] === "string"
          ? ctx.sanitizeText(req.body[key])
          : req.body[key];
    }
  }
  const result = await cohorts.updateCohort(id, patch, opts(req));
  if (!result.ok) return fail(res, result);
  res.json({ cohort: result.cohort });
});

// ── Join / leave / waitlist ─────────────────────────────────────────────────

router.post("/:id/join", requireAuth, async (req, res) => {
  if (ctx.isAccountMuted?.(req.user)) {
    res.status(403).json({ message: "Account temporarily muted" });
    return;
  }
  const result = await cohorts.joinCohort(
    {
      cohortId: ctx.sanitizeText(req.params.id),
      userId: req.user.id
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.status(result.alreadyMember ? 200 : result.waitlisted ? 202 : 201).json({
    ok: true,
    waitlisted: Boolean(result.waitlisted),
    alreadyMember: Boolean(result.alreadyMember),
    position: result.position || null,
    membership: result.membership
  });
});

router.post("/:id/leave", requireAuth, async (req, res) => {
  const result = await cohorts.leaveCohort(
    {
      cohortId: ctx.sanitizeText(req.params.id),
      userId: req.user.id
    },
    opts(req)
  );
  res.json({ ok: true, removed: Boolean(result.removed) });
});

router.get("/:id/members", requireAuth, async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const cohort = await cohorts.getCohort(id, opts(req));
  if (!cohort) {
    res.status(404).json({ message: "Cohort not found" });
    return;
  }
  const membership = await cohorts.getMembership(id, req.user.id, opts(req));
  const isFacil = await cohorts.isFacilitatorOrAdmin(cohort, req.user.id, opts(req));
  if (!isFacil && membership?.status !== "active") {
    res.status(403).json({ message: "Members only" });
    return;
  }
  const status = ctx.sanitizeText(req.query.status || "active") || "active";
  let members = await cohorts.listMembers({ cohortId: id, status }, opts(req));
  const blocked = await cohorts.blockedMemberIds(id, req.user.id, opts(req));
  const blockedSet = new Set(blocked);
  members = members.filter((m) => !blockedSet.has(m.userId) || m.userId === req.user.id);
  res.json({ members, total: members.length });
});

router.get("/:id/waitlist", requireAuth, async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const cohort = await cohorts.getCohort(id, opts(req));
  if (!cohort) {
    res.status(404).json({ message: "Cohort not found" });
    return;
  }
  const isFacil = await cohorts.isFacilitatorOrAdmin(cohort, req.user.id, opts(req));
  if (!isFacil) {
    res.status(403).json({ message: "Facilitator required" });
    return;
  }
  const waitlist = await cohorts.listWaitlist(id, opts(req));
  res.json({ waitlist, total: waitlist.length });
});

router.post("/:id/waitlist/promote", requireAuth, async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const cohort = await cohorts.getCohort(id, opts(req));
  if (!cohort) {
    res.status(404).json({ message: "Cohort not found" });
    return;
  }
  const isFacil = await cohorts.isFacilitatorOrAdmin(cohort, req.user.id, opts(req));
  if (!isFacil) {
    res.status(403).json({ message: "Facilitator required" });
    return;
  }
  const result = await cohorts.promoteNextFromWaitlist(id, opts(req));
  res.json({ ok: true, promoted: result.promoted });
});

// ── Harassment / moderation ─────────────────────────────────────────────────

router.post("/:id/members/:userId/moderate", requireAuth, async (req, res) => {
  const action = ctx.sanitizeText(req.body.action || "");
  const result = await cohorts.moderateMember(
    {
      cohortId: ctx.sanitizeText(req.params.id),
      userId: ctx.sanitizeText(req.params.userId),
      action,
      actorId: req.user.id,
      notes: ctx.sanitizeText(req.body.notes || "")
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result, result.reason === "forbidden" ? 403 : 422);
  res.json({ ok: true, status: result.status });
});

// ── Buddy matching ──────────────────────────────────────────────────────────

router.get("/:id/buddies", requireAuth, async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const membership = await cohorts.getMembership(id, req.user.id, opts(req));
  const cohort = await cohorts.getCohort(id, opts(req));
  const isFacil = cohort
    ? await cohorts.isFacilitatorOrAdmin(cohort, req.user.id, opts(req))
    : false;
  if (!isFacil && membership?.status !== "active") {
    res.status(403).json({ message: "Members only" });
    return;
  }
  const pairs = await cohorts.listBuddyPairs(
    {
      cohortId: id,
      userId: isFacil ? undefined : req.user.id,
      status: ctx.sanitizeText(req.query.status || "") || undefined
    },
    opts(req)
  );
  res.json({ pairs, total: pairs.length });
});

router.post("/:id/buddies/match", requireAuth, async (req, res) => {
  const result = await cohorts.matchBuddies(
    {
      cohortId: ctx.sanitizeText(req.params.id),
      actorId: req.user.id
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.json({
    ok: true,
    created: result.created,
    unmatched: result.unmatched,
    totalPairs: result.totalPairs,
    skipped: result.skipped
  });
});

router.post("/:id/buddies", requireAuth, async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const cohort = await cohorts.getCohort(id, opts(req));
  if (!cohort) {
    res.status(404).json({ message: "Cohort not found" });
    return;
  }
  const isFacil = await cohorts.isFacilitatorOrAdmin(cohort, req.user.id, opts(req));
  if (!isFacil) {
    res.status(403).json({ message: "Facilitator required" });
    return;
  }
  const result = await cohorts.createBuddyPair(
    {
      cohortId: id,
      userAId: ctx.sanitizeText(req.body.userAId || req.body.user_a_id || ""),
      userBId: ctx.sanitizeText(req.body.userBId || req.body.user_b_id || ""),
      matchedBy: req.user.id,
      notes: ctx.sanitizeText(req.body.notes || "")
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.status(201).json({ pair: result.pair });
});

router.delete("/:id/buddies/:pairId", requireAuth, async (req, res) => {
  const result = await cohorts.dissolveBuddyPair(
    {
      pairId: ctx.sanitizeText(req.params.pairId),
      actorId: req.user.id
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.json({ ok: true, pair: result.pair });
});

// ── Events ──────────────────────────────────────────────────────────────────

router.get("/:id/events", async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const cohort = await cohorts.getCohort(id, opts(req));
  if (!cohort) {
    res.status(404).json({ message: "Cohort not found" });
    return;
  }
  const events = await cohorts.listEvents(
    {
      cohortId: id,
      status: ctx.sanitizeText(req.query.status || "") || undefined,
      upcomingOnly: String(req.query.upcoming || "").toLowerCase() === "true"
    },
    opts(req)
  );
  res.json({ events, total: events.length });
});

router.post("/:id/events", requireAuth, async (req, res) => {
  const result = await cohorts.createEvent(
    {
      cohortId: ctx.sanitizeText(req.params.id),
      title: ctx.sanitizeText(req.body.title || ""),
      description: ctx.sanitizeText(req.body.description || ""),
      startsAt: req.body.startsAt || req.body.starts_at,
      endsAt: req.body.endsAt || req.body.ends_at,
      location: ctx.sanitizeText(req.body.location || ""),
      meetingUrl: ctx.sanitizeText(req.body.meetingUrl || req.body.meeting_url || ""),
      reminderOffsetMinutes: Number(
        req.body.reminderOffsetMinutes ?? req.body.reminder_offset_minutes ?? 60
      ),
      createdBy: req.user.id
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.status(201).json({ event: result.event });
});

router.post("/:id/events/:eventId/cancel", requireAuth, async (req, res) => {
  const result = await cohorts.cancelEvent(
    {
      eventId: ctx.sanitizeText(req.params.eventId),
      actorId: req.user.id
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.json({ ok: true, event: result.event });
});

// ── Outcomes / complete ─────────────────────────────────────────────────────

router.post("/:id/complete", requireAuth, async (req, res) => {
  const result = await cohorts.completeCohort(
    {
      cohortId: ctx.sanitizeText(req.params.id),
      actorId: req.user.id
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.json({
    ok: true,
    cohort: result.cohort,
    outcomes: result.outcomes
  });
});

router.post("/:id/outcomes", requireAuth, async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const cohort = await cohorts.getCohort(id, opts(req));
  if (!cohort) {
    res.status(404).json({ message: "Cohort not found" });
    return;
  }
  const targetUserId = ctx.sanitizeText(req.body.userId || req.user.id);
  const isFacil = await cohorts.isFacilitatorOrAdmin(cohort, req.user.id, opts(req));
  if (!isFacil && targetUserId !== req.user.id) {
    res.status(403).json({ message: "Facilitator required for other users" });
    return;
  }
  const result = await cohorts.recordOutcome(
    {
      cohortId: id,
      userId: targetUserId,
      outcomeType: ctx.sanitizeText(req.body.outcomeType || "completion"),
      notes: ctx.sanitizeText(req.body.notes || "")
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.status(201).json({ outcome: result.outcome });
});

router.get("/:id/outcomes", requireAuth, async (req, res) => {
  const id = ctx.sanitizeText(req.params.id);
  const cohort = await cohorts.getCohort(id, opts(req));
  if (!cohort) {
    res.status(404).json({ message: "Cohort not found" });
    return;
  }
  const isFacil = await cohorts.isFacilitatorOrAdmin(cohort, req.user.id, opts(req));
  if (!isFacil) {
    res.status(403).json({ message: "Facilitator required" });
    return;
  }
  const outcomes = await cohorts.listOutcomes({ cohortId: id }, opts(req));
  res.json({ outcomes, total: outcomes.length });
});

// ── Mentors (mounted also under /api/mentors via server) ────────────────────

router.get("/mentors/list", async (req, res) => {
  const mentors = await cohorts.listMentors(
    {
      status: ctx.sanitizeText(req.query.status || "open") || "open",
      region: req.query.region
        ? ctx.normalizeCountry(req.query.region)
        : undefined,
      expertise: ctx.sanitizeText(req.query.expertise || "") || undefined
    },
    opts(req)
  );
  res.json({ mentors, total: mentors.length });
});

router.post("/mentors/me", requireAuth, async (req, res) => {
  const result = await cohorts.upsertMentorProfile(
    {
      userId: req.user.id,
      displayName: ctx.sanitizeText(
        req.body.displayName || req.user.displayName || req.user.id
      ),
      bio: ctx.sanitizeText(req.body.bio || ""),
      expertise: Array.isArray(req.body.expertise) ? req.body.expertise : [],
      availability: req.body.availability || {},
      status: ctx.sanitizeText(req.body.status || "open"),
      maxMentees: Number(req.body.maxMentees || 3),
      languages: Array.isArray(req.body.languages) ? req.body.languages : ["en"],
      region: ctx.normalizeCountry(req.body.region || "global")
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.status(201).json({ profile: result.profile });
});

router.get("/mentors/me", requireAuth, async (req, res) => {
  const profile = await cohorts.getMentorProfile(req.user.id, opts(req));
  if (!profile) {
    res.status(404).json({ message: "No mentor profile" });
    return;
  }
  res.json({ profile });
});

router.patch("/mentors/me/availability", requireAuth, async (req, res) => {
  const result = await cohorts.setMentorAvailability(
    {
      userId: req.user.id,
      availability: req.body.availability,
      status: req.body.status ? ctx.sanitizeText(req.body.status) : undefined
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.json({ profile: result.profile });
});

router.post("/:id/mentors", requireAuth, async (req, res) => {
  const result = await cohorts.assignMentorToCohort(
    {
      cohortId: ctx.sanitizeText(req.params.id),
      mentorUserId: ctx.sanitizeText(req.body.mentorUserId || req.body.userId || ""),
      actorId: req.user.id
    },
    opts(req)
  );
  if (!result.ok) return fail(res, result);
  res.status(201).json({ ok: true, mentorUserId: result.mentorUserId });
});

// ── Admin job triggers ──────────────────────────────────────────────────────

router.post("/admin/reminders/run", requireAdminOrToken, async (req, res) => {
  // Enqueue cohort.reminder job
  try {
    const jobs = require("../lib/jobs");
    const { job } = await jobs.enqueue(
      "cohort.reminder",
      {
        reason: ctx.sanitizeText(req.body.reason || "admin_trigger"),
        limit: Number(req.body.limit || 50)
      },
      {
        usePostgres: ctx.usePostgres,
        getPool: () => ctx.getPgPool?.() || null,
        useMemory: !ctx.usePostgres,
        idempotencyKey: `cohort.reminder:admin:${Date.now()}`
      }
    );
    res.status(202).json({ ok: true, jobId: job?.id || null });
  } catch (err) {
    res.status(500).json({
      message: "Failed to enqueue",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

router.post("/admin/:id/buddy-match", requireAdminOrToken, async (req, res) => {
  try {
    const jobs = require("../lib/jobs");
    const cohortId = ctx.sanitizeText(req.params.id);
    const { job } = await jobs.enqueue(
      "buddy.match",
      { cohortId, reason: "admin_trigger" },
      {
        usePostgres: ctx.usePostgres,
        getPool: () => ctx.getPgPool?.() || null,
        useMemory: !ctx.usePostgres,
        idempotencyKey: `buddy.match:${cohortId}:${Date.now()}`
      }
    );
    res.status(202).json({ ok: true, jobId: job?.id || null });
  } catch (err) {
    res.status(500).json({
      message: "Failed to enqueue",
      error: err instanceof Error ? err.message : String(err)
    });
  }
});

module.exports = router;
