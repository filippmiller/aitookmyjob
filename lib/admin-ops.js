/**
 * Admin operations: appeals, crisis cases, SLA clocks, sanctions list helpers.
 * Dual storage: PostgreSQL when DATABASE_URL set, JSON files otherwise.
 * Bead: aitj-z8q.16
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { customAlphabet } = require("nanoid");
const {
  APPEAL_STATUS,
  CRISIS_CASE_STATUS,
  SLA_STATE,
  TAKEDOWN_STATUS,
  ENTITY,
  valuesOf,
  assertCanTransition,
  canTransition
} = require("./domain-contract");

const idGen = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 14);

// SLA targets (hours)
const APPEAL_SLA_HOURS = Number(process.env.APPEAL_SLA_HOURS || 72);
const CRISIS_SLA_HOURS = Number(process.env.CRISIS_SLA_HOURS || 4);
const SLA_AT_RISK_RATIO = 0.75; // at_risk when past 75% of window

function dataDir(options = {}) {
  return options.dataDir || path.join(__dirname, "..", "data");
}

function appealsPath(options) {
  return path.join(dataDir(options), "appeals.json");
}

function crisisPath(options) {
  return path.join(dataDir(options), "crisis-cases.json");
}

function usePg(options = {}) {
  return Boolean(options.usePostgres);
}

function getPoolOrThrow(options = {}) {
  const pool = typeof options.getPool === "function" ? options.getPool() : null;
  if (!pool) throw new Error("PostgreSQL pool required");
  return pool;
}

function nowIso() {
  return new Date().toISOString();
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600 * 1000).toISOString();
}

/**
 * Compute SLA state from due date and lifecycle status.
 * Terminal statuses → resolved; otherwise on_track / at_risk / breached.
 *
 * @param {string} slaDueAt
 * @param {string} status
 * @param {string[]} terminalStatuses
 * @param {{ createdAt?: string, windowHours?: number }} [meta]
 */
function computeSlaState(slaDueAt, status, terminalStatuses, meta = {}) {
  if (terminalStatuses.includes(status)) return SLA_STATE.RESOLVED;
  const due = new Date(slaDueAt).getTime();
  if (Number.isNaN(due)) return SLA_STATE.ON_TRACK;
  const now = Date.now();
  if (now >= due) return SLA_STATE.BREACHED;

  let windowMs = null;
  if (meta.createdAt) {
    const created = new Date(meta.createdAt).getTime();
    if (!Number.isNaN(created) && due > created) windowMs = due - created;
  }
  if (windowMs == null && meta.windowHours) {
    windowMs = Number(meta.windowHours) * 3600 * 1000;
  }
  if (windowMs == null || windowMs <= 0) {
    windowMs = Math.max(due - now, 3600 * 1000);
  }
  const remaining = due - now;
  const riskThreshold = windowMs * (1 - SLA_AT_RISK_RATIO); // last 25% of window
  if (remaining <= riskThreshold) return SLA_STATE.AT_RISK;
  return SLA_STATE.ON_TRACK;
}

function refreshSla(row, terminalStatuses, windowHours) {
  return {
    ...row,
    slaState: computeSlaState(row.slaDueAt, row.status, terminalStatuses, {
      createdAt: row.createdAt,
      windowHours
    })
  };
}

function readJsonArray(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeJsonArray(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), "utf8");
}

// ── Appeals ──────────────────────────────────────────────────────────────────

const APPEAL_TERMINAL = [
  APPEAL_STATUS.UPHELD,
  APPEAL_STATUS.OVERTURNED,
  APPEAL_STATUS.WITHDRAWN
];

