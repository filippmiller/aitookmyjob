/**
 * Expression & publication-intent helpers (aitj-z8q.8).
 * Pure validation / mapping over domain-contract enums.
 * Stories own structured intents; vents own lightweight emotional release.
 */

"use strict";

const {
  PUBLICATION_INTENT,
  DESIRED_RESPONSE,
  ANONYMITY_MODE,
  ADVICE_PERMISSION,
  RETENTION_PREFERENCE,
  VISIBILITY,
  STORY_STATUS,
  VENT_STATUS,
  ENTITY,
  DEFAULT_DESIRED_RESPONSE_BY_INTENT,
  valuesOf,
  defaultDesiredResponse,
  assertValidStatus,
  canTransition,
  assertCanTransition,
  isPubliclyListable,
  isVisibilityAllowed
} = require("./domain-contract");

const STORY_LIKE_INTENTS = Object.freeze([
  PUBLICATION_INTENT.STORY,
  PUBLICATION_INTENT.ADVICE_REQUEST,
  PUBLICATION_INTENT.WARN,
  PUBLICATION_INTENT.GOOD_NEWS,
  PUBLICATION_INTENT.NEWS_SHARE
]);

const MODE_META = Object.freeze({
  [PUBLICATION_INTENT.VENT]: Object.freeze({
    id: PUBLICATION_INTENT.VENT,
    label: "Vent",
    description: "Emotional release — be heard without forced action content.",
    entity: ENTITY.VENT,
    primaryEntity: "vent",
    defaultDesiredResponse: DESIRED_RESPONSE.EMPATHY,
    defaultVisibility: VISIBILITY.COMMUNITY,
    defaultAnonymity: ANONYMITY_MODE.ANONYMOUS,
    defaultAdvicePermission: ADVICE_PERMISSION.CLOSED,
    defaultRetention: RETENTION_PREFERENCE.DAYS_30,
    requiresStructuredFields: false,
    supportsSupportWithoutAction: true
  }),
  [PUBLICATION_INTENT.STORY]: Object.freeze({
    id: PUBLICATION_INTENT.STORY,
    label: "Structured story",
    description: "Share a displacement narrative with optional detail fields.",
    entity: ENTITY.STORY,
    primaryEntity: "story",
    defaultDesiredResponse: DESIRED_RESPONSE.WITNESS,
    defaultVisibility: VISIBILITY.PUBLIC,
    defaultAnonymity: ANONYMITY_MODE.ALIAS,
    defaultAdvicePermission: ADVICE_PERMISSION.OPEN,
    defaultRetention: RETENTION_PREFERENCE.INDEFINITE,
    requiresStructuredFields: true,
    supportsSupportWithoutAction: true
  }),
  [PUBLICATION_INTENT.ADVICE_REQUEST]: Object.freeze({
    id: PUBLICATION_INTENT.ADVICE_REQUEST,
    label: "Ask for advice",
    description: "Request practical advice; you control who may respond.",
    entity: ENTITY.STORY,
    primaryEntity: "story",
    defaultDesiredResponse: DESIRED_RESPONSE.ADVICE,
    defaultVisibility: VISIBILITY.PUBLIC,
    defaultAnonymity: ANONYMITY_MODE.ALIAS,
    defaultAdvicePermission: ADVICE_PERMISSION.OPEN,
    defaultRetention: RETENTION_PREFERENCE.INDEFINITE,
    requiresStructuredFields: true,
    supportsSupportWithoutAction: true
  }),
  [PUBLICATION_INTENT.WARN]: Object.freeze({
    id: PUBLICATION_INTENT.WARN,
    label: "Warn others",
    description: "Warn others about employer practices or patterns.",
    entity: ENTITY.STORY,
    primaryEntity: "story",
    defaultDesiredResponse: DESIRED_RESPONSE.SHARE,
    defaultVisibility: VISIBILITY.PUBLIC,
    defaultAnonymity: ANONYMITY_MODE.ALIAS,
    defaultAdvicePermission: ADVICE_PERMISSION.CLOSED,
    defaultRetention: RETENTION_PREFERENCE.INDEFINITE,
    requiresStructuredFields: true,
    supportsSupportWithoutAction: true
  }),
  [PUBLICATION_INTENT.GOOD_NEWS]: Object.freeze({
    id: PUBLICATION_INTENT.GOOD_NEWS,
    label: "Share good news",
    description: "Celebrate recovery, rehire, or a successful pivot.",
    entity: ENTITY.STORY,
    primaryEntity: "story",
    defaultDesiredResponse: DESIRED_RESPONSE.CELEBRATE,
    defaultVisibility: VISIBILITY.PUBLIC,
    defaultAnonymity: ANONYMITY_MODE.ALIAS,
    defaultAdvicePermission: ADVICE_PERMISSION.OPEN,
    defaultRetention: RETENTION_PREFERENCE.INDEFINITE,
    requiresStructuredFields: true,
    supportsSupportWithoutAction: true
  }),
  [PUBLICATION_INTENT.NEWS_SHARE]: Object.freeze({
    id: PUBLICATION_INTENT.NEWS_SHARE,
    label: "Share a news item",
    description: "Share an external news item with your commentary.",
    entity: ENTITY.STORY,
    primaryEntity: "story",
    defaultDesiredResponse: DESIRED_RESPONSE.DISCUSS,
    defaultVisibility: VISIBILITY.PUBLIC,
    defaultAnonymity: ANONYMITY_MODE.ALIAS,
    defaultAdvicePermission: ADVICE_PERMISSION.OPEN,
    defaultRetention: RETENTION_PREFERENCE.INDEFINITE,
    requiresStructuredFields: false,
    supportsSupportWithoutAction: true
  })
});

