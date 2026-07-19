/**
 * Product analytics, funnels, outcomes, and privacy-safe public aggregates.
 *
 * - Events are documented, deduplicated, and tagged seed/test vs real.
 * - Public aggregates apply k-anonymity suppression (default k=5).
 * - Deletion cascade removes or anonymizes analytics for a user.
 *
 * Bead: aitj-z8q.18
 */

"use strict";

const { customAlphabet } = require("nanoid");
const metrics = require("./metrics");

const idGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 16);

/** North-star + safety event catalog (document for product/ops). */
const EVENT_NAMES = Object.freeze({
  // Activation
  SESSION_START: "session.start",
  AUTH_REGISTER: "auth.register",
  AUTH_LOGIN: "auth.login",
  // Expression funnel
  EXPRESSION_DRAFT_SAVED: "expression.draft_saved",
  EXPRESSION_PREVIEWED: "expression.previewed",
  EXPRESSION_SUBMITTED: "expression.submitted",
  EXPRESSION_PUBLISHED: "expression.published",
  EXPRESSION_EDITED: "expression.edited",
  EXPRESSION_DELETED: "expression.deleted",
  EXPRESSION_REPORTED: "expression.reported",
  EXPRESSION_FOLLOW_UP: "expression.follow_up",
  // Support / social
  SUPPORT_REACT: "support.react",
  SUPPORT_COMMENT: "support.comment",
  SUPPORT_FOLLOW: "support.follow",
  // Useful actions
  RESOURCE_OPEN: "resource.open",
  RESOURCE_SAVE: "resource.save",
  OPPORTUNITY_OPEN: "opportunity.open",
  // Cohorts
  COHORT_JOIN: "cohort.join",
  COHORT_EVENT_RSVP: "cohort.event_rsvp",
  // Recovery outcomes
  OUTCOME_FOUND_JOB: "outcome.found_job",
  OUTCOME_PIVOTED: "outcome.pivoted",
  OUTCOME_STILL_SEARCHING: "outcome.still_searching",
  // Safety
  SAFETY_REPORT: "safety.report",
  SAFETY_CRISIS_VIEW: "safety.crisis_view"
});

const FUNNELS = Object.freeze({
  activation: Object.freeze([
    EVENT_NAMES.SESSION_START,
    EVENT_NAMES.AUTH_REGISTER,
    EVENT_NAMES.EXPRESSION_SUBMITTED
  ]),
  expression: Object.freeze([
    EVENT_NAMES.EXPRESSION_DRAFT_SAVED,
    EVENT_NAMES.EXPRESSION_PREVIEWED,
    EVENT_NAMES.EXPRESSION_SUBMITTED,
    EVENT_NAMES.EXPRESSION_PUBLISHED
  ]),
  support: Object.freeze([
    EVENT_NAMES.SUPPORT_REACT,
    EVENT_NAMES.SUPPORT_COMMENT,
    EVENT_NAMES.SUPPORT_FOLLOW
  ]),
  recovery: Object.freeze([
    EVENT_NAMES.EXPRESSION_PUBLISHED,
    EVENT_NAMES.RESOURCE_OPEN,
    EVENT_NAMES.COHORT_JOIN,
    EVENT_NAMES.OUTCOME_FOUND_JOB
  ])
});

const DEFAULT_K = 5;
const MAX_PROPS_KEYS = 24;
const MAX_PROP_LEN = 200;

// ── Memory store (dev without DATABASE_URL) ──────────────────────────────────

const memory = {
  events: []
};

function memoryReset() {
  memory.events = [];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function nowIso() {
  return new Date().toISOString();
}

function usePg(options = {}) {
  return Boolean(options.usePostgres && options.getPool);
}

function getPoolOrThrow(options) {
  const pool = options.getPool?.();
  if (!pool) throw new Error("analytics requires getPool when usePostgres is true");
  return pool;
}

function sanitizeProps(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(input)) {
    if (n >= MAX_PROPS_KEYS) break;
    const key = String(k).slice(0, 64);
    // Drop obvious PII keys
    if (/email|password|phone|token|secret|ip|ssn|address/i.test(key)) continue;
    if (v == null) continue;
    if (typeof v === "string") out[key] = v.slice(0, MAX_PROP_LEN);
    else if (typeof v === "number" || typeof v === "boolean") out[key] = v;
    else if (typeof v === "object") {
      try {
        out[key] = JSON.parse(JSON.stringify(v));
      } catch (_e) {
        /* skip */
      }
    }
    n += 1;
  }
  return out;
}

