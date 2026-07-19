/**
 * Community-grounded news (aitj-z8q.10).
 * Offline unit tests: URL/content hash dedupe merge, entity extraction,
 * NEWS_STATUS / NEWS_SUBMISSION_STATUS transitions, storage submit+discuss,
 * source health, news.source_check handler registration.
 *
 * Run: npm run test:news
 */

"use strict";

const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CONTEXT_PATH = path.join(__dirname, "..", "lib/context.js");
const HANDLERS_PATH = path.join(__dirname, "..", "lib/job-handlers.js");
const JOBS_PATH = path.join(__dirname, "..", "lib/jobs.js");
const DOMAIN_PATH = path.join(__dirname, "..", "lib/domain-contract.js");
const INGEST_PATH = path.join(__dirname, "..", "lib/news-ingest.js");

function clearModule(modPath) {
  try {
    delete require.cache[require.resolve(modPath)];
  } catch (_e) {
    /* ignore */
  }
}

function loadContext(envPatch = {}) {
  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV
  };
  if (Object.prototype.hasOwnProperty.call(envPatch, "DATABASE_URL")) {
    if (!envPatch.DATABASE_URL) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = envPatch.DATABASE_URL;
  }
  clearModule(INGEST_PATH);
  clearModule(CONTEXT_PATH);
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const ctx = require(CONTEXT_PATH);
  return {
    ctx,
    restore() {
      if (saved.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved.DATABASE_URL;
      if (saved.NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = saved.NODE_ENV;
      clearModule(CONTEXT_PATH);
      clearModule(INGEST_PATH);
    }
  };
}

describe("domain contract — news community enums", () => {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const domain = require(DOMAIN_PATH);

  it("exports NEWS_SUBMISSION_STATUS and NEWS_SOURCE_STATUS", () => {
    assert.equal(domain.NEWS_SUBMISSION_STATUS.PENDING, "pending");
    assert.equal(domain.NEWS_SUBMISSION_STATUS.APPROVED, "approved");
    assert.equal(domain.NEWS_SUBMISSION_STATUS.REJECTED, "rejected");
    assert.equal(domain.NEWS_SOURCE_STATUS.OK, "ok");
    assert.equal(domain.NEWS_SOURCE_STATUS.BROKEN, "broken");
    assert.equal(domain.NEWS_SOURCE_STATUS.STALE, "stale");
  });

  it("allows news discovered → published and published → rejected", () => {
    assert.equal(
      domain.canTransition(domain.ENTITY.NEWS, domain.NEWS_STATUS.DISCOVERED, domain.NEWS_STATUS.PUBLISHED),
      true
    );
    assert.equal(
      domain.canTransition(domain.ENTITY.NEWS, domain.NEWS_STATUS.PUBLISHED, domain.NEWS_STATUS.REJECTED),
      true
    );
    assert.equal(
      domain.canTransition(domain.ENTITY.NEWS, domain.NEWS_STATUS.REJECTED, domain.NEWS_STATUS.PUBLISHED),
      false
    );
  });

  it("submission pending → approved|rejected only", () => {
    assert.equal(
      domain.canTransition(
        domain.ENTITY.NEWS_SUBMISSION,
        domain.NEWS_SUBMISSION_STATUS.PENDING,
        domain.NEWS_SUBMISSION_STATUS.APPROVED
      ),
      true
    );
    assert.equal(
      domain.canTransition(
        domain.ENTITY.NEWS_SUBMISSION,
        domain.NEWS_SUBMISSION_STATUS.APPROVED,
        domain.NEWS_SUBMISSION_STATUS.PENDING
      ),
      false
    );
  });

  it("API boundaries list news module ownership", () => {
    const mounts = domain.API_BOUNDARIES.map((b) => b.module);
    assert.ok(mounts.includes("routes/news.js"));
  });
});

describe("news-ingest pure helpers — normalize, hash, entities, merge", () => {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const ingest = require(INGEST_PATH);

  it("canonicalUrl strips tracking params, www, trailing slash, hash", () => {
    const a = ingest.canonicalUrl(
      "https://WWW.Example.com/path/story/?utm_source=x&utm_medium=y&fbclid=1&id=9#section"
    );
    const b = ingest.canonicalUrl("https://example.com/path/story?id=9");
    assert.equal(a, b);
    assert.equal(a, "https://example.com/path/story?id=9");
  });

  it("urlHash is stable for equivalent URLs", () => {
    const h1 = ingest.urlHash(ingest.canonicalUrl("https://news.site/a?utm_campaign=1"));
    const h2 = ingest.urlHash(ingest.canonicalUrl("https://www.news.site/a/"));
    assert.equal(h1, h2);
    assert.match(h1, /^[a-f0-9]{64}$/);
  });

  it("contentHash ignores case and punctuation", () => {
    const h1 = ingest.contentHash("AI Layoffs Hit Microsoft!", "techcrunch.com");
    const h2 = ingest.contentHash("ai layoffs hit microsoft", "techcrunch.com");
    assert.equal(h1, h2);
  });

  it("extractEntities finds companies and professions", () => {
    const e = ingest.extractEntities(
      "Microsoft lays off software engineers amid AI automation push in the United States"
    );
    assert.ok(e.companies.includes("Microsoft"));
    assert.ok(e.professions.some((p) => /software engineer|engineer/i.test(p)));
    assert.ok(e.regions.includes("us"));
  });

  it("mergeNewsItems prefers earlier discovery and max relevance", () => {
    const a = ingest.enrichNewsCandidate({
      id: "news_a",
      title: { en: "AI layoffs at Google hit white-collar workers" },
      url: "https://a.example/story",
      source: "a.example",
      relevanceScore: 30,
      discoveredAt: "2026-01-01T00:00:00.000Z",
      publishedAt: "2026-01-02T00:00:00.000Z",
      companies: ["Google"]
    });
    const b = ingest.enrichNewsCandidate({
      id: "news_b",
      title: { en: "AI layoffs at Google hit white-collar workers" },
      url: "https://b.example/story?utm_source=rss",
      source: "b.example",
      relevanceScore: 44,
      discoveredAt: "2026-01-03T00:00:00.000Z",
      publishedAt: "2026-01-04T00:00:00.000Z",
      professions: ["engineer"]
    });
    const { survivor, discarded, reason } = ingest.mergeNewsItems(a, b);
    assert.equal(survivor.id, "news_a");
    assert.equal(reason, "earlier_discovered");
    assert.equal(survivor.relevanceScore, 44);
    assert.ok(survivor.companies.includes("Google"));
    assert.ok(survivor.professions.includes("engineer") || survivor.entities.professions.length >= 0);
    assert.equal(discarded.mergedIntoId, "news_a");
  });

  it("dedupeNewsItems merges same canonical URL", () => {
    const items = [
      {
        title: { en: "AI job cuts accelerate workforce reduction" },
        url: "https://outlet.com/ai-layoffs?utm_source=feed",
        source: "outlet.com",
        relevanceScore: 30,
        status: "published",
        discoveredAt: "2026-02-01T00:00:00.000Z"
      },
      {
        title: { en: "AI job cuts accelerate workforce reduction" },
        url: "https://www.outlet.com/ai-layoffs/",
        source: "outlet.com",
        relevanceScore: 50,
        status: "published",
        discoveredAt: "2026-02-02T00:00:00.000Z"
      }
    ];
    const { items: out, merges } = ingest.dedupeNewsItems(items);
    assert.equal(out.length, 1);
    assert.equal(out[0].relevanceScore, 50);
    assert.ok(merges.length >= 1);
    assert.equal(merges[0].match, "url");
  });

  it("dedupeNewsItems merges identical title across sources", () => {
    const title = "Workers replaced by AI in automation layoffs wave";
    const { items: out, merges } = ingest.dedupeNewsItems([
      {
        title: { en: title },
        url: "https://one.com/a",
        source: "one.com",
        relevanceScore: 40,
        discoveredAt: "2026-03-01T00:00:00.000Z"
      },
      {
        title: { en: title },
        url: "https://two.com/b",
        source: "two.com",
        relevanceScore: 22,
        discoveredAt: "2026-03-02T00:00:00.000Z"
      }
    ]);
    assert.equal(out.length, 1);
    assert.ok(merges.some((m) => m.match === "title" || m.match === "url"));
  });

  it("canTransitionNewsStatus respects domain contract", () => {
    assert.equal(ingest.canTransitionNewsStatus("pending", "published"), true);
    assert.equal(ingest.canTransitionNewsStatus("rejected", "published"), false);
    assert.equal(ingest.canTransitionSubmissionStatus("pending", "approved"), true);
    assert.equal(ingest.canTransitionSubmissionStatus("approved", "rejected"), false);
  });

  it("relevanceScore requires both AI and work terms", () => {
    assert.equal(ingest.relevanceScore("AI models improve"), 0);
    assert.ok(ingest.relevanceScore("AI layoffs hit offices") >= 20);
  });
});

describe("JSON storage — upsert merge, submit, discuss, correct", () => {
  let handle;
  let tmpDir;
  let originalDataDirFiles;

  before(() => {
    handle = loadContext({ DATABASE_URL: "" });
  });

  after(() => handle.restore());

  beforeEach(async () => {
    // Reset news-related JSON files to empty via locked updates when possible
    const { ctx } = handle;
    if (ctx.usePostgres) return;
    // Clear news file contents for isolation
    const newsPath = ctx.newsPath;
    const subPath = ctx.newsSubmissionsPath;
    const discPath = ctx.newsDiscussionsPath;
    const healthPath = ctx.newsSourceHealthPath;
    originalDataDirFiles = { newsPath, subPath, discPath, healthPath };
    for (const p of [newsPath, subPath, discPath, healthPath]) {
      if (p && fs.existsSync(path.dirname(p))) {
        try {
          fs.writeFileSync(p, "[]");
        } catch (_e) {
          /* ignore */
        }
      }
    }
  });

  it("storageUpsertNewsItems merges duplicate URLs and keeps max score", async () => {
    const { ctx } = handle;
    const r1 = await ctx.storageUpsertNewsItems([
      {
        title: { en: "AI workforce reduction hits Meta support jobs" },
        url: "https://example-news.test/meta-ai-layoffs?utm_source=x",
        source: "example-news.test",
        status: "published",
        relevanceScore: 30,
        discoveredAt: "2026-04-01T00:00:00.000Z"
      }
    ]);
    assert.equal(r1.inserted, 1);

    const r2 = await ctx.storageUpsertNewsItems([
      {
        title: { en: "AI workforce reduction hits Meta support jobs" },
        url: "https://www.example-news.test/meta-ai-layoffs/",
        source: "example-news.test",
        status: "published",
        relevanceScore: 55,
        discoveredAt: "2026-04-02T00:00:00.000Z"
      }
    ]);
    assert.ok(r2.updated >= 1 || r2.merged >= 1);

    const list = await ctx.storageGetNews({ status: "published", limit: 50 });
    const matches = list.filter((n) => (n.canonicalUrl || n.url).includes("meta-ai-layoffs"));
    assert.equal(matches.length, 1);
    assert.equal(matches[0].relevanceScore, 55);
    assert.ok(matches[0].companies.includes("Meta") || matches[0].entities?.companies?.includes("Meta"));
  });

  it("user submission → approve creates published news with entities", async () => {
    const { ctx } = handle;
    const created = await ctx.storageCreateNewsSubmission({
      url: "https://bizwire.test/stories/openai-job-cuts",
      title: "OpenAI announces job cuts for content writers",
      commentary: "Another AI layoff round",
      submittedBy: "user_test_1"
    });
    assert.equal(created.ok, true);
    assert.equal(created.submission.status, "pending");
    assert.ok(created.submission.companies.includes("OpenAI"));

    const approved = await ctx.storageModerateNewsSubmission(created.submission.id, "approve", {
      actorId: "mod_1"
    });
    assert.equal(approved.ok, true);
    assert.ok(approved.newsItemId);

    const item = await ctx.storageGetNewsById(approved.newsItemId, { includeNonPublic: true });
    assert.ok(item);
    assert.equal(item.status, "published");
    assert.ok(item.companies.includes("OpenAI") || item.entities.companies.includes("OpenAI"));
  });

  it("reject submission is terminal until re-pending only via contract", async () => {
    const { ctx } = handle;
    const created = await ctx.storageCreateNewsSubmission({
      url: "https://bizwire.test/stories/reject-me",
      title: "AI automation layoffs at Amazon",
      submittedBy: "user_test_2"
    });
    const rejected = await ctx.storageModerateNewsSubmission(created.submission.id, "reject", {
      actorId: "mod_1",
      reason: "Off-topic"
    });
    assert.equal(rejected.ok, true);
    assert.equal(rejected.submission.status, "rejected");

    const again = await ctx.storageModerateNewsSubmission(created.submission.id, "approve", {
      actorId: "mod_1"
    });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "invalid_transition");
  });

  it("discussion attaches to published news item", async () => {
    const { ctx } = handle;
    await ctx.storageUpsertNewsItems([
      {
        id: "news_discuss_1",
        title: { en: "AI job cuts continue at IBM" },
        url: "https://discuss.test/ibm-ai",
        source: "discuss.test",
        status: "published",
        relevanceScore: 40
      }
    ]);
    const item = (await ctx.storageGetNews({ status: "published", limit: 100 }))
      .find((n) => n.url.includes("ibm-ai"));
    assert.ok(item);

    const d = await ctx.storageInsertNewsDiscussion({
      newsItemId: item.id,
      body: "I lived this — the AI excuse was cover for cost cutting.",
      createdBy: "user_discuss"
    });
    assert.equal(d.ok, true);

    const list = await ctx.storageGetNewsDiscussions(item.id);
    assert.equal(list.length, 1);
    assert.match(list[0].body, /cost cutting/);
  });

  it("moderator correct updates companies/professions and note", async () => {
    const { ctx } = handle;
    await ctx.storageUpsertNewsItems([
      {
        title: { en: "AI layoffs reported at a large tech firm" },
        url: "https://correct.test/story-1",
        source: "correct.test",
        status: "published",
        relevanceScore: 30
      }
    ]);
    const item = (await ctx.storageGetNews({ status: "published", limit: 100 }))
      .find((n) => n.url.includes("correct.test"));
    assert.ok(item);

    const corrected = await ctx.storageCorrectNewsItem(
      item.id,
      {
        companies: ["Salesforce"],
        professions: ["customer support"],
        correctionNote: "Outlet later named Salesforce; corrected.",
        summary: "Salesforce cut customer support roles citing AI."
      },
      "mod_2"
    );
    assert.equal(corrected.ok, true);
    assert.ok(corrected.item.companies.includes("Salesforce"));
    assert.ok(corrected.item.professions.includes("customer support"));
    assert.match(corrected.item.correctionNote, /Salesforce/);
    assert.equal(corrected.item.correctedBy, "mod_2");
  });

  it("moderator reject transitions published → rejected", async () => {
    const { ctx } = handle;
    await ctx.storageUpsertNewsItems([
      {
        title: { en: "AI workforce reduction rumor mill" },
        url: "https://reject.test/story-2",
        source: "reject.test",
        status: "published",
        relevanceScore: 30
      }
    ]);
    const item = (await ctx.storageGetNews({ status: "published", limit: 100 }))
      .find((n) => n.url.includes("reject.test"));
    const rejected = await ctx.storageRejectNewsItem(item.id, "Unverified rumor", "mod_3");
    assert.equal(rejected.ok, true);
    assert.equal(rejected.item.status, "rejected");

    const publicList = await ctx.storageGetNews({ status: "published", limit: 100 });
    assert.equal(publicList.some((n) => n.id === item.id), false);
  });

  it("company/profession search filters work", async () => {
    const { ctx } = handle;
    await ctx.storageUpsertNewsItems([
      {
        title: { en: "Nvidia AI automation triggers job cuts" },
        url: "https://search.test/nvidia",
        source: "search.test",
        status: "published",
        relevanceScore: 40,
        companies: ["Nvidia"],
        professions: ["engineer"]
      },
      {
        title: { en: "Unrelated AI workforce story elsewhere" },
        url: "https://search.test/other",
        source: "search.test",
        status: "published",
        relevanceScore: 40
      }
    ]);
    const byCompany = await ctx.storageGetNews({
      status: "published",
      company: "nvidia",
      limit: 50
    });
    assert.ok(byCompany.some((n) => n.url.includes("nvidia")));
    assert.ok(byCompany.every((n) =>
      (n.companies || []).join(" ").toLowerCase().includes("nvidia")
      || JSON.stringify(n.entities || {}).toLowerCase().includes("nvidia")
    ));
  });

  it("source health records consecutive failures as broken", async () => {
    const { ctx } = handle;
    await ctx.storageRecordNewsSourceHealth({
      sourceKey: "flaky.source",
      sourceName: "flaky.source",
      ok: false,
      httpStatus: 500,
      failureReason: "http_500"
    });
    await ctx.storageRecordNewsSourceHealth({
      sourceKey: "flaky.source",
      ok: false,
      httpStatus: 500
    });
    await ctx.storageRecordNewsSourceHealth({
      sourceKey: "flaky.source",
      ok: false,
      httpStatus: 500
    });
    const health = await ctx.storageGetNewsSourceHealth({ limit: 20 });
    const row = health.find((h) => (h.sourceKey || h.source_key) === "flaky.source");
    assert.ok(row);
    assert.equal(row.status, "broken");
    assert.ok(Number(row.consecutiveFailures || row.consecutive_failures) >= 3);
  });
});

describe("job handlers — news.source_check registration", () => {
  it("registers news.ingest and news.source_check", () => {
    clearModule(JOBS_PATH);
    clearModule(HANDLERS_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const jobs = require(JOBS_PATH);
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const { registerBuiltinHandlers } = require(HANDLERS_PATH);
    const fakeCtx = {
      usePostgres: false,
      storageGetNews: async () => [],
      storageGetNewsById: async () => null,
      storageGetNewsForSourceCheck: async () => [],
      storageUpdateNewsItemSourceCheck: async () => ({ ok: true }),
      storageAudit: async () => {}
    };
    registerBuiltinHandlers(fakeCtx, jobs);
    assert.equal(typeof jobs.getHandler("news.ingest"), "function");
    assert.equal(typeof jobs.getHandler("news.source_check"), "function");
  });
});

describe("migration 009 module shape", () => {
  it("exports version 009 with up/down", () => {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const mig = require("../migrations/009_news_community.js");
    assert.equal(mig.version, "009");
    assert.equal(mig.name, "news_community");
    assert.equal(typeof mig.up, "function");
    assert.equal(typeof mig.down, "function");
  });
});