function mapAppealRow(r) {
  const row = {
    id: r.id,
    appellantUserId: r.appellantUserId || r.appellant_user_id,
    targetType: r.targetType || r.target_type,
    targetId: r.targetId || r.target_id,
    reason: r.reason || "",
    status: r.status || APPEAL_STATUS.SUBMITTED,
    slaDueAt: r.slaDueAt || r.sla_due_at,
    slaState: r.slaState || r.sla_state || SLA_STATE.ON_TRACK,
    resolutionNote: r.resolutionNote || r.resolution_note || "",
    assignedTo: r.assignedTo || r.assigned_to || null,
    resolvedBy: r.resolvedBy || r.resolved_by || null,
    resolvedAt: r.resolvedAt || r.resolved_at || null,
    createdAt: r.createdAt || r.created_at,
    updatedAt: r.updatedAt || r.updated_at
  };
  return refreshSla(row, APPEAL_TERMINAL, APPEAL_SLA_HOURS);
}

async function listAppeals({ status, slaState, limit = 100, offset = 0 } = {}, options = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM appeals
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3;`,
      [status || null, lim, off]
    );
    let rows = res.rows.map(mapAppealRow);
    if (slaState) rows = rows.filter((r) => r.slaState === slaState);
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM appeals WHERE ($1::text IS NULL OR status = $1);`,
      [status || null]
    );
    return { appeals: rows, total: countRes.rows[0].c };
  }
  let rows = readJsonArray(appealsPath(options)).map(mapAppealRow);
  if (status) rows = rows.filter((r) => r.status === status);
  if (slaState) rows = rows.filter((r) => r.slaState === slaState);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { appeals: rows.slice(off, off + lim), total: rows.length };
}

async function getAppeal(id, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query("SELECT * FROM appeals WHERE id = $1 LIMIT 1;", [id]);
    if (!res.rows[0]) return null;
    return mapAppealRow(res.rows[0]);
  }
  return readJsonArray(appealsPath(options)).map(mapAppealRow).find((a) => a.id === id) || null;
}