const ANALYTICS_EVENTS = Object.freeze({
  DRAFT_SAVED: "expression.draft_saved",
  PREVIEWED: "expression.previewed",
  SUBMITTED: "expression.submitted",
  PUBLISHED: "expression.published",
  EDITED: "expression.edited",
  DELETED: "expression.deleted",
  REPORTED: "expression.reported",
  FOLLOW_UP: "expression.follow_up"
});

const NOTIFICATION_JOB_TYPE = "notification.expression";
const ANALYTICS_JOB_TYPE = "analytics.expression";

function listModes() {
  return valuesOf(PUBLICATION_INTENT).map((id) => ({ ...MODE_META[id] }));
}

function getModeMeta(intent) {
  return MODE_META[intent] || null;
}

function isStoryLikeIntent(intent) {
  return STORY_LIKE_INTENTS.includes(intent);
}

function isVentIntent(intent) {
  return intent === PUBLICATION_INTENT.VENT;
}

function entityForIntent(intent) {
  if (isVentIntent(intent)) return ENTITY.VENT;
  if (isStoryLikeIntent(intent)) return ENTITY.STORY;
  return null;
}

function normalizeEnum(value, enumObj, fallback) {
  const v = String(value || "").trim().toLowerCase();
  if (valuesOf(enumObj).includes(v)) return v;
  return fallback;
}

/**
 * Normalize author controls from request body using intent defaults.
 * @returns {{ ok: true, controls: object } | { ok: false, errors: object[] }}
 */
