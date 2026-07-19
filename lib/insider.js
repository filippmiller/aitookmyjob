/**
 * Insider signals + protected evidence workflow.
 *
 * Public surface: summary + verificationLevel only (P-SIGNAL-PUBLIC).
 * Evidence is never publicly listable; every privileged access is audited.
 * Two independent reports can be linked without exposing authors.
 *
 * Uses domain-contract enums/transitions (INSIDER_SIGNAL_STATUS, EVIDENCE_*,
 * VERIFICATION_LEVEL, legal_hold / retention).
 *
 * Bead: aitj-z8q.9
 */

"use strict";

const { customAlphabet } = require("nanoid");
const crypto = require("crypto");
const domain = require("./domain-contract");

const {
  ENTITY,
  INSIDER_SIGNAL_STATUS,
  EVIDENCE_STATUS,
  VERIFICATION_LEVEL,
  VISIBILITY,
  RETENTION_PREFERENCE,
  assertValidStatus,
  assertCanTransition,
  canTransition,
  isPubliclyListable,
  isVisibilityAllowed,
  isLegalHoldBlockingDelete,
  getRetentionRule,
  planDeletion,
  valuesOf
} = domain;

const idGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);
const trackGen = customAlphabet("1234567890ABCDEFGHJKLMNPQRSTUVWXYZ", 10);

const AUTOMATION_TYPES = Object.freeze([
  "llm_chatbot",
  "rpa",
  "copilot",
  "full_role_replacement",
  "scheduling",
  "customer_support",
  "content_generation",
  "code_generation",
  "other"
]);

const EVIDENCE_ACCESS_ACTIONS = Object.freeze([
  "view",
  "download",
  "metadata",
  "redact",
  "purge",
  "status_change",
  "upload",
  "list"
]);

/** Fields that must never appear on public payloads. */
const PUBLIC_FORBIDDEN_KEYS = Object.freeze([
  "authorId",
  "author_id",
  "trackingCode",
  "tracking_code",
  "bodyRestricted",
  "body_restricted",
  "storageKey",
  "storage_key",
  "bodyRef",
  "body_ref",
  "filenameStored",
  "filename_stored",
  "sha256",
  "uploaderId",
  "uploader_id",
  "evidence",
  "rawEvidence",
  "blob",
  "content",
  "bytes"
]);

/** Metadata keys stripped on upload / redaction hooks (EXIF-ish / PII). */
const METADATA_STRIP_KEYS = Object.freeze([
  "gps",
  "GPS",
  "gpsLatitude",
  "gpsLongitude",
  "latitude",
  "longitude",
  "exif",
  "EXIF",
  "deviceSerial",
  "serialNumber",
  "author",
  "creator",
  "lastModifiedBy",
  "owner",
  "email",
  "phone",
  "ssn",
  "ip",
  "userAgent",
  "originalPath",
  "localPath",
  "username",
  "fullName",
  "address"
]);

// ── In-memory store (dev without DATABASE_URL) ──────────────────────────────

const memory = {
  signals: new Map(),
  evidence: new Map(),
  accessLog: new Map(),
  links: new Map()
};

function memoryReset() {
  memory.signals.clear();
  memory.evidence.clear();
  memory.accessLog.clear();
  memory.links.clear();
}

function nowIso() {
  return new Date().toISOString();
}

function newSignalId() {
  return `sig_${idGen()}`;
}

function newEvidenceId() {
  return `evd_${idGen()}`;
}

function newAccessId() {
  return `eal_${idGen()}`;
}

function newLinkId() {
  return `slk_${idGen()}`;
}

function newTrackingCode() {
  return `INS-${trackGen()}`;
}

// ── Pool resolution (same pattern as lib/jobs.js) ───────────────────────────

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

// ── Pure helpers: metadata redaction, public summary, privacy ───────────────

/**
 * Strip EXIF/PII-ish keys from evidence metadata. Recursive for plain objects.
 * @param {object|null|undefined} meta
 * @returns {{ stripped: object, removedKeys: string[] }}
 */
function stripMetadata(meta) {
  const removedKeys = [];
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return { stripped: {}, removedKeys };
  }

  function walk(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (METADATA_STRIP_KEYS.includes(k)) {
        removedKeys.push(k);
        continue;
      }
      // nested common containers
      if (k === "exif" || k === "EXIF" || k === "gps" || k === "GPS") {
        removedKeys.push(k);
        continue;
      }
      out[k] = typeof v === "object" && v !== null && !Array.isArray(v) ? walk(v) : v;
    }
    return out;
  }

  return { stripped: walk(meta), removedKeys: [...new Set(removedKeys)] };
}

/**
 * Redact original filename: keep extension, hash basename.
 */
function redactFilename(name) {
  const raw = String(name || "file").trim() || "file";
  const lastDot = raw.lastIndexOf(".");
  const ext = lastDot > 0 && lastDot < raw.length - 1 ? raw.slice(lastDot) : "";
  const hash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `redacted_${hash}${ext.toLowerCase()}`;
}

/**
 * Build the only public-safe summary for an insider signal.
 * Explicit verificationLevel; never author, tracking, restricted body, or evidence blobs.
 */
function toPublicSummary(signal) {
  if (!signal) return null;
  if (!isPubliclyListable(ENTITY.INSIDER_SIGNAL, signal.status)) {
    return null;
  }
  return {
    id: signal.id,
    companySlug: signal.companySlug,
    companyName: signal.companyName || undefined,
    rolesAffected: Array.isArray(signal.rolesAffected) ? [...signal.rolesAffected] : [],
    automationType: signal.automationType || "",
    eventDate: signal.eventDate || null,
    confidence: signal.confidence == null ? null : Number(signal.confidence),
    verificationLevel: signal.verificationLevel,
    status: INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY,
    summary: signal.summaryPublic || "",
    publishedAt: signal.publishedAt || null,
    // Count of linked reports only — no author ids
    linkedReportCount: Number(signal.linkedReportCount || 0)
  };
}

/**
 * Assert a payload does not leak evidence or author fields (for tests + route guard).
 */
function assertPublicSafe(payload) {
  if (!payload || typeof payload !== "object") return true;
  const stack = [payload];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur)) {
      if (PUBLIC_FORBIDDEN_KEYS.includes(k)) {
        const err = new Error(`Public payload leaks forbidden field: ${k}`);
        err.code = "PUBLIC_LEAK";
        err.field = k;
        throw err;
      }
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return true;
}

