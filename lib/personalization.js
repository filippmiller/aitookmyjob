/**
 * Intent-aware feed personalization (aitj-z8q.13).
 *
 * Models consumer intent (only reading → ready to help), ranks feed items
 * with human-readable explanations, keeps expression/support first-class,
 * and never forces career/action content on emotional-support seekers.
 *
 * Dual store: in-memory for unit tests / JSON fallback; PostgreSQL when
 * DATABASE_URL is available (migration 011).
 */

"use strict";

const crypto = require("crypto");
const {
  USER_INTENT,
  USER_INTENT_SOURCE,
  FEED_ITEM_TYPE,
  DESIRED_RESPONSE,
  PUBLICATION_INTENT,
  valuesOf
} = require("./domain-contract");

const feedEventId = () => `fev_${crypto.randomBytes(9).toString("hex")}`;

// ── Intent catalog ──────────────────────────────────────────────────────────

const INTENT_META = Object.freeze({
  [USER_INTENT.ONLY_READING]: Object.freeze({
    id: USER_INTENT.ONLY_READING,
    label: "Only reading",
    description: "Browse quietly. Light mix of stories and news — no pressure to act.",
    allowActionRecs: false,
    supportFirst: true
  }),
  [USER_INTENT.NEED_TO_VENT]: Object.freeze({
    id: USER_INTENT.NEED_TO_VENT,
    label: "Need to vent",
    description: "Emotional support first. Vents and solidarity — no forced career advice.",
    allowActionRecs: false,
    supportFirst: true
  }),
  [USER_INTENT.SEEKING_SIMILAR]: Object.freeze({
    id: USER_INTENT.SEEKING_SIMILAR,
    label: "Seeking similar people",
    description: "Find people in your profession, region, or situation.",
    allowActionRecs: false,
    supportFirst: true
  }),
  [USER_INTENT.GATHERING_INFORMATION]: Object.freeze({
    id: USER_INTENT.GATHERING_INFORMATION,
    label: "Gathering information",
    description: "News, discussions, and verified references — learn before you act.",
    allowActionRecs: false,
    supportFirst: false
  }),
  [USER_INTENT.READY_TO_ACT]: Object.freeze({
    id: USER_INTENT.READY_TO_ACT,
    label: "Ready to act",
    description: "Resources, opportunities, and practical next steps when you want them.",
    allowActionRecs: true,
    supportFirst: false
  }),
  [USER_INTENT.READY_TO_HELP]: Object.freeze({
    id: USER_INTENT.READY_TO_HELP,
    label: "Ready to help",
    description: "Support others who are venting or asking for advice.",
    allowActionRecs: false,
    supportFirst: true
  })
});

/**
 * Base relevance weights by intent × item type.
 * Action types (resource, opportunity, petition) stay near-zero unless ready_to_act.
 */
const INTENT_TYPE_WEIGHTS = Object.freeze({
  [USER_INTENT.ONLY_READING]: Object.freeze({
    vent: 0.55,
    story: 1.0,
    news: 0.95,
    resource: 0.15,
    opportunity: 0.05,
    topic: 0.5,
    group: 0.25,
    petition: 0.1,
    next_step: 0.2
  }),
  [USER_INTENT.NEED_TO_VENT]: Object.freeze({
    vent: 1.2,
    story: 0.9,
    news: 0.25,
    resource: 0.0,
    opportunity: 0.0,
    topic: 0.35,
    group: 0.45,
    petition: 0.0,
    next_step: 0.15
  }),
  [USER_INTENT.SEEKING_SIMILAR]: Object.freeze({
    vent: 0.7,
    story: 1.15,
    news: 0.4,
    resource: 0.2,
    opportunity: 0.1,
    topic: 0.7,
    group: 1.1,
    petition: 0.15,
    next_step: 0.35
  }),
  [USER_INTENT.GATHERING_INFORMATION]: Object.freeze({
    vent: 0.3,
    story: 0.65,
    news: 1.2,
    resource: 0.95,
    opportunity: 0.35,
    topic: 0.9,
    group: 0.3,
    petition: 0.25,
    next_step: 0.5
  }),
  [USER_INTENT.READY_TO_ACT]: Object.freeze({
    vent: 0.25,
    story: 0.55,
    news: 0.5,
    resource: 1.2,
    opportunity: 1.25,
    topic: 0.45,
    group: 0.35,
    petition: 1.0,
    next_step: 1.1
  }),
  [USER_INTENT.READY_TO_HELP]: Object.freeze({
    vent: 1.15,
    story: 1.0,
    news: 0.3,
    resource: 0.15,
    opportunity: 0.05,
    topic: 0.75,
    group: 0.85,
    petition: 0.2,
    next_step: 0.4
  })
});

