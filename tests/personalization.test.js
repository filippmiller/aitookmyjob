/**
 * Intent-aware personalization (aitj-z8q.13).
 * Offline unit tests: intent model, ranking, support-first (no forced action),
 * anonymous fallback, explanations, next steps.
 *
 * Run: npm run test:personalization
 */

"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const PERS_PATH = path.join(__dirname, "..", "lib/personalization.js");
const DOMAIN_PATH = path.join(__dirname, "..", "lib/domain-contract.js");
const MIGRATE_PATH = path.join(__dirname, "..", "lib/migrate.js");

function clearModule(modPath) {
  try {
    delete require.cache[require.resolve(modPath)];
  } catch (_e) {
    /* ignore */
  }
}

function loadPers() {
  clearModule(PERS_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(PERS_PATH);
}

const sampleItems = () => [
  {
    type: "vent",
    id: "v1",
    title: "Exhausted",
    summary: "Just need to be heard",
    desiredResponse: "empathy",
    publicationIntent: "vent",
    createdAt: "2026-07-18T10:00:00.000Z"
  },
  {
    type: "story",
    id: "s1",
    title: "Laid off from support",
    profession: "customer_support",
    country: "us",
    desiredResponse: "witness",
    publicationIntent: "story",
    createdAt: "2026-07-17T10:00:00.000Z"
  },
  {
    type: "story",
    id: "s2",
    title: "Need resume tips",
    profession: "engineer",
    country: "de",
    desiredResponse: "advice",
    publicationIntent: "advice_request",
    createdAt: "2026-07-16T10:00:00.000Z"
  },
  {
    type: "news",
    id: "n1",
    title: "AI layoffs continue",
    summary: "Industry report",
    createdAt: "2026-07-18T08:00:00.000Z"
  },
  {
    type: "resource",
    id: "r1",
    title: "Unemployment benefits guide",
    url: "https://www.careeronestop.org/",
    createdAt: "2026-07-10T10:00:00.000Z"
  },
  {
    type: "opportunity",
    id: "o1",
    title: "Retraining program",
    url: "https://www.careeronestop.org/jobs",
    createdAt: "2026-07-12T10:00:00.000Z"
  },
  {
    type: "petition",
    id: "p1",
    title: "Transparency petition",
    createdAt: "2026-07-11T10:00:00.000Z"
  },
  {
    type: "group",
    id: "g1",
    title: "Support professionals circle",
    profession: "customer_support",
    region: "us",
    createdAt: "2026-07-15T10:00:00.000Z"
  }
];

describe("domain contract — user intent enums", () => {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const domain = require(DOMAIN_PATH);

  it("exports USER_INTENT consumer states", () => {
    assert.equal(domain.USER_INTENT.ONLY_READING, "only_reading");
    assert.equal(domain.USER_INTENT.NEED_TO_VENT, "need_to_vent");
    assert.equal(domain.USER_INTENT.SEEKING_SIMILAR, "seeking_similar");
    assert.equal(domain.USER_INTENT.GATHERING_INFORMATION, "gathering_information");
    assert.equal(domain.USER_INTENT.READY_TO_ACT, "ready_to_act");
    assert.equal(domain.USER_INTENT.READY_TO_HELP, "ready_to_help");
  });

  it("exports FEED_ITEM_TYPE and USER_INTENT_SOURCE", () => {
    assert.equal(domain.FEED_ITEM_TYPE.VENT, "vent");
    assert.equal(domain.FEED_ITEM_TYPE.OPPORTUNITY, "opportunity");
    assert.equal(domain.USER_INTENT_SOURCE.ANONYMOUS_FALLBACK, "anonymous_fallback");
  });

  it("registers user_intent_state entity and feed API boundary", () => {
    assert.equal(domain.ENTITY.USER_INTENT_STATE, "user_intent_state");
    const mounts = domain.API_BOUNDARIES.map((b) => b.module);
    assert.ok(mounts.includes("routes/feed.js"));
  });
});

describe("migration 011 present", () => {
  it("loads migration 011 intent_feeds after 010", () => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { loadMigrations } = require(MIGRATE_PATH);
    const migrations = loadMigrations();
    const versions = migrations.map((m) => m.version);
    assert.ok(versions.includes("011"), `expected 011, got ${versions.join(",")}`);
    const m011 = migrations.find((m) => m.version === "011");
    assert.equal(m011.name, "intent_feeds");
    assert.equal(typeof m011.up, "function");
    assert.ok(versions.indexOf("010") < versions.indexOf("011"));
  });
});

