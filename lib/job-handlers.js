/**
 * Built-in job type handlers.
 * Kept separate from lib/jobs.js so the queue core stays framework-agnostic.
 *
 * Bead: aitj-z8q.5
 */

"use strict";

const { ingestNews } = require("./news-ingest");

/**
 * Register product job handlers on the jobs module.
 * @param {object} ctx - app context (storage, audit, …)
 * @param {object} jobsModule - require('./jobs')
 */
function registerBuiltinHandlers(ctx, jobsModule) {
  const register = jobsModule.registerHandler.bind(jobsModule);

  /**
   * news.ingest — fetch GDELT + RSS and upsert news_items.
   * Payload: { daysBack?, maxRecords?, reason? }
   */
  register("news.ingest", async (payload = {}, meta = {}) => {
    if (!ctx.usePostgres) {
      return { skipped: true, reason: "news.ingest requires DATABASE_URL / postgres" };
    }
    const result = await ingestNews(ctx, {
      daysBack: Number(payload.daysBack || process.env.NEWS_INGEST_DAYS_BACK || 14),
      maxRecords: Number(payload.maxRecords || process.env.NEWS_INGEST_MAX_RECORDS || 25)
    });
    try {
      await ctx.storageAudit({
        action: "news.ingest.job",
        actorId: "system",
        targetType: "news_items",
        targetId: payload.reason || meta.job?.id || "job",
        metadata: { ...result, jobId: meta.job?.id || null },
        ip: ""
      });
    } catch (auditErr) {
      // Audit failure should not fail the job effect (ingest already applied)
      console.warn("[job-handlers] news.ingest audit failed:", auditErr.message || auditErr);
    }
    return result;
  });

  /**
   * jobs.ping — health/example job; no side effects beyond returning timestamps.
   */
  register("jobs.ping", async (payload = {}) => {
    return {
      pong: true,
      at: new Date().toISOString(),
      echo: payload.echo ?? null
    };
  });
}

module.exports = {
  registerBuiltinHandlers
};
