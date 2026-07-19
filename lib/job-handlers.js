/**
 * Built-in job type handlers.
 * Kept separate from lib/jobs.js so the queue core stays framework-agnostic.
 *
 * Beads: aitj-z8q.5 jobs, aitj-z8q.8 expression, aitj-z8q.12 resources, aitj-z8q.15 notifications
 */

"use strict";

const { ingestNews } = require("./news-ingest");
const notifications = require("./notifications");
const { RESOURCE_LINK_STATUS, NEWS_SOURCE_STATUS } = require("./domain-contract");

/**
 * HEAD/GET a URL and classify link health (Node >=18 fetch).
 */
async function probeUrl(url, { timeoutMs = 12_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "aitookmyjob-link-check/1.0" }
      });
    } catch (_headErr) {
      res = null;
    }
    if (!res || res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "aitookmyjob-link-check/1.0" }
      });
      try {
        if (res.body && typeof res.body.cancel === "function") await res.body.cancel();
      } catch (_e) {
        /* ignore */
      }
    }
    const httpStatus = res.status;
    if (httpStatus >= 200 && httpStatus < 400) {
      const redirected = Boolean(res.redirected);
      return {
        linkStatus: redirected ? RESOURCE_LINK_STATUS.REDIRECT : RESOURCE_LINK_STATUS.OK,
        linkHttpStatus: httpStatus
      };
    }
    return {
      linkStatus: RESOURCE_LINK_STATUS.BROKEN,
      linkHttpStatus: httpStatus,
      flaggedReason: `http_${httpStatus}`
    };
  } catch (err) {
    return {
      linkStatus: RESOURCE_LINK_STATUS.BROKEN,
      linkHttpStatus: null,
      flaggedReason: err.name === "AbortError" ? "timeout" : "network_error"
    };
  } finally {
    clearTimeout(timer);
  }
}

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

  /**
   * resource.link_check — probe resource URLs and flag broken/stale entries.
   * Payload: { resourceId?, limit?, reason? }
   */
  register("resource.link_check", async (payload = {}, meta = {}) => {
    const limit = Math.min(Math.max(Number(payload.limit || 50), 1), 200);
    let targets;
    if (payload.resourceId) {
      const one = await ctx.storageGetResourceById(payload.resourceId, { includeNonPublic: true });
      targets = one ? [one] : [];
    } else {
      const all = await ctx.storageGetResources({ includeNonPublic: true });
      targets = all.slice(0, limit);
    }

    const results = [];
    let ok = 0;
    let broken = 0;
    let redirect = 0;
    let skipped = 0;

    for (const resource of targets) {
      if (!resource.url || ctx.isBannedResourceUrl?.(resource.url)) {
        await ctx.storageUpdateResourceLinkCheck(resource.id, {
          linkStatus: RESOURCE_LINK_STATUS.BROKEN,
          linkHttpStatus: null,
          flaggedReason: "banned_or_invalid_url"
        });
        broken += 1;
        results.push({ id: resource.id, linkStatus: "broken", reason: "banned_or_invalid_url" });
        continue;
      }
      const probe = await probeUrl(resource.url);
      await ctx.storageUpdateResourceLinkCheck(resource.id, {
        linkStatus: probe.linkStatus,
        linkHttpStatus: probe.linkHttpStatus,
        flaggedReason: probe.flaggedReason || ""
      });
      if (probe.linkStatus === RESOURCE_LINK_STATUS.OK) ok += 1;
      else if (probe.linkStatus === RESOURCE_LINK_STATUS.REDIRECT) redirect += 1;
      else if (probe.linkStatus === RESOURCE_LINK_STATUS.BROKEN) broken += 1;
      else skipped += 1;
      results.push({
        id: resource.id,
        linkStatus: probe.linkStatus,
        httpStatus: probe.linkHttpStatus,
        reason: probe.flaggedReason || null
      });
    }

    const summary = {
      checked: targets.length,
      ok,
      broken,
      redirect,
      skipped,
      reason: payload.reason || null,
      jobId: meta.job?.id || null,
      results
    };

    try {
      await ctx.storageAudit({
        action: "resource.link_check.job",
        actorId: "system",
        targetType: "resources",
        targetId: payload.resourceId || "batch",
        metadata: {
          checked: summary.checked,
          ok: summary.ok,
          broken: summary.broken,
          redirect: summary.redirect,
          jobId: summary.jobId
        },
        ip: ""
      });
    } catch (auditErr) {
      console.warn("[job-handlers] resource.link_check audit failed:", auditErr.message || auditErr);
    }

    return summary;
  });

  /**
   * news.source_check — probe news article URLs and update source_status.
   * Payload: { newsId?, limit?, reason? }
   */
  register("news.source_check", async (payload = {}, meta = {}) => {
    const limit = Math.min(Math.max(Number(payload.limit || 50), 1), 200);
    let targets;
    if (payload.newsId || payload.news_id) {
      const one = await ctx.storageGetNewsById(payload.newsId || payload.news_id, {
        includeNonPublic: true
      });
      targets = one ? [one] : [];
    } else if (typeof ctx.storageGetNewsForSourceCheck === "function") {
      targets = await ctx.storageGetNewsForSourceCheck({ limit });
    } else {
      targets = await ctx.storageGetNews({ status: "published", limit });
    }

    let ok = 0;
    let broken = 0;
    let stale = 0;
    let skipped = 0;
    const results = [];

    for (const item of targets) {
      if (!item?.url) {
        skipped += 1;
        continue;
      }
      const probe = await probeUrl(item.url);
      const mapped =
        probe.linkStatus === RESOURCE_LINK_STATUS.OK
          ? NEWS_SOURCE_STATUS.OK
          : probe.linkStatus === RESOURCE_LINK_STATUS.REDIRECT
            ? NEWS_SOURCE_STATUS.STALE
            : NEWS_SOURCE_STATUS.BROKEN;
      if (typeof ctx.storageUpdateNewsItemSourceCheck === "function") {
        await ctx.storageUpdateNewsItemSourceCheck(item.id, {
          linkStatus: mapped,
          linkHttpStatus: probe.linkHttpStatus,
          flaggedReason: probe.flaggedReason || ""
        });
      }
      if (mapped === NEWS_SOURCE_STATUS.OK) ok += 1;
      else if (mapped === NEWS_SOURCE_STATUS.STALE) stale += 1;
      else if (mapped === NEWS_SOURCE_STATUS.BROKEN) broken += 1;
      else skipped += 1;
      results.push({
        id: item.id,
        sourceStatus: mapped,
        httpStatus: probe.linkHttpStatus,
        reason: probe.flaggedReason || null
      });
    }

    const summary = {
      checked: targets.length,
      ok,
      broken,
      stale,
      skipped,
      reason: payload.reason || null,
      jobId: meta.job?.id || null,
      results
    };

    try {
      await ctx.storageAudit({
        action: "news.source_check.job",
        actorId: "system",
        targetType: "news_items",
        targetId: payload.newsId || payload.news_id || "batch",
        metadata: {
          checked: summary.checked,
          ok: summary.ok,
          broken: summary.broken,
          stale: summary.stale,
          jobId: summary.jobId
        },
        ip: ""
      });
    } catch (auditErr) {
      console.warn("[job-handlers] news.source_check audit failed:", auditErr.message || auditErr);
    }

    return summary;
  });
}

module.exports = {
  registerBuiltinHandlers,
  probeUrl
};