async function createAppeal(
  { appellantUserId, targetType, targetId, reason },
  options = {}
) {
  const now = nowIso();
  const entry = mapAppealRow({
    id: `apl_${idGen()}`,
    appellantUserId,
    targetType: String(targetType || "").slice(0, 40),
    targetId: String(targetId || "").slice(0, 80),
    reason: String(reason || "").slice(0, 2000),
    status: APPEAL_STATUS.SUBMITTED,
    slaDueAt: hoursFromNow(APPEAL_SLA_HOURS),
    slaState: SLA_STATE.ON_TRACK,
    resolutionNote: "",
    assignedTo: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now
  });

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO appeals (
        id, appellant_user_id, target_type, target_id, reason, status,
        sla_due_at, sla_state, resolution_note, assigned_to, resolved_by, resolved_at,
        created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14);`,
      [
        entry.id,
        entry.appellantUserId,
        entry.targetType,
        entry.targetId,
        entry.reason,
        entry.status,
        entry.slaDueAt,
        entry.slaState,
        entry.resolutionNote,
        entry.assignedTo,
        entry.resolvedBy,
        entry.resolvedAt,
        entry.createdAt,
        entry.updatedAt
      ]
    );
    return entry;
  }
  const rows = readJsonArray(appealsPath(options));
  rows.push(entry);
  writeJsonArray(appealsPath(options), rows);
  return entry;
}

async function transitionAppeal(id, toStatus, { actorId, note, assignedTo } = {}, options = {}) {
  const current = await getAppeal(id, options);
  if (!current) {
    const err = new Error("Appeal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  assertCanTransition(ENTITY.APPEAL, current.status, toStatus);
  const now = nowIso();
  const terminal = APPEAL_TERMINAL.includes(toStatus);
  const patch = {
    status: toStatus,
    updatedAt: now,
    resolutionNote: note != null ? String(note).slice(0, 2000) : current.resolutionNote,
    assignedTo: assignedTo !== undefined ? assignedTo : current.assignedTo,
    resolvedBy: terminal ? actorId || current.resolvedBy : current.resolvedBy,
    resolvedAt: terminal ? now : current.resolvedAt,
    slaState: terminal
      ? SLA_STATE.RESOLVED
      : computeSlaState(current.slaDueAt, toStatus, APPEAL_TERMINAL, {
          createdAt: current.createdAt,
          windowHours: APPEAL_SLA_HOURS
        })
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE appeals SET
         status = $2,
         resolution_note = $3,
         assigned_to = $4,
         resolved_by = $5,
         resolved_at = $6,
         sla_state = $7,
         updated_at = $8
       WHERE id = $1
       RETURNING *;`,
      [
        id,
        patch.status,
        patch.resolutionNote,
        patch.assignedTo,
        patch.resolvedBy,
        patch.resolvedAt,
        patch.slaState,
        patch.updatedAt
      ]
    );
    return mapAppealRow(res.rows[0]);
  }
  const rows = readJsonArray(appealsPath(options));
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) {
    const err = new Error("Appeal not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  rows[idx] = { ...rows[idx], ...patch };
  writeJsonArray(appealsPath(options), rows);
  return mapAppealRow(rows[idx]);
}

// ── Crisis cases ─────────────────────────────────────────────────────────────

const CRISIS_TERMINAL = [CRISIS_CASE_STATUS.RESOLVED, CRISIS_CASE_STATUS.FALSE_POSITIVE];

function mapCrisisRow(r) {
  let resources = r.resourcesOffered || r.resources_offered || [];
  if (typeof resources === "string") {
    try {
      resources = JSON.parse(resources);
    } catch {
      resources = [];
    }
  }
  const row = {
    id: r.id,
    sourceType: r.sourceType || r.source_type,
    sourceId: r.sourceId || r.source_id,
    country: r.country || "global",
    excerpt: r.excerpt || "",
    riskScore: Number(r.riskScore != null ? r.riskScore : r.risk_score != null ? r.risk_score : 1),
    status: r.status || CRISIS_CASE_STATUS.OPEN,
    slaDueAt: r.slaDueAt || r.sla_due_at,
    slaState: r.slaState || r.sla_state || SLA_STATE.ON_TRACK,
    notes: r.notes || "",
    assignedTo: r.assignedTo || r.assigned_to || null,
    resourcesOffered: Array.isArray(resources) ? resources : [],
    resolvedBy: r.resolvedBy || r.resolved_by || null,
    resolvedAt: r.resolvedAt || r.resolved_at || null,
    createdAt: r.createdAt || r.created_at,
    updatedAt: r.updatedAt || r.updated_at
  };
  return refreshSla(row, CRISIS_TERMINAL, CRISIS_SLA_HOURS);
}

async function listCrisisCases({ status, slaState, limit = 100, offset = 0 } = {}, options = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM crisis_cases
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY
         CASE status
           WHEN 'open' THEN 0
           WHEN 'acknowledged' THEN 1
           WHEN 'escalated' THEN 2
           WHEN 'in_progress' THEN 3
           ELSE 4
         END,
         created_at DESC
       LIMIT $2 OFFSET $3;`,
      [status || null, lim, off]
    );
    let rows = res.rows.map(mapCrisisRow);
    if (slaState) rows = rows.filter((r) => r.slaState === slaState);
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM crisis_cases WHERE ($1::text IS NULL OR status = $1);`,
      [status || null]
    );
    return { cases: rows, total: countRes.rows[0].c };
  }
  let rows = readJsonArray(crisisPath(options)).map(mapCrisisRow);
  if (status) rows = rows.filter((r) => r.status === status);
  if (slaState) rows = rows.filter((r) => r.slaState === slaState);
  const rank = { open: 0, acknowledged: 1, escalated: 2, in_progress: 3 };
  rows.sort((a, b) => {
    const ra = rank[a.status] ?? 4;
    const rb = rank[b.status] ?? 4;
    if (ra !== rb) return ra - rb;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return { cases: rows.slice(off, off + lim), total: rows.length };
}

async function getCrisisCase(id, options = {}) {
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query("SELECT * FROM crisis_cases WHERE id = $1 LIMIT 1;", [id]);
    if (!res.rows[0]) return null;
    return mapCrisisRow(res.rows[0]);
  }
  return readJsonArray(crisisPath(options)).map(mapCrisisRow).find((c) => c.id === id) || null;
}

