/**
 * Domain Contract v1 — machine-readable source of truth for aitookmyjob product domain.
 * Docs: docs/domain-contract-v1.md
 * Bead: aitj-z8q.1
 *
 * Free-form lifecycle status strings are forbidden for new feature code.
 * Import enums and helpers from this module.
 */

"use strict";

const DOMAIN_CONTRACT_VERSION = "1.0.0";

// ── freeze helpers ──────────────────────────────────────────────────────────

function freezeEnum(obj) {
  return Object.freeze({ ...obj });
}

function valuesOf(enumObj) {
  return Object.values(enumObj);
}

// ── Publication intents & author controls ───────────────────────────────────

const PUBLICATION_INTENT = freezeEnum({
  VENT: "vent",
  STORY: "story",
  ADVICE_REQUEST: "advice_request",
  WARN: "warn",
  GOOD_NEWS: "good_news",
  NEWS_SHARE: "news_share"
});

const DESIRED_RESPONSE = freezeEnum({
  NONE: "none",
  EMPATHY: "empathy",
  ADVICE: "advice",
  WITNESS: "witness",
  SHARE: "share",
  CELEBRATE: "celebrate",
  DISCUSS: "discuss",
  PRACTICAL_HELP: "practical_help"
});

const ANONYMITY_MODE = freezeEnum({
  IDENTIFIED: "identified",
  ALIAS: "alias",
  ANONYMOUS: "anonymous"
});

const ADVICE_PERMISSION = freezeEnum({
  OPEN: "open",
  FOLLOWERS: "followers",
  CLOSED: "closed"
});

const RETENTION_PREFERENCE = freezeEnum({
  DAYS_30: "30d",
  DAYS_90: "90d",
  DAYS_365: "365d",
  INDEFINITE: "indefinite"
});

const DEFAULT_DESIRED_RESPONSE_BY_INTENT = freezeEnum({
  [PUBLICATION_INTENT.VENT]: DESIRED_RESPONSE.EMPATHY,
  [PUBLICATION_INTENT.STORY]: DESIRED_RESPONSE.WITNESS,
  [PUBLICATION_INTENT.ADVICE_REQUEST]: DESIRED_RESPONSE.ADVICE,
  [PUBLICATION_INTENT.WARN]: DESIRED_RESPONSE.SHARE,
  [PUBLICATION_INTENT.GOOD_NEWS]: DESIRED_RESPONSE.CELEBRATE,
  [PUBLICATION_INTENT.NEWS_SHARE]: DESIRED_RESPONSE.DISCUSS
});

// ── Visibility & field privacy ──────────────────────────────────────────────

const VISIBILITY = freezeEnum({
  PUBLIC: "public",
  COMMUNITY: "community",
  RESTRICTED: "restricted",
  PRIVATE: "private",
  SYSTEM: "system"
});

const NAME_DISPLAY = freezeEnum({
  ALIAS: "alias",
  INITIALS: "initials",
  FIRST_NAME: "first_name",
  ANONYMOUS: "anonymous"
});

const COMPANY_DISPLAY = freezeEnum({
  EXACT: "exact",
  INDUSTRY_ONLY: "industry_only",
  MASKED: "masked"
});

const GEO_DISPLAY = freezeEnum({
  CITY: "city",
  REGION: "region",
  COUNTRY: "country",
  HIDDEN: "hidden"
});

const DATE_DISPLAY = freezeEnum({
  EXACT: "exact",
  MONTH: "month",
  YEAR: "year",
  HIDDEN: "hidden"
});

// ── Lifecycle status enums ──────────────────────────────────────────────────

const STORY_STATUS = freezeEnum({
  DRAFT: "draft",
  PENDING: "pending",
  PUBLISHED: "published",
  REJECTED: "rejected",
  ARCHIVED: "archived",
  DELETED: "deleted"
});

const VENT_STATUS = freezeEnum({
  DRAFT: "draft",
  PENDING: "pending",
  PUBLISHED: "published",
  HIDDEN: "hidden",
  REJECTED: "rejected",
  DELETED: "deleted"
});

const INSIDER_SIGNAL_STATUS = freezeEnum({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  PUBLISHED_SUMMARY: "published_summary",
  REJECTED: "rejected",
  LEGAL_HOLD: "legal_hold",
  DELETED: "deleted"
});

const VERIFICATION_LEVEL = freezeEnum({
  UNCORROBORATED: "uncorroborated",
  SINGLE_SOURCE: "single_source",
  MULTI_SOURCE: "multi_source",
  VERIFIED: "verified"
});

const EVIDENCE_STATUS = freezeEnum({
  UPLOADED: "uploaded",
  SCANNING: "scanning",
  AVAILABLE: "available",
  RESTRICTED: "restricted",
  REDACTED: "redacted",
  PURGED: "purged"
});

const EVIDENCE_TIER = freezeEnum({
  SELF_REPORT: "self_report",
  DOC_VERIFIED: "doc_verified",
  MULTI_SOURCE: "multi_source"
});

const NEWS_STATUS = freezeEnum({
  DISCOVERED: "discovered",
  PENDING: "pending",
  PUBLISHED: "published",
  ARCHIVED: "archived",
  REJECTED: "rejected"
});

const DISCUSSION_TOPIC_STATUS = freezeEnum({
  PENDING: "pending",
  PUBLISHED: "published",
  LOCKED: "locked",
  REJECTED: "rejected",
  DELETED: "deleted"
});

const DISCUSSION_REPLY_STATUS = freezeEnum({
  PENDING: "pending",
  PUBLISHED: "published",
  DELETED: "deleted"
});

const RESOURCE_STATUS = freezeEnum({
  DRAFT: "draft",
  PUBLISHED: "published",
  ARCHIVED: "archived",
  DELETED: "deleted"
});

const OPPORTUNITY_STATUS = freezeEnum({
  DRAFT: "draft",
  OPEN: "open",
  CLOSED: "closed",
  ARCHIVED: "archived",
  DELETED: "deleted"
});

/** Human + automated verification of catalog entries (aitj-z8q.12). */
const RESOURCE_VERIFICATION_STATE = freezeEnum({
  UNVERIFIED: "unverified",
  VERIFIED: "verified",
  STALE: "stale",
  BROKEN: "broken"
});

/** Result of automated link checks (resource.link_check job). */
const RESOURCE_LINK_STATUS = freezeEnum({
  UNKNOWN: "unknown",
  OK: "ok",
  BROKEN: "broken",
  REDIRECT: "redirect"
});