const ACTION_ITEM_TYPES = Object.freeze([
  FEED_ITEM_TYPE.RESOURCE,
  FEED_ITEM_TYPE.OPPORTUNITY,
  FEED_ITEM_TYPE.PETITION
]);

const SUPPORT_ITEM_TYPES = Object.freeze([
  FEED_ITEM_TYPE.VENT,
  FEED_ITEM_TYPE.STORY,
  FEED_ITEM_TYPE.GROUP
]);

const DEFAULT_ANON_INTENT = USER_INTENT.ONLY_READING;
const DEFAULT_AUTH_INTENT = USER_INTENT.ONLY_READING;

// ── Memory stores ───────────────────────────────────────────────────────────

const memory = {
  /** @type {Map<string, object>} userId -> intent state */
  intentState: new Map(),
  /** @type {Map<string, object>} event id -> feed event */
  feedEvents: new Map()
};

function memoryReset() {
  memory.intentState.clear();
  memory.feedEvents.clear();
}

function nowIso() {
  return new Date().toISOString();
}

// ── Pool helpers ────────────────────────────────────────────────────────────

function resolvePool(options = {}) {
  if (options.pool) return options.pool;
  if (typeof options.getPool === "function") {
    try {
      return options.getPool() || null;
    } catch (_e) {
      return null;
    }
  }
  return null;
}

function usePg(options = {}) {
  if (options.useMemory === true) return false;
  if (options.usePostgres === false) return false;
  const pool = resolvePool(options);
  if (pool) return true;
  if (options.usePostgres === true) return true;
  try {
    // eslint-disable-next-line global-require
    const ctx = require("./context");
    return Boolean(ctx.usePostgres && ctx.getPgPool && ctx.getPgPool());
  } catch (_e) {
    return false;
  }
}

function getPoolOrThrow(options = {}) {
  const pool = resolvePool(options);
  if (pool) return pool;
  // eslint-disable-next-line global-require
  const ctx = require("./context");
  const p = ctx.getPgPool();
  if (!p) throw new Error("PostgreSQL pool not initialized");
  return p;
}

// ── Pure helpers ────────────────────────────────────────────────────────────

function listIntents() {
  return valuesOf(USER_INTENT).map((id) => ({ ...INTENT_META[id] }));
}

function getIntentMeta(intent) {
  return INTENT_META[intent] || null;
}

function isValidIntent(intent) {
  return valuesOf(USER_INTENT).includes(intent);
}

function isActionItemType(type) {
  return ACTION_ITEM_TYPES.includes(type);
}

function isSupportItemType(type) {
  return SUPPORT_ITEM_TYPES.includes(type);
}

/**
 * Whether this intent may surface action recommendations (jobs, resources, petitions).
 * Emotional-support seekers never get forced action recs.
 */
function allowsActionRecommendations(intent) {
  const meta = INTENT_META[intent];
  return Boolean(meta && meta.allowActionRecs);
}

/**
 * Privacy-safe default for anonymous visitors — no PII, no inferred history.
 */
function anonymousFallbackIntent(overrides = {}) {
  const primary =
    overrides.primaryIntent && isValidIntent(overrides.primaryIntent)
      ? overrides.primaryIntent
      : DEFAULT_ANON_INTENT;
  return {
    userId: null,
    primaryIntent: primary,
    secondaryIntents: Array.isArray(overrides.secondaryIntents)
      ? overrides.secondaryIntents.filter(isValidIntent).slice(0, 3)
      : [],
    prefs: sanitizePrefs(overrides.prefs || {}),
    source: USER_INTENT_SOURCE.ANONYMOUS_FALLBACK,
    updatedAt: null,
    createdAt: null,
    anonymous: true
  };
}

function defaultIntentState(userId) {
  const ts = nowIso();
  return {
    userId: userId || null,
    primaryIntent: DEFAULT_AUTH_INTENT,
    secondaryIntents: [],
    prefs: {},
    source: USER_INTENT_SOURCE.DEFAULT,
    updatedAt: ts,
    createdAt: ts,
    anonymous: !userId
  };
}