async function createCrisisCase(
  { sourceType, sourceId, country, excerpt, riskScore, resourcesOffered },
  options = {}
) {
  const now = nowIso();
  const entry = mapCrisisRow({
    id: `crs_${idGen()}`,
    sourceType: String(sourceType || "content").slice(0, 40),
    sourceId: String(sourceId || "").slice(0, 80),
    country: String(country || "global").slice(0, 16),
    excerpt: String(excerpt || "").slice(0, 500),
    riskScore: Number(riskScore) || 1,
    status: CRISIS_CASE_STATUS.OPEN,
    slaDueAt: hoursFromNow(CRISIS_SLA_HOURS),
    slaState: SLA_STATE.ON_TRACK,
    notes: "",
    assignedTo: null,
    resourcesOffered: Array.isArray(resourcesOffered) ? resourcesOffered : [],
    resolvedBy: null,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now
  });

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    await pool.query(
      `INSERT INTO crisis_cases (
        id, source_type, source_id, country, excerpt, risk_score, status,
        sla_due_at, sla_state, notes, assigned_to, resources_offered,
        resolved_by, resolved_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16);`,
      [
        entry.id,
        entry.sourceType,
        entry.sourceId,
        entry.country,
        entry.excerpt,
        entry.riskScore,
        entry.status,
        entry.slaDueAt,
        entry.slaState,
        entry.notes,
        entry.assignedTo,
        JSON.stringify(entry.resourcesOffered),
        entry.resolvedBy,
        entry.resolvedAt,
        entry.createdAt,
        entry.updatedAt
      ]
    );
    return entry;
  }
  const rows = readJsonArray(crisisPath(options));
  rows.push(entry);
  writeJsonArray(crisisPath(options), rows);
  return entry;
}