/** Cost model for resources / opportunities. */
const RESOURCE_COST = freezeEnum({
  FREE: "free",
  FREEMIUM: "freemium",
  PAID: "paid",
  UNKNOWN: "unknown"
});

/** User report lifecycle for catalog quality. */
const RESOURCE_REPORT_STATUS = freezeEnum({
  OPEN: "open",
  IN_REVIEW: "in_review",
  RESOLVED: "resolved",
  DISMISSED: "dismissed"
});

const COHORT_STATUS = freezeEnum({
  DRAFT: "draft",
  OPEN: "open",
  FULL: "full",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled"
});

const NOTIFICATION_STATUS = freezeEnum({
  PENDING: "pending",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
  CANCELLED: "cancelled"
});

const MODERATION_STATUS = freezeEnum({
  OPEN: "open",
  IN_REVIEW: "in_review",
  APPROVED: "approved",
  REJECTED: "rejected",
  ESCALATED: "escalated",
  CLOSED: "closed"
});

const APPEAL_STATUS = freezeEnum({
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  UPHELD: "upheld",
  OVERTURNED: "overturned",
  WITHDRAWN: "withdrawn"
});

const OUTCOME_STATUS = freezeEnum({
  SEARCHING: "searching",
  FOUND: "found",
  PIVOTED: "pivoted",
  LEFT_WORKFORCE: "left_workforce",
  UNKNOWN: "unknown"
});

const SANCTION_TYPE = freezeEnum({
  WARN: "warn",
  MUTE: "mute",
  SUSPEND: "suspend",
  BAN: "ban"
});

const TAKEDOWN_STATUS = freezeEnum({
  PENDING: "pending",
  IN_REVIEW: "in_review",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  COMPLETED: "completed"
});

const PETITION_STATUS = freezeEnum({
  DRAFT: "draft",
  OPEN: "open",
  CLOSED: "closed",
  DELETED: "deleted"
});

const ANONYMOUS_INBOX_STATUS = freezeEnum({
  RECEIVED: "received",
  TRIAGED: "triaged",
  LINKED: "linked",
  CLOSED: "closed"
});

// ── Entity registry ─────────────────────────────────────────────────────────

const ENTITY = freezeEnum({
  PUBLICATION_INTENT: "publication_intent",
  STORY: "story",
  VENT: "vent",
  INSIDER_SIGNAL: "insider_signal",
  EVIDENCE: "evidence",
  NEWS: "news",
  DISCUSSION_TOPIC: "discussion_topic",
  DISCUSSION_REPLY: "discussion_reply",
  RESOURCE: "resource",
  OPPORTUNITY: "opportunity",
  COHORT: "cohort",
  NOTIFICATION: "notification",
  MODERATION_CASE: "moderation_case",
  APPEAL: "appeal",
  OUTCOME: "outcome",
  USER_ACCOUNT: "user_account",
  SANCTION: "sanction",
  TAKEDOWN_REQUEST: "takedown_request",
  PETITION: "petition",
  AUDIT_EVENT: "audit_event",
  ANONYMOUS_INBOX: "anonymous_inbox"
});

/** Status enum object keyed by entity name used in helpers. */
const STATUS_ENUMS = freezeEnum({
  [ENTITY.STORY]: STORY_STATUS,
  [ENTITY.VENT]: VENT_STATUS,
  [ENTITY.INSIDER_SIGNAL]: INSIDER_SIGNAL_STATUS,
  [ENTITY.EVIDENCE]: EVIDENCE_STATUS,
  [ENTITY.NEWS]: NEWS_STATUS,
  [ENTITY.DISCUSSION_TOPIC]: DISCUSSION_TOPIC_STATUS,
  [ENTITY.DISCUSSION_REPLY]: DISCUSSION_REPLY_STATUS,
  [ENTITY.RESOURCE]: RESOURCE_STATUS,
  [ENTITY.OPPORTUNITY]: OPPORTUNITY_STATUS,
  [ENTITY.COHORT]: COHORT_STATUS,
  [ENTITY.NOTIFICATION]: NOTIFICATION_STATUS,
  [ENTITY.MODERATION_CASE]: MODERATION_STATUS,
  [ENTITY.APPEAL]: APPEAL_STATUS,
  [ENTITY.OUTCOME]: OUTCOME_STATUS,
  [ENTITY.TAKEDOWN_REQUEST]: TAKEDOWN_STATUS,
  [ENTITY.PETITION]: PETITION_STATUS,
  [ENTITY.ANONYMOUS_INBOX]: ANONYMOUS_INBOX_STATUS
});

// ── Transitions ─────────────────────────────────────────────────────────────

function edges(pairs) {
  const map = Object.create(null);
  for (const [from, toList] of pairs) {
    map[from] = Object.freeze([...toList]);
  }
  return Object.freeze(map);
}

