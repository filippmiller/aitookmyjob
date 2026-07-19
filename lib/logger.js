/**
 * Structured JSON logger with secret/PII redaction.
 * Bead: aitj-z8q.6
 *
 * Usage:
 *   const log = require("./logger");
 *   log.info("boot", { port: 8080 });
 *   const reqLog = log.child({ requestId: req.id });
 *   reqLog.warn("slow_request", { durationMs: 1200 });
 */

"use strict";

const REDACT = "[REDACTED]";

/** Keys (case-insensitive) whose values are always redacted. */
const SENSITIVE_KEY_RE =
  /^(password|passwd|pwd|secret|token|api[_-]?key|authorization|auth|cookie|set-cookie|csrf|session|otp|code|phone|email|ssn|credit[_-]?card|card[_-]?number|cvv|private[_-]?key|access[_-]?token|refresh[_-]?token|bearer|database_url|connection[_-]?string)$/i;

/** Substring patterns that look like secrets in free-form strings. */
const SECRET_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\b(sk|pk|rk|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{10,}/gi,
  /postgres(ql)?:\/\/[^\s"']+/gi,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b\+?\d{1,3}[-.\s]?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g
];

/**
 * Deep-redact objects/arrays. Primitives that match secret patterns are scrubbed.
 * @param {*} value
 * @param {number} [depth]
 * @returns {*}
 */
function redact(value, depth = 0) {
  if (depth > 8) return "[MaxDepth]";
  if (value == null) return value;
  if (typeof value === "string") {
    let out = value;
    for (const re of SECRET_VALUE_PATTERNS) {
      out = out.replace(re, REDACT);
    }
    return out;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redact(String(value.message), depth + 1),
      stack: process.env.NODE_ENV === "production" ? undefined : redact(String(value.stack || ""), depth + 1)
    };
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = REDACT;
      } else {
        out[k] = redact(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function baseFields(bindings) {
  return {
    ts: new Date().toISOString(),
    service: "aitookmyjob",
    ...bindings
  };
}

function write(level, msg, fields, bindings, stream) {
  const payload = {
    ...baseFields(bindings),
    level,
    msg: typeof msg === "string" ? redact(msg) : String(msg)
  };
  if (fields && typeof fields === "object") {
    Object.assign(payload, redact(fields));
  }
  const line = JSON.stringify(payload);
  (stream || (level === "error" ? process.stderr : process.stdout)).write(line + "\n");
  return payload;
}

function createLogger(bindings = {}) {
  return {
    child(extra = {}) {
      return createLogger({ ...bindings, ...extra });
    },
    debug(msg, fields) {
      if (String(process.env.LOG_LEVEL || "info").toLowerCase() === "debug") {
        return write("debug", msg, fields, bindings);
      }
      return null;
    },
    info(msg, fields) {
      return write("info", msg, fields, bindings);
    },
    warn(msg, fields) {
      return write("warn", msg, fields, bindings);
    },
    error(msg, fields) {
      return write("error", msg, fields, bindings, process.stderr);
    },
    /** console-compatible helpers used by jobs worker loop */
    log(msg, fields) {
      return write("info", msg, fields, bindings);
    }
  };
}

const root = createLogger();

module.exports = {
  REDACT,
  SENSITIVE_KEY_RE,
  redact,
  createLogger,
  child: root.child.bind(root),
  debug: root.debug.bind(root),
  info: root.info.bind(root),
  warn: root.warn.bind(root),
  error: root.error.bind(root),
  log: root.log.bind(root)
};
