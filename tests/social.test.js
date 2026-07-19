/**
 * Social & support interactions (aitj-z8q.11).
 * Offline unit tests: block filtering, save/follow idempotency, reaction limits,
 * threaded comments, reputation, opt-out preference categories.
 *
 * Run: npm run test:social
 */

"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const SOCIAL_PATH = path.join(__dirname, "..", "lib/social.js");
const DOMAIN_PATH = path.join(__dirname, "..", "lib/domain-contract.js");
const NOTIF_PATH = path.join(__dirname, "..", "lib/notifications.js");
const MIGRATE_PATH = path.join(__dirname, "..", "lib/migrate.js");

function clearModule(modPath) {
  try {
    delete require.cache[require.resolve(modPath)];
  } catch (_e) {
    /* ignore */
  }
}

function loadSocial() {
  clearModule(SOCIAL_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(SOCIAL_PATH);
}

describe("domain contract — social enums", () => {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const domain = require(DOMAIN_PATH);

  it("exports reaction, comment, group, social_report enums", () => {
    assert.equal(domain.REACTION_TYPE.HELPFUL, "helpful");
    assert.equal(domain.REACTION_TYPE.SOLIDARITY, "solidarity");
    assert.equal(domain.COMMENT_STATUS.PUBLISHED, "published");
    assert.equal(domain.SOCIAL_GROUP_STATUS.OPEN, "open");
    assert.equal(domain.SOCIAL_REPORT_STATUS.OPEN, "open");
  });

  it("registers comment / social_group / social_report entities with transitions", () => {
    assert.equal(domain.ENTITY.COMMENT, "comment");
    assert.equal(domain.canTransition("comment", "published", "deleted"), true);
    assert.equal(domain.canTransition("social_group", "open", "closed"), true);
    assert.equal(domain.canTransition("social_report", "open", "resolved"), true);
    assert.equal(domain.isPubliclyListable("comment", "published"), true);
    assert.equal(domain.isPubliclyListable("social_group", "open"), true);
  });

  it("API boundaries list social module ownership", () => {
    const mounts = domain.API_BOUNDARIES.map((b) => b.module);
    assert.ok(mounts.includes("routes/social.js"));
  });
});

describe("migration 010 present", () => {
  it("loads migration 010 social_support after 008", () => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { loadMigrations } = require(MIGRATE_PATH);
    const migrations = loadMigrations();
    const versions = migrations.map((m) => m.version);
    assert.ok(versions.includes("010"), `expected 010, got ${versions.join(",")}`);
    const m010 = migrations.find((m) => m.version === "010");
    assert.equal(m010.name, "social_support");
    assert.equal(typeof m010.up, "function");
    // 009 may be absent (reserved for news agent)
    if (versions.includes("009")) {
      assert.ok(versions.indexOf("009") < versions.indexOf("010"));
    }
  });
});