const TRANSITIONS = freezeEnum({
  [ENTITY.STORY]: edges([
    [STORY_STATUS.DRAFT, [STORY_STATUS.PENDING, STORY_STATUS.DELETED]],
    [STORY_STATUS.PENDING, [STORY_STATUS.PUBLISHED, STORY_STATUS.REJECTED, STORY_STATUS.DELETED]],
    [STORY_STATUS.PUBLISHED, [STORY_STATUS.ARCHIVED, STORY_STATUS.DELETED]],
    [STORY_STATUS.REJECTED, [STORY_STATUS.PENDING, STORY_STATUS.DELETED]],
    [STORY_STATUS.ARCHIVED, [STORY_STATUS.PUBLISHED, STORY_STATUS.DELETED]],
    [STORY_STATUS.DELETED, []]
  ]),
  [ENTITY.VENT]: edges([
    [VENT_STATUS.DRAFT, [VENT_STATUS.PENDING, VENT_STATUS.DELETED]],
    [VENT_STATUS.PENDING, [VENT_STATUS.PUBLISHED, VENT_STATUS.REJECTED, VENT_STATUS.DELETED]],
    [VENT_STATUS.PUBLISHED, [VENT_STATUS.HIDDEN, VENT_STATUS.DELETED]],
    [VENT_STATUS.HIDDEN, [VENT_STATUS.PUBLISHED, VENT_STATUS.DELETED]],
    [VENT_STATUS.REJECTED, [VENT_STATUS.PENDING, VENT_STATUS.DELETED]],
    [VENT_STATUS.DELETED, []]
  ]),
  [ENTITY.INSIDER_SIGNAL]: edges([
    [INSIDER_SIGNAL_STATUS.DRAFT, [INSIDER_SIGNAL_STATUS.SUBMITTED, INSIDER_SIGNAL_STATUS.DELETED]],
    [INSIDER_SIGNAL_STATUS.SUBMITTED, [INSIDER_SIGNAL_STATUS.UNDER_REVIEW, INSIDER_SIGNAL_STATUS.DELETED]],
    [INSIDER_SIGNAL_STATUS.UNDER_REVIEW, [
      INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY,
      INSIDER_SIGNAL_STATUS.REJECTED,
      INSIDER_SIGNAL_STATUS.LEGAL_HOLD
    ]],
    [INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY, [
      INSIDER_SIGNAL_STATUS.LEGAL_HOLD,
      INSIDER_SIGNAL_STATUS.DELETED
    ]],
    [INSIDER_SIGNAL_STATUS.REJECTED, [INSIDER_SIGNAL_STATUS.UNDER_REVIEW, INSIDER_SIGNAL_STATUS.DELETED]],
    // legal_hold: cannot go to deleted (D-LEGAL-HOLD)
    [INSIDER_SIGNAL_STATUS.LEGAL_HOLD, [
      INSIDER_SIGNAL_STATUS.UNDER_REVIEW,
      INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY
    ]],
    [INSIDER_SIGNAL_STATUS.DELETED, []]
  ]),
  [ENTITY.EVIDENCE]: edges([
    [EVIDENCE_STATUS.UPLOADED, [EVIDENCE_STATUS.SCANNING, EVIDENCE_STATUS.PURGED]],
    [EVIDENCE_STATUS.SCANNING, [EVIDENCE_STATUS.AVAILABLE, EVIDENCE_STATUS.RESTRICTED, EVIDENCE_STATUS.PURGED]],
    [EVIDENCE_STATUS.AVAILABLE, [EVIDENCE_STATUS.RESTRICTED, EVIDENCE_STATUS.REDACTED, EVIDENCE_STATUS.PURGED]],
    [EVIDENCE_STATUS.RESTRICTED, [EVIDENCE_STATUS.AVAILABLE, EVIDENCE_STATUS.REDACTED, EVIDENCE_STATUS.PURGED]],
    [EVIDENCE_STATUS.REDACTED, [EVIDENCE_STATUS.PURGED]],
    [EVIDENCE_STATUS.PURGED, []]
  ]),
  [ENTITY.NEWS]: edges([
    [NEWS_STATUS.DISCOVERED, [NEWS_STATUS.PENDING, NEWS_STATUS.REJECTED]],
    [NEWS_STATUS.PENDING, [NEWS_STATUS.PUBLISHED, NEWS_STATUS.REJECTED]],
    [NEWS_STATUS.PUBLISHED, [NEWS_STATUS.ARCHIVED]],
    [NEWS_STATUS.ARCHIVED, [NEWS_STATUS.PUBLISHED]],
    [NEWS_STATUS.REJECTED, [NEWS_STATUS.PENDING]]
  ]),
  [ENTITY.DISCUSSION_TOPIC]: edges([
    [DISCUSSION_TOPIC_STATUS.PENDING, [
      DISCUSSION_TOPIC_STATUS.PUBLISHED,
      DISCUSSION_TOPIC_STATUS.REJECTED,
      DISCUSSION_TOPIC_STATUS.DELETED
    ]],
    [DISCUSSION_TOPIC_STATUS.PUBLISHED, [DISCUSSION_TOPIC_STATUS.LOCKED, DISCUSSION_TOPIC_STATUS.DELETED]],
    [DISCUSSION_TOPIC_STATUS.LOCKED, [DISCUSSION_TOPIC_STATUS.PUBLISHED, DISCUSSION_TOPIC_STATUS.DELETED]],
    [DISCUSSION_TOPIC_STATUS.REJECTED, [DISCUSSION_TOPIC_STATUS.PENDING, DISCUSSION_TOPIC_STATUS.DELETED]],
    [DISCUSSION_TOPIC_STATUS.DELETED, []]
  ]),
  [ENTITY.DISCUSSION_REPLY]: edges([
    [DISCUSSION_REPLY_STATUS.PENDING, [DISCUSSION_REPLY_STATUS.PUBLISHED, DISCUSSION_REPLY_STATUS.DELETED]],
    [DISCUSSION_REPLY_STATUS.PUBLISHED, [DISCUSSION_REPLY_STATUS.DELETED]],
    [DISCUSSION_REPLY_STATUS.DELETED, []]
  ]),
  [ENTITY.RESOURCE]: edges([
    [RESOURCE_STATUS.DRAFT, [RESOURCE_STATUS.PUBLISHED, RESOURCE_STATUS.DELETED]],
    [RESOURCE_STATUS.PUBLISHED, [RESOURCE_STATUS.ARCHIVED, RESOURCE_STATUS.DELETED]],
    [RESOURCE_STATUS.ARCHIVED, [RESOURCE_STATUS.PUBLISHED, RESOURCE_STATUS.DELETED]],
    [RESOURCE_STATUS.DELETED, []]
  ]),
  [ENTITY.OPPORTUNITY]: edges([
    [OPPORTUNITY_STATUS.DRAFT, [OPPORTUNITY_STATUS.OPEN, OPPORTUNITY_STATUS.DELETED]],
    [OPPORTUNITY_STATUS.OPEN, [OPPORTUNITY_STATUS.CLOSED, OPPORTUNITY_STATUS.DELETED]],
    [OPPORTUNITY_STATUS.CLOSED, [OPPORTUNITY_STATUS.ARCHIVED, OPPORTUNITY_STATUS.DELETED, OPPORTUNITY_STATUS.OPEN]],
    [OPPORTUNITY_STATUS.ARCHIVED, [OPPORTUNITY_STATUS.DELETED]],
    [OPPORTUNITY_STATUS.DELETED, []]
  ]),
  [ENTITY.COHORT]: edges([
    [COHORT_STATUS.DRAFT, [COHORT_STATUS.OPEN, COHORT_STATUS.CANCELLED]],
    [COHORT_STATUS.OPEN, [COHORT_STATUS.FULL, COHORT_STATUS.IN_PROGRESS, COHORT_STATUS.CANCELLED]],
    [COHORT_STATUS.FULL, [COHORT_STATUS.OPEN, COHORT_STATUS.IN_PROGRESS, COHORT_STATUS.CANCELLED]],
    [COHORT_STATUS.IN_PROGRESS, [COHORT_STATUS.COMPLETED, COHORT_STATUS.CANCELLED]],
    [COHORT_STATUS.COMPLETED, []],
    [COHORT_STATUS.CANCELLED, []]
  ]),
  [ENTITY.NOTIFICATION]: edges([
    [NOTIFICATION_STATUS.PENDING, [
      NOTIFICATION_STATUS.DELIVERED,
      NOTIFICATION_STATUS.FAILED,
      NOTIFICATION_STATUS.CANCELLED
    ]],
    [NOTIFICATION_STATUS.DELIVERED, [NOTIFICATION_STATUS.READ, NOTIFICATION_STATUS.CANCELLED]],
    [NOTIFICATION_STATUS.FAILED, [NOTIFICATION_STATUS.PENDING, NOTIFICATION_STATUS.CANCELLED]],
    [NOTIFICATION_STATUS.READ, []],
    [NOTIFICATION_STATUS.CANCELLED, []]
  ]),
  [ENTITY.MODERATION_CASE]: edges([
    [MODERATION_STATUS.OPEN, [MODERATION_STATUS.IN_REVIEW, MODERATION_STATUS.CLOSED]],
    [MODERATION_STATUS.IN_REVIEW, [
      MODERATION_STATUS.APPROVED,
      MODERATION_STATUS.REJECTED,
      MODERATION_STATUS.ESCALATED,
      MODERATION_STATUS.CLOSED
    ]],
    [MODERATION_STATUS.ESCALATED, [
      MODERATION_STATUS.IN_REVIEW,
      MODERATION_STATUS.APPROVED,
      MODERATION_STATUS.REJECTED,
      MODERATION_STATUS.CLOSED
    ]],
    [MODERATION_STATUS.APPROVED, [MODERATION_STATUS.CLOSED]],
    [MODERATION_STATUS.REJECTED, [MODERATION_STATUS.CLOSED]],
    [MODERATION_STATUS.CLOSED, []]
  ]),
  [ENTITY.APPEAL]: edges([
    [APPEAL_STATUS.SUBMITTED, [APPEAL_STATUS.UNDER_REVIEW, APPEAL_STATUS.WITHDRAWN]],
    [APPEAL_STATUS.UNDER_REVIEW, [
      APPEAL_STATUS.UPHELD,
      APPEAL_STATUS.OVERTURNED,
      APPEAL_STATUS.WITHDRAWN
    ]],
    [APPEAL_STATUS.UPHELD, []],
    [APPEAL_STATUS.OVERTURNED, []],
    [APPEAL_STATUS.WITHDRAWN, []]
  ]),
  // Outcomes are author updates — any → any except self is allowed; model as full mesh.
  [ENTITY.OUTCOME]: edges(
    valuesOf(OUTCOME_STATUS).map((from) => [
      from,
      valuesOf(OUTCOME_STATUS).filter((to) => to !== from)
    ])
  ),
  [ENTITY.TAKEDOWN_REQUEST]: edges([
    [TAKEDOWN_STATUS.PENDING, [TAKEDOWN_STATUS.IN_REVIEW, TAKEDOWN_STATUS.REJECTED]],
    [TAKEDOWN_STATUS.IN_REVIEW, [
      TAKEDOWN_STATUS.ACCEPTED,
      TAKEDOWN_STATUS.REJECTED,
      TAKEDOWN_STATUS.COMPLETED
    ]],
    [TAKEDOWN_STATUS.ACCEPTED, [TAKEDOWN_STATUS.COMPLETED]],
    [TAKEDOWN_STATUS.REJECTED, []],
    [TAKEDOWN_STATUS.COMPLETED, []]
  ]),
  [ENTITY.PETITION]: edges([
    [PETITION_STATUS.DRAFT, [PETITION_STATUS.OPEN, PETITION_STATUS.DELETED]],
    [PETITION_STATUS.OPEN, [PETITION_STATUS.CLOSED, PETITION_STATUS.DELETED]],
    [PETITION_STATUS.CLOSED, [PETITION_STATUS.DELETED]],
    [PETITION_STATUS.DELETED, []]
  ]),
  [ENTITY.ANONYMOUS_INBOX]: edges([
    [ANONYMOUS_INBOX_STATUS.RECEIVED, [ANONYMOUS_INBOX_STATUS.TRIAGED, ANONYMOUS_INBOX_STATUS.CLOSED]],
    [ANONYMOUS_INBOX_STATUS.TRIAGED, [ANONYMOUS_INBOX_STATUS.LINKED, ANONYMOUS_INBOX_STATUS.CLOSED]],
    [ANONYMOUS_INBOX_STATUS.LINKED, [ANONYMOUS_INBOX_STATUS.CLOSED]],
    [ANONYMOUS_INBOX_STATUS.CLOSED, []]
  ])
});