function normalizeAuthorControls(body = {}, intentHint) {
  const errors = [];
  const intent = normalizeEnum(
    body.publicationIntent || body.intent || intentHint,
    PUBLICATION_INTENT,
    null
  );
  if (!intent) {
    errors.push({
      field: "publicationIntent",
      message: `Must be one of: ${valuesOf(PUBLICATION_INTENT).join(", ")}`
    });
    return { ok: false, errors };
  }
  const meta = MODE_META[intent];
  const desiredResponse = normalizeEnum(
    body.desiredResponse,
    DESIRED_RESPONSE,
    meta.defaultDesiredResponse || defaultDesiredResponse(intent)
  );
  const anonymityMode = normalizeEnum(
    body.anonymityMode,
    ANONYMITY_MODE,
    meta.defaultAnonymity
  );
  const advicePermission = normalizeEnum(
    body.advicePermission,
    ADVICE_PERMISSION,
    meta.defaultAdvicePermission
  );
  const visibility = normalizeEnum(
    body.visibility,
    VISIBILITY,
    meta.defaultVisibility
  );
  const retentionPreference = normalizeEnum(
    body.retentionPreference,
    RETENTION_PREFERENCE,
    meta.defaultRetention
  );

  const entity = entityForIntent(intent);
  if (!isVisibilityAllowed(entity, visibility)) {
    errors.push({
      field: "visibility",
      message: `Visibility "${visibility}" is not allowed for ${entity}`
    });
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    controls: {
      publicationIntent: intent,
      desiredResponse,
      anonymityMode,
      advicePermission,
      visibility,
      retentionPreference,
      entity,
      primaryEntity: meta.primaryEntity
    }
  };
}

/**
 * Whether desired response implies forced "action" CTAs (job search, petitions…).
 * Empathy / witness / none / celebrate must never force action content.
 */
function forcesActionContent(desiredResponse) {
  return (
    desiredResponse === DESIRED_RESPONSE.PRACTICAL_HELP ||
    desiredResponse === DESIRED_RESPONSE.ADVICE
  );
}

/**
 * UI prompt policy: support without forced action.
 */
function responsePromptPolicy(desiredResponse) {
  const dr = normalizeEnum(desiredResponse, DESIRED_RESPONSE, DESIRED_RESPONSE.NONE);
  if (dr === DESIRED_RESPONSE.NONE) {
    return {
      showReactions: false,
      showAdviceForm: false,
      showSharePrompt: false,
      showCelebrate: false,
      showCtaBanner: false,
      label: "Author asked for no response prompts"
    };
  }
  if (dr === DESIRED_RESPONSE.EMPATHY || dr === DESIRED_RESPONSE.WITNESS) {
    return {
      showReactions: true,
      showAdviceForm: false,
      showSharePrompt: false,
      showCelebrate: false,
      showCtaBanner: false,
      label: "Support / witness only — no forced action"
    };
  }
  if (dr === DESIRED_RESPONSE.ADVICE || dr === DESIRED_RESPONSE.PRACTICAL_HELP) {
    return {
      showReactions: true,
      showAdviceForm: true,
      showSharePrompt: false,
      showCelebrate: false,
      showCtaBanner: false,
      label: "Advice welcome (author-controlled)"
    };
  }
  if (dr === DESIRED_RESPONSE.SHARE) {
    return {
      showReactions: true,
      showAdviceForm: false,
      showSharePrompt: true,
      showCelebrate: false,
      showCtaBanner: false,
      label: "Share / amplify welcome"
    };
  }
  if (dr === DESIRED_RESPONSE.CELEBRATE) {
    return {
      showReactions: true,
      showAdviceForm: false,
      showSharePrompt: false,
      showCelebrate: true,
      showCtaBanner: false,
      label: "Celebrate with the author"
    };
  }
  if (dr === DESIRED_RESPONSE.DISCUSS) {
    return {
      showReactions: true,
      showAdviceForm: false,
      showSharePrompt: false,
      showCelebrate: false,
      showCtaBanner: false,
      label: "Discussion welcome"
    };
  }
  return {
    showReactions: true,
    showAdviceForm: false,
    showSharePrompt: false,
    showCelebrate: false,
    showCtaBanner: false,
    label: "Default support"
  };
}

