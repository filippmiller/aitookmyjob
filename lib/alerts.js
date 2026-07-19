/**
 * Alert webhook stub — fire-and-forget HTTP POST when ALERT_WEBHOOK_URL is set.
 * Bead: aitj-z8q.6
 *
 * Covers: availability, DB, job failures. No external service required;
 * when URL is unset, alerts are structured-logged only.
 */

"use strict";

const logger = require("./logger");
const metrics = require("./metrics");
const { getRelease } = require("./release");

const DEDUPE_MS = Math.max(5_000, Number(process.env.ALERT_DEDUPE_MS || 60_000));

/** @type {Map<string, number>} last fire timestamp by fingerprint */
const lastFired = new Map();

/**
 * @param {{
 *   severity?: 'info'|'warning'|'critical',
 *   type: string,
 *   message: string,
 *   details?: object
 * }} alert
 * @returns {Promise<{ sent: boolean, skipped?: string }>}
 */
async function notify(alert) {
  const severity = alert.severity || "warning";
  const type = String(alert.type || "unknown");
  const message = String(alert.message || type);
  const fingerprint = `${severity}:${type}:${message}`;
  const now = Date.now();
  const prev = lastFired.get(fingerprint) || 0;
  if (now - prev < DEDUPE_MS) {
    return { sent: false, skipped: "deduped" };
  }
  lastFired.set(fingerprint, now);
  metrics.inc("alerts_total");
  metrics.inc(`alerts_${severity}`);

  const body = {
    service: "aitookmyjob",
    severity,
    type,
    message,
    details: alert.details || {},
    release: getRelease(),
    timestamp: new Date().toISOString()
  };

  logger.warn("alert", {
    alertType: type,
    severity,
    message,
    details: alert.details || {}
  });

  const url = process.env.ALERT_WEBHOOK_URL || "";
  if (!url) {
    return { sent: false, skipped: "no_webhook" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "aitookmyjob-alerts/1" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Number(process.env.ALERT_WEBHOOK_TIMEOUT_MS || 5000))
    });
    if (!res.ok) {
      logger.error("alert_webhook_failed", { status: res.status, alertType: type });
      metrics.inc("alerts_webhook_errors");
      return { sent: false, skipped: `http_${res.status}` };
    }
    metrics.inc("alerts_webhook_ok");
    return { sent: true };
  } catch (err) {
    logger.error("alert_webhook_error", {
      alertType: type,
      error: err instanceof Error ? err.message : String(err)
    });
    metrics.inc("alerts_webhook_errors");
    return { sent: false, skipped: "network" };
  }
}

function resetDedupe() {
  lastFired.clear();
}

module.exports = {
  notify,
  resetDedupe,
  DEDUPE_MS
};