// ── Public-visible statuses (list APIs) ─────────────────────────────────────

const PUBLIC_LISTABLE_STATUSES = freezeEnum({
  [ENTITY.STORY]: Object.freeze([STORY_STATUS.PUBLISHED]),
  [ENTITY.VENT]: Object.freeze([VENT_STATUS.PUBLISHED]),
  [ENTITY.INSIDER_SIGNAL]: Object.freeze([INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY]),
  [ENTITY.EVIDENCE]: Object.freeze([]), // never public
  [ENTITY.NEWS]: Object.freeze([NEWS_STATUS.PUBLISHED]),
  [ENTITY.DISCUSSION_TOPIC]: Object.freeze([
    DISCUSSION_TOPIC_STATUS.PUBLISHED,
    DISCUSSION_TOPIC_STATUS.LOCKED
  ]),
  [ENTITY.DISCUSSION_REPLY]: Object.freeze([DISCUSSION_REPLY_STATUS.PUBLISHED]),
  [ENTITY.RESOURCE]: Object.freeze([RESOURCE_STATUS.PUBLISHED]),
  [ENTITY.OPPORTUNITY]: Object.freeze([OPPORTUNITY_STATUS.OPEN]),
  [ENTITY.COHORT]: Object.freeze([
    COHORT_STATUS.OPEN,
    COHORT_STATUS.FULL,
    COHORT_STATUS.IN_PROGRESS
  ]),
  [ENTITY.NOTIFICATION]: Object.freeze([]),
  [ENTITY.MODERATION_CASE]: Object.freeze([]),
  [ENTITY.APPEAL]: Object.freeze([]),
  [ENTITY.OUTCOME]: Object.freeze(valuesOf(OUTCOME_STATUS)), // shown via parent privacy
  [ENTITY.PETITION]: Object.freeze([PETITION_STATUS.OPEN, PETITION_STATUS.CLOSED]),
  [ENTITY.TAKEDOWN_REQUEST]: Object.freeze([]),
  [ENTITY.ANONYMOUS_INBOX]: Object.freeze([])
});