function anonymityToNameDisplay(anonymityMode) {
  if (anonymityMode === ANONYMITY_MODE.ANONYMOUS) return "anonymous";
  if (anonymityMode === ANONYMITY_MODE.IDENTIFIED) return "first_name";
  return "alias";
}

/**
 * Validate vent payload (lightweight).
 */
function validateVentPayload(body = {}, options = {}) {
  const errors = [];
  const bodyText = String(body.body || body.story || body.text || "").trim();
  const minLen = options.asDraft ? 1 : 10;
  const maxLen = 4000;
  if (bodyText.length < minLen) {
    errors.push({ field: "body", message: `Body must be at least ${minLen} characters` });
  }
  if (bodyText.length > maxLen) {
    errors.push({ field: "body", message: `Body must be at most ${maxLen} characters` });
  }
  const title = String(body.title || "").trim();
  if (title.length > 200) {
    errors.push({ field: "title", message: "Title must be at most 200 characters" });
  }
  const controls = normalizeAuthorControls(
    { ...body, publicationIntent: PUBLICATION_INTENT.VENT },
    PUBLICATION_INTENT.VENT
  );
  if (!controls.ok) errors.push(...controls.errors);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      title: title || null,
      body: bodyText,
      country: String(body.country || "global").toLowerCase().slice(0, 20),
      language: String(body.language || "en").toLowerCase().slice(0, 10),
      displayName: String(body.name || body.displayName || "Anonymous").trim().slice(0, 80) || "Anonymous",
      company: String(body.company || "").trim().slice(0, 120) || null,
      ...controls.controls
    }
  };
}

/**
 * Build public preview for any expression record.
 */
function buildExpressionPreview(record) {
  const intent = record.publicationIntent || PUBLICATION_INTENT.STORY;
  const meta = MODE_META[intent] || MODE_META[PUBLICATION_INTENT.STORY];
  const desiredResponse = record.desiredResponse || meta.defaultDesiredResponse;
  const policy = responsePromptPolicy(desiredResponse);
  const body = record.body || record.story || "";
  return {
    kind: record.kind || meta.primaryEntity,
    id: record.id || null,
    publicationIntent: intent,
    modeLabel: meta.label,
    desiredResponse,
    responsePolicy: policy,
    visibility: record.visibility || meta.defaultVisibility,
    anonymityMode: record.anonymityMode || meta.defaultAnonymity,
    advicePermission: record.advicePermission || meta.defaultAdvicePermission,
    retentionPreference: record.retentionPreference || meta.defaultRetention,
    title: record.title || record.reason || null,
    bodyPreview: String(body).slice(0, 500),
    displayName:
      record.anonymityMode === ANONYMITY_MODE.ANONYMOUS
        ? "Anonymous"
        : record.name || record.displayName || "Author",
    status: record.status || null,
    forcesActionContent: forcesActionContent(desiredResponse)
  };
}

/**
 * Safe status transition helper for expression entities.
 */
function transitionStatus(entity, from, to) {
  assertCanTransition(entity, from, to);
  return to;
}

function initialStatusForSubmit({ asDraft, riskBand, entity }) {
  if (asDraft) {
    return entity === ENTITY.VENT ? VENT_STATUS.DRAFT : STORY_STATUS.DRAFT;
  }
  if (riskBand === "high") {
    return entity === ENTITY.VENT ? VENT_STATUS.REJECTED : STORY_STATUS.REJECTED;
  }
  return entity === ENTITY.VENT ? VENT_STATUS.PENDING : STORY_STATUS.PENDING;
}