function normalizeEventName(name) {
  return String(name || "").trim().slice(0, 120);
}

function isKnownEvent(name) {
  return Object.values(EVENT_NAMES).includes(name);
}

/**
 * Map expression analytics job payload → canonical event name.
 */
function mapExpressionJobEvent(payload = {}) {
  const raw = String(payload.event || "").trim();
  if (Object.values(EVENT_NAMES).includes(raw)) return raw;
  // expression.js ANALYTICS_EVENTS already use expression.* names
  if (raw.startsWith("expression.")) return raw;
  return EVENT_NAMES.EXPRESSION_SUBMITTED;
}

function rowToEvent(r) {
  if (!r) return null;
  return {
    id: r.id,
    eventName: r.event_name || r.eventName,
    eventAt: r.event_at instanceof Date ? r.event_at.toISOString() : r.eventAt || r.event_at,
    userId: r.user_id ?? r.userId ?? null,
    sessionId: r.session_id ?? r.sessionId ?? null,
    anonymousId: r.anonymous_id ?? r.anonymousId ?? null,
    subjectType: r.subject_type ?? r.subjectType ?? null,
    subjectId: r.subject_id ?? r.subjectId ?? null,
    country: r.country || null,
    language: r.language || null,
    properties: r.properties || {},
    isSeed: Boolean(r.is_seed ?? r.isSeed),
    isTest: Boolean(r.is_test ?? r.isTest),
    dedupeKey: r.dedupe_key ?? r.dedupeKey ?? null,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.createdAt || r.created_at
  };
}

// ── Track ────────────────────────────────────────────────────────────────────

/**
 * Record a product analytics event.
 * @returns {{ event, created: boolean }} created=false when dedupe hit
 */
async function track(input = {}, options = {}) {
  const eventName = normalizeEventName(input.eventName || input.event);
  if (!eventName) throw new Error("track requires eventName");

  const eventAt = input.eventAt || input.at || nowIso();
  const properties = sanitizeProps(input.properties || input.props || {});
  const isSeed = Boolean(input.isSeed || properties.isSeed);
  const isTest = Boolean(input.isTest || properties.isTest || process.env.ANALYTICS_FORCE_TEST === "1");
  delete properties.isSeed;
  delete properties.isTest;

  const dedupeKey = input.dedupeKey
    ? String(input.dedupeKey).slice(0, 200)
    : null;

  const record = {
    id: input.id || `ae_${idGen()}`,
    eventName,
    eventAt,
    userId: input.userId || null,
    sessionId: input.sessionId || null,
    anonymousId: input.anonymousId || null,
    subjectType: input.subjectType || input.kind || null,
    subjectId: input.subjectId || input.id_subject || input.targetId || null,
    // Prefer explicit subjectId over payload.id which may be the event id
    country: input.country ? String(input.country).slice(0, 16) : null,
    language: input.language ? String(input.language).slice(0, 8) : null,
    properties,
    isSeed,
    isTest,
    dedupeKey,
    createdAt: nowIso()
  };

  // Fix subjectId when caller passed expression record id via subjectId/targetId
  if (input.subjectId) record.subjectId = String(input.subjectId).slice(0, 64);
  else if (input.targetId) record.subjectId = String(input.targetId).slice(0, 64);
  else if (input.recordId) record.subjectId = String(input.recordId).slice(0, 64);

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    try {
      const res = await pool.query(
        `INSERT INTO analytics_events (
           id, event_name, event_at, user_id, session_id, anonymous_id,
           subject_type, subject_id, country, language, properties,
           is_seed, is_test, dedupe_key, created_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15
         )
         ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
         RETURNING *;`,
        [
          record.id,
          record.eventName,
          record.eventAt,
          record.userId,
          record.sessionId,
          record.anonymousId,
          record.subjectType,
          record.subjectId,
          record.country,
          record.language,
          JSON.stringify(record.properties),
          record.isSeed,
          record.isTest,
          record.dedupeKey,
          record.createdAt
        ]
      );
      if (!res.rows.length) {
        metrics.inc("analytics.deduped");
        return { event: record, created: false };
      }
      metrics.inc("analytics.tracked");
      return { event: rowToEvent(res.rows[0]), created: true };
    } catch (err) {
      // Unique partial index name may differ; also handle plain unique on dedupe
      if (err && (err.code === "23505" || /duplicate/i.test(err.message || ""))) {
        metrics.inc("analytics.deduped");
        return { event: record, created: false };
      }
      throw err;
    }
  }

  if (dedupeKey) {
    const existing = memory.events.find((e) => e.dedupeKey === dedupeKey);
    if (existing) {
      metrics.inc("analytics.deduped");
      return { event: existing, created: false };
    }
  }
  memory.events.push(record);
  metrics.inc("analytics.tracked");
  return { event: record, created: true };
}