/** Max visibility allowed per entity. */
const ALLOWED_VISIBILITY = freezeEnum({
  [ENTITY.STORY]: Object.freeze([
    VISIBILITY.PUBLIC,
    VISIBILITY.COMMUNITY,
    VISIBILITY.RESTRICTED,
    VISIBILITY.PRIVATE
  ]),
  [ENTITY.VENT]: Object.freeze([
    VISIBILITY.PUBLIC,
    VISIBILITY.COMMUNITY,
    VISIBILITY.RESTRICTED,
    VISIBILITY.PRIVATE
  ]),
  [ENTITY.INSIDER_SIGNAL]: Object.freeze([
    VISIBILITY.PUBLIC, // summary only
    VISIBILITY.RESTRICTED,
    VISIBILITY.PRIVATE
  ]),
  [ENTITY.EVIDENCE]: Object.freeze([
    VISIBILITY.RESTRICTED,
    VISIBILITY.PRIVATE,
    VISIBILITY.SYSTEM
  ]),
  [ENTITY.NEWS]: Object.freeze([VISIBILITY.PUBLIC, VISIBILITY.COMMUNITY]),
  [ENTITY.DISCUSSION_TOPIC]: Object.freeze([
    VISIBILITY.PUBLIC,
    VISIBILITY.COMMUNITY,
    VISIBILITY.RESTRICTED
  ]),
  [ENTITY.DISCUSSION_REPLY]: Object.freeze([
    VISIBILITY.PUBLIC,
    VISIBILITY.COMMUNITY,
    VISIBILITY.RESTRICTED
  ]),
  [ENTITY.RESOURCE]: Object.freeze([VISIBILITY.PUBLIC, VISIBILITY.COMMUNITY]),
  [ENTITY.OPPORTUNITY]: Object.freeze([VISIBILITY.PUBLIC, VISIBILITY.COMMUNITY]),
  [ENTITY.COHORT]: Object.freeze([
    VISIBILITY.PUBLIC,
    VISIBILITY.COMMUNITY,
    VISIBILITY.RESTRICTED
  ]),
  [ENTITY.NOTIFICATION]: Object.freeze([VISIBILITY.PRIVATE, VISIBILITY.SYSTEM]),
  [ENTITY.MODERATION_CASE]: Object.freeze([VISIBILITY.RESTRICTED, VISIBILITY.SYSTEM]),
  [ENTITY.APPEAL]: Object.freeze([VISIBILITY.RESTRICTED, VISIBILITY.PRIVATE, VISIBILITY.SYSTEM]),
  [ENTITY.OUTCOME]: Object.freeze([
    VISIBILITY.PUBLIC,
    VISIBILITY.COMMUNITY,
    VISIBILITY.RESTRICTED,
    VISIBILITY.PRIVATE
  ])
});

// ── Retention ───────────────────────────────────────────────────────────────

const RETENTION_RULES = freezeEnum({
  [ENTITY.STORY]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 30,
    legalHoldBlocksPurge: true
  }),
  [ENTITY.VENT]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 30,
    legalHoldBlocksPurge: false,
    respectsAuthorPreference: true
  }),
  [ENTITY.INSIDER_SIGNAL]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 30,
    legalHoldBlocksPurge: true
  }),
  [ENTITY.EVIDENCE]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 90,
    legalHoldBlocksPurge: true
  }),
  [ENTITY.DISCUSSION_TOPIC]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 30,
    legalHoldBlocksPurge: false
  }),
  [ENTITY.DISCUSSION_REPLY]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 14,
    legalHoldBlocksPurge: false
  }),
  [ENTITY.NEWS]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 30,
    legalHoldBlocksPurge: false,
    appliesToStatuses: Object.freeze([NEWS_STATUS.REJECTED])
  }),
  [ENTITY.NOTIFICATION]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 90,
    legalHoldBlocksPurge: false
  }),
  [ENTITY.MODERATION_CASE]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 730,
    legalHoldBlocksPurge: true,
    retainClosedYears: 2
  }),
  [ENTITY.APPEAL]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 730,
    legalHoldBlocksPurge: true
  }),
  [ENTITY.AUDIT_EVENT]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 730,
    legalHoldBlocksPurge: true,
    minimumRetainDays: 730
  }),
  [ENTITY.COHORT]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 365,
    legalHoldBlocksPurge: false,
    rosterPiiPurgeDays: 90
  }),
  [ENTITY.RESOURCE]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 30,
    legalHoldBlocksPurge: false
  }),
  [ENTITY.OPPORTUNITY]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 30,
    legalHoldBlocksPurge: false,
    archiveAfterClosedDays: 180
  }),
  [ENTITY.PETITION]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 30,
    legalHoldBlocksPurge: false
  }),
  [ENTITY.USER_ACCOUNT]: Object.freeze({
    softDeleteDays: 0,
    purgeDays: 0,
    legalHoldBlocksPurge: true,
    piiPurgeOnDelete: true
  })
});

// ── Relationships (for docs/tooling) ────────────────────────────────────────