describe("blocks — filtering and mutual effects", () => {
  let social;

  beforeEach(() => {
    social = loadSocial();
    social.memoryReset();
  });

  afterEach(() => {
    social.memoryReset();
  });

  const mem = { useMemory: true };

  it("block is idempotent and removes follows both ways", async () => {
    await social.followUser({ followerId: "u1", followeeId: "u2" }, mem);
    await social.followUser({ followerId: "u2", followeeId: "u1" }, mem);
    const b1 = await social.blockUser({ blockerId: "u1", blockedId: "u2" }, mem);
    assert.equal(b1.ok, true);
    assert.equal(b1.created, true);
    const b2 = await social.blockUser({ blockerId: "u1", blockedId: "u2" }, mem);
    assert.equal(b2.ok, true);
    assert.equal(b2.created, false);
    assert.equal(await social.isFollowing("u1", "u2", mem), false);
    assert.equal(await social.isFollowing("u2", "u1", mem), false);
    assert.equal(await social.isBlockedEither("u1", "u2", mem), true);
  });

  it("filterBlockedAuthors removes blocked authors from reads", async () => {
    await social.blockUser({ blockerId: "viewer", blockedId: "troll" }, mem);
    const items = [
      { id: "1", createdBy: "friend", body: "hi" },
      { id: "2", createdBy: "troll", body: "spam" },
      { id: "3", createdBy: "viewer", body: "mine" }
    ];
    const filtered = await social.filterBlockedAuthors("viewer", items, "createdBy", mem);
    assert.equal(filtered.length, 2);
    assert.ok(filtered.every((i) => i.createdBy !== "troll"));
  });

  it("follow and react fail when blocked either direction", async () => {
    await social.blockUser({ blockerId: "a", blockedId: "b" }, mem);
    const f = await social.followUser({ followerId: "b", followeeId: "a" }, mem);
    assert.equal(f.ok, false);
    assert.equal(f.reason, "blocked");
    const r = await social.addReaction(
      {
        userId: "b",
        targetType: "story",
        targetId: "s1",
        reactionType: "solidarity",
        contentAuthorId: "a"
      },
      mem
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "blocked");
  });

  it("maybeNotifySocial skips blocked pairs", async () => {
    await social.blockUser({ blockerId: "author", blockedId: "actor" }, mem);
    const out = await social.maybeNotifySocial(
      {
        recipientUserId: "author",
        kind: "reply",
        actorId: "actor",
        targetType: "comment",
        targetId: "c1"
      },
      mem
    );
    assert.equal(out.skipped, true);
    assert.equal(out.reason, "blocked");
  });
});

describe("save / follow idempotency", () => {
  let social;
  const mem = { useMemory: true };

  beforeEach(() => {
    social = loadSocial();
    social.memoryReset();
  });

  afterEach(() => social.memoryReset());

  it("save is idempotent (created false on second call)", async () => {
    const a = await social.saveContent(
      { userId: "u1", targetType: "story", targetId: "st1" },
      mem
    );
    assert.equal(a.ok, true);
    assert.equal(a.created, true);
    const b = await social.saveContent(
      { userId: "u1", targetType: "story", targetId: "st1" },
      mem
    );
    assert.equal(b.ok, true);
    assert.equal(b.created, false);
    const list = await social.listSaves("u1", mem);
    assert.equal(list.length, 1);
    const removed = await social.unsaveContent(
      { userId: "u1", targetType: "story", targetId: "st1" },
      mem
    );
    assert.equal(removed.removed, true);
    assert.equal((await social.listSaves("u1", mem)).length, 0);
  });

  it("follow is idempotent", async () => {
    const a = await social.followUser({ followerId: "u1", followeeId: "u2" }, mem);
    assert.equal(a.created, true);
    const b = await social.followUser({ followerId: "u1", followeeId: "u2" }, mem);
    assert.equal(b.created, false);
    assert.equal(await social.isFollowing("u1", "u2", mem), true);
    const un = await social.unfollowUser({ followerId: "u1", followeeId: "u2" }, mem);
    assert.equal(un.removed, true);
    assert.equal(await social.isFollowing("u1", "u2", mem), false);
  });
});