function sanitizePrefs(prefs = {}) {
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) return {};
  const out = {};
  if (prefs.hideActionContent === true) out.hideActionContent = true;
  if (prefs.preferSupport === true) out.preferSupport = true;
  if (typeof prefs.profession === "string" && prefs.profession.trim()) {
    out.profession = prefs.profession.trim().slice(0, 80);
  }
  if (typeof prefs.region === "string" && prefs.region.trim()) {
    out.region = prefs.region.trim().slice(0, 32).toLowerCase();
  }
  if (typeof prefs.language === "string" && prefs.language.trim()) {
    out.language = prefs.language.trim().slice(0, 12).toLowerCase();
  }
  // Never accept free-form PII blobs into prefs
  return out;
}

/**
 * Normalize PATCH/GET body for intent updates.
 * @returns {{ ok: true, value } | { ok: false, reason, field? }}
 */
function normalizeIntentPatch(body = {}) {
  const rawPrimary =
    body.primaryIntent || body.primary_intent || body.intent || body.userIntent;
  if (rawPrimary != null && rawPrimary !== "") {
    const primary = String(rawPrimary).trim();
    if (!isValidIntent(primary)) {
      return { ok: false, reason: "invalid_intent", field: "primaryIntent" };
    }
  }

  let secondaryIntents;
  const rawSecondary = body.secondaryIntents || body.secondary_intents;
  if (rawSecondary != null) {
    if (!Array.isArray(rawSecondary)) {
      return { ok: false, reason: "invalid_secondary", field: "secondaryIntents" };
    }
    secondaryIntents = [];
    for (const s of rawSecondary) {
      const v = String(s || "").trim();
      if (!isValidIntent(v)) {
        return { ok: false, reason: "invalid_intent", field: "secondaryIntents" };
      }
      if (!secondaryIntents.includes(v)) secondaryIntents.push(v);
    }
    secondaryIntents = secondaryIntents.slice(0, 3);
  }

  const prefs =
    body.prefs != null ? sanitizePrefs(body.prefs) : undefined;

  const primaryIntent =
    rawPrimary != null && rawPrimary !== ""
      ? String(rawPrimary).trim()
      : undefined;

  if (primaryIntent == null && secondaryIntents == null && prefs == null) {
    return { ok: false, reason: "empty_patch" };
  }

  return {
    ok: true,
    value: {
      primaryIntent,
      secondaryIntents,
      prefs,
      source: USER_INTENT_SOURCE.EXPLICIT
    }
  };
}

function mapIntentRow(row) {
  if (!row) return null;
  return {
    userId: row.user_id || row.userId || null,
    primaryIntent: row.primary_intent || row.primaryIntent,
    secondaryIntents: Array.isArray(row.secondary_intents)
      ? row.secondary_intents
      : Array.isArray(row.secondaryIntents)
        ? row.secondaryIntents
        : typeof row.secondary_intents === "string"
          ? safeJsonArray(row.secondary_intents)
          : [],
    prefs:
      row.prefs && typeof row.prefs === "object" && !Array.isArray(row.prefs)
        ? sanitizePrefs(row.prefs)
        : typeof row.prefs === "string"
          ? sanitizePrefs(safeJsonObject(row.prefs))
          : {},
    source: row.source || USER_INTENT_SOURCE.DEFAULT,
    updatedAt: row.updated_at || row.updatedAt || null,
    createdAt: row.created_at || row.createdAt || null,
    anonymous: false
  };
}

function safeJsonArray(s) {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch (_e) {
    return [];
  }
}

function safeJsonObject(s) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch (_e) {
    return {};
  }
}

// ── Intent persistence ──────────────────────────────────────────────────────

/**
 * Get intent for a user. Anonymous → privacy-safe fallback (no DB write).
 */
async function getUserIntent(userId, options = {}) {
  if (!userId) {
    return anonymousFallbackIntent(options.anonOverrides || {});
  }

  if (!usePg(options)) {
    const existing = memory.intentState.get(userId);
    if (existing) return { ...existing, anonymous: false };
    return defaultIntentState(userId);
  }

  const pool = getPoolOrThrow(options);
  const res = await pool.query(
    `SELECT user_id, primary_intent, secondary_intents, prefs, source, updated_at, created_at
     FROM user_intent_state WHERE user_id = $1 LIMIT 1;`,
    [userId]
  );
  if (!res.rows[0]) return defaultIntentState(userId);
  return mapIntentRow(res.rows[0]);
}

