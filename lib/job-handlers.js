/**
 * Built-in job type handlers.
 * Kept separate from lib/jobs.js so the queue core stays framework-agnostic.
 *
 * Beads: aitj-z8q.5 (jobs core), aitj-z8q.8 (expression stubs), aitj-z8q.15 (notifications)
 */

"use strict";

const { ingestNews } = require("./news-ingest");
const notifications = require("./notifications");

function notifOptions(ctx) {
  return {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool?.() || null,
    useMemory: !ctx.usePostgres,
    sendTelegram: ctx.sendTelegramMessage
      ? (chatId, text) => ctx.sendTelegramMessage(chatId, text)
      : undefined,
    jobsOptions: {
      usePostgres: ctx.usePostgres,
      getPool: () => ctx.getPgPool?.() || null,
      useMemory: !ctx.usePostgres
    }
  };
}

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
   * Full routing through notification.send preferred when deliveryId present.
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
      reason: "expression lifecycle stub; use notification.send for real delivery",
      at: new Date().toISOString(),
      payloadType: payload.type || null
    };
  });

  /**
   * notification.send — deliver one notification_deliveries row.
   * Payload: { deliveryId }
   */
  register("notification.send", async (payload = {}, meta = {}) => {
    const deliveryId = payload.deliveryId || payload.delivery_id;
    if (!deliveryId) {
      throw new Error("notification.send requires payload.deliveryId");
    }
    const opts = notifOptions(ctx);
    const result = await notifications.deliver(deliveryId, opts);
    if (!result.ok && !result.skipped) {
      if (result.exhausted || result.error === "not_found" || result.error === "missing_recipient_email") {
        throw new Error(result.error || "notification_send_failed");
      }
      throw new Error(result.error || "notification_send_failed");
    }
    try {
      await ctx.storageAudit?.({
        action: "notification.send.job",
        actorId: "system",
        targetType: "notification_delivery",
        targetId: deliveryId,
        metadata: {
          ok: result.ok,
          skipped: Boolean(result.skipped),
          reason: result.reason || null,
          simulated: Boolean(result.simulated),
          status: result.delivery?.status || null,
          provider: result.delivery?.provider || null,
          jobId: meta.job?.id || null
        },
        ip: ""
      });
    } catch (_e) {
      /* audit must not fail delivery */
    }
    return {
      deliveryId,
      ok: result.ok,
      skipped: Boolean(result.skipped),
      reason: result.reason || null,
      status: result.delivery?.status || null,
      provider: result.delivery?.provider || null,
      simulated: Boolean(result.simulated)
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

  /**
   * digest.weekly — fan-out weekly digest to subscribers (enqueues notification.send per recipient).
   * Payload: { windowKey?, reason? }
   */
  register("digest.weekly", async (payload = {}, meta = {}) => {
    const opts = notifOptions(ctx);
    const result = await notifications.runWeeklyDigest(ctx, {
      ...opts,
      windowKey: payload.windowKey || payload.window_key || undefined
    });
    try {
      await ctx.storageAudit?.({
        action: "digest.weekly.job",
        actorId: "system",
        targetType: "subscribers",
        targetId: payload.reason || meta.job?.id || "digest",
        metadata: { ...result, jobId: meta.job?.id || null },
        ip: ""
      });
    } catch (_e) {
      /* ignore */
    }
    return result;
  });
}

module.exports = {
  registerBuiltinHandlers
};