/**
 * Handle analytics.expression job payload.
 */
async function recordExpressionJob(payload = {}, meta = {}, options = {}) {
  const eventName = mapExpressionJobEvent(payload);
  const subjectId = payload.id || payload.subjectId || null;
  const dedupeKey =
    payload.dedupeKey ||
    (subjectId
      ? `expr:${eventName}:${subjectId}:${payload.status || ""}`
      : null);

  return track(
    {
      eventName,
      eventAt: payload.at || nowIso(),
      userId: payload.userId || payload.submittedBy || null,
      subjectType: payload.kind || payload.subjectType || "expression",
      subjectId,
      country: payload.country || null,
      language: payload.language || null,
      properties: {
        publicationIntent: payload.publicationIntent || null,
        status: payload.status || null,
        desiredResponse: payload.desiredResponse || null,
        jobId: meta.job?.id || null
      },
      isSeed: Boolean(payload.isSeed),
      isTest: Boolean(payload.isTest),
      dedupeKey
    },
    options
  );
}

// ── Query ────────────────────────────────────────────────────────────────────

function applyAudienceFilter(events, { includeSeed = false, includeTest = false } = {}) {
  return events.filter((e) => {
    if (!includeSeed && e.isSeed) return false;
    if (!includeTest && e.isTest) return false;
    return true;
  });
}

