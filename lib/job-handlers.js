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

  /**
   * notification.expression — stub deliverer for expression lifecycle notifications.
   * Full inbox delivery lands in a later bead; this records audit only.
   */
  register("notification.expression", async (payload = {}, meta = {}) => {
    try {
      await ctx.storageAudit({
        action: "notification.expression.stub",
        actorId: "system",
        targetType: payload.targetType || "expression",
        targetId: payload.targetId || meta.job?.id || "unknown",
        metadata: {
          type: payload.type || null,
          desiredResponse: payload.desiredResponse || null,
          forceAction: Boolean(payload.forceAction),
          recipientId: payload.recipientId || null,
          jobId: meta.job?.id || null
        },
        ip: ""
      });
    } catch (auditErr) {
      console.warn("[job-handlers] notification.expression audit failed:", auditErr.message || auditErr);
    }
    return {
      delivered: false,
      stub: true,
      reason: "notification inbox not yet implemented; enqueued + audited",
      at: new Date().toISOString(),
      payloadType: payload.type || null
    };
  });

  /**
   * analytics.expression — stub sink for expression analytics events.
   */
  register("analytics.expression", async (payload = {}, meta = {}) => {
    try {
      await ctx.storageAudit({
        action: "analytics.expression.stub",
        actorId: "system",
        targetType: payload.kind || "expression",
        targetId: payload.id || meta.job?.id || "unknown",
        metadata: {
          event: payload.event || null,
          publicationIntent: payload.publicationIntent || null,
          status: payload.status || null,
          desiredResponse: payload.desiredResponse || null,
          jobId: meta.job?.id || null
        },
        ip: ""
      });
    } catch (auditErr) {
      console.warn("[job-handlers] analytics.expression audit failed:", auditErr.message || auditErr);
    }
    return {
      recorded: true,
      stub: true,
      event: payload.event || null,
      at: new Date().toISOString()
    };
  });
}

module.exports = {
  registerBuiltinHandlers
};
