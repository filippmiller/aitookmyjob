/**
 * Search, discovery, entity pages, saved searches (aitj-z8q.17).
 * Offline unit tests: empty query, pagination bounds, evidence exclusion,
 * vent visibility, blocked authors, saved search notify stub.
 *
 * Run: npm run test:search
 */

"use strict";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const SEARCH_PATH = path.join(__dirname, "..", "lib/search.js");
const SOCIAL_PATH = path.join(__dirname, "..", "lib/social.js");
const DOMAIN_PATH = path.join(__dirname, "..", "lib/domain-contract.js");
const MIGRATE_PATH = path.join(__dirname, "..", "lib/migrate.js");
const JOBS_PATH = path.join(__dirname, "..", "lib/jobs.js");
const HANDLERS_PATH = path.join(__dirname, "..", "lib/job-handlers.js");

function clearModule(modPath) {
  try {
    delete require.cache[require.resolve(modPath)];
  } catch (_e) {
    /* ignore */
  }
}

function loadSearch() {
  clearModule(SEARCH_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(SEARCH_PATH);
}

function loadSocial() {
  clearModule(SOCIAL_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  return require(SOCIAL_PATH);
}

const FIXTURE_STORIES = [
  {
    id: "st_search_1",
    status: "published",
    visibility: "public",
    profession: "Copywriter",
    company: "AdSpark Media",
    country: "us",
    language: "en",
    reason: "LLM workflows replaced drafting",
    story: "Our copy team was cut after AI drafting tools shipped.",
    createdAt: "2026-02-01T00:00:00.000Z",
    submittedBy: "author_a"
  },
  {
    id: "st_search_2",
    status: "published",
    visibility: "public",
    profession: "QA Engineer",
    company: "CloudRail GmbH",
    country: "de",
    language: "de",
    reason: "AI-assisted testing",
    story: "QA headcount dropped after automation.",
    createdAt: "2026-02-02T00:00:00.000Z",
    submittedBy: "author_b"
  },
  {
    id: "st_draft",
    status: "draft",
    visibility: "public",
    profession: "Hidden",
    company: "SecretCo",
    country: "us",
    story: "Should never appear",
    createdAt: "2026-02-03T00:00:00.000Z"
  }
];

const FIXTURE_VENTS = [
  {
    id: "vent_public",
    status: "published",
    visibility: "public",
    body: "Public vent about AI layoffs and burnout",
    country: "us",
    language: "en",
    createdAt: "2026-02-04T00:00:00.000Z",
    submittedBy: "author_a"
  },
  {
    id: "vent_community",
    status: "published",
    visibility: "community",
    body: "Community-only vent about AI layoffs",
    country: "us",
    language: "en",
    createdAt: "2026-02-05T00:00:00.000Z",
    submittedBy: "author_b"
  },
  {
    id: "vent_private",
    status: "published",
    visibility: "private",
    body: "Private vent must not search",
    country: "us",
    createdAt: "2026-02-06T00:00:00.000Z",
    submittedBy: "author_a"
  }
];

const FIXTURE_NEWS = [
  {
    id: "news_1",
    status: "published",
    title: { en: "Major tech firm cuts support roles" },
    summary: "AI chatbots replace first-line support agents",
    source: "LaborWire",
    region: "us",
    language: "en",
    companies: ["HelpDesk AI"],
    professions: ["Support Agent"],
    publishedAt: "2026-02-07T00:00:00.000Z"
  }
];

const FIXTURE_RESOURCES = [
  {
    id: "res_1",
    status: "published",
    title: "Career pivot guide for displaced writers",
    summary: "Practical steps after AI content tools",
    region: "global",
    language: "en",
    cost: "free",
    createdAt: "2026-02-08T00:00:00.000Z"
  }
];

function baseSources(extra = {}) {
  return {
    stories: FIXTURE_STORIES,
    vents: FIXTURE_VENTS,
    news: FIXTURE_NEWS,
    resources: FIXTURE_RESOURCES,
    groups: [],
    insiderSignals: [
      {
        id: "sig_1",
        status: "published_summary",
        companyName: "AdSpark Media",
        companySlug: "adspark-media",
        summary: "Multiple reports of AI drafting layoffs",
        verificationLevel: "multi_source",
        publishedAt: "2026-02-09T00:00:00.000Z",
        rolesAffected: ["Copywriter"]
      }
    ],
    ...extra
  };
}

describe("domain + migration — search discovery", () => {
  it("API boundaries list search module", () => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const domain = require(DOMAIN_PATH);
    const mounts = domain.API_BOUNDARIES.map((b) => b.module);
    assert.ok(mounts.includes("routes/search.js"));
  });

  it("migration 014 search_discovery is loadable", () => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { loadMigrations } = require(MIGRATE_PATH);
    const migrations = loadMigrations();
    const m014 = migrations.find((m) => m.version === "014");
    assert.ok(m014);
    assert.equal(m014.name, "search_discovery");
    assert.equal(typeof m014.up, "function");
  });

  it("evidence is never publicly listable", () => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const domain = require(DOMAIN_PATH);
    assert.equal(domain.isPubliclyListable("evidence", "available"), false);
    assert.deepEqual(domain.PUBLIC_LISTABLE_STATUSES[domain.ENTITY.EVIDENCE], []);
  });
});