async function listEvents(filters = {}, options = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const includeSeed = Boolean(filters.includeSeed);
  const includeTest = Boolean(filters.includeTest);
  const eventName = filters.eventName ? normalizeEventName(filters.eventName) : null;
  const userId = filters.userId || null;

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const clauses = [];
    const params = [];
    let i = 1;
    if (eventName) {
      clauses.push(`event_name = $${i++}`);
      params.push(eventName);
    }
    if (userId) {
      clauses.push(`user_id = $${i++}`);
      params.push(userId);
    }
    if (!includeSeed) clauses.push("is_seed = false");
    if (!includeTest) clauses.push("is_test = false");
    if (filters.from) {
      clauses.push(`event_at >= $${i++}`);
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push(`event_at <= $${i++}`);
      params.push(filters.to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(limit);
    const res = await pool.query(
      `SELECT * FROM analytics_events ${where}
       ORDER BY event_at DESC LIMIT $${i}`,
      params
    );
    return res.rows.map(rowToEvent);
  }

  let rows = applyAudienceFilter([...memory.events], { includeSeed, includeTest });
  if (eventName) rows = rows.filter((e) => e.eventName === eventName);
  if (userId) rows = rows.filter((e) => e.userId === userId);
  if (filters.from) rows = rows.filter((e) => e.eventAt >= filters.from);
  if (filters.to) rows = rows.filter((e) => e.eventAt <= filters.to);
  rows.sort((a, b) => String(b.eventAt).localeCompare(String(a.eventAt)));
  return rows.slice(0, limit);
}

async function countByEvent(filters = {}, options = {}) {
  const events = await listEvents({ ...filters, limit: 500 }, options);
  // For memory/dev we may need full scan — re-query without tight limit for counts
  let all;
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const clauses = [];
    const params = [];
    let i = 1;
    if (!filters.includeSeed) clauses.push("is_seed = false");
    if (!filters.includeTest) clauses.push("is_test = false");
    if (filters.from) {
      clauses.push(`event_at >= $${i++}`);
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push(`event_at <= $${i++}`);
      params.push(filters.to);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const res = await pool.query(
      `SELECT event_name, COUNT(*)::int AS c
       FROM analytics_events ${where}
       GROUP BY event_name
       ORDER BY c DESC`,
      params
    );
    const map = {};
    for (const r of res.rows) map[r.event_name] = r.c;
    return map;
  }
  all = applyAudienceFilter(memory.events, {
    includeSeed: Boolean(filters.includeSeed),
    includeTest: Boolean(filters.includeTest)
  });
  if (filters.from) all = all.filter((e) => e.eventAt >= filters.from);
  if (filters.to) all = all.filter((e) => e.eventAt <= filters.to);
  const map = {};
  for (const e of all) map[e.eventName] = (map[e.eventName] || 0) + 1;
  return map;
}

// ── Funnels ──────────────────────────────────────────────────────────────────

/**
 * Compute step counts for a named funnel. Distinguishes seed/test totals.
 */
async function funnel(name, filters = {}, options = {}) {
  const steps = FUNNELS[name];
  if (!steps) {
    const err = new Error(`Unknown funnel: ${name}`);
    err.code = "UNKNOWN_FUNNEL";
    throw err;
  }

  const realCounts = await countByEvent({ ...filters, includeSeed: false, includeTest: false }, options);
  const seedCounts = await countByEvent({ ...filters, includeSeed: true, includeTest: true }, options);

  const realSteps = steps.map((eventName) => ({
    eventName,
    count: realCounts[eventName] || 0
  }));
  const seedSteps = steps.map((eventName) => ({
    eventName,
    count: seedCounts[eventName] || 0
  }));

  // Conversion rates relative to first step
  const base = realSteps[0]?.count || 0;
  const conversions = realSteps.map((s, idx) => ({
    eventName: s.eventName,
    count: s.count,
    rateFromStart: base > 0 ? Number((s.count / base).toFixed(4)) : null,
    rateFromPrev:
      idx === 0
        ? 1
        : realSteps[idx - 1].count > 0
          ? Number((s.count / realSteps[idx - 1].count).toFixed(4))
          : null
  }));

  return {
    funnel: name,
    generatedAt: nowIso(),
    audience: {
      real: conversions,
      seedAndTest: seedSteps
    },
    methodology: {
      realExcludes: ["is_seed=true", "is_test=true"],
      note: "Seed/test events are tracked but excluded from product funnels by default."
    }
  };
}

async function listFunnels(filters = {}, options = {}) {
  const names = Object.keys(FUNNELS);
  const out = {};
  for (const n of names) {
    // eslint-disable-next-line no-await-in-loop
    out[n] = await funnel(n, filters, options);
  }
  return { generatedAt: nowIso(), funnels: out };
}

// ── K-anonymity ──────────────────────────────────────────────────────────────

/**
 * Suppress counts below k. Returns null for suppressed values.
 */
function applyKAnonymity(count, k = DEFAULT_K) {
  const n = Number(count) || 0;
  const threshold = Math.max(1, Number(k) || DEFAULT_K);
  if (n > 0 && n < threshold) {
    return { count: null, suppressed: true, reason: `n<${threshold}` };
  }
  return { count: n, suppressed: false, reason: null };
}

/**
 * Filter dimension buckets: drop or suppress those with n < k.
 */
function suppressBuckets(entries, { k = DEFAULT_K, valueKey = "count" } = {}) {
  const threshold = Math.max(1, Number(k) || DEFAULT_K);
  const kept = [];
  let suppressedBuckets = 0;
  let suppressedVolume = 0;
  for (const entry of entries) {
    const n = Number(entry[valueKey]) || 0;
    if (n > 0 && n < threshold) {
      suppressedBuckets += 1;
      suppressedVolume += n;
      continue;
    }
    kept.push({ ...entry, suppressed: false });
  }
  return {
    buckets: kept,
    suppression: {
      k: threshold,
      suppressedBuckets,
      suppressedVolume,
      methodology: `Buckets with 0 < n < ${threshold} are omitted to reduce re-identification risk.`
    }
  };
}

/**
 * Build public research aggregates with k-anonymity on profession/month buckets.
 * @param {object[]} stories — published stories
 */
function publicStoryAggregates(stories = [], { country = "global", k = DEFAULT_K } = {}) {
  const filtered = (stories || []).filter((s) => {
    if (s.status !== "published") return false;
    if (s.isSeed || s.is_seed) return false;
    if (s.isTest || s.is_test) return false;
    if (country !== "global" && s.country !== country) return false;
    return true;
  });

  const byProfession = new Map();
  const byMonth = new Map();
  for (const s of filtered) {
    const prof = String(s.profession || "unknown").trim() || "unknown";
    byProfession.set(prof, (byProfession.get(prof) || 0) + 1);
    const monthKey = String(s.laidOffAt || s.createdAt || "").slice(0, 7) || "unknown";
    byMonth.set(monthKey, (byMonth.get(monthKey) || 0) + 1);
  }

  const profEntries = [...byProfession.entries()]
    .map(([profession, storiesCount]) => ({ profession, storiesCount }))
    .sort((a, b) => b.storiesCount - a.storiesCount);
  const monthEntries = [...byMonth.entries()]
    .map(([month, storiesCount]) => ({ month, storiesCount }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const profSup = suppressBuckets(profEntries, { k, valueKey: "storiesCount" });
  const monthSup = suppressBuckets(monthEntries, { k, valueKey: "storiesCount" });

  // Global total is low-risk (no dimension join). Suppress only cross-tab cells.
  return {
    country,
    generatedAt: nowIso(),
    totalPublishedStories: filtered.length,
    topProfessions: profSup.buckets.slice(0, 20),
    monthlyTrend: monthSup.buckets,
    kAnonymity: {
      k: Math.max(1, Number(k) || DEFAULT_K),
      profession: profSup.suppression,
      monthly: monthSup.suppression
    },
    methodology: {
      seedExcluded: true,
      testExcluded: true,
      suppression: `Profession/month cells with 0 < n < k (k=${Math.max(1, Number(k) || DEFAULT_K)}) are omitted.`,
      limitations: [
        "Self-reported stories may contain uncertainty.",
        "Aggregates are directional, not labor-market census values.",
        "Small cohorts are suppressed to prevent re-identification."
      ]
    }
  };
}

// ── Deletion cascade ─────────────────────────────────────────────────────────

/**
 * Remove analytics rows for a user (GDPR-style). Returns deleted count.
 */
async function deleteUserEvents(userId, options = {}) {
  if (!userId) return { deleted: 0 };
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `DELETE FROM analytics_events WHERE user_id = $1 RETURNING id;`,
      [userId]
    );
    return { deleted: res.rowCount || 0 };
  }
  const before = memory.events.length;
  memory.events = memory.events.filter((e) => e.userId !== userId);
  return { deleted: before - memory.events.length };
}

/**
 * Anonymize subject references when content is anonymized (keep counts, drop user_id).
 */
async function anonymizeUserEvents(userId, options = {}) {
  if (!userId) return { updated: 0 };
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE analytics_events
       SET user_id = NULL,
           properties = properties || '{"anonymized":true}'::jsonb
       WHERE user_id = $1
       RETURNING id;`,
      [userId]
    );
    return { updated: res.rowCount || 0 };
  }
  let updated = 0;
  for (const e of memory.events) {
    if (e.userId === userId) {
      e.userId = null;
      e.properties = { ...e.properties, anonymized: true };
      updated += 1;
    }
  }
  return { updated };
}

function eventCatalog() {
  const eventsByName = {};
  for (const [constName, eventName] of Object.entries(EVENT_NAMES)) {
    eventsByName[eventName] = { constName, eventName };
  }
  return {
    events: eventsByName,
    eventConstants: { ...EVENT_NAMES },
    funnels: Object.fromEntries(
      Object.entries(FUNNELS).map(([k, steps]) => [k, [...steps]])
    ),
    kDefault: DEFAULT_K,
    notes: [
      "North-star: published expression + recovery outcome (found_job / pivoted).",
      "Safety: report and crisis_view events are always real-audience unless is_test.",
      "Dashboards must split real vs seed/test via is_seed / is_test flags."
    ]
  };
}

module.exports = {
  EVENT_NAMES,
  FUNNELS,
  DEFAULT_K,
  track,
  recordExpressionJob,
  listEvents,
  countByEvent,
  funnel,
  listFunnels,
  applyKAnonymity,
  suppressBuckets,
  publicStoryAggregates,
  deleteUserEvents,
  anonymizeUserEvents,
  mapExpressionJobEvent,
  isKnownEvent,
  eventCatalog,
  memoryReset,
  // test helpers
  _memory: memory
};