/**
 * Create or update intent for an authenticated user.
 */
async function setUserIntent(userId, patch, options = {}) {
  if (!userId) {
    return { ok: false, reason: "auth_required" };
  }
  const normalized = normalizeIntentPatch(patch);
  if (!normalized.ok) return normalized;

  const current = await getUserIntent(userId, options);
  const next = {
    userId,
    primaryIntent: normalized.value.primaryIntent || current.primaryIntent || DEFAULT_AUTH_INTENT,
    secondaryIntents:
      normalized.value.secondaryIntents != null
        ? normalized.value.secondaryIntents
        : current.secondaryIntents || [],
    prefs:
      normalized.value.prefs != null
        ? { ...current.prefs, ...normalized.value.prefs }
        : current.prefs || {},
    source: USER_INTENT_SOURCE.EXPLICIT,
    updatedAt: nowIso(),
    createdAt: current.createdAt || nowIso(),
    anonymous: false
  };

  // Filter primary out of secondary
  next.secondaryIntents = (next.secondaryIntents || []).filter(
    (i) => i !== next.primaryIntent
  );

  if (!usePg(options)) {
    memory.intentState.set(userId, next);
    return { ok: true, state: next };
  }

  const pool = getPoolOrThrow(options);
  await pool.query(
    `INSERT INTO user_intent_state (
      user_id, primary_intent, secondary_intents, prefs, source, updated_at, created_at
    ) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6::timestamptz, $7::timestamptz)
    ON CONFLICT (user_id) DO UPDATE SET
      primary_intent = EXCLUDED.primary_intent,
      secondary_intents = EXCLUDED.secondary_intents,
      prefs = EXCLUDED.prefs,
      source = EXCLUDED.source,
      updated_at = EXCLUDED.updated_at;`,
    [
      userId,
      next.primaryIntent,
      JSON.stringify(next.secondaryIntents),
      JSON.stringify(next.prefs),
      next.source,
      next.updatedAt,
      next.createdAt
    ]
  );

  return { ok: true, state: next };
}

// ── Feed events (optional analytics) ────────────────────────────────────────

async function recordFeedEvent(event, options = {}) {
  const eventType = String(event.eventType || event.event_type || "").trim();
  const allowed = [
    "impression",
    "click",
    "save",
    "hide",
    "dismiss",
    "intent_change"
  ];
  if (!allowed.includes(eventType)) {
    return { ok: false, reason: "invalid_event_type" };
  }

  // Privacy: never store raw IP or email; session_key is opaque if provided
  const row = {
    id: event.id || feedEventId(),
    userId: event.userId || event.user_id || null,
    sessionKey: event.sessionKey || event.session_key || null,
    eventType,
    itemType: String(event.itemType || event.item_type || "").slice(0, 32),
    itemId: String(event.itemId || event.item_id || "").slice(0, 64),
    intentAtTime: event.intentAtTime || event.intent_at_time || null,
    metadata:
      event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
        ? event.metadata
        : {},
    createdAt: nowIso()
  };

  // Strip accidental PII keys from metadata
  for (const key of ["email", "phone", "ip", "password", "token"]) {
    delete row.metadata[key];
  }

  if (!usePg(options)) {
    memory.feedEvents.set(row.id, row);
    return { ok: true, event: row };
  }

  const pool = getPoolOrThrow(options);
  await pool.query(
    `INSERT INTO feed_events (
      id, user_id, session_key, event_type, item_type, item_id,
      intent_at_time, metadata, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::timestamptz);`,
    [
      row.id,
      row.userId,
      row.sessionKey,
      row.eventType,
      row.itemType,
      row.itemId,
      row.intentAtTime,
      JSON.stringify(row.metadata),
      row.createdAt
    ]
  );
  return { ok: true, event: row };
}

// ── Ranking ─────────────────────────────────────────────────────────────────

function itemTimestamp(item) {
  const raw =
    item.publishedAt ||
    item.createdAt ||
    item.updatedAt ||
    item.lastUpdate ||
    item.timestamp ||
    null;
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : 0;
}