describe("reaction limits and helpfulness reputation", () => {
  let social;
  const mem = { useMemory: true, skipRateLimit: false };

  beforeEach(() => {
    social = loadSocial();
    social.memoryReset();
  });

  afterEach(() => social.memoryReset());

  it("reaction is idempotent per type", async () => {
    const a = await social.addReaction(
      {
        userId: "u1",
        targetType: "story",
        targetId: "s1",
        reactionType: "solidarity",
        contentAuthorId: "author1"
      },
      mem
    );
    assert.equal(a.created, true);
    const b = await social.addReaction(
      {
        userId: "u1",
        targetType: "story",
        targetId: "s1",
        reactionType: "solidarity",
        contentAuthorId: "author1"
      },
      mem
    );
    assert.equal(b.created, false);
    const counts = await social.countReactions("story", "s1", mem);
    assert.equal(counts.solidarity, 1);
  });

  it("helpful reaction awards reputation to content author", async () => {
    await social.addReaction(
      {
        userId: "helper",
        targetType: "comment",
        targetId: "c1",
        reactionType: "helpful",
        contentAuthorId: "author1"
      },
      mem
    );
    const score = await social.getReputationScore("author1", mem);
    assert.ok(score.score >= social.REPUTATION_POINTS.helpful_reaction);
    assert.ok(score.events >= 1);
  });

  it("enforces reaction rate limit", async () => {
    const max = social.RATE_LIMITS.reaction.max;
    for (let i = 0; i < max; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await social.addReaction(
        {
          userId: "spammer",
          targetType: "story",
          targetId: `s${i}`,
          reactionType: "strength"
        },
        mem
      );
      assert.equal(r.ok, true, `expected ok at ${i}`);
    }
    const over = await social.addReaction(
      {
        userId: "spammer",
        targetType: "story",
        targetId: "overflow",
        reactionType: "strength"
      },
      mem
    );
    assert.equal(over.ok, false);
    assert.equal(over.reason, "rate_limited");
  });
});

describe("threaded comments", () => {
  let social;
  const mem = { useMemory: true };

  beforeEach(() => {
    social = loadSocial();
    social.memoryReset();
  });

  afterEach(() => social.memoryReset());

  it("creates nested threads and extracts mentions", async () => {
    const root = await social.createComment(
      {
        targetType: "story",
        targetId: "st1",
        body: "Root thought @alice",
        createdBy: "u1",
        mentionUserIds: ["user_alice_01"]
      },
      mem
    );
    assert.equal(root.ok, true);
    assert.ok(root.comment.mentions.includes("alice") || root.comment.mentions.includes("user_alice_01"));

    const child = await social.createComment(
      {
        targetType: "story",
        targetId: "st1",
        parentId: root.comment.id,
        body: "Reply to root",
        createdBy: "u2"
      },
      mem
    );
    assert.equal(child.ok, true);
    assert.equal(child.comment.parentId, root.comment.id);

    const flat = await social.listComments(
      { targetType: "story", targetId: "st1", viewerId: "u3" },
      mem
    );
    assert.equal(flat.length, 2);
    const tree = social.nestComments(flat);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].children.length, 1);
  });

  it("blocks prevent commenting on blocked user's parent", async () => {
    const root = await social.createComment(
      {
        targetType: "vent",
        targetId: "v1",
        body: "vent root",
        createdBy: "author"
      },
      mem
    );
    await social.blockUser({ blockerId: "author", blockedId: "troll" }, mem);
    const child = await social.createComment(
      {
        targetType: "vent",
        targetId: "v1",
        parentId: root.comment.id,
        body: "blocked reply",
        createdBy: "troll"
      },
      mem
    );
    assert.equal(child.ok, false);
    assert.equal(child.reason, "blocked");
  });

  it("listComments filters blocked authors for viewer", async () => {
    await social.createComment(
      { targetType: "news", targetId: "n1", body: "ok", createdBy: "good" },
      mem
    );
    await social.createComment(
      { targetType: "news", targetId: "n1", body: "bad", createdBy: "bad" },
      mem
    );
    await social.blockUser({ blockerId: "viewer", blockedId: "bad" }, mem);
    const rows = await social.listComments(
      { targetType: "news", targetId: "n1", viewerId: "viewer" },
      mem
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].createdBy, "good");
  });
});