/**
 * Evidence metadata-only projection for staff (still no body_ref / bytes).
 * Full storage_key only when includeStorageKey=true (download path).
 */
function toEvidenceStaffMeta(ev, { includeStorageKey = false } = {}) {
  if (!ev) return null;
  if (ev.status === EVIDENCE_STATUS.PURGED) {
    return {
      id: ev.id,
      parentType: ev.parentType,
      parentId: ev.parentId,
      status: EVIDENCE_STATUS.PURGED,
      purgedAt: ev.purgedAt || null
    };
  }
  const out = {
    id: ev.id,
    parentType: ev.parentType,
    parentId: ev.parentId,
    status: ev.status,
    visibility: ev.visibility,
    contentType: ev.contentType,
    filenameOriginal: ev.filenameOriginal,
    filenameStored: ev.filenameStored,
    sizeBytes: ev.sizeBytes,
    sha256: ev.sha256 || null,
    redactionNotes: ev.redactionNotes || null,
    metadata: ev.metadata || {},
    metadataStripped: Boolean(ev.metadataStripped),
    createdAt: ev.createdAt,
    updatedAt: ev.updatedAt
  };
  if (includeStorageKey) {
    out.storageKey = ev.storageKey;
    out.bodyRef = ev.bodyRef || null;
  }
  return out;
}

/**
 * Staff-facing signal (includes restricted body + author for audit); never includes evidence blobs.
 */
function toStaffSignal(signal) {
  if (!signal) return null;
  return {
    id: signal.id,
    companySlug: signal.companySlug,
    companyName: signal.companyName,
    rolesAffected: Array.isArray(signal.rolesAffected) ? [...signal.rolesAffected] : [],
    automationType: signal.automationType,
    eventDate: signal.eventDate,
    confidence: signal.confidence == null ? null : Number(signal.confidence),
    verificationLevel: signal.verificationLevel,
    status: signal.status,
    visibility: signal.visibility,
    summaryPublic: signal.summaryPublic,
    bodyRestricted: signal.bodyRestricted,
    authorId: signal.authorId,
    trackingCode: signal.trackingCode,
    retentionPreference: signal.retentionPreference,
    purgeAfter: signal.purgeAfter,
    metadataStripped: Boolean(signal.metadataStripped),
    createdAt: signal.createdAt,
    updatedAt: signal.updatedAt,
    submittedAt: signal.submittedAt,
    publishedAt: signal.publishedAt,
    deletedAt: signal.deletedAt
  };
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles)) return [];
  return roles
    .map((r) => String(r || "").trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 40);
}

function normalizeAutomationType(t) {
  const s = String(t || "other").trim().toLowerCase().replace(/\s+/g, "_");
  return AUTOMATION_TYPES.includes(s) ? s : "other";
}

function normalizeVerificationLevel(v) {
  const s = String(v || VERIFICATION_LEVEL.UNCORROBORATED).trim().toLowerCase();
  if (valuesOf(VERIFICATION_LEVEL).includes(s)) return s;
  return VERIFICATION_LEVEL.UNCORROBORATED;
}

function normalizeRetention(v) {
  const s = String(v || RETENTION_PREFERENCE.INDEFINITE).trim().toLowerCase();
  if (valuesOf(RETENTION_PREFERENCE).includes(s)) return s;
  return RETENTION_PREFERENCE.INDEFINITE;
}

function parseEventDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function parseConfidence(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return Math.min(1, Math.max(0, n));
}

function slugifyCompany(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function orderedPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

function retentionPurgeAfter(entity, fromDate = new Date()) {
  const rule = getRetentionRule(entity);
  if (!rule) return null;
  const days = Number(rule.purgeDays || 0);
  if (!days) return null;
  const d = new Date(fromDate);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

// ── Row mappers ─────────────────────────────────────────────────────────────

function rowToSignal(row) {
  if (!row) return null;
  let roles = row.roles_affected ?? row.rolesAffected ?? [];
  if (typeof roles === "string") {
    try {
      roles = JSON.parse(roles);
    } catch (_e) {
      roles = [];
    }
  }
  return {
    id: row.id,
    companySlug: row.company_slug ?? row.companySlug,
    companyName: row.company_name ?? row.companyName ?? "",
    rolesAffected: Array.isArray(roles) ? roles : [],
    automationType: row.automation_type ?? row.automationType ?? "",
    eventDate: row.event_date
      ? (row.event_date instanceof Date
        ? row.event_date.toISOString().slice(0, 10)
        : String(row.event_date).slice(0, 10))
      : row.eventDate || null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    verificationLevel: row.verification_level ?? row.verificationLevel,
    status: row.status,
    visibility: row.visibility,
    summaryPublic: row.summary_public ?? row.summaryPublic ?? null,
    bodyRestricted: row.body_restricted ?? row.bodyRestricted ?? null,
    authorId: row.author_id ?? row.authorId ?? null,
    trackingCode: row.tracking_code ?? row.trackingCode ?? null,
    retentionPreference: row.retention_preference ?? row.retentionPreference ?? RETENTION_PREFERENCE.INDEFINITE,
    purgeAfter: row.purge_after
      ? new Date(row.purge_after).toISOString()
      : row.purgeAfter || null,
    metadataStripped: Boolean(row.metadata_stripped ?? row.metadataStripped),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : row.createdAt,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : row.updatedAt,
    submittedAt: row.submitted_at
      ? new Date(row.submitted_at).toISOString()
      : row.submittedAt || null,
    publishedAt: row.published_at
      ? new Date(row.published_at).toISOString()
      : row.publishedAt || null,
    deletedAt: row.deleted_at
      ? new Date(row.deleted_at).toISOString()
      : row.deletedAt || null
  };
}

function rowToEvidence(row) {
  if (!row) return null;
  let meta = row.metadata ?? {};
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta);
    } catch (_e) {
      meta = {};
    }
  }
  return {
    id: row.id,
    parentType: row.parent_type ?? row.parentType,
    parentId: row.parent_id ?? row.parentId,
    uploaderId: row.uploader_id ?? row.uploaderId ?? null,
    status: row.status,
    visibility: row.visibility,
    contentType: row.content_type ?? row.contentType ?? "application/octet-stream",
    filenameOriginal: row.filename_original ?? row.filenameOriginal ?? "",
    filenameStored: row.filename_stored ?? row.filenameStored ?? "",
    storageKey: row.storage_key ?? row.storageKey ?? "",
    sizeBytes: Number(row.size_bytes ?? row.sizeBytes ?? 0),
    sha256: row.sha256 || null,
    redactionNotes: row.redaction_notes ?? row.redactionNotes ?? null,
    metadata: meta,
    metadataStripped: Boolean(row.metadata_stripped ?? row.metadataStripped),
    bodyRef: row.body_ref ?? row.bodyRef ?? null,
    purgeAfter: row.purge_after
      ? new Date(row.purge_after).toISOString()
      : row.purgeAfter || null,
    purgedAt: row.purged_at
      ? new Date(row.purged_at).toISOString()
      : row.purgedAt || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : row.createdAt,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : row.updatedAt
  };
}