function recencyBoost(item, now = Date.now()) {
  const ts = itemTimestamp(item);
  if (!ts) return 0;
  const ageDays = Math.max(0, (now - ts) / (1000 * 60 * 60 * 24));
  if (ageDays <= 1) return 0.25;
  if (ageDays <= 7) return 0.15;
  if (ageDays <= 30) return 0.05;
  return 0;
}

function similarityBoost(item, prefs = {}) {
  let boost = 0;
  const profession = (prefs.profession || "").toLowerCase();
  const region = (prefs.region || "").toLowerCase();
  if (profession) {
    const hay = `${item.profession || ""} ${(item.professions || []).join(" ")}`.toLowerCase();
    if (hay && hay.includes(profession)) boost += 0.35;
  }
  if (region && region !== "global") {
    const itemRegion = String(item.region || item.country || "").toLowerCase();
    if (itemRegion && (itemRegion === region || itemRegion === "global")) {
      boost += itemRegion === region ? 0.2 : 0.05;
    }
  }
  return boost;
}

function supportSignalBoost(item, intent) {
  if (!isSupportItemType(item.type)) return 0;
  const dr = item.desiredResponse || "";
  const pi = item.publicationIntent || "";

  if (intent === USER_INTENT.NEED_TO_VENT) {
    if (item.type === FEED_ITEM_TYPE.VENT) return 0.4;
    if (dr === DESIRED_RESPONSE.EMPATHY || dr === DESIRED_RESPONSE.WITNESS) return 0.3;
    if (pi === PUBLICATION_INTENT.VENT) return 0.35;
    // Suppress advice-seeking stories when user needs to vent
    if (dr === DESIRED_RESPONSE.ADVICE || dr === DESIRED_RESPONSE.PRACTICAL_HELP) return -0.2;
  }

  if (intent === USER_INTENT.READY_TO_HELP) {
    if (item.type === FEED_ITEM_TYPE.VENT) return 0.35;
    if (dr === DESIRED_RESPONSE.EMPATHY || dr === DESIRED_RESPONSE.ADVICE) return 0.3;
    if (pi === PUBLICATION_INTENT.ADVICE_REQUEST) return 0.35;
  }

  if (intent === USER_INTENT.SEEKING_SIMILAR) {
    if (item.type === FEED_ITEM_TYPE.STORY || item.type === FEED_ITEM_TYPE.GROUP) return 0.15;
  }

  return 0;
}

/**
 * Score a single feed item for the given intent.
 * Action items score ~0 (or hard-zeroed) unless intent allows action recs.
 */
function scoreItem(item, intent, context = {}) {
  const type = item.type || item.itemType || "";
  const weights = INTENT_TYPE_WEIGHTS[intent] || INTENT_TYPE_WEIGHTS[DEFAULT_ANON_INTENT];
  const base = weights[type] != null ? weights[type] : 0.1;
  const prefs = context.prefs || {};
  const reasons = [];

  let score = base;
  reasons.push({ code: "type_weight", weight: base, detail: `Matches ${type} for ${intent}` });

  // Hard gate: never force action content on non-action intents
  if (isActionItemType(type) && !allowsActionRecommendations(intent)) {
    // prefs can further hide; base weight may already be 0 for need_to_vent
    if (prefs.hideActionContent || intent === USER_INTENT.NEED_TO_VENT) {
      return {
        score: 0,
        reasons: [
          {
            code: "action_suppressed",
            weight: 0,
            detail: "Action recommendations are hidden for your current intent"
          }
        ],
        suppressed: true
      };
    }
    // Soft deprioritize if weight is already low
    if (base <= 0.2) {
      reasons.push({
        code: "action_deprioritized",
        weight: 0,
        detail: "Career/action items appear only when you choose Ready to act"
      });
    }
  }

  if (prefs.hideActionContent && isActionItemType(type)) {
    return {
      score: 0,
      reasons: [{ code: "prefs_hide_action", weight: 0, detail: "You hid action content" }],
      suppressed: true
    };
  }

  if (prefs.preferSupport && isSupportItemType(type)) {
    score += 0.2;
    reasons.push({ code: "prefer_support", weight: 0.2, detail: "You prefer support content" });
  }

  const sim = similarityBoost(item, prefs);
  if (sim > 0) {
    score += sim;
    reasons.push({
      code: "similarity",
      weight: sim,
      detail: "Similar profession or region to your preferences"
    });
  }

  const support = supportSignalBoost(item, intent);
  if (support !== 0) {
    score += support;
    reasons.push({
      code: support > 0 ? "support_signal" : "support_mismatch",
      weight: support,
      detail:
        support > 0
          ? "Expression/support content prioritized for your intent"
          : "Advice-oriented content deprioritized while you need support"
    });
  }

  const recency = recencyBoost(item, context.now);
  if (recency > 0) {
    score += recency;
    reasons.push({ code: "recency", weight: recency, detail: "Recently published" });
  }

  // Secondary intents: mild boost if type aligns
  const secondary = context.secondaryIntents || [];
  for (const sec of secondary) {
    const secWeights = INTENT_TYPE_WEIGHTS[sec];
    if (secWeights && secWeights[type] >= 0.9) {
      score += 0.1;
      reasons.push({
        code: "secondary_intent",
        weight: 0.1,
        detail: `Also relevant to secondary intent: ${sec}`
      });
      break;
    }
  }

  return { score: Math.max(0, score), reasons, suppressed: false };
}