async function transitionCrisisCase(
  id,
  toStatus,
  { actorId, notes, assignedTo, resourcesOffered } = {},
  options = {}
) {
  const current = await getCrisisCase(id, options);
  if (!current) {
    const err = new Error("Crisis case not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  assertCanTransition(ENTITY.CRISIS_CASE, current.status, toStatus);
  const now = nowIso();
  const terminal = CRISIS_TERMINAL.includes(toStatus);
  const patch = {
    status: toStatus,
    updatedAt: now,
    notes: notes != null ? String(notes).slice(0, 2000) : current.notes,
    assignedTo: assignedTo !== undefined ? assignedTo : current.assignedTo,
    resourcesOffered:
      resourcesOffered !== undefined
        ? Array.isArray(resourcesOffered)
          ? resourcesOffered
          : current.resourcesOffered
        : current.resourcesOffered,
    resolvedBy: terminal ? actorId || current.resolvedBy : current.resolvedBy,
    resolvedAt: terminal ? now : current.resolvedAt,
    slaState: terminal
      ? SLA_STATE.RESOLVED
      : computeSlaState(current.slaDueAt, toStatus, CRISIS_TERMINAL, {
          createdAt: current.createdAt,
          windowHours: CRISIS_SLA_HOURS
        })
  };

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE crisis_cases SET
         status = $2,
         notes = $3,
         assigned_to = $4,
         resources_offered = $5::jsonb,
         resolved_by = $6,
         resolved_at = $7,
         sla_state = $8,
         updated_at = $9
       WHERE id = $1
       RETURNING *;`,
      [
        id,
        patch.status,
        patch.notes,
        patch.assignedTo,
        JSON.stringify(patch.resourcesOffered),
        patch.resolvedBy,
        patch.resolvedAt,
        patch.slaState,
        patch.updatedAt
      ]
    );
    return mapCrisisRow(res.rows[0]);
  }
  const rows = readJsonArray(crisisPath(options));
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) {
    const err = new Error("Crisis case not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  rows[idx] = { ...rows[idx], ...patch };
  writeJsonArray(crisisPath(options), rows);
  return mapCrisisRow(rows[idx]);
}

/**
 * Scan moderation-scored content for crisis flag and open a case if none open.
 * options.scoreModeration / getCrisisResources provided by caller (from context).
 */
async function ensureCrisisFromModeration(
  { sourceType, sourceId, text, country, score },
  options = {}
) {
  const crisisScore =
    score && typeof score.crisis === "number"
      ? score.crisis
      : options.scoreModeration
        ? options.scoreModeration({ story: text, reason: "" }).crisis
        : 0;
  if (crisisScore < 1) return null;

  // Dedupe open cases for same source
  const { cases } = await listCrisisCases({ limit: 200 }, options);
  const existing = cases.find(
    (c) =>
      c.sourceType === sourceType &&
      c.sourceId === sourceId &&
      !CRISIS_TERMINAL.includes(c.status)
  );
  if (existing) return { created: false, case: existing };

  const resources =
    typeof options.getCrisisResources === "function"
      ? options.getCrisisResources(country || "global")
      : [];
  const created = await createCrisisCase(
    {
      sourceType,
      sourceId,
      country: country || "global",
      excerpt: String(text || "").slice(0, 400),
      riskScore: crisisScore,
      resourcesOffered: resources
    },
    options
  );
  return { created: true, case: created };
}

// ── Sanctions list (PG + JSON) ───────────────────────────────────────────────

function mapSanctionRow(r) {
  return {
    id: r.id,
    targetUserId: r.targetUserId || r.target_user_id,
    type: r.type,
    reason: r.reason || "",
    durationDays: r.durationDays != null ? r.durationDays : r.duration_days,
    createdBy: r.createdBy || r.created_by,
    createdAt: r.createdAt || r.created_at
  };
}

async function listSanctions({ limit = 100, offset = 0, targetUserId } = {}, options = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM sanctions
       WHERE ($1::text IS NULL OR target_user_id = $1)
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3;`,
      [targetUserId || null, lim, off]
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM sanctions WHERE ($1::text IS NULL OR target_user_id = $1);`,
      [targetUserId || null]
    );
    return { sanctions: res.rows.map(mapSanctionRow), total: countRes.rows[0].c };
  }
  const file = path.join(dataDir(options), "sanctions.json");
  let rows = readJsonArray(file).map(mapSanctionRow);
  if (targetUserId) rows = rows.filter((s) => s.targetUserId === targetUserId);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { sanctions: rows.slice(off, off + lim), total: rows.length };
}

// ── Takedown resolve ─────────────────────────────────────────────────────────

function mapTakedown(r) {
  return {
    id: r.id,
    email: r.email,
    reason: r.reason || "",
    targetUrl: r.targetUrl || r.target_url,
    legalBasis: r.legalBasis || r.legal_basis || "unspecified",
    status: r.status || TAKEDOWN_STATUS.PENDING,
    resolutionNote: r.resolutionNote || r.resolution_note || "",
    resolvedBy: r.resolvedBy || r.resolved_by || null,
    resolvedAt: r.resolvedAt || r.resolved_at || null,
    createdAt: r.createdAt || r.created_at,
    updatedAt: r.updatedAt || r.updated_at || r.createdAt || r.created_at
  };
}

async function listTakedownsAdmin({ status, limit = 100, offset = 0 } = {}, options = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  const off = Math.max(0, Number(offset) || 0);
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `SELECT * FROM takedowns
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3;`,
      [status || null, lim, off]
    );
    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS c FROM takedowns WHERE ($1::text IS NULL OR status = $1);`,
      [status || null]
    );
    return { takedowns: res.rows.map(mapTakedown), total: countRes.rows[0].c };
  }
  const file = path.join(dataDir(options), "takedowns.json");
  let rows = readJsonArray(file).map(mapTakedown);
  if (status) rows = rows.filter((t) => t.status === status);
  rows.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return { takedowns: rows.slice(off, off + lim), total: rows.length };
}