function rowToAccess(row) {
  if (!row) return null;
  let meta = row.metadata ?? {};
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta);
    } catch (_e) {
      meta = {};
    }
  }
  return {
    id: row.id,
    evidenceId: row.evidence_id ?? row.evidenceId,
    actorId: row.actor_id ?? row.actorId,
    action: row.action,
    reason: row.reason || null,
    ip: row.ip || null,
    metadata: meta,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : row.createdAt
  };
}

function rowToLink(row) {
  if (!row) return null;
  return {
    id: row.id,
    signalIdA: row.signal_id_a ?? row.signalIdA,
    signalIdB: row.signal_id_b ?? row.signalIdB,
    linkedBy: row.linked_by ?? row.linkedBy,
    reason: row.reason || "",
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : row.createdAt
  };
}

// ── Memory CRUD ─────────────────────────────────────────────────────────────

function memoryCreateSignal(input) {
  const id = input.id || newSignalId();
  const now = nowIso();
  const signal = {
    id,
    companySlug: input.companySlug,
    companyName: input.companyName || "",
    rolesAffected: normalizeRoles(input.rolesAffected),
    automationType: normalizeAutomationType(input.automationType),
    eventDate: parseEventDate(input.eventDate),
    confidence: parseConfidence(input.confidence),
    verificationLevel: normalizeVerificationLevel(input.verificationLevel),
    status: input.status || INSIDER_SIGNAL_STATUS.DRAFT,
    visibility: input.visibility || VISIBILITY.RESTRICTED,
    summaryPublic: input.summaryPublic || null,
    bodyRestricted: input.bodyRestricted || null,
    authorId: input.authorId || null,
    trackingCode: input.trackingCode || null,
    retentionPreference: normalizeRetention(input.retentionPreference),
    purgeAfter: null,
    metadataStripped: Boolean(input.metadataStripped),
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    publishedAt: null,
    deletedAt: null
  };
  assertValidStatus(ENTITY.INSIDER_SIGNAL, signal.status);
  if (!isVisibilityAllowed(ENTITY.INSIDER_SIGNAL, signal.visibility)) {
    const err = new Error(`Invalid visibility for insider_signal: ${signal.visibility}`);
    err.code = "INVALID_VISIBILITY";
    throw err;
  }
  memory.signals.set(id, signal);
  return { ...signal };
}

function memoryGetSignal(id) {
  const s = memory.signals.get(id);
  return s ? { ...s, rolesAffected: [...s.rolesAffected] } : null;
}

function memoryListSignals({ status, companySlug, publicOnly = false, limit = 50, offset = 0 } = {}) {
  let rows = [...memory.signals.values()];
  if (publicOnly) {
    rows = rows.filter((s) => isPubliclyListable(ENTITY.INSIDER_SIGNAL, s.status));
  } else if (status) {
    rows = rows.filter((s) => s.status === status);
  }
  if (companySlug) {
    rows = rows.filter((s) => s.companySlug === companySlug);
  }
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const total = rows.length;
  return {
    signals: rows.slice(offset, offset + limit).map((s) => ({
      ...s,
      rolesAffected: [...s.rolesAffected]
    })),
    total
  };
}

function memoryUpdateSignal(id, patch) {
  const cur = memory.signals.get(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: nowIso() };
  if (patch.rolesAffected) next.rolesAffected = normalizeRoles(patch.rolesAffected);
  memory.signals.set(id, next);
  return { ...next, rolesAffected: [...next.rolesAffected] };
}

function memoryCreateEvidence(input) {
  const id = input.id || newEvidenceId();
  const now = nowIso();
  const { stripped, removedKeys } = stripMetadata(input.metadata || {});
  const filenameOriginal = String(input.filenameOriginal || "file").slice(0, 255);
  const filenameStored = input.filenameStored || redactFilename(filenameOriginal);
  const visibility = input.visibility || VISIBILITY.RESTRICTED;
  if (!isVisibilityAllowed(ENTITY.EVIDENCE, visibility)) {
    const err = new Error(`Invalid visibility for evidence: ${visibility}`);
    err.code = "INVALID_VISIBILITY";
    throw err;
  }
  const ev = {
    id,
    parentType: input.parentType,
    parentId: input.parentId,
    uploaderId: input.uploaderId || null,
    status: input.status || EVIDENCE_STATUS.UPLOADED,
    visibility,
    contentType: input.contentType || "application/octet-stream",
    filenameOriginal,
    filenameStored,
    storageKey: input.storageKey || `evidence/${id}/${filenameStored}`,
    sizeBytes: Math.max(0, Number(input.sizeBytes || 0)),
    sha256: input.sha256 || null,
    redactionNotes: input.redactionNotes || null,
    metadata: stripped,
    metadataStripped: true,
    bodyRef: input.bodyRef || null,
    purgeAfter: null,
    purgedAt: null,
    createdAt: now,
    updatedAt: now,
    _stripRemovedKeys: removedKeys
  };
  assertValidStatus(ENTITY.EVIDENCE, ev.status);
  memory.evidence.set(id, ev);
  const { _stripRemovedKeys, ...publicEv } = ev;
  return { evidence: { ...publicEv }, removedKeys: _stripRemovedKeys };
}

function memoryGetEvidence(id) {
  const e = memory.evidence.get(id);
  if (!e) return null;
  const { _stripRemovedKeys, ...rest } = e;
  return { ...rest, metadata: { ...(rest.metadata || {}) } };
}