/**
 * Human-readable explanation for why an item appears.
 */
function explainRecommendation(item, intent, scoreResult) {
  const meta = INTENT_META[intent] || INTENT_META[DEFAULT_ANON_INTENT];
  const type = item.type || "content";
  const top = (scoreResult.reasons || [])
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)[0];

  if (scoreResult.suppressed) {
    return {
      summary: "Hidden for your current intent",
      detail: (scoreResult.reasons[0] && scoreResult.reasons[0].detail) || "",
      codes: (scoreResult.reasons || []).map((r) => r.code)
    };
  }

  const templates = {
    vent: `Shown because you're ${meta.label.toLowerCase()} — community vents stay first-class`,
    story: `A community story ranked for “${meta.label}”`,
    news: `News relevant while you're ${meta.label.toLowerCase()}`,
    resource: allowsActionRecommendations(intent)
      ? "Verified resource because you indicated you're ready to act"
      : "Reference material (not pushed as a required next step)",
    opportunity: allowsActionRecommendations(intent)
      ? "Opportunity surfaced because you chose Ready to act"
      : "Opportunity available but not prioritized for your intent",
    topic: `Discussion topic related to “${meta.label}”`,
    group: "Group of people with similar situations or professions",
    petition: allowsActionRecommendations(intent)
      ? "Petition you can take action on"
      : "Petition deprioritized unless you choose Ready to act",
    next_step: `Suggested next step for “${meta.label}”`
  };

  const summary = templates[type] || `Recommended for “${meta.label}”`;
  const detail = top ? top.detail : meta.description;

  return {
    summary,
    detail,
    codes: (scoreResult.reasons || []).map((r) => r.code)
  };
}

/**
 * Rank a list of feed items. Returns new array with score + why attached.
 * Suppressed action items are dropped unless includeSuppressed is true.
 */
