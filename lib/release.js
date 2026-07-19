/**
 * Release / build metadata for health probes and metrics.
 * Bead: aitj-z8q.6
 */

"use strict";

const path = require("path");

let cached = null;

function readPackageVersion() {
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    const pkg = require(path.join(__dirname, "..", "package.json"));
    return String(pkg.version || "0.0.0");
  } catch (_err) {
    return "0.0.0";
  }
}

/**
 * @returns {{
 *   service: string,
 *   version: string,
 *   gitSha: string,
 *   node: string,
 *   env: string
 * }}
 */
function getRelease() {
  if (cached) return cached;
  const gitSha =
    process.env.GIT_SHA ||
    process.env.SOURCE_COMMIT ||
    process.env.COOLIFY_COMMIT ||
    process.env.COMMIT_SHA ||
    "unknown";
  cached = Object.freeze({
    service: "aitookmyjob",
    version: process.env.RELEASE_VERSION || readPackageVersion(),
    gitSha: String(gitSha).slice(0, 40),
    node: process.version,
    env: process.env.NODE_ENV || "development"
  });
  return cached;
}

/** Test helper — clear memoization. */
function resetReleaseCache() {
  cached = null;
}

module.exports = {
  getRelease,
  resetReleaseCache
};