async function resolveTakedown(id, { status, note, actorId }, options = {}) {
  if (!valuesOf(TAKEDOWN_STATUS).includes(status)) {
    const err = new Error("Invalid takedown status");
    err.code = "INVALID_STATUS";
    throw err;
  }
  const now = nowIso();
  const terminal = ["accepted", "rejected", "completed"].includes(status);

  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      `UPDATE takedowns SET
         status = $2,
         resolution_note = COALESCE($3, resolution_note),
         resolved_by = CASE WHEN $4 THEN $5 ELSE resolved_by END,
         resolved_at = CASE WHEN $4 THEN $6::timestamptz ELSE resolved_at END,
         updated_at = $6::timestamptz
       WHERE id = $1
       RETURNING *;`,
      [id, status, note != null ? String(note).slice(0, 2000) : null, terminal, actorId || null, now]
    );
    if (!res.rows[0]) {
      const err = new Error("Takedown not found");
      err.code = "NOT_FOUND";
      throw err;
    }
    return mapTakedown(res.rows[0]);
  }

  const file = path.join(dataDir(options), "takedowns.json");
  const rows = readJsonArray(file);
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) {
    const err = new Error("Takedown not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  const cur = mapTakedown(rows[idx]);
  // Soft transition check when possible
  if (cur.status !== status && canTransition(ENTITY.TAKEDOWN_REQUEST, cur.status, status)) {
    // ok
  } else if (cur.status !== status && !canTransition(ENTITY.TAKEDOWN_REQUEST, cur.status, status)) {
    // Still allow admin override for legacy pending-only rows missing intermediate states
    if (!(cur.status === "pending" && ["in_review", "accepted", "rejected", "completed"].includes(status))) {
      const err = new Error(`Illegal transition ${cur.status} → ${status}`);
      err.code = "ILLEGAL_TRANSITION";
      throw err;
    }
  }
  const next = {
    ...rows[idx],
    status,
    resolutionNote: note != null ? String(note).slice(0, 2000) : cur.resolutionNote,
    resolvedBy: terminal ? actorId || cur.resolvedBy : cur.resolvedBy,
    resolvedAt: terminal ? now : cur.resolvedAt,
    updatedAt: now
  };
  rows[idx] = next;
  writeJsonArray(file, rows);
  return mapTakedown(next);
}

// ── User role update ─────────────────────────────────────────────────────────

const STAFF_ROLES = new Set([
  "user",
  "expert",
  "community_lead",
  "journalist",
  "moderator",
  "admin",
  "superadmin",
  "data_analyst"
]);

async function updateUserRole(userId, role, options = {}) {
  if (!STAFF_ROLES.has(role)) {
    const err = new Error("Invalid role");
    err.code = "INVALID_ROLE";
    throw err;
  }
  if (usePg(options)) {
    const pool = getPoolOrThrow(options);
    const res = await pool.query(
      "UPDATE users SET role = $2 WHERE id = $1 RETURNING id, email, role, created_at, muted_until, banned_until;",
      [userId, role]
    );
    if (!res.rows[0]) {
      const err = new Error("User not found");
      err.code = "NOT_FOUND";
      throw err;
    }
    const r = res.rows[0];
    return {
      id: r.id,
      email: r.email,
      role: r.role,
      createdAt: r.created_at,
      mutedUntil: r.muted_until,
      bannedUntil: r.banned_until
    };
  }
  const file = path.join(dataDir(options), "users.json");
  const rows = readJsonArray(file);
  const idx = rows.findIndex((u) => u.id === userId);
  if (idx < 0) {
    const err = new Error("User not found");
    err.code = "NOT_FOUND";
    throw err;
  }
  rows[idx].role = role;
  writeJsonArray(file, rows);
  const u = rows[idx];
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    mutedUntil: u.mutedUntil || null,
    bannedUntil: u.bannedUntil || null
  };
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    createdAt: u.createdAt,
    mutedUntil: u.mutedUntil || null,
    bannedUntil: u.bannedUntil || null
  };
}

module.exports = {
  APPEAL_SLA_HOURS,
  CRISIS_SLA_HOURS,
  APPEAL_TERMINAL,
  CRISIS_TERMINAL,
  STAFF_ROLES,
  computeSlaState,
  listAppeals,
  getAppeal,
  createAppeal,
  transitionAppeal,
  listCrisisCases,
  getCrisisCase,
  createCrisisCase,
  transitionCrisisCase,
  ensureCrisisFromModeration,
  listSanctions,
  listTakedownsAdmin,
  resolveTakedown,
  updateUserRole,
  publicUser,
  mapAppealRow,
  mapCrisisRow
};