function rankFeedItems(items, options = {}) {
  const intent = isValidIntent(options.intent)
    ? options.intent
    : DEFAULT_ANON_INTENT;
  const secondaryIntents = Array.isArray(options.secondaryIntents)
    ? options.secondaryIntents.filter(isValidIntent)
    : [];
  const prefs = sanitizePrefs(options.prefs || {});
  const includeSuppressed = options.includeSuppressed === true;
  const limit = Math.min(Math.max(Number(options.limit || 40), 1), 100);
  const context = {
    prefs,
    secondaryIntents,
    now: options.now || Date.now()
  };

  const scored = [];
  for (const item of items || []) {
    if (!item || !item.type) continue;
    const result = scoreItem(item, intent, context);
    if (result.suppressed && !includeSuppressed) continue;
    // Drop near-zero non-support noise for support-first intents
    if (
      result.score <= 0 &&
      !includeSuppressed &&
      isActionItemType(item.type)
    ) {
      continue;
    }
    const why = explainRecommendation(item, intent, result);
    scored.push({
      ...item,
      score: Number(result.score.toFixed(4)),
      why,
      intent
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return itemTimestamp(b) - itemTimestamp(a);
  });

  return scored.slice(0, limit);
}

/**
 * Next-step suggestions tailored to intent. Never injects job-hunt CTAs
 * for need_to_vent / only_reading / seeking_similar.
 */
function nextStepsForIntent(intent, prefs = {}) {
  const steps = [];
  const push = (id, title, description, href, type = "next_step") => {
    steps.push({
      id,
      type,
      title,
      description,
      href,
      why: {
        summary: `Next step for “${(INTENT_META[intent] || {}).label || intent}”`,
        detail: description,
        codes: ["next_step"]
      }
    });
  };

  switch (intent) {
    case USER_INTENT.NEED_TO_VENT:
      push(
        "ns_vent",
        "Share a vent",
        "Be heard without forced career advice or action CTAs.",
        "/#share"
      );
      push(
        "ns_read_support",
        "Read support stories",
        "See how others felt the same pressure — witness only.",
        "/#stories"
      );
      push(
        "ns_crisis",
        "Crisis resources",
        "If you're in crisis, localized help is available anytime.",
        "/#resources"
      );
      break;
    case USER_INTENT.SEEKING_SIMILAR:
      push(
        "ns_stories_filter",
        "Filter stories by profession",
        "Find people in roles like yours.",
        "/#stories"
      );
      push(
        "ns_groups",
        "Browse groups",
        "Join professional or regional support groups.",
        "/api/social/groups"
      );
      push(
        "ns_share_story",
        "Share your story",
        "Help others recognize the pattern.",
        "/#share"
      );
      break;
    case USER_INTENT.GATHERING_INFORMATION:
      push(
        "ns_news",
        "Community news",
        "Displacement news grounded in discussion.",
        "/#news"
      );
      push(
        "ns_resources_info",
        "Verified resources",
        "Reference catalog — no obligation to apply.",
        "/#resources"
      );
      push(
        "ns_forum",
        "Forum discussions",
        "Ask questions and learn from the community.",
        "/forum.html"
      );
      break;
    case USER_INTENT.READY_TO_ACT:
      push(
        "ns_opportunities",
        "Open opportunities",
        "Jobs and programs when you're ready.",
        "/#resources"
      );
      push(
        "ns_resources_act",
        "Practical resources",
        "Legal, benefits, and re-skilling links that are verified.",
        "/#resources"
      );
      push(
        "ns_petitions",
        "Petitions",
        "Collective action if that fits your goals.",
        "/#community"
      );
      break;
    case USER_INTENT.READY_TO_HELP:
      push(
        "ns_help_vents",
        "Respond to vents",
        "Offer solidarity — no unsolicited career pitches.",
        "/#stories"
      );
      push(
        "ns_advice_requests",
        "Advice requests",
        "Help when authors explicitly asked for advice.",
        "/#stories"
      );
      push(
        "ns_join_group_help",
        "Join a group",
        "Support people in a profession or region.",
        "/api/social/groups"
      );
      break;
    case USER_INTENT.ONLY_READING:
    default:
      push(
        "ns_browse_stories",
        "Browse stories",
        "Read at your own pace — no calls to action.",
        "/#stories"
      );
      push(
        "ns_news_quiet",
        "Scan the news",
        "Stay informed without committing to next steps.",
        "/#news"
      );
      if (!prefs.hideActionContent) {
        push(
          "ns_set_intent",
          "Tell us what you need",
          "Change your intent anytime — support stays first-class.",
          "/#stories"
        );
      }
      break;
  }

  return steps;
}

/**
 * Normalize heterogeneous storage records into feed items.
 */
function toFeedItem(type, record) {
  if (!record || !record.id) return null;
  const base = {
    type,
    id: record.id,
    title:
      record.title ||
      record.name ||
      (typeof record.title === "object" ? record.title?.en : null) ||
      "",
    summary:
      record.summary ||
      record.story ||
      record.body ||
      record.description ||
      "",
    createdAt: record.createdAt || record.publishedAt || null,
    publishedAt: record.publishedAt || record.createdAt || null,
    updatedAt: record.updatedAt || record.lastUpdate || null,
    region: record.region || record.country || "global",
    country: record.country || record.region || "global",
    language: record.language || "en",
    profession: record.profession || "",
    professions: record.professions || [],
    publicationIntent: record.publicationIntent || null,
    desiredResponse: record.desiredResponse || null,
    status: record.status || null,
    href: null
  };

  switch (type) {
    case FEED_ITEM_TYPE.STORY:
      base.title = base.title || `${record.profession || "Story"} — ${record.company || ""}`.trim();
      base.summary = (record.story || "").slice(0, 280);
      base.href = `/story/${record.id}`;
      break;
    case FEED_ITEM_TYPE.VENT:
      base.title = record.title || "Community vent";
      base.summary = (record.body || "").slice(0, 280);
      base.href = `/api/vents/${record.id}`;
      break;
    case FEED_ITEM_TYPE.NEWS:
      base.title =
        (typeof record.title === "object" ? record.title?.en || Object.values(record.title || {})[0] : record.title) ||
        "News";
      base.href = record.url || `/api/news/${record.id}`;
      break;
    case FEED_ITEM_TYPE.RESOURCE:
      base.title = record.title || "Resource";
      base.href = record.url || `/api/resources/${record.id}`;
      break;
    case FEED_ITEM_TYPE.OPPORTUNITY:
      base.title = record.title || "Opportunity";
      base.href = record.url || `/api/opportunities/${record.id}`;
      break;
    case FEED_ITEM_TYPE.TOPIC:
      base.title = record.title || "Discussion";
      base.href = `/forum.html#topic-${record.id}`;
      break;
    case FEED_ITEM_TYPE.GROUP:
      base.title = record.name || record.title || "Group";
      base.summary = record.description || "";
      base.href = `/api/social/groups/${record.id}`;
      break;
    case FEED_ITEM_TYPE.PETITION:
      base.title = record.title || "Petition";
      base.href = `/api/petitions/${record.id}`;
      break;
    default:
      break;
  }

  return base;
}

/**
 * Build a personalized feed payload from candidate pools + intent state.
 */
function buildPersonalizedFeed(pools, intentState, options = {}) {
  const intent = intentState?.primaryIntent || DEFAULT_ANON_INTENT;
  const secondaryIntents = intentState?.secondaryIntents || [];
  const prefs = intentState?.prefs || {};
  const items = [];

  const addAll = (type, rows) => {
    for (const row of rows || []) {
      const item = toFeedItem(type, row);
      if (item) items.push(item);
    }
  };

  addAll(FEED_ITEM_TYPE.VENT, pools.vents);
  addAll(FEED_ITEM_TYPE.STORY, pools.stories);
  addAll(FEED_ITEM_TYPE.NEWS, pools.news);
  addAll(FEED_ITEM_TYPE.RESOURCE, pools.resources);
  addAll(FEED_ITEM_TYPE.OPPORTUNITY, pools.opportunities);
  addAll(FEED_ITEM_TYPE.TOPIC, pools.topics);
  addAll(FEED_ITEM_TYPE.GROUP, pools.groups);
  addAll(FEED_ITEM_TYPE.PETITION, pools.petitions);

  const ranked = rankFeedItems(items, {
    intent,
    secondaryIntents,
    prefs,
    limit: options.limit || 40,
    now: options.now
  });

  const nextSteps = nextStepsForIntent(intent, prefs);

  return {
    intent: {
      primaryIntent: intent,
      secondaryIntents,
      prefs,
      source: intentState?.source || USER_INTENT_SOURCE.DEFAULT,
      anonymous: Boolean(intentState?.anonymous || !intentState?.userId),
      meta: INTENT_META[intent] || null,
      available: listIntents()
    },
    items: ranked,
    nextSteps,
    policy: {
      actionRecommendations: allowsActionRecommendations(intent),
      supportFirst: Boolean((INTENT_META[intent] || {}).supportFirst),
      explanation: "Every item includes a why block describing ranking reasons."
    },
    generatedAt: nowIso()
  };
}

module.exports = {
  USER_INTENT,
  USER_INTENT_SOURCE,
  FEED_ITEM_TYPE,
  INTENT_META,
  INTENT_TYPE_WEIGHTS,
  ACTION_ITEM_TYPES,
  SUPPORT_ITEM_TYPES,
  DEFAULT_ANON_INTENT,
  DEFAULT_AUTH_INTENT,

  listIntents,
  getIntentMeta,
  isValidIntent,
  isActionItemType,
  isSupportItemType,
  allowsActionRecommendations,
  anonymousFallbackIntent,
  defaultIntentState,
  sanitizePrefs,
  normalizeIntentPatch,

  getUserIntent,
  setUserIntent,
  recordFeedEvent,

  scoreItem,
  explainRecommendation,
  rankFeedItems,
  nextStepsForIntent,
  toFeedItem,
  buildPersonalizedFeed,

  memoryReset,
  memory
};