function publicVent(vent) {
  if (!vent) return null;
  if (!isPubliclyListable(ENTITY.VENT, vent.status) && vent.visibility !== VISIBILITY.PUBLIC) {
    // Callers filter status; still strip internal fields.
  }
  const anonymity = vent.anonymityMode || ANONYMITY_MODE.ANONYMOUS;
  return {
    id: vent.id,
    kind: "vent",
    title: vent.title,
    body: vent.body,
    status: vent.status,
    publicationIntent: vent.publicationIntent || PUBLICATION_INTENT.VENT,
    desiredResponse: vent.desiredResponse || DESIRED_RESPONSE.EMPATHY,
    advicePermission: vent.advicePermission || ADVICE_PERMISSION.CLOSED,
    anonymityMode: anonymity,
    visibility: vent.visibility || VISIBILITY.COMMUNITY,
    retentionPreference: vent.retentionPreference || RETENTION_PREFERENCE.DAYS_30,
    country: vent.country,
    language: vent.language,
    displayName: anonymity === ANONYMITY_MODE.ANONYMOUS ? "Anonymous" : vent.displayName || "Anonymous",
    company:
      anonymity === ANONYMITY_MODE.ANONYMOUS
        ? null
        : vent.company || null,
    createdAt: vent.createdAt,
    updatedAt: vent.updatedAt,
    metrics: {
      views: Number(vent.metrics?.views || 0),
      support: Number(vent.metrics?.support || 0)
    },
    responsePolicy: responsePromptPolicy(vent.desiredResponse || DESIRED_RESPONSE.EMPATHY)
  };
}

function authorMayEdit(record, user, entity) {
  if (!record || !user) return false;
  if (record.submittedBy && record.submittedBy === user.id) {
    const editable =
      entity === ENTITY.VENT
        ? [VENT_STATUS.DRAFT, VENT_STATUS.PENDING, VENT_STATUS.REJECTED]
        : [STORY_STATUS.DRAFT, STORY_STATUS.PENDING, STORY_STATUS.REJECTED];
    return editable.includes(record.status);
  }
  return false;
}

function authorMayDelete(record, user) {
  if (!record || !user) return false;
  return Boolean(record.submittedBy && record.submittedBy === user.id);
}

function analyticsEventPayload(eventName, record, extra = {}) {
  return {
    event: eventName,
    at: new Date().toISOString(),
    kind: record.kind || record.primaryEntity || null,
    id: record.id || null,
    publicationIntent: record.publicationIntent || null,
    status: record.status || null,
    desiredResponse: record.desiredResponse || null,
    ...extra
  };
}

function notificationPayload(type, record, recipientId = null) {
  return {
    type,
    recipientId,
    targetType: record.kind || "expression",
    targetId: record.id,
    publicationIntent: record.publicationIntent,
    desiredResponse: record.desiredResponse,
    // Respect author: never force action CTAs in notification copy for empathy/none
    forceAction: forcesActionContent(record.desiredResponse),
    createdAt: new Date().toISOString()
  };
}

module.exports = {
  MODE_META,
  STORY_LIKE_INTENTS,
  ANALYTICS_EVENTS,
  NOTIFICATION_JOB_TYPE,
  ANALYTICS_JOB_TYPE,
  listModes,
  getModeMeta,
  isStoryLikeIntent,
  isVentIntent,
  entityForIntent,
  normalizeAuthorControls,
  normalizeEnum,
  forcesActionContent,
  responsePromptPolicy,
  anonymityToNameDisplay,
  validateVentPayload,
  buildExpressionPreview,
  transitionStatus,
  initialStatusForSubmit,
  publicVent,
  authorMayEdit,
  authorMayDelete,
  analyticsEventPayload,
  notificationPayload,
  // re-export commonly used contract pieces for routes
  PUBLICATION_INTENT,
  DESIRED_RESPONSE,
  ANONYMITY_MODE,
  ADVICE_PERMISSION,
  RETENTION_PREFERENCE,
  VISIBILITY,
  STORY_STATUS,
  VENT_STATUS,
  ENTITY,
  DEFAULT_DESIRED_RESPONSE_BY_INTENT,
  valuesOf,
  assertValidStatus,
  canTransition,
  assertCanTransition,
  isPubliclyListable,
  isVisibilityAllowed,
  defaultDesiredResponse
};