function memoryListEvidenceForParent(parentType, parentId) {
  return [...memory.evidence.values()]
    .filter((e) => e.parentType === parentType && e.parentId === parentId)
    .map((e) => {
      const { _stripRemovedKeys, ...rest } = e;
      return { ...rest, metadata: { ...(rest.metadata || {}) } };
    });
}

function memoryUpdateEvidence(id, patch) {
  const cur = memory.evidence.get(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: nowIso() };
  memory.evidence.set(id, next);
  const { _stripRemovedKeys, ...rest } = next;
  return { ...rest };
}

function memoryLogAccess(entry) {
  const id = entry.id || newAccessId();
  const row = {
    id,
    evidenceId: entry.evidenceId,
    actorId: entry.actorId,
    action: entry.action,
    reason: entry.reason || null,
    ip: entry.ip || null,
    metadata: entry.metadata || {},
    createdAt: nowIso()
  };
  memory.accessLog.set(id, row);
  return { ...row };
}

function memoryListAccess(evidenceId, { limit = 100 } = {}) {
  return [...memory.accessLog.values()]
    .filter((a) => a.evidenceId === evidenceId)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
    .map((a) => ({ ...a }));
}

function memoryLinkSignals(signalIdA, signalIdB, { linkedBy, reason } = {}) {
  if (signalIdA === signalIdB) {
    const err = new Error("Cannot link a signal to itself");
    err.code = "INVALID_LINK";
    throw err;
  }
  const [a, b] = orderedPair(signalIdA, signalIdB);
  if (!memory.signals.has(a) || !memory.signals.has(b)) {
    const err = new Error("One or both signals not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  for (const link of memory.links.values()) {
    if (link.signalIdA === a && link.signalIdB === b) {
      return { link: { ...link }, created: false };
    }
  }
  const link = {
    id: newLinkId(),
    signalIdA: a,
    signalIdB: b,
    linkedBy: linkedBy || "system",
    reason: reason || "",
    createdAt: nowIso()
  };
  memory.links.set(link.id, link);
  return { link: { ...link }, created: true };
}

function memoryListLinksFor(signalId) {
  return [...memory.links.values()]
    .filter((l) => l.signalIdA === signalId || l.signalIdB === signalId)
    .map((l) => ({
      id: l.id,
      peerSignalId: l.signalIdA === signalId ? l.signalIdB : l.signalIdA,
      // deliberately no author fields
      reason: l.reason,
      createdAt: l.createdAt
    }));
}

function memoryLinkedCount(signalId) {
  return memoryListLinksFor(signalId).length;
}

// ── Postgres CRUD ───────────────────────────────────────────────────────────

async function pgCreateSignal(pool, input) {
  const id = input.id || newSignalId();
  const status = input.status || INSIDER_SIGNAL_STATUS.DRAFT;
  const visibility = input.visibility || VISIBILITY.RESTRICTED;
  assertValidStatus(ENTITY.INSIDER_SIGNAL, status);
  if (!isVisibilityAllowed(ENTITY.INSIDER_SIGNAL, visibility)) {
    const err = new Error(`Invalid visibility for insider_signal: ${visibility}`);
    err.code = "INVALID_VISIBILITY";
    throw err;
  }
  const roles = normalizeRoles(input.rolesAffected);
  await pool.query(
    `INSERT INTO insider_signals (
      id, company_slug, company_name, roles_affected, automation_type, event_date,
      confidence, verification_level, status, visibility, summary_public, body_restricted,
      author_id, tracking_code, retention_preference, metadata_stripped, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW()
    );`,
    [
      id,
      input.companySlug,
      input.companyName || "",
      JSON.stringify(roles),
      normalizeAutomationType(input.automationType),
      parseEventDate(input.eventDate),
      parseConfidence(input.confidence),
      normalizeVerificationLevel(input.verificationLevel),
      status,
      visibility,
      input.summaryPublic || null,
      input.bodyRestricted || null,
      input.authorId || null,
      input.trackingCode || null,
      normalizeRetention(input.retentionPreference),
      Boolean(input.metadataStripped)
    ]
  );
  return pgGetSignal(pool, id);
}

async function pgGetSignal(pool, id) {
  const res = await pool.query("SELECT * FROM insider_signals WHERE id = $1 LIMIT 1;", [id]);
  return rowToSignal(res.rows[0]);
}

async function pgListSignals(pool, { status, companySlug, publicOnly = false, limit = 50, offset = 0 } = {}) {
  const clauses = [];
  const params = [];
  if (publicOnly) {
    clauses.push("status = $1");
    params.push(INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY);
  } else if (status) {
    params.push(status);
    clauses.push(`status = $${params.length}`);
  }
  if (companySlug) {
    params.push(companySlug);
    clauses.push(`company_slug = $${params.length}`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS c FROM insider_signals ${where};`,
    params
  );
  params.push(limit, offset);
  const res = await pool.query(
    `SELECT * FROM insider_signals ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length};`,
    params
  );
  return {
    signals: res.rows.map(rowToSignal),
    total: countRes.rows[0]?.c || 0
  };
}

async function pgUpdateSignal(pool, id, patch) {
  const fields = [];
  const values = [];
  const map = {
    companySlug: "company_slug",
    companyName: "company_name",
    automationType: "automation_type",
    eventDate: "event_date",
    confidence: "confidence",
    verificationLevel: "verification_level",
    status: "status",
    visibility: "visibility",
    summaryPublic: "summary_public",
    bodyRestricted: "body_restricted",
    retentionPreference: "retention_preference",
    purgeAfter: "purge_after",
    metadataStripped: "metadata_stripped",
    submittedAt: "submitted_at",
    publishedAt: "published_at",
    deletedAt: "deleted_at"
  };
  for (const [k, col] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      values.push(patch[k]);
      fields.push(`${col} = $${values.length}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "rolesAffected")) {
    values.push(JSON.stringify(normalizeRoles(patch.rolesAffected)));
    fields.push(`roles_affected = $${values.length}::jsonb`);
  }
  if (!fields.length) return pgGetSignal(pool, id);
  fields.push("updated_at = NOW()");
  values.push(id);
  await pool.query(
    `UPDATE insider_signals SET ${fields.join(", ")} WHERE id = $${values.length};`,
    values
  );
  return pgGetSignal(pool, id);
}

