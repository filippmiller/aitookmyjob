/**
 * Built-in job type handlers.
 * Kept separate from lib/jobs.js so the queue core stays framework-agnostic.
 *
 * Beads: aitj-z8q.5 (jobs), aitj-z8q.12 (resource.link_check)
 */

"use strict";

const { ingestNews } = require("./news-ingest");
const { RESOURCE_LINK_STATUS } = require("./domain-contract");

/**
 * HEAD/GET a URL and classify link health.
 * Uses undici/global fetch (Node >=18). Never follows to write payloads.
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
    // Some hosts reject HEAD — fall back to GET without body consumption when needed
    if (!res || res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "aitookmyjob-link-check/1.0" }
      });
      try {
        // Drain small body to free the socket; ignore content
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
   * resource.link_check — probe resource URLs and flag broken/stale entries.
   * Payload: { resourceId?, limit?, reason? }
   * Works in JSON fallback and Postgres modes.
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
      if (!resource.url || ctx.isBannedResourceUrl(resource.url)) {
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
}

module.exports = {
  registerBuiltinHandlers,
  probeUrl
};