const RELATIONSHIPS = Object.freeze([
  Object.freeze({ from: ENTITY.USER_ACCOUNT, to: ENTITY.STORY, type: "authors" }),
  Object.freeze({ from: ENTITY.USER_ACCOUNT, to: ENTITY.VENT, type: "authors" }),
  Object.freeze({ from: ENTITY.USER_ACCOUNT, to: ENTITY.INSIDER_SIGNAL, type: "authors" }),
  Object.freeze({ from: ENTITY.USER_ACCOUNT, to: ENTITY.DISCUSSION_TOPIC, type: "authors" }),
  Object.freeze({ from: ENTITY.USER_ACCOUNT, to: ENTITY.DISCUSSION_REPLY, type: "authors" }),
  Object.freeze({ from: ENTITY.USER_ACCOUNT, to: ENTITY.APPEAL, type: "files" }),
  Object.freeze({ from: ENTITY.USER_ACCOUNT, to: ENTITY.NOTIFICATION, type: "receives" }),
  Object.freeze({ from: ENTITY.STORY, to: ENTITY.OUTCOME, type: "has" }),
  Object.freeze({ from: ENTITY.STORY, to: ENTITY.EVIDENCE, type: "may_attach" }),
  Object.freeze({ from: ENTITY.INSIDER_SIGNAL, to: ENTITY.EVIDENCE, type: "attaches" }),
  Object.freeze({ from: ENTITY.STORY, to: ENTITY.MODERATION_CASE, type: "reviewed_by" }),
  Object.freeze({ from: ENTITY.VENT, to: ENTITY.MODERATION_CASE, type: "reviewed_by" }),
  Object.freeze({ from: ENTITY.INSIDER_SIGNAL, to: ENTITY.MODERATION_CASE, type: "reviewed_by" }),
  Object.freeze({ from: ENTITY.DISCUSSION_TOPIC, to: ENTITY.DISCUSSION_REPLY, type: "contains" }),
  Object.freeze({ from: ENTITY.MODERATION_CASE, to: ENTITY.APPEAL, type: "may_appeal" }),
  Object.freeze({ from: ENTITY.COHORT, to: ENTITY.NOTIFICATION, type: "reminds" }),
  Object.freeze({ from: ENTITY.TAKEDOWN_REQUEST, to: ENTITY.STORY, type: "targets" })
]);

// ── Deletion cascades (pure rules) ──────────────────────────────────────────

/**
 * Cascade rules: when parent hits a trigger status, children get scheduled actions.
 * action: soft_delete | schedule_purge | cancel | anonymize | close
 */
const DELETION_CASCADES = Object.freeze([
  Object.freeze({
    id: "D-USER-CASCADE",
    parent: ENTITY.USER_ACCOUNT,
    trigger: "account_delete",
    effects: Object.freeze([
      Object.freeze({ child: ENTITY.STORY, action: "anonymize_or_soft_delete" }),
      Object.freeze({ child: ENTITY.VENT, action: "anonymize_or_soft_delete" }),
      Object.freeze({ child: ENTITY.INSIDER_SIGNAL, action: "anonymize_or_soft_delete" }),
      Object.freeze({ child: ENTITY.DISCUSSION_TOPIC, action: "anonymize_or_soft_delete" }),
      Object.freeze({ child: ENTITY.DISCUSSION_REPLY, action: "anonymize_or_soft_delete" }),
      Object.freeze({ child: ENTITY.EVIDENCE, action: "schedule_purge" }),
      Object.freeze({ child: ENTITY.NOTIFICATION, action: "cancel" }),
      Object.freeze({ child: ENTITY.AUDIT_EVENT, action: "redact_actor_pii" })
    ])
  }),
  Object.freeze({
    id: "D-STORY-CASCADE",
    parent: ENTITY.STORY,
    triggerStatus: STORY_STATUS.DELETED,
    effects: Object.freeze([
      Object.freeze({ child: ENTITY.OUTCOME, action: "hide" }),
      Object.freeze({ child: ENTITY.EVIDENCE, action: "schedule_purge" }),
      Object.freeze({ child: ENTITY.MODERATION_CASE, action: "close" })
    ])
  }),
  Object.freeze({
    id: "D-SIGNAL-CASCADE",
    parent: ENTITY.INSIDER_SIGNAL,
    triggerStatus: INSIDER_SIGNAL_STATUS.DELETED,
    effects: Object.freeze([
      Object.freeze({ child: ENTITY.EVIDENCE, action: "schedule_purge_unless_legal_hold" }),
      Object.freeze({ child: ENTITY.MODERATION_CASE, action: "close" })
    ])
  }),
  Object.freeze({
    id: "D-TOPIC-CASCADE",
    parent: ENTITY.DISCUSSION_TOPIC,
    triggerStatus: DISCUSSION_TOPIC_STATUS.DELETED,
    effects: Object.freeze([
      Object.freeze({ child: ENTITY.DISCUSSION_REPLY, action: "soft_delete" })
    ])
  })
]);

// ── API ownership (documentation + light tooling) ───────────────────────────

const API_BOUNDARIES = Object.freeze([
  Object.freeze({
    mount: "/api/auth",
    module: "routes/auth.js",
    owns: Object.freeze([ENTITY.USER_ACCOUNT])
  }),
  Object.freeze({
    mount: "/api/stories",
    module: "routes/stories.js",
    owns: Object.freeze([ENTITY.STORY, ENTITY.OUTCOME])
  }),
  Object.freeze({
    mount: "/api/forum",
    module: "routes/forum.js",
    owns: Object.freeze([ENTITY.DISCUSSION_TOPIC, ENTITY.DISCUSSION_REPLY])
  }),
  Object.freeze({
    mount: "/api/admin",
    module: "routes/admin.js",
    owns: Object.freeze([ENTITY.MODERATION_CASE, ENTITY.SANCTION])
  }),
  Object.freeze({
    mount: "/api/* (integrations)",
    module: "routes/integrations.js",
    owns: Object.freeze([
      ENTITY.NEWS,
      ENTITY.COHORT,
      ENTITY.PETITION,
      ENTITY.TAKEDOWN_REQUEST,
      ENTITY.ANONYMOUS_INBOX
    ])
  }),
  Object.freeze({
    mount: "/api/resources, /api/opportunities",
    module: "routes/resources.js",
    owns: Object.freeze([ENTITY.RESOURCE, ENTITY.OPPORTUNITY])
  }),
  Object.freeze({
    mount: "/api/vents (planned)",
    module: "routes/vents.js (planned)",
    owns: Object.freeze([ENTITY.VENT])
  }),
  Object.freeze({
    mount: "/api/signals (planned)",
    module: "routes/signals.js (planned)",
    owns: Object.freeze([ENTITY.INSIDER_SIGNAL, ENTITY.EVIDENCE])
  }),
  Object.freeze({
    mount: "/api/appeals (planned)",
    module: "routes/appeals.js (planned)",
    owns: Object.freeze([ENTITY.APPEAL])
  }),
  Object.freeze({
    mount: "/api/notifications (planned)",
    module: "routes/notifications.js (planned)",
    owns: Object.freeze([ENTITY.NOTIFICATION])
  })
]);

// ── Legacy runtime mapping (stories today) ──────────────────────────────────