describe("intent catalog & validation", () => {
  let pers;

  beforeEach(() => {
    pers = loadPers();
    pers.memoryReset();
  });

  afterEach(() => {
    pers.memoryReset();
  });

  it("lists all six intents with supportFirst flags", () => {
    const list = pers.listIntents();
    assert.equal(list.length, 6);
    const vent = list.find((i) => i.id === "need_to_vent");
    assert.equal(vent.supportFirst, true);
    assert.equal(vent.allowActionRecs, false);
    const act = list.find((i) => i.id === "ready_to_act");
    assert.equal(act.allowActionRecs, true);
  });

  it("normalizeIntentPatch rejects unknown intents", () => {
    const bad = pers.normalizeIntentPatch({ primaryIntent: "job_hunt_hard" });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "invalid_intent");
  });

  it("normalizeIntentPatch accepts primary + secondary + prefs", () => {
    const ok = pers.normalizeIntentPatch({
      primaryIntent: "need_to_vent",
      secondaryIntents: ["seeking_similar"],
      prefs: { preferSupport: true, email: "should-be-stripped@x.com", profession: "writer" }
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.value.primaryIntent, "need_to_vent");
    assert.deepEqual(ok.value.secondaryIntents, ["seeking_similar"]);
    assert.equal(ok.value.prefs.preferSupport, true);
    assert.equal(ok.value.prefs.profession, "writer");
    assert.equal(ok.value.prefs.email, undefined);
  });
});

describe("anonymous privacy-safe fallback", () => {
  let pers;

  beforeEach(() => {
    pers = loadPers();
    pers.memoryReset();
  });

  it("getUserIntent(null) returns anonymous only_reading without PII fields", async () => {
    const state = await pers.getUserIntent(null, { useMemory: true });
    assert.equal(state.anonymous, true);
    assert.equal(state.userId, null);
    assert.equal(state.primaryIntent, "only_reading");
    assert.equal(state.source, "anonymous_fallback");
    assert.ok(!("email" in state));
    assert.ok(!("ip" in state));
  });

  it("anonymous fallback does not write memory state", async () => {
    await pers.getUserIntent(null, { useMemory: true });
    assert.equal(pers.memory.intentState.size, 0);
  });
});

describe("intent persistence (memory)", () => {
  let pers;
  const mem = { useMemory: true };

  beforeEach(() => {
    pers = loadPers();
    pers.memoryReset();
  });

  afterEach(() => {
    pers.memoryReset();
  });

  it("setUserIntent requires userId", async () => {
    const r = await pers.setUserIntent(null, { primaryIntent: "ready_to_act" }, mem);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });

  it("users can set and change intent", async () => {
    const a = await pers.setUserIntent("u1", { primaryIntent: "need_to_vent" }, mem);
    assert.equal(a.ok, true);
    assert.equal(a.state.primaryIntent, "need_to_vent");
    assert.equal(a.state.source, "explicit");

    const got = await pers.getUserIntent("u1", mem);
    assert.equal(got.primaryIntent, "need_to_vent");

    const b = await pers.setUserIntent("u1", { primaryIntent: "ready_to_act" }, mem);
    assert.equal(b.state.primaryIntent, "ready_to_act");
  });
});

