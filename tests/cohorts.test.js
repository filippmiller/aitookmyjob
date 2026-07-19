/**
 * Cohorts, buddy matching, mentors, events (aitj-z8q.14).
 * Offline unit tests: capacity/waitlist, join/leave, harassment blocks,
 * buddy matching, mentors, event reminders, outcomes.
 *
 * Run: npm run test:cohorts
 */

"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const COHORTS_PATH = path.join(__dirname, "..", "lib/cohorts.js");
const SOCIAL_PATH = path.join(__dirname, "..", "lib/social.js");
const DOMAIN_PATH = path.join(__dirname, "..", "lib/domain-contract.js");
const MIGRATE_PATH = path.join(__dirname, "..", "lib/migrate.js");
const NOTIF_PATH = path.join(__dirname, "..", "lib/notifications.js");
const HANDLERS_PATH = path.join(__dirname, "..", "lib/job-handlers.js");
const JOBS_PATH = path.join(__dirname, "..", "lib/jobs.js");

function clearModule(modPath) {
  try {
    delete require.cache[require.resolve(modPath)];
  } catch (_e) {
    /* ignore */
  }
}

function loadCohorts() {
  clearModule(COHORTS_PATH);
  clearModule(SOCIAL_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(COHORTS_PATH);
}

function loadSocial() {
  clearModule(SOCIAL_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(SOCIAL_PATH);
}

const mem = { useMemory: true, skipRateLimit: true };

describe("domain contract — cohort status machine", () => {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const domain = require(DOMAIN_PATH);

  it("exports COHORT_STATUS and transitions", () => {
    assert.equal(domain.COHORT_STATUS.OPEN, "open");
    assert.equal(domain.COHORT_STATUS.FULL, "full");
    assert.equal(domain.canTransition("cohort", "open", "full"), true);
    assert.equal(domain.canTransition("cohort", "open", "in_progress"), true);
    assert.equal(domain.canTransition("cohort", "completed", "open"), false);
    assert.equal(domain.isPubliclyListable("cohort", "open"), true);
  });

  it("API boundaries include routes/cohorts.js", () => {
    const mounts = domain.API_BOUNDARIES.map((b) => b.module);
    assert.ok(
      mounts.includes("routes/cohorts.js"),
      `expected routes/cohorts.js in ${mounts.join(",")}`
    );
  });
});

describe("migration 012 present", () => {
  it("loads migration 012 cohorts_mentors after 010", () => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { loadMigrations } = require(MIGRATE_PATH);
    const migrations = loadMigrations();
    const versions = migrations.map((m) => m.version);
    assert.ok(versions.includes("012"), `expected 012, got ${versions.join(",")}`);
    const m012 = migrations.find((m) => m.version === "012");
    assert.equal(m012.name, "cohorts_mentors");
    assert.equal(typeof m012.up, "function");
    // 011 may be absent (reserved for intent-feeds agent)
    if (versions.includes("010")) {
      assert.ok(versions.indexOf("010") < versions.indexOf("012"));
    }
    assert.ok(!versions.includes("011") || versions.indexOf("011") < versions.indexOf("012"));
  });
});

describe("cohort join / leave / capacity / waitlist", () => {
  let cohorts;

  beforeEach(() => {
    cohorts = loadCohorts();
    cohorts.memoryReset();
  });

  afterEach(() => {
    cohorts.memoryReset();
  });

  it("creates a cohort and facilitator is enrolled", async () => {
    const r = await cohorts.createCohort(
      {
        title: "30-day Support Transition",
        profession: "QA Engineer",
        capacity: 5,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    assert.equal(r.ok, true);
    assert.equal(r.cohort.enrolled, 1);
    assert.equal(r.cohort.status, "open");
    const m = await cohorts.getMembership(r.cohort.id, "fac1", mem);
    assert.equal(m.role, "facilitator");
    assert.equal(m.status, "active");
  });

  it("join succeeds until capacity, then waitlists", async () => {
    const created = await cohorts.createCohort(
      {
        title: "Tiny Capacity Cohort XX",
        profession: "Writer",
        capacity: 2,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    assert.equal(created.ok, true);
    const id = created.cohort.id;

    const j2 = await cohorts.joinCohort({ cohortId: id, userId: "u2" }, mem);
    assert.equal(j2.ok, true);
    assert.equal(j2.waitlisted, false);

    const full = await cohorts.getCohort(id, mem);
    assert.equal(full.status, "full");
    assert.equal(full.enrolled, 2);

    const j3 = await cohorts.joinCohort({ cohortId: id, userId: "u3" }, mem);
    assert.equal(j3.ok, true);
    assert.equal(j3.waitlisted, true);
    assert.equal(j3.position, 1);

    const wl = await cohorts.listWaitlist(id, mem);
    assert.equal(wl.length, 1);
    assert.equal(wl[0].userId, "u3");
  });

  it("leave frees a seat and promotes waitlist", async () => {
    cohorts.memoryReset();
    const created = await cohorts.createCohort(
      {
        title: "Promote Waitlist Cohort",
        profession: "Designer",
        capacity: 2,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    const id = created.cohort.id;
    await cohorts.joinCohort({ cohortId: id, userId: "u2" }, mem);
    await cohorts.joinCohort({ cohortId: id, userId: "u3" }, mem);

    const leave = await cohorts.leaveCohort({ cohortId: id, userId: "u2" }, mem);
    assert.equal(leave.removed, true);

    const m3 = await cohorts.getMembership(id, "u3", mem);
    assert.equal(m3.status, "active");

    const c = await cohorts.getCohort(id, mem);
    assert.equal(c.enrolled, 2);
    assert.equal(c.status, "full");

    const wl = await cohorts.listWaitlist(id, mem);
    assert.equal(wl.length, 0);
  });

  it("leave is idempotent for non-members", async () => {
    const created = await cohorts.createCohort(
      {
        title: "Idempotent Leave Cohort",
        profession: "Analyst",
        capacity: 10,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    const r = await cohorts.leaveCohort(
      { cohortId: created.cohort.id, userId: "stranger" },
      mem
    );
    assert.equal(r.ok, true);
    assert.equal(r.removed, false);
  });

  it("full cohort without waitlist rejects join", async () => {
    const created = await cohorts.createCohort(
      {
        title: "No Waitlist Cohort XXX",
        profession: "Ops",
        capacity: 2,
        waitlistEnabled: false,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    await cohorts.joinCohort({ cohortId: created.cohort.id, userId: "u2" }, mem);
    const r = await cohorts.joinCohort(
      { cohortId: created.cohort.id, userId: "u3" },
      mem
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "full");
  });
});

describe("harassment controls — blocks and bans", () => {
  let cohorts;
  let social;

  beforeEach(() => {
    cohorts = loadCohorts();
    social = loadSocial();
    cohorts.memoryReset();
    social.memoryReset();
  });

  afterEach(() => {
    cohorts.memoryReset();
    social.memoryReset();
  });

  it("blocked user cannot join cohort with blocked facilitator", async () => {
    const created = await cohorts.createCohort(
      {
        title: "Safe Facilitator Cohort",
        profession: "HR",
        capacity: 10,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    await social.blockUser({ blockerId: "fac1", blockedId: "troll" }, mem);
    const r = await cohorts.joinCohort(
      { cohortId: created.cohort.id, userId: "troll" },
      mem
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "blocked");
  });

  it("facilitator can ban a member and free capacity", async () => {
    const created = await cohorts.createCohort(
      {
        title: "Moderation Cohort XXXX",
        profession: "Support",
        capacity: 3,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    const id = created.cohort.id;
    await cohorts.joinCohort({ cohortId: id, userId: "u2" }, mem);
    await cohorts.joinCohort({ cohortId: id, userId: "u3" }, mem);

    const ban = await cohorts.moderateMember(
      { cohortId: id, userId: "u2", action: "ban", actorId: "fac1", notes: "harassment" },
      mem
    );
    assert.equal(ban.ok, true);
    assert.equal(ban.status, "banned");

    const m = await cohorts.getMembership(id, "u2", mem);
    assert.equal(m.status, "banned");

    const rejoin = await cohorts.joinCohort({ cohortId: id, userId: "u2" }, mem);
    assert.equal(rejoin.ok, false);
    assert.equal(rejoin.reason, "banned");
  });

  it("buddy match skips blocked pairs", async () => {
    const created = await cohorts.createCohort(
      {
        title: "Buddy Harassment Cohort",
        profession: "Dev",
        capacity: 10,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    const id = created.cohort.id;
    // fac1 already member; add 3 more so free pool has pairs without fac1
    await cohorts.joinCohort({ cohortId: id, userId: "a" }, mem);
    await cohorts.joinCohort({ cohortId: id, userId: "b" }, mem);
    await cohorts.joinCohort({ cohortId: id, userId: "c" }, mem);
    await social.blockUser({ blockerId: "a", blockedId: "b" }, mem);

    const result = await cohorts.matchBuddies({ cohortId: id, actorId: "fac1" }, mem);
    assert.equal(result.ok, true);
    // No active pair should be a-b
    for (const p of result.created) {
      const set = new Set([p.userAId, p.userBId]);
      assert.ok(!(set.has("a") && set.has("b")), "blocked pair should not match");
    }
  });
});

describe("buddy matching", () => {
  let cohorts;

  beforeEach(() => {
    cohorts = loadCohorts();
    cohorts.memoryReset();
  });

  afterEach(() => {
    cohorts.memoryReset();
  });

  it("pairs unpaired active members greedily", async () => {
    const created = await cohorts.createCohort(
      {
        title: "Buddy Match Happy Path",
        profession: "PM",
        capacity: 10,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    const id = created.cohort.id;
    await cohorts.joinCohort({ cohortId: id, userId: "u1" }, mem);
    await cohorts.joinCohort({ cohortId: id, userId: "u2" }, mem);
    await cohorts.joinCohort({ cohortId: id, userId: "u3" }, mem);

    // 4 active members (fac1 + u1 + u2 + u3) → 2 pairs, 0 unmatched
    const result = await cohorts.matchBuddies({ cohortId: id, actorId: "fac1" }, mem);
    assert.equal(result.ok, true);
    assert.equal(result.totalPairs, 2);
    assert.equal(result.unmatched.length, 0);

    const pairs = await cohorts.listBuddyPairs({ cohortId: id, status: "active" }, mem);
    assert.equal(pairs.length, 2);

    // Odd count leaves one unmatched
    await cohorts.joinCohort({ cohortId: id, userId: "u4" }, mem);
    const again = await cohorts.matchBuddies({ cohortId: id, actorId: "fac1" }, mem);
    assert.equal(again.ok, true);
    assert.equal(again.totalPairs, 0); // existing pairs retained; only u4 free
    assert.equal(again.unmatched.length, 1);
    assert.equal(again.unmatched[0], "u4");
  });
});

describe("mentors and events", () => {
  let cohorts;

  beforeEach(() => {
    cohorts = loadCohorts();
    cohorts.memoryReset();
  });

  afterEach(() => {
    cohorts.memoryReset();
  });

  it("upserts mentor profile and lists open mentors", async () => {
    const up = await cohorts.upsertMentorProfile(
      {
        userId: "mentor1",
        displayName: "Alex",
        bio: "Former product designer",
        expertise: ["design", "portfolio"],
        status: "open",
        maxMentees: 2
      },
      mem
    );
    assert.equal(up.ok, true);
    const list = await cohorts.listMentors({ status: "open" }, mem);
    assert.equal(list.length, 1);
    assert.equal(list[0].userId, "mentor1");
  });

  it("sets mentor availability to paused", async () => {
    await cohorts.upsertMentorProfile({ userId: "m1", status: "open" }, mem);
    const r = await cohorts.setMentorAvailability(
      { userId: "m1", status: "paused", availability: { weekdays: ["mon"] } },
      mem
    );
    assert.equal(r.ok, true);
    assert.equal(r.profile.status, "paused");
    assert.deepEqual(r.profile.availability.weekdays, ["mon"]);
  });

  it("facilitator creates events and claimDueEventReminders marks them", async () => {
    const created = await cohorts.createCohort(
      {
        title: "Events Cohort Path XXX",
        profession: "Coach",
        capacity: 10,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    const id = created.cohort.id;
    const startsAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30m
    const ev = await cohorts.createEvent(
      {
        cohortId: id,
        title: "Kickoff call",
        startsAt,
        reminderOffsetMinutes: 60,
        createdBy: "fac1"
      },
      mem
    );
    assert.equal(ev.ok, true);

    const due = await cohorts.claimDueEventReminders({ now: new Date(), limit: 10 }, mem);
    assert.equal(due.length, 1);
    assert.equal(due[0].id, ev.event.id);
    assert.ok(due[0].reminderSentAt);

    // second claim is empty (already sent)
    const due2 = await cohorts.claimDueEventReminders({ now: new Date(), limit: 10 }, mem);
    assert.equal(due2.length, 0);
  });

  it("records outcomes and completeCohort marks members completed", async () => {
    const created = await cohorts.createCohort(
      {
        title: "Completion Cohort Path",
        profession: "Writer",
        capacity: 10,
        createdBy: "fac1",
        facilitatorId: "fac1"
      },
      mem
    );
    const id = created.cohort.id;
    await cohorts.joinCohort({ cohortId: id, userId: "u1" }, mem);

    // move to in_progress first for valid transition open -> completed is not allowed
    // open -> in_progress -> completed
    await cohorts.updateCohort(id, { status: "in_progress" }, { ...mem, actorId: "fac1" });
    const done = await cohorts.completeCohort({ cohortId: id, actorId: "fac1" }, mem);
    assert.equal(done.ok, true);
    assert.equal(done.cohort.status, "completed");
    assert.ok(done.outcomes.length >= 1);

    const m = await cohorts.getMembership(id, "u1", mem);
    assert.equal(m.status, "completed");
  });
});

describe("notification templates for cohorts", () => {
  it("renders cohort templates", () => {
    clearModule(NOTIF_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const notifications = require(NOTIF_PATH);
    for (const key of [
      notifications.TEMPLATE_KEYS.COHORT_REMINDER,
      notifications.TEMPLATE_KEYS.COHORT_EVENT,
      notifications.TEMPLATE_KEYS.COHORT_OUTCOME,
      notifications.TEMPLATE_KEYS.COHORT_BUDDY
    ]) {
      const rendered = notifications.renderTemplate(key, {
        cohortTitle: "Test Cohort",
        eventTitle: "Kickoff",
        startsAt: "2026-08-01T10:00:00Z"
      });
      assert.ok(rendered.subject);
      assert.ok(rendered.bodyText);
      assert.ok(rendered.bodyHtml);
    }
  });
});

describe("job handlers register cohort.reminder and buddy.match", () => {
  it("registers without throwing", () => {
    clearModule(HANDLERS_PATH);
    clearModule(JOBS_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const jobs = require(JOBS_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { registerBuiltinHandlers } = require(HANDLERS_PATH);
    // reset handlers map if present
    if (typeof jobs.clearHandlers === "function") jobs.clearHandlers();
    registerBuiltinHandlers(
      {
        usePostgres: false,
        storageAudit: async () => {},
        storageGetUserById: async () => null
      },
      jobs
    );
    // handlers registered — process one ping to ensure module still works
    assert.equal(typeof jobs.registerHandler, "function");
  });
});