describe("groups and reports", () => {
  let social;
  const mem = { useMemory: true };

  beforeEach(() => {
    social = loadSocial();
    social.memoryReset();
  });

  afterEach(() => social.memoryReset());

  it("creates professional group and join/leave", async () => {
    const g = await social.createGroup(
      {
        name: "Laid-off Designers",
        type: "professional",
        profession: "design",
        region: "us",
        createdBy: "owner1"
      },
      mem
    );
    assert.equal(g.ok, true);
    assert.equal(g.group.type, "professional");
    const join = await social.joinGroup({ groupId: g.group.id, userId: "member1" }, mem);
    assert.equal(join.ok, true);
    const leave = await social.leaveGroup({ groupId: g.group.id, userId: "member1" }, mem);
    assert.equal(leave.removed, true);
    const listed = await social.listGroups({ type: "professional" }, mem);
    assert.ok(listed.some((x) => x.id === g.group.id));
  });

  it("report creates audit trail entry and resolve works", async () => {
    const r = await social.reportContent(
      {
        reporterId: "u1",
        targetType: "comment",
        targetId: "c1",
        reason: "harassment",
        details: "details here"
      },
      mem
    );
    assert.equal(r.ok, true);
    const open = await social.listReports({ status: "open" }, mem);
    assert.ok(open.some((x) => x.id === r.report.id));
    const resolved = await social.resolveReport(
      { id: r.report.id, resolverId: "mod1", status: "resolved", note: "actioned" },
      mem
    );
    assert.equal(resolved.ok, true);
  });
});

describe("notification opt-out for social categories", () => {
  it("social templates map to mentions/replies/follows categories", () => {
    clearModule(NOTIF_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const notifications = require(NOTIF_PATH);
    assert.equal(
      notifications.TEMPLATE_CATEGORY[notifications.TEMPLATE_KEYS.SOCIAL_MENTION],
      "mentions"
    );
    assert.equal(
      notifications.TEMPLATE_CATEGORY[notifications.TEMPLATE_KEYS.SOCIAL_REPLY],
      "replies"
    );
    assert.equal(
      notifications.TEMPLATE_CATEGORY[notifications.TEMPLATE_KEYS.SOCIAL_FOLLOW],
      "follows"
    );
  });

  it("maySend respects emailMentions / emailReplies pref opt-out", async () => {
    clearModule(NOTIF_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const notifications = require(NOTIF_PATH);
    notifications.memoryReset();
    const pref = await notifications.ensurePreferences(
      { userId: "u_opt", email: "opt@example.com" },
      { useMemory: true }
    );
    await notifications.updatePreferences(
      pref.id,
      { emailMentions: false, emailReplies: false, emailFollows: false },
      { useMemory: true }
    );
    const m = await notifications.maySend(
      {
        email: "opt@example.com",
        userId: "u_opt",
        templateKey: notifications.TEMPLATE_KEYS.SOCIAL_MENTION,
        channel: notifications.CHANNEL.EMAIL
      },
      { useMemory: true }
    );
    assert.equal(m.allowed, false);
    assert.equal(m.reason, "mentions_disabled");

    const r = await notifications.maySend(
      {
        email: "opt@example.com",
        userId: "u_opt",
        templateKey: notifications.TEMPLATE_KEYS.SOCIAL_REPLY,
        channel: notifications.CHANNEL.EMAIL
      },
      { useMemory: true }
    );
    assert.equal(r.allowed, false);
    assert.equal(r.reason, "replies_disabled");
  });

  it("renders social templates", () => {
    clearModule(NOTIF_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const notifications = require(NOTIF_PATH);
    const mention = notifications.renderTemplate(notifications.TEMPLATE_KEYS.SOCIAL_MENTION, {
      preview: "hey @you",
      unsubscribeToken: "tok"
    });
    assert.match(mention.subject, /mentioned/i);
    assert.match(mention.bodyText, /hey @you/);
    const reply = notifications.renderTemplate(notifications.TEMPLATE_KEYS.SOCIAL_REPLY, {
      preview: "nice point"
    });
    assert.match(reply.subject, /reply/i);
  });
});

describe("extractMentions", () => {
  it("pulls @handles from body", () => {
    const social = loadSocial();
    assert.deepEqual(social.extractMentions("hi @Alice and @bob_1!"), ["alice", "bob_1"]);
    assert.deepEqual(social.extractMentions("no mentions here"), []);
  });
});