describe("search — empty query", () => {
  let search;

  beforeEach(() => {
    search = loadSearch();
    search.memoryReset();
  });

  it("returns empty results without fabricated content", async () => {
    const result = await search.search(
      { q: "", limit: 20 },
      { forceMemory: true, sources: baseSources() }
    );
    assert.equal(result.emptyQuery, true);
    assert.equal(result.empty, true);
    assert.equal(result.total, 0);
    assert.deepEqual(result.results, []);
    assert.ok(result.message);
  });

  it("whitespace-only query is empty", async () => {
    const result = await search.search(
      { q: "   " },
      { forceMemory: true, sources: baseSources() }
    );
    assert.equal(result.emptyQuery, true);
    assert.equal(result.results.length, 0);
  });
});

describe("search — pagination bounds", () => {
  let search;

  beforeEach(() => {
    search = loadSearch();
    search.memoryReset();
  });

  it("clamps limit to 1..50", () => {
    assert.equal(search.clampLimit(0), 1);
    assert.equal(search.clampLimit(-5), 1);
    assert.equal(search.clampLimit(999), 50);
    assert.equal(search.clampLimit("12"), 12);
    assert.equal(search.clampLimit(undefined), 20);
  });

  it("clamps offset to 0..MAX", () => {
    assert.equal(search.clampOffset(-1), 0);
    assert.equal(search.clampOffset(1e9), search.MAX_OFFSET);
    assert.equal(search.clampOffset("3"), 3);
  });

  it("paginates results without exceeding limit", async () => {
    const manyStories = Array.from({ length: 30 }, (_, i) => ({
      id: `st_p_${i}`,
      status: "published",
      visibility: "public",
      profession: "Analyst",
      company: `Firm${i}`,
      country: "us",
      reason: "AI automation wave",
      story: `Automation displaced role number ${i} in analytics`,
      createdAt: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`
    }));
    const page1 = await search.search(
      { q: "automation", limit: 10, offset: 0 },
      { forceMemory: true, sources: baseSources({ stories: manyStories, vents: [], news: [], resources: [], insiderSignals: [] }) }
    );
    assert.ok(page1.total >= 10);
    assert.equal(page1.results.length, 10);
    assert.equal(page1.limit, 10);
    assert.equal(page1.offset, 0);

    const page2 = await search.search(
      { q: "automation", limit: 10, offset: 10 },
      { forceMemory: true, sources: baseSources({ stories: manyStories, vents: [], news: [], resources: [], insiderSignals: [] }) }
    );
    assert.equal(page2.offset, 10);
    assert.ok(page2.results.length <= 10);
    // pages should not fully overlap
    const ids1 = new Set(page1.results.map((r) => r.id));
    const overlap = page2.results.filter((r) => ids1.has(r.id));
    assert.equal(overlap.length, 0);
  });

  it("rejects oversize limit by clamping", async () => {
    const result = await search.search(
      { q: "copywriter", limit: 500, offset: 0 },
      { forceMemory: true, sources: baseSources() }
    );
    assert.equal(result.limit, 50);
    assert.ok(result.results.length <= 50);
  });
});

describe("search — permissions & evidence exclusion", () => {
  let search;
  let social;

  beforeEach(() => {
    search = loadSearch();
    social = loadSocial();
    search.memoryReset();
    social.memoryReset();
  });

  afterEach(() => {
    search.memoryReset();
    social.memoryReset();
  });

  it("never returns evidence type even if injected in sources", async () => {
    // Attempt to inject a forbidden evidence-shaped document via custom sources
    // (collectDocuments will not build evidence docs; assert parseTypes + search reject)
    assert.ok(!search.SEARCH_DOC_TYPES.includes("evidence"));
    assert.ok(search.FORBIDDEN_SEARCH_TYPES.includes("evidence"));

    const result = await search.search(
      { q: "secret", types: "evidence" },
      {
        forceMemory: true,
        sources: baseSources({
          stories: [
            {
              id: "st_ev",
              status: "published",
              visibility: "public",
              profession: "Analyst",
              company: "X",
              country: "us",
              story: "secret evidence blob should not matter",
              reason: "n/a",
              createdAt: "2026-02-01T00:00:00.000Z"
            }
          ]
        })
      }
    );
    assert.equal(result.forbidden, true);
    assert.equal(result.results.length, 0);
    assert.ok(result.results.every((r) => r.type !== "evidence"));
  });

  it("excludes draft stories and private vents", async () => {
    const result = await search.search(
      { q: "SecretCo" },
      { forceMemory: true, sources: baseSources() }
    );
    assert.equal(result.results.some((r) => r.id === "st_draft"), false);

    const ventPrivate = await search.search(
      { q: "Private vent", types: "vent" },
      { forceMemory: true, sources: baseSources(), includeCommunity: true }
    );
    assert.equal(ventPrivate.results.some((r) => r.id === "vent_private"), false);
  });

  it("public vents visible anonymously; community vents require includeCommunity", async () => {
    const anon = await search.search(
      { q: "layoffs", types: "vent" },
      { forceMemory: true, sources: baseSources(), includeCommunity: false }
    );
    assert.ok(anon.results.some((r) => r.id === "vent_public"));
    assert.equal(anon.results.some((r) => r.id === "vent_community"), false);

    const signedIn = await search.search(
      { q: "layoffs", types: "vent", includeCommunity: true },
      { forceMemory: true, sources: baseSources(), includeCommunity: true }
    );
    assert.ok(signedIn.results.some((r) => r.id === "vent_community"));
  });

  it("filters blocked authors when social is available", async () => {
    await social.blockUser({ blockerId: "viewer", blockedId: "author_a" }, { useMemory: true });
    const result = await search.search(
      { q: "copywriter", viewerId: "viewer" },
      {
        forceMemory: true,
        sources: baseSources(),
        social,
        useMemory: true
      }
    );
    assert.equal(
      result.results.some((r) => r.id === "st_search_1"),
      false,
      "blocked author story should be filtered"
    );
    // company entity derived from story may still appear (no authorId) — that's ok
  });

  it("insider summaries are searchable; no forbidden fields", async () => {
    const result = await search.search(
      { q: "AdSpark", types: "insider_summary" },
      { forceMemory: true, sources: baseSources() }
    );
    assert.ok(result.total >= 1);
    for (const hit of result.results) {
      assert.equal(hit.type, "insider_summary");
      assert.equal(hit.authorId, undefined);
      assert.equal(hit.evidence, undefined);
      assert.equal(hit.bodyRestricted, undefined);
    }
  });
});

describe("search — relevance", () => {
  let search;

  beforeEach(() => {
    search = loadSearch();
    search.memoryReset();
  });

  it("ranks title/company matches above weak body matches", async () => {
    const result = await search.search(
      { q: "Copywriter" },
      { forceMemory: true, sources: baseSources() }
    );
    assert.ok(result.results.length >= 1);
    assert.ok(result.results[0].score > 0);
    // Copywriter profession story or entity should be near top
    const top = result.results[0];
    assert.ok(
      /copywriter/i.test(top.title) ||
        top.profession === "Copywriter" ||
        top.type === "profession"
    );
  });
});

describe("entity pages", () => {
  let search;

  beforeEach(() => {
    search = loadSearch();
    search.memoryReset();
  });

  it("returns company entity with related stories", async () => {
    const page = await search.getEntityPage(
      "company",
      "adspark-media",
      { limit: 20 },
      { forceMemory: true, sources: baseSources() }
    );
    assert.equal(page.ok, true);
    assert.equal(page.empty, false);
    assert.equal(page.entity.type, "company");
    assert.ok(page.totals.stories >= 1);
  });

  it("empty entity has no fabricated content", async () => {
    const page = await search.getEntityPage(
      "company",
      "does-not-exist-xyz",
      {},
      { forceMemory: true, sources: baseSources() }
    );
    assert.equal(page.ok, true);
    assert.equal(page.empty, true);
    assert.equal(page.totals.stories, 0);
    assert.deepEqual(page.stories, []);
    assert.ok(page.message);
  });

  it("profession and region entity types work", async () => {
    const prof = await search.getEntityPage(
      "profession",
      "qa-engineer",
      {},
      { forceMemory: true, sources: baseSources() }
    );
    assert.equal(prof.ok, true);
    assert.ok(prof.totals.stories >= 1);

    const region = await search.getEntityPage(
      "region",
      "de",
      {},
      { forceMemory: true, sources: baseSources() }
    );
    assert.equal(region.ok, true);
    assert.ok(region.totals.stories >= 1);
  });
});

describe("saved searches + notify stub", () => {
  let search;
  let jobs;

  beforeEach(() => {
    search = loadSearch();
    clearModule(JOBS_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    jobs = require(JOBS_PATH);
    if (typeof jobs.memoryReset === "function") jobs.memoryReset();
    search.memoryReset();
  });

  afterEach(() => {
    search.memoryReset();
    if (typeof jobs.memoryReset === "function") jobs.memoryReset();
  });

  it("CRUD saved search in memory", async () => {
    const created = await search.createSavedSearch(
      {
        userId: "u1",
        name: "AI copy",
        query: "copywriter",
        types: ["story", "news"],
        notify: false
      },
      { useMemory: true }
    );
    assert.equal(created.ok, true);
    assert.equal(created.savedSearch.query, "copywriter");

    const listed = await search.listSavedSearches("u1", { useMemory: true });
    assert.equal(listed.length, 1);

    const updated = await search.updateSavedSearch(
      created.savedSearch.id,
      "u1",
      { notify: true, name: "AI copy alerts" },
      { useMemory: true }
    );
    assert.equal(updated.ok, true);
    assert.equal(updated.savedSearch.notify, true);
    assert.equal(updated.savedSearch.name, "AI copy alerts");

    const del = await search.deleteSavedSearch(created.savedSearch.id, "u1", { useMemory: true });
    assert.equal(del.ok, true);
    const after = await search.listSavedSearches("u1", { useMemory: true });
    assert.equal(after.length, 0);
  });

  it("enable notifications enqueues search.notify job stub", async () => {
    const created = await search.createSavedSearch(
      { userId: "u2", query: "layoffs", notify: false },
      { useMemory: true }
    );
    const enq = await search.enableSavedSearchNotifications(
      created.savedSearch.id,
      "u2",
      { useMemory: true, jobs, forceMemory: true }
    );
    assert.equal(enq.ok, true);
    assert.equal(enq.savedSearch.notify, true);
    assert.equal(enq.enqueued, true);
    assert.ok(enq.jobId);

    // Run stub handler body
    const run = await search.runSavedSearchNotify(
      { savedSearchId: created.savedSearch.id, userId: "u2" },
      { useMemory: true, forceMemory: true, sources: baseSources() }
    );
    assert.equal(run.ok, true);
    assert.equal(run.stub, true);
    assert.equal(run.delivered, false);
    assert.ok(typeof run.resultCount === "number");
  });

  it("registers search.notify job handler", () => {
    clearModule(HANDLERS_PATH);
    clearModule(JOBS_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const jobsMod = require(JOBS_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const handlers = require(HANDLERS_PATH);
    handlers.registerBuiltinHandlers(
      {
        usePostgres: false,
        getPgPool: () => null,
        storageAudit: async () => {}
      },
      jobsMod
    );
    assert.equal(typeof jobsMod.getHandler("search.notify"), "function");
  });
});