describe("ranking — support-first, no forced action", () => {
  let pers;

  beforeEach(() => {
    pers = loadPers();
  });

  it("need_to_vent ranks vents/stories above resources and drops action items", () => {
    const ranked = pers.rankFeedItems(sampleItems(), {
      intent: "need_to_vent",
      now: Date.parse("2026-07-19T12:00:00.000Z")
    });
    assert.ok(ranked.length >= 2);
    const types = ranked.map((i) => i.type);
    assert.ok(types.includes("vent"), "vents remain first-class");
    assert.ok(types.includes("story"), "stories remain first-class");
    assert.equal(types.includes("opportunity"), false, "no forced opportunities");
    assert.equal(types.includes("resource"), false, "no forced career resources");
    assert.equal(types.includes("petition"), false, "no forced petitions");

    const top = ranked[0];
    assert.ok(["vent", "story"].includes(top.type), `top was ${top.type}`);
    assert.ok(top.why && top.why.summary, "explanation present");
  });

  it("need_to_vent does not allow action recommendations", () => {
    assert.equal(pers.allowsActionRecommendations("need_to_vent"), false);
    assert.equal(pers.allowsActionRecommendations("only_reading"), false);
    assert.equal(pers.allowsActionRecommendations("seeking_similar"), false);
    assert.equal(pers.allowsActionRecommendations("ready_to_act"), true);
  });

  it("ready_to_act surfaces opportunities and resources near the top", () => {
    const ranked = pers.rankFeedItems(sampleItems(), {
      intent: "ready_to_act",
      now: Date.parse("2026-07-19T12:00:00.000Z")
    });
    const topTypes = ranked.slice(0, 4).map((i) => i.type);
    assert.ok(
      topTypes.includes("opportunity") || topTypes.includes("resource") || topTypes.includes("petition"),
      `expected action types near top, got ${topTypes.join(",")}`
    );
    const opp = ranked.find((i) => i.type === "opportunity");
    assert.ok(opp);
    assert.ok(opp.why.summary.toLowerCase().includes("ready to act") || opp.why.codes.length > 0);
  });

  it("gathering_information prefers news over vents", () => {
    const ranked = pers.rankFeedItems(sampleItems(), {
      intent: "gathering_information",
      now: Date.parse("2026-07-19T12:00:00.000Z")
    });
    const news = ranked.find((i) => i.type === "news");
    const vent = ranked.find((i) => i.type === "vent");
    assert.ok(news);
    assert.ok(vent);
    assert.ok(news.score > vent.score, `news ${news.score} vs vent ${vent.score}`);
  });

  it("seeking_similar boosts matching profession/region", () => {
    const ranked = pers.rankFeedItems(sampleItems(), {
      intent: "seeking_similar",
      prefs: { profession: "customer_support", region: "us" },
      now: Date.parse("2026-07-19T12:00:00.000Z")
    });
    const story = ranked.find((i) => i.id === "s1");
    const other = ranked.find((i) => i.id === "s2");
    assert.ok(story && other);
    assert.ok(story.score > other.score, `similar ${story.score} vs other ${other.score}`);
    assert.ok(story.why.codes.includes("similarity") || story.why.summary);
  });

  it("ready_to_help elevates vents and advice requests", () => {
    const ranked = pers.rankFeedItems(sampleItems(), {
      intent: "ready_to_help",
      now: Date.parse("2026-07-19T12:00:00.000Z")
    });
    const vent = ranked.find((i) => i.id === "v1");
    const advice = ranked.find((i) => i.id === "s2");
    const opp = ranked.find((i) => i.type === "opportunity");
    assert.ok(vent);
    assert.ok(advice);
    assert.ok(vent.score > 0.5);
    // opportunities should be absent or very low
    assert.ok(!opp || opp.score < vent.score);
  });

  it("every ranked item includes a why explanation", () => {
    for (const intent of pers.listIntents().map((i) => i.id)) {
      const ranked = pers.rankFeedItems(sampleItems(), { intent });
      for (const item of ranked) {
        assert.ok(item.why, `${intent} ${item.id}`);
        assert.ok(item.why.summary, `${intent} ${item.id} summary`);
        assert.ok(Array.isArray(item.why.codes), `${intent} ${item.id} codes`);
      }
    }
  });

  it("scoreItem hard-suppresses action for need_to_vent", () => {
    const r = pers.scoreItem(
      { type: "opportunity", id: "o1" },
      "need_to_vent",
      {}
    );
    assert.equal(r.suppressed, true);
    assert.equal(r.score, 0);
  });
});