async function pgCreateEvidence(pool, input) {
  const id = input.id || newEvidenceId();
  const { stripped, removedKeys } = stripMetadata(input.metadata || {});
  const filenameOriginal = String(input.filenameOriginal || "file").slice(0, 255);
  const filenameStored = input.filenameStored || redactFilename(filenameOriginal);
  const visibility = input.visibility || VISIBILITY.RESTRICTED;
  if (!isVisibilityAllowed(ENTITY.EVIDENCE, visibility)) {
    const err = new Error(`Invalid visibility for evidence: ${visibility}`);
    err.code = "INVALID_VISIBILITY";
    throw err;
  }
  const status = input.status || EVIDENCE_STATUS.UPLOADED;
  assertValidStatus(ENTITY.EVIDENCE, status);
  const storageKey = input.storageKey || `evidence/${id}/${filenameStored}`;
  await pool.query(
    `INSERT INTO evidence (
      id, parent_type, parent_id, uploader_id, status, visibility, content_type,
      filename_original, filename_stored, storage_key, size_bytes, sha256,
      redaction_notes, metadata, metadata_stripped, body_ref, created_at, updated_at
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,TRUE,$15,NOW(),NOW()
    );`,
    [
      id,
      input.parentType,
      input.parentId,
      input.uploaderId || null,
      status,
      visibility,
      input.contentType || "application/octet-stream",
      filenameOriginal,
      filenameStored,
      storageKey,
      Math.max(0, Number(input.sizeBytes || 0)),
      input.sha256 || null,
      input.redactionNotes || null,
      JSON.stringify(stripped),
      input.bodyRef || null
    ]
  );
  const evidence = await pgGetEvidence(pool, id);
  return { evidence, removedKeys };
}

async function pgGetEvidence(pool, id) {
  const res = await pool.query("SELECT * FROM evidence WHERE id = $1 LIMIT 1;", [id]);
  return rowToEvidence(res.rows[0]);
}

async function pgListEvidenceForParent(pool, parentType, parentId) {
  const res = await pool.query(
    `SELECT * FROM evidence WHERE parent_type = $1 AND parent_id = $2
     ORDER BY created_at DESC;`,
    [parentType, parentId]
  );
  return res.rows.map(rowToEvidence);
}

