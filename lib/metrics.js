/**
 * Lightweight in-process metrics counters for probes and alert hooks.
 * Bead: aitj-z8q.6
 *
 * Not a Prometheus exporter — JSON snapshot at GET /metrics is enough for
 * Coolify/uptime robots and a future scrape adapter.
 */

"use strict";

const { getRelease } = require("./release");

const startedAt = Date.now();

/** @type {Map<string, number>} */
const counters = new Map();

/** @type {Map<string, number>} */
const gauges = new Map();

function inc(name, by = 1) {
  const key = String(name);
  counters.set(key, (counters.get(key) || 0) + Number(by) || 0);
  return counters.get(key);
}

function setGauge(name, value) {
  gauges.set(String(name), Number(value));
  return gauges.get(String(name));
}

function getCounter(name) {
  return counters.get(String(name)) || 0;
}

/**
 * Snapshot suitable for HTTP /metrics and alert evaluation.
 */
function snapshot() {
  const counterObj = {};
  for (const [k, v] of counters.entries()) counterObj[k] = v;
  const gaugeObj = {};
  for (const [k, v] of gauges.entries()) gaugeObj[k] = v;
  const mem = process.memoryUsage();
  return {
    ok: true,
    release: getRelease(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    pid: process.pid,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external
    },
    counters: counterObj,
    gauges: gaugeObj,
    timestamp: new Date().toISOString()
  };
}

/** Reset all counters/gauges (tests only). */
function reset() {
  counters.clear();
  gauges.clear();
}

module.exports = {
  inc,
  setGauge,
  getCounter,
  snapshot,
  reset
};