describe("next steps — intent-aware, no forced career CTAs", () => {
  let pers;

  beforeEach(() => {
    pers = loadPers();
  });

  it("need_to_vent next steps mention vent/support, not job applications", () => {
    const steps = pers.nextStepsForIntent("need_to_vent");
    assert.ok(steps.length >= 2);
    const blob = JSON.stringify(steps).toLowerCase();
    assert.ok(blob.includes("vent") || blob.includes("support") || blob.includes("heard"));
    assert.ok(!blob.includes("apply for jobs"));
    assert.ok(!blob.includes("open opportunities"));
  });

  it("ready_to_act includes opportunities/resources", () => {
    const steps = pers.nextStepsForIntent("ready_to_act");
    const blob = JSON.stringify(steps).toLowerCase();
    assert.ok(blob.includes("opportunit") || blob.includes("resource"));
  });

  it("only_reading stays low-pressure", () => {
    const steps = pers.nextStepsForIntent("only_reading");
    const blob = JSON.stringify(steps).toLowerCase();
    assert.ok(blob.includes("browse") || blob.includes("scan") || blob.includes("pace"));
  });
});

describe("buildPersonalizedFeed integration", () => {
  let pers;

  beforeEach(() => {
    pers = loadPers();
  });

  it("builds feed with policy flags for support intent", () => {
    const feed = pers.buildPersonalizedFeed(
      {
        vents: [
          {
            id: "v1",
            title: "Hard day",
            body: "…",
            status: "published",
            desiredResponse: "empathy",
            publicationIntent: "vent",
            createdAt: "2026-07-18T10:00:00.000Z"
          }
        ],
        stories: [
          {
            id: "s1",
            name: "Alex",
            profession: "writer",
            company: "Co",
            story: "Displaced",
            status: "published",
            desiredResponse: "witness",
            publicationIntent: "story",
            createdAt: "2026-07-17T10:00:00.000Z"
          }
        ],
        news: [],
        resources: [
          {
            id: "r1",
            title: "Jobs board",
            url: "https://www.careeronestop.org/",
            status: "published"
          }
        ],
        opportunities: [
          {
            id: "o1",
            title: "Role",
            url: "https://www.careeronestop.org/x",
            status: "open"
          }
        ],
        topics: [],
        groups: [],
        petitions: []
      },
      {
        primaryIntent: "need_to_vent",
        secondaryIntents: [],
        prefs: {},
        source: "explicit",
        anonymous: false,
        userId: "u1"
      },
      { limit: 20 }
    );

    assert.equal(feed.intent.primaryIntent, "need_to_vent");
    assert.equal(feed.policy.actionRecommendations, false);
    assert.equal(feed.policy.supportFirst, true);
    assert.ok(feed.items.length >= 1);
    assert.ok(feed.items.every((i) => i.why && i.why.summary));
    assert.ok(feed.nextSteps.length >= 1);
    assert.equal(
      feed.items.some((i) => i.type === "opportunity" || i.type === "resource"),
      false,
      "action items must not appear for need_to_vent"
    );
  });

  it("anonymous feed uses only_reading policy", () => {
    const anon = pers.anonymousFallbackIntent();
    const feed = pers.buildPersonalizedFeed(
      {
        stories: [
          {
            id: "s1",
            name: "A",
            profession: "x",
            company: "y",
            story: "z",
            status: "published",
            createdAt: "2026-07-18T00:00:00.000Z"
          }
        ],
        vents: [],
        news: [{ id: "n1", title: "Headline", status: "published", createdAt: "2026-07-18T00:00:00.000Z" }],
        resources: [],
        opportunities: [],
        topics: [],
        groups: [],
        petitions: []
      },
      anon,
      { limit: 10 }
    );
    assert.equal(feed.intent.anonymous, true);
    assert.equal(feed.intent.primaryIntent, "only_reading");
    assert.equal(feed.policy.actionRecommendations, false);
  });
});