async function pgUpdateEvidence(pool, id, patch) {
  const fields = [];
  const values = [];
  const map = {
    status: "status",
    visibility: "visibility",
    contentType: "content_type",
    filenameOriginal: "filename_original",
    filenameStored: "filename_stored",
    storageKey: "storage_key",
    sizeBytes: "size_bytes",
    sha256: "sha256",
    redactionNotes: "redaction_notes",
    metadataStripped: "metadata_stripped",
    bodyRef: "body_ref",
    purgeAfter: "purge_after",
    purgedAt: "purged_at"
  };
  for (const [k, col] of Object.entries(map)) {
    if (Object.prototype.hasOwnProperty.call(patch, k)) {
      values.push(patch[k]);
      fields.push(`${col} = $${values.length}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "metadata")) {
    values.push(JSON.stringify(patch.metadata || {}));
    fields.push(`metadata = $${values.length}::jsonb`);
  }
  if (!fields.length) return pgGetEvidence(pool, id);
  fields.push("updated_at = NOW()");
  values.push(id);
  await pool.query(
    `UPDATE evidence SET ${fields.join(", ")} WHERE id = $${values.length};`,
    values
  );
  return pgGetEvidence(pool, id);
}

async function pgLogAccess(pool, entry) {
  const id = entry.id || newAccessId();
  await pool.query(
    `INSERT INTO evidence_access_log (
      id, evidence_id, actor_id, action, reason, ip, metadata, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW());`,
    [
      id,
      entry.evidenceId,
      entry.actorId,
      entry.action,
      entry.reason || null,
      entry.ip || null,
      JSON.stringify(entry.metadata || {})
    ]
  );
  const res = await pool.query("SELECT * FROM evidence_access_log WHERE id = $1;", [id]);
  return rowToAccess(res.rows[0]);
}

async function pgListAccess(pool, evidenceId, { limit = 100 } = {}) {
  const res = await pool.query(
    `SELECT * FROM evidence_access_log WHERE evidence_id = $1
     ORDER BY created_at DESC LIMIT $2;`,
    [evidenceId, limit]
  );
  return res.rows.map(rowToAccess);
}

async function pgLinkSignals(pool, signalIdA, signalIdB, { linkedBy, reason } = {}) {
  if (signalIdA === signalIdB) {
    const err = new Error("Cannot link a signal to itself");
    err.code = "INVALID_LINK";
    throw err;
  }
  const [a, b] = orderedPair(signalIdA, signalIdB);
  const existingA = await pgGetSignal(pool, a);
  const existingB = await pgGetSignal(pool, b);
  if (!existingA || !existingB) {
    const err = new Error("One or both signals not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const found = await pool.query(
    "SELECT * FROM signal_links WHERE signal_id_a = $1 AND signal_id_b = $2 LIMIT 1;",
    [a, b]
  );
  if (found.rows[0]) {
    return { link: rowToLink(found.rows[0]), created: false };
  }
  const id = newLinkId();
  await pool.query(
    `INSERT INTO signal_links (id, signal_id_a, signal_id_b, linked_by, reason, created_at)
     VALUES ($1,$2,$3,$4,$5,NOW());`,
    [id, a, b, linkedBy || "system", reason || ""]
  );
  const res = await pool.query("SELECT * FROM signal_links WHERE id = $1;", [id]);
  return { link: rowToLink(res.rows[0]), created: true };
}

async function pgListLinksFor(pool, signalId) {
  const res = await pool.query(
    `SELECT * FROM signal_links
     WHERE signal_id_a = $1 OR signal_id_b = $1
     ORDER BY created_at DESC;`,
    [signalId]
  );
  return res.rows.map((row) => {
    const l = rowToLink(row);
    return {
      id: l.id,
      peerSignalId: l.signalIdA === signalId ? l.signalIdB : l.signalIdA,
      reason: l.reason,
      createdAt: l.createdAt
    };
  });
}

async function pgLinkedCount(pool, signalId) {
  const res = await pool.query(
    `SELECT COUNT(*)::int AS c FROM signal_links
     WHERE signal_id_a = $1 OR signal_id_b = $1;`,
    [signalId]
  );
  return res.rows[0]?.c || 0;
}

// ── Public API (storage-agnostic) ───────────────────────────────────────────

async function createSignal(input, options = {}) {
  const companySlug =
    input.companySlug ||
    slugifyCompany(input.companyName || input.company || "");
  if (!companySlug || companySlug === "unknown") {
    const err = new Error("companySlug or companyName is required");
    err.code = "VALIDATION";
    throw err;
  }
  const payload = {
    ...input,
    companySlug,
    companyName: input.companyName || input.company || companySlug,
    status: input.status || INSIDER_SIGNAL_STATUS.DRAFT,
    trackingCode: input.trackingCode || (input.authorId ? null : newTrackingCode())
  };
  if (usePg(options)) {
    return pgCreateSignal(getPoolOrThrow(options), payload);
  }
  return memoryCreateSignal(payload);
}

async function getSignal(id, options = {}) {
  if (usePg(options)) return pgGetSignal(getPoolOrThrow(options), id);
  return memoryGetSignal(id);
}

async function listSignals(query = {}, options = {}) {
  if (usePg(options)) return pgListSignals(getPoolOrThrow(options), query);
  return memoryListSignals(query);
}

/**
 * Public list: published_summary only, verificationLevel explicit, no authors/evidence.
 */
async function listPublicSummaries(query = {}, options = {}) {
  const { signals, total } = await listSignals(
    {
      publicOnly: true,
      companySlug: query.companySlug,
      limit: query.limit || 50,
      offset: query.offset || 0
    },
    options
  );
  const summaries = [];
  for (const s of signals) {
    let linkedReportCount = 0;
    if (usePg(options)) {
      linkedReportCount = await pgLinkedCount(getPoolOrThrow(options), s.id);
    } else {
      linkedReportCount = memoryLinkedCount(s.id);
    }
    const summary = toPublicSummary({ ...s, linkedReportCount });
    if (summary) {
      assertPublicSafe(summary);
      summaries.push(summary);
    }
  }
  return { signals: summaries, total };
}

async function getPublicSummary(id, options = {}) {
  const s = await getSignal(id, options);
  if (!s) return null;
  let linkedReportCount = 0;
  if (usePg(options)) {
    linkedReportCount = await pgLinkedCount(getPoolOrThrow(options), s.id);
  } else {
    linkedReportCount = memoryLinkedCount(s.id);
  }
  const summary = toPublicSummary({ ...s, linkedReportCount });
  if (summary) assertPublicSafe(summary);
  return summary;
}

/**
 * Transition signal status via domain-contract assertCanTransition.
 * Handles legal_hold, published_summary timestamps, delete/purge scheduling.
 */
async function transitionSignal(id, toStatus, options = {}) {
  const s = await getSignal(id, options);
  if (!s) {
    const err = new Error("Signal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  assertCanTransition(ENTITY.INSIDER_SIGNAL, s.status, toStatus);

  if (
    toStatus === INSIDER_SIGNAL_STATUS.DELETED &&
    isLegalHoldBlockingDelete(ENTITY.INSIDER_SIGNAL, s.status)
  ) {
    const err = new Error("D-LEGAL-HOLD: cannot delete while legal_hold");
    err.code = "LEGAL_HOLD";
    throw err;
  }

  const patch = { status: toStatus };
  if (toStatus === INSIDER_SIGNAL_STATUS.SUBMITTED && !s.submittedAt) {
    patch.submittedAt = nowIso();
  }
  if (toStatus === INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY) {
    patch.publishedAt = nowIso();
    patch.visibility = VISIBILITY.PUBLIC;
    if (options.summaryPublic != null) patch.summaryPublic = options.summaryPublic;
    else if (s.summaryPublic == null && s.bodyRestricted) {
      // Prefer staff-provided summary; never auto-publish restricted body.
      patch.summaryPublic = options.summaryPublic || "";
    }
  }
  if (toStatus === INSIDER_SIGNAL_STATUS.DELETED) {
    patch.deletedAt = nowIso();
    patch.purgeAfter = retentionPurgeAfter(ENTITY.INSIDER_SIGNAL);
    // Cascade: schedule evidence purge unless parent was legal_hold (blocked above)
    const plan = planDeletion(ENTITY.INSIDER_SIGNAL, INSIDER_SIGNAL_STATUS.DELETED);
    if (plan.allowed) {
      await scheduleEvidencePurgeForParent("insider_signal", id, options);
    }
  }
  if (toStatus === INSIDER_SIGNAL_STATUS.LEGAL_HOLD) {
    // Clear any pending purge
    patch.purgeAfter = null;
    patch.deletedAt = null;
  }
  if (options.verificationLevel) {
    patch.verificationLevel = normalizeVerificationLevel(options.verificationLevel);
  }

  if (usePg(options)) {
    return pgUpdateSignal(getPoolOrThrow(options), id, patch);
  }
  return memoryUpdateSignal(id, patch);
}

async function setVerificationLevel(id, level, options = {}) {
  const s = await getSignal(id, options);
  if (!s) {
    const err = new Error("Signal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const verificationLevel = normalizeVerificationLevel(level);
  if (usePg(options)) {
    return pgUpdateSignal(getPoolOrThrow(options), id, { verificationLevel });
  }
  return memoryUpdateSignal(id, { verificationLevel });
}

async function updateSignalFields(id, fields, options = {}) {
  const s = await getSignal(id, options);
  if (!s) {
    const err = new Error("Signal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  // Only allow content edits in draft/submitted (author) or any non-deleted (staff via options.staff)
  const editable = [INSIDER_SIGNAL_STATUS.DRAFT, INSIDER_SIGNAL_STATUS.SUBMITTED];
  if (!options.staff && !editable.includes(s.status)) {
    const err = new Error("Signal is not editable in current status");
    err.code = "NOT_EDITABLE";
    throw err;
  }
  const patch = {};
  if (fields.rolesAffected != null) patch.rolesAffected = fields.rolesAffected;
  if (fields.automationType != null) patch.automationType = normalizeAutomationType(fields.automationType);
  if (fields.eventDate != null) patch.eventDate = parseEventDate(fields.eventDate);
  if (fields.confidence != null) patch.confidence = parseConfidence(fields.confidence);
  if (fields.bodyRestricted != null) patch.bodyRestricted = String(fields.bodyRestricted).slice(0, 20000);
  if (fields.summaryPublic != null && options.staff) {
    patch.summaryPublic = String(fields.summaryPublic).slice(0, 5000);
  }
  if (fields.companyName != null) patch.companyName = String(fields.companyName).slice(0, 200);
  if (usePg(options)) return pgUpdateSignal(getPoolOrThrow(options), id, patch);
  return memoryUpdateSignal(id, patch);
}

async function scheduleEvidencePurgeForParent(parentType, parentId, options = {}) {
  const list = usePg(options)
    ? await pgListEvidenceForParent(getPoolOrThrow(options), parentType, parentId)
    : memoryListEvidenceForParent(parentType, parentId);
  const purgeAfter = retentionPurgeAfter(ENTITY.EVIDENCE);
  for (const ev of list) {
    if (ev.status === EVIDENCE_STATUS.PURGED) continue;
    // If somehow still available and we need to mark purge schedule
    if (usePg(options)) {
      await pgUpdateEvidence(getPoolOrThrow(options), ev.id, { purgeAfter });
    } else {
      memoryUpdateEvidence(ev.id, { purgeAfter });
    }
  }
}

/**
 * Attach evidence to a signal. Metadata is stripped. Raw body is never returned publicly.
 */
async function attachEvidence(signalId, input, options = {}) {
  const s = await getSignal(signalId, options);
  if (!s) {
    const err = new Error("Signal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (s.status === INSIDER_SIGNAL_STATUS.DELETED) {
    const err = new Error("Cannot attach evidence to deleted signal");
    err.code = "INVALID_STATUS";
    throw err;
  }
  const payload = {
    parentType: "insider_signal",
    parentId: signalId,
    uploaderId: input.uploaderId || null,
    contentType: input.contentType,
    filenameOriginal: input.filenameOriginal,
    sizeBytes: input.sizeBytes,
    sha256: input.sha256,
    metadata: input.metadata,
    bodyRef: input.bodyRef || null,
    storageKey: input.storageKey,
    visibility: VISIBILITY.RESTRICTED
  };
  let result;
  if (usePg(options)) {
    result = await pgCreateEvidence(getPoolOrThrow(options), payload);
  } else {
    result = memoryCreateEvidence(payload);
  }

  // Audit upload
  await logEvidenceAccess(
    {
      evidenceId: result.evidence.id,
      actorId: input.uploaderId || options.actorId || "system",
      action: "upload",
      reason: input.reason || "attach",
      ip: options.ip || null,
      metadata: { removedKeys: result.removedKeys, sizeBytes: result.evidence.sizeBytes }
    },
    options
  );

  return {
    evidence: toEvidenceStaffMeta(result.evidence),
    removedKeys: result.removedKeys
  };
}

async function getEvidence(id, options = {}) {
  if (usePg(options)) return pgGetEvidence(getPoolOrThrow(options), id);
  return memoryGetEvidence(id);
}

async function listEvidenceForSignal(signalId, options = {}) {
  // Never a public API — caller must enforce auth
  if (usePg(options)) {
    return pgListEvidenceForParent(getPoolOrThrow(options), "insider_signal", signalId);
  }
  return memoryListEvidenceForParent("insider_signal", signalId);
}

/**
 * Privileged evidence access — always audited. Returns staff meta (optionally storage key).
 */
async function accessEvidence(id, { actorId, action = "view", reason, ip, includeStorageKey = false } = {}, options = {}) {
  const ev = await getEvidence(id, options);
  if (!ev) {
    const err = new Error("Evidence not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (ev.status === EVIDENCE_STATUS.PURGED) {
    const err = new Error("Evidence has been purged");
    err.code = "PURGED";
    throw err;
  }
  const act = EVIDENCE_ACCESS_ACTIONS.includes(action) ? action : "view";
  await logEvidenceAccess(
    {
      evidenceId: id,
      actorId: actorId || "unknown",
      action: act,
      reason: reason || null,
      ip: ip || null,
      metadata: { includeStorageKey: Boolean(includeStorageKey) }
    },
    options
  );
  return toEvidenceStaffMeta(ev, { includeStorageKey });
}

async function transitionEvidence(id, toStatus, options = {}) {
  const ev = await getEvidence(id, options);
  if (!ev) {
    const err = new Error("Evidence not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  assertCanTransition(ENTITY.EVIDENCE, ev.status, toStatus);
  const patch = { status: toStatus };
  if (toStatus === EVIDENCE_STATUS.PURGED) {
    patch.purgedAt = nowIso();
    patch.storageKey = "";
    patch.bodyRef = null;
    patch.sha256 = null;
    patch.metadata = {};
  }
  if (toStatus === EVIDENCE_STATUS.REDACTED && options.redactionNotes) {
    patch.redactionNotes = String(options.redactionNotes).slice(0, 2000);
    // Re-run metadata strip on redaction
    const { stripped } = stripMetadata(ev.metadata || {});
    patch.metadata = stripped;
    patch.metadataStripped = true;
    if (ev.filenameOriginal) {
      patch.filenameStored = redactFilename(ev.filenameOriginal);
    }
  }
  let updated;
  if (usePg(options)) {
    updated = await pgUpdateEvidence(getPoolOrThrow(options), id, patch);
  } else {
    updated = memoryUpdateEvidence(id, patch);
  }
  await logEvidenceAccess(
    {
      evidenceId: id,
      actorId: options.actorId || "system",
      action: toStatus === EVIDENCE_STATUS.PURGED ? "purge" : "status_change",
      reason: options.reason || `${ev.status}→${toStatus}`,
      ip: options.ip || null,
      metadata: { from: ev.status, to: toStatus }
    },
    options
  );
  return toEvidenceStaffMeta(updated);
}

async function logEvidenceAccess(entry, options = {}) {
  if (!entry.action || !EVIDENCE_ACCESS_ACTIONS.includes(entry.action)) {
    const err = new Error(`Invalid evidence access action: ${entry.action}`);
    err.code = "INVALID_ACTION";
    throw err;
  }
  if (usePg(options)) return pgLogAccess(getPoolOrThrow(options), entry);
  return memoryLogAccess(entry);
}

async function listEvidenceAccessLog(evidenceId, query = {}, options = {}) {
  if (usePg(options)) return pgListAccess(getPoolOrThrow(options), evidenceId, query);
  return memoryListAccess(evidenceId, query);
}

/**
 * Link two independent reports without exposing authors.
 * Public consumers only see linkedReportCount; staff see peerSignalId only.
 */
async function linkSignals(signalIdA, signalIdB, { linkedBy, reason } = {}, options = {}) {
  if (usePg(options)) {
    return pgLinkSignals(getPoolOrThrow(options), signalIdA, signalIdB, { linkedBy, reason });
  }
  return memoryLinkSignals(signalIdA, signalIdB, { linkedBy, reason });
}

async function listLinkedSignals(signalId, options = {}) {
  // Returns peer ids only — no author fields
  if (usePg(options)) return pgListLinksFor(getPoolOrThrow(options), signalId);
  return memoryListLinksFor(signalId);
}

/**
 * Legal review path: enter legal_hold (blocks delete).
 */
async function placeLegalHold(id, options = {}) {
  return transitionSignal(id, INSIDER_SIGNAL_STATUS.LEGAL_HOLD, options);
}

/**
 * Release legal hold to under_review or published_summary.
 */
async function releaseLegalHold(id, toStatus = INSIDER_SIGNAL_STATUS.UNDER_REVIEW, options = {}) {
  const s = await getSignal(id, options);
  if (!s) {
    const err = new Error("Signal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (s.status !== INSIDER_SIGNAL_STATUS.LEGAL_HOLD) {
    const err = new Error("Signal is not under legal hold");
    err.code = "INVALID_STATUS";
    throw err;
  }
  if (
    toStatus !== INSIDER_SIGNAL_STATUS.UNDER_REVIEW &&
    toStatus !== INSIDER_SIGNAL_STATUS.PUBLISHED_SUMMARY
  ) {
    const err = new Error("Release target must be under_review or published_summary");
    err.code = "INVALID_STATUS";
    throw err;
  }
  return transitionSignal(id, toStatus, options);
}

/**
 * Soft-delete with cascade plan (blocked by legal_hold).
 */
async function softDeleteSignal(id, options = {}) {
  const s = await getSignal(id, options);
  if (!s) {
    const err = new Error("Signal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  if (isLegalHoldBlockingDelete(ENTITY.INSIDER_SIGNAL, s.status)) {
    const err = new Error("D-LEGAL-HOLD: cannot delete while legal_hold");
    err.code = "LEGAL_HOLD";
    throw err;
  }
  if (!canTransition(ENTITY.INSIDER_SIGNAL, s.status, INSIDER_SIGNAL_STATUS.DELETED)) {
    const err = new Error(`Cannot delete signal in status ${s.status}`);
    err.code = "ILLEGAL_TRANSITION";
    throw err;
  }
  return transitionSignal(id, INSIDER_SIGNAL_STATUS.DELETED, options);
}

/**
 * Public list must never return evidence entities.
 * Pure check used by tests and route guards.
 */
function evidenceNeverPubliclyListable() {
  return valuesOf(EVIDENCE_STATUS).every((s) => !isPubliclyListable(ENTITY.EVIDENCE, s));
}

/**
 * Validate create/submit input shape (lightweight, no zod dependency here).
 */
function validateSignalInput(body) {
  const errors = [];
  const companySlug =
    (body.companySlug && String(body.companySlug).trim()) ||
    slugifyCompany(body.companyName || body.company || "");
  if (!companySlug || companySlug === "unknown") {
    errors.push("companySlug or companyName is required");
  }
  if (body.rolesAffected != null && !Array.isArray(body.rolesAffected)) {
    errors.push("rolesAffected must be an array of strings");
  }
  if (body.verificationLevel != null) {
    const v = String(body.verificationLevel).toLowerCase();
    if (!valuesOf(VERIFICATION_LEVEL).includes(v)) {
      errors.push("invalid verificationLevel");
    }
  }
  if (body.visibility != null && !isVisibilityAllowed(ENTITY.INSIDER_SIGNAL, body.visibility)) {
    errors.push("invalid visibility for insider_signal");
  }
  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      companySlug,
      companyName: String(body.companyName || body.company || companySlug).slice(0, 200),
      rolesAffected: normalizeRoles(body.rolesAffected || []),
      automationType: normalizeAutomationType(body.automationType || "other"),
      eventDate: parseEventDate(body.eventDate || body.date),
      confidence: parseConfidence(body.confidence),
      verificationLevel: normalizeVerificationLevel(
        body.verificationLevel || VERIFICATION_LEVEL.UNCORROBORATED
      ),
      bodyRestricted: body.bodyRestricted || body.body || body.details
        ? String(body.bodyRestricted || body.body || body.details).slice(0, 20000)
        : null,
      summaryPublic: body.summaryPublic
        ? String(body.summaryPublic).slice(0, 5000)
        : null,
      retentionPreference: normalizeRetention(body.retentionPreference),
      visibility: body.visibility || VISIBILITY.RESTRICTED
    }
  };
}

module.exports = {
  // enums re-export for convenience
  AUTOMATION_TYPES,
  EVIDENCE_ACCESS_ACTIONS,
  PUBLIC_FORBIDDEN_KEYS,
  METADATA_STRIP_KEYS,
  INSIDER_SIGNAL_STATUS,
  EVIDENCE_STATUS,
  VERIFICATION_LEVEL,
  VISIBILITY,

  // pure helpers
  stripMetadata,
  redactFilename,
  toPublicSummary,
  assertPublicSafe,
  toEvidenceStaffMeta,
  toStaffSignal,
  evidenceNeverPubliclyListable,
  validateSignalInput,
  slugifyCompany,
  orderedPair,
  retentionPurgeAfter,
  canTransition,
  isLegalHoldBlockingDelete,
  planDeletion,

  // storage API
  createSignal,
  getSignal,
  listSignals,
  listPublicSummaries,
  getPublicSummary,
  transitionSignal,
  setVerificationLevel,
  updateSignalFields,
  attachEvidence,
  getEvidence,
  listEvidenceForSignal,
  accessEvidence,
  transitionEvidence,
  logEvidenceAccess,
  listEvidenceAccessLog,
  linkSignals,
  listLinkedSignals,
  placeLegalHold,
  releaseLegalHold,
  softDeleteSignal,
  scheduleEvidencePurgeForParent,

  // test helpers
  memoryReset,
  memory
};