/** Status strings currently written by production routes for stories. */
const LEGACY_STORY_STATUSES = Object.freeze([
  STORY_STATUS.PENDING,
  STORY_STATUS.PUBLISHED,
  STORY_STATUS.REJECTED
]);

const LEGACY_GAPS = Object.freeze({
  story: Object.freeze({
    runtime: LEGACY_STORY_STATUSES,
    contractExtra: Object.freeze([
      STORY_STATUS.DRAFT,
      STORY_STATUS.ARCHIVED,
      STORY_STATUS.DELETED
    ]),
    notes: "Runtime uses pending|published|rejected only; draft/archived/deleted are contract-forward."
  }),
  outcome: Object.freeze({
    runtime: Object.freeze(["foundNewJob boolean", "query outcome=found|searching"]),
    contract: OUTCOME_STATUS,
    notes: "Map foundNewJob true→found, false→searching until Outcome entity lands."
  }),
  discussion_topic: Object.freeze({
    // storageModerationAction already writes rejected for topics
    runtime: Object.freeze(["published", "pending", "deleted", "rejected"]),
    contractExtra: Object.freeze([DISCUSSION_TOPIC_STATUS.LOCKED])
  }),
  news: Object.freeze({
    runtime: Object.freeze(["published"]),
    contractExtra: Object.freeze([
      NEWS_STATUS.DISCOVERED,
      NEWS_STATUS.PENDING,
      NEWS_STATUS.ARCHIVED,
      NEWS_STATUS.REJECTED
    ])
  }),
  cohort: Object.freeze({
    runtime: Object.freeze(["open"]),
    contractExtra: Object.freeze([
      COHORT_STATUS.DRAFT,
      COHORT_STATUS.FULL,
      COHORT_STATUS.IN_PROGRESS,
      COHORT_STATUS.COMPLETED,
      COHORT_STATUS.CANCELLED
    ])
  })
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function getStatusEnum(entity) {
  const e = STATUS_ENUMS[entity];
  if (!e) {
    const err = new Error(`Unknown entity for status enum: ${entity}`);
    err.code = "UNKNOWN_ENTITY";
    throw err;
  }
  return e;
}

function isValidStatus(entity, status) {
  if (typeof status !== "string" || !status) return false;
  const enumObj = STATUS_ENUMS[entity];
  if (!enumObj) return false;
  return valuesOf(enumObj).includes(status);
}

/**
 * @param {string} entity
 * @param {string} status
 * @returns {string} status if valid
 * @throws {Error} if entity unknown or status not in enum (rejects free-form)
 */
function assertValidStatus(entity, status) {
  if (!STATUS_ENUMS[entity]) {
    const err = new Error(`Unknown entity: ${entity}`);
    err.code = "UNKNOWN_ENTITY";
    throw err;
  }
  if (!isValidStatus(entity, status)) {
    const err = new Error(
      `Invalid status "${status}" for entity "${entity}". Allowed: ${valuesOf(STATUS_ENUMS[entity]).join(", ")}`
    );
    err.code = "INVALID_STATUS";
    err.entity = entity;
    err.status = status;
    throw err;
  }
  return status;
}

function canTransition(entity, from, to) {
  // Validate endpoints first so invalid statuses never pass via same-state no-op
  // (e.g. canTransition("story","live","live") must be false).
  if (!isValidStatus(entity, from) || !isValidStatus(entity, to)) return false;
  if (from === to) return true;
  const graph = TRANSITIONS[entity];
  if (!graph) return false;
  const allowed = graph[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Assert transition; throws on invalid status or disallowed edge.
 */
function assertCanTransition(entity, from, to) {
  assertValidStatus(entity, from);
  assertValidStatus(entity, to);
  if (!canTransition(entity, from, to)) {
    const err = new Error(
      `Illegal transition for ${entity}: ${from} → ${to}`
    );
    err.code = "ILLEGAL_TRANSITION";
    err.entity = entity;
    err.from = from;
    err.to = to;
    throw err;
  }
  return true;
}

function isPubliclyListable(entity, status) {
  const list = PUBLIC_LISTABLE_STATUSES[entity];
  if (!list) return false;
  return list.includes(status);
}

function isVisibilityAllowed(entity, visibility) {
  const list = ALLOWED_VISIBILITY[entity];
  if (!list) return false;
  return list.includes(visibility);
}

function getRetentionRule(entity) {
  return RETENTION_RULES[entity] || null;
}

function getCascadeRules(parentEntity) {
  return DELETION_CASCADES.filter((r) => r.parent === parentEntity);
}

/** Map moderation staff action to content story/topic status. */
function moderationActionToContentStatus(action) {
  if (action === "approve") return STORY_STATUS.PUBLISHED;
  if (action === "reject") return STORY_STATUS.REJECTED;
  const err = new Error(`Unknown moderation action: ${action}`);
  err.code = "INVALID_MODERATION_ACTION";
  throw err;
}

/** Map legacy foundNewJob boolean to OUTCOME_STATUS. */
function outcomeFromFoundNewJob(foundNewJob) {
  return foundNewJob ? OUTCOME_STATUS.FOUND : OUTCOME_STATUS.SEARCHING;
}

function foundNewJobFromOutcome(outcome) {
  assertValidStatus(ENTITY.OUTCOME, outcome);
  return outcome === OUTCOME_STATUS.FOUND || outcome === OUTCOME_STATUS.PIVOTED;
}

function defaultDesiredResponse(intent) {
  if (!valuesOf(PUBLICATION_INTENT).includes(intent)) {
    const err = new Error(`Unknown publication intent: ${intent}`);
    err.code = "INVALID_INTENT";
    throw err;
  }
  return DEFAULT_DESIRED_RESPONSE_BY_INTENT[intent];
}

function isLegalHoldBlockingDelete(entity, status) {
  if (entity === ENTITY.INSIDER_SIGNAL && status === INSIDER_SIGNAL_STATUS.LEGAL_HOLD) {
    return true;
  }
  return false;
}

/**
 * Pure cascade planner for tests and future storage layer.
 * @returns {{ allowed: boolean, reason?: string, effects: object[] }}
 */
function planDeletion(entity, status, options = {}) {
  if (isLegalHoldBlockingDelete(entity, status)) {
    return {
      allowed: false,
      reason: "D-LEGAL-HOLD: cannot delete while legal_hold",
      effects: []
    };
  }
  if (status === STORY_STATUS.DELETED || status === VENT_STATUS.DELETED ||
      status === INSIDER_SIGNAL_STATUS.DELETED || status === DISCUSSION_TOPIC_STATUS.DELETED) {
    // already deleted
    const rules = getCascadeRules(entity).filter(
      (r) => r.triggerStatus === status || r.trigger === options.trigger
    );
    return {
      allowed: true,
      effects: rules.flatMap((r) => [...r.effects])
    };
  }
  if (options.trigger === "account_delete" && entity === ENTITY.USER_ACCOUNT) {
    const rules = getCascadeRules(ENTITY.USER_ACCOUNT);
    return {
      allowed: true,
      effects: rules.flatMap((r) => [...r.effects])
    };
  }
  // generic: can we transition to deleted?
  const deletedStatus =
    entity === ENTITY.EVIDENCE ? EVIDENCE_STATUS.PURGED :
    STATUS_ENUMS[entity] && valuesOf(STATUS_ENUMS[entity]).includes("deleted")
      ? "deleted"
      : null;
  if (!deletedStatus) {
    return { allowed: false, reason: "Entity has no deleted/purged terminal via this planner", effects: [] };
  }
  if (!canTransition(entity, status, deletedStatus)) {
    return {
      allowed: false,
      reason: `Cannot transition ${entity} ${status} → ${deletedStatus}`,
      effects: []
    };
  }
  const rules = getCascadeRules(entity).filter((r) => r.triggerStatus === deletedStatus);
  return {
    allowed: true,
    effects: rules.flatMap((r) => [...r.effects]),
    toStatus: deletedStatus
  };
}

/** Privacy invariant checks (pure). */
const PRIVACY_INVARIANTS = Object.freeze({
  "P-EVIDENCE-PUBLIC": () =>
    PUBLIC_LISTABLE_STATUSES[ENTITY.EVIDENCE].length === 0 &&
    valuesOf(EVIDENCE_STATUS).every((s) => !isPubliclyListable(ENTITY.EVIDENCE, s)),
  "P-VIS-EVIDENCE": () => {
    const allowed = ALLOWED_VISIBILITY[ENTITY.EVIDENCE];
    return (
      !allowed.includes(VISIBILITY.PUBLIC) &&
      !allowed.includes(VISIBILITY.COMMUNITY) &&
      allowed.includes(VISIBILITY.RESTRICTED)
    );
  },
  "P-STORY-PUBLIC-STATUS": () =>
    PUBLIC_LISTABLE_STATUSES[ENTITY.STORY].length === 1 &&
    PUBLIC_LISTABLE_STATUSES[ENTITY.STORY][0] === STORY_STATUS.PUBLISHED &&
    !isPubliclyListable(ENTITY.STORY, STORY_STATUS.PENDING) &&
    !isPubliclyListable(ENTITY.STORY, STORY_STATUS.DELETED) &&
    !isPubliclyListable(ENTITY.STORY, STORY_STATUS.REJECTED),
  "P-NOTIFY-PRIVATE": () =>
    PUBLIC_LISTABLE_STATUSES[ENTITY.NOTIFICATION].length === 0 &&
    !isVisibilityAllowed(ENTITY.NOTIFICATION, VISIBILITY.PUBLIC),
  "D-NO-PUBLIC-DELETED": () => {
    const entitiesWithDeleted = [
      ENTITY.STORY,
      ENTITY.VENT,
      ENTITY.INSIDER_SIGNAL,
      ENTITY.DISCUSSION_TOPIC,
      ENTITY.DISCUSSION_REPLY,
      ENTITY.RESOURCE,
      ENTITY.OPPORTUNITY,
      ENTITY.PETITION
    ];
    return entitiesWithDeleted.every((e) => !isPubliclyListable(e, "deleted"));
  },
  "D-LEGAL-HOLD": () =>
    !canTransition(
      ENTITY.INSIDER_SIGNAL,
      INSIDER_SIGNAL_STATUS.LEGAL_HOLD,
      INSIDER_SIGNAL_STATUS.DELETED
    )
});

function evaluatePrivacyInvariants() {
  const results = {};
  for (const [id, fn] of Object.entries(PRIVACY_INVARIANTS)) {
    results[id] = Boolean(fn());
  }
  return results;
}

// ── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  DOMAIN_CONTRACT_VERSION,

  PUBLICATION_INTENT,
  DESIRED_RESPONSE,
  ANONYMITY_MODE,
  ADVICE_PERMISSION,
  RETENTION_PREFERENCE,
  DEFAULT_DESIRED_RESPONSE_BY_INTENT,

  VISIBILITY,
  NAME_DISPLAY,
  COMPANY_DISPLAY,
  GEO_DISPLAY,
  DATE_DISPLAY,

  STORY_STATUS,
  VENT_STATUS,
  INSIDER_SIGNAL_STATUS,
  VERIFICATION_LEVEL,
  EVIDENCE_STATUS,
  EVIDENCE_TIER,
  NEWS_STATUS,
  DISCUSSION_TOPIC_STATUS,
  DISCUSSION_REPLY_STATUS,
  RESOURCE_STATUS,
  OPPORTUNITY_STATUS,
  RESOURCE_VERIFICATION_STATE,
  RESOURCE_LINK_STATUS,
  RESOURCE_COST,
  RESOURCE_REPORT_STATUS,
  COHORT_STATUS,
  NOTIFICATION_STATUS,
  MODERATION_STATUS,
  APPEAL_STATUS,
  OUTCOME_STATUS,
  SANCTION_TYPE,
  TAKEDOWN_STATUS,
  PETITION_STATUS,
  ANONYMOUS_INBOX_STATUS,

  ENTITY,
  STATUS_ENUMS,
  TRANSITIONS,
  PUBLIC_LISTABLE_STATUSES,
  ALLOWED_VISIBILITY,
  RETENTION_RULES,
  RELATIONSHIPS,
  DELETION_CASCADES,
  API_BOUNDARIES,
  LEGACY_STORY_STATUSES,
  LEGACY_GAPS,
  PRIVACY_INVARIANTS,

  // helpers
  valuesOf,
  getStatusEnum,
  isValidStatus,
  assertValidStatus,
  canTransition,
  assertCanTransition,
  isPubliclyListable,
  isVisibilityAllowed,
  getRetentionRule,
  getCascadeRules,
  moderationActionToContentStatus,
  outcomeFromFoundNewJob,
  foundNewJobFromOutcome,
  defaultDesiredResponse,
  isLegalHoldBlockingDelete,
  planDeletion,
  evaluatePrivacyInvariants
};
