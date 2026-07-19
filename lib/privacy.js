/**
 * Privacy export, account deletion cascade, and content anonymization.
 *
 * Implements D-USER-CASCADE from domain-contract:
 * - PII purge on user row
 * - Published expression → anonymize (keep aggregates)
 * - Drafts / private → soft-delete or hard-delete
 * - Analytics events → delete
 * - Sessions / identities / telegram → hard-delete
 *
 * Bead: aitj-z8q.19 (delete/export); coordinates with aitj-z8q.18 analytics cascade.
 */

"use strict";

const analytics = require("./analytics");

const ANON_LABEL = "Anonymous";
const ANON_COMPANY = "Redacted";

function usePg(ctx) {
  return Boolean(ctx.usePostgres && ctx.getPgPool);
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Collect a machine-readable privacy export for the subject user.
 * No secrets (password hashes, OTP codes, tokens).
 */
async function exportUserData(userId, ctx) {
  if (!userId) {
    const err = new Error("userId required");
    err.code = "VALIDATION";
    throw err;
  }

  const user = await ctx.storageGetUserById?.(userId);
  // fallbacks if storage helpers differ
  let resolvedUser = user;
  if (!resolvedUser && ctx.storageGetUsers) {
    const all = await ctx.storageGetUsers();
    resolvedUser = (all || []).find((u) => u.id === userId) || null;
  }

  const identity = ctx.storageGetIdentityByUserId
    ? await ctx.storageGetIdentityByUserId(userId)
    : null;
  const telegram = ctx.storageGetTelegramLinkByUserId
    ? await ctx.storageGetTelegramLinkByUserId(userId)
    : null;

  const stories = ((await ctx.storageGetStories?.()) || []).filter(
    (s) => s.submittedBy === userId
  );

  let vents = [];
  if (ctx.storageGetVents) {
    vents = ((await ctx.storageGetVents()) || []).filter((v) => v.submittedBy === userId);
  } else if (usePg(ctx)) {
    try {
      const pool = ctx.getPgPool();
      const res = await pool.query(
        `SELECT id, status, visibility, body, country, language, publication_intent,
                desired_response, submitted_by, created_at, updated_at
         FROM vents WHERE submitted_by = $1`,
        [userId]
      );
      vents = res.rows.map((r) => ({
        id: r.id,
        status: r.status,
        visibility: r.visibility,
        body: r.body,
        country: r.country,
        language: r.language,
        publicationIntent: r.publication_intent,
        desiredResponse: r.desired_response,
        submittedBy: r.submitted_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));
    } catch (_e) {
      vents = [];
    }
  }

  const analyticsOpts = {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool?.(),
    useMemory: !ctx.usePostgres
  };
  const analyticsEvents = await analytics.listEvents(
    { userId, includeSeed: true, includeTest: true, limit: 500 },
    analyticsOpts
  );

  // Audit events where actor is the user (redact sensitive metadata keys)
  let audit = [];
  if (ctx.storageGetAuditRange) {
    try {
      const from = "1970-01-01T00:00:00.000Z";
      const to = nowIso();
      const all = await ctx.storageGetAuditRange(from, to);
      audit = (all || [])
        .filter((e) => e.actorId === userId)
        .map((e) => ({
          id: e.id,
          action: e.action,
          targetType: e.targetType,
          targetId: e.targetId,
          createdAt: e.createdAt,
          metadata: scrubMeta(e.metadata)
        }));
    } catch (_e) {
      audit = [];
    }
  }

  return {
    exportedAt: nowIso(),
    schemaVersion: 1,
    subject: {
      id: userId,
      email: resolvedUser?.email || null,
      role: resolvedUser?.role || null,
      createdAt: resolvedUser?.createdAt || null,
      phoneVerified: Boolean(identity?.phoneVerified),
      phone: identity?.phone || resolvedUser?.phone || null,
      telegramLinked: Boolean(telegram)
    },
    content: {
      stories: stories.map(publicExportStory),
      vents: vents.map(publicExportVent)
    },
    analytics: analyticsEvents.map((e) => ({
      id: e.id,
      eventName: e.eventName,
      eventAt: e.eventAt,
      subjectType: e.subjectType,
      subjectId: e.subjectId,
      properties: e.properties
    })),
    audit,
    notes: [
      "Password hashes, session tokens, and OTP secrets are never exported.",
      "Evidence binary payloads are not included; request staff process if needed.",
      "Published content may remain anonymized after account deletion for research integrity."
    ]
  };
}

function scrubMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  const out = { ...meta };
  for (const k of Object.keys(out)) {
    if (/email|password|token|secret|phone|ip/i.test(k)) delete out[k];
  }
  return out;
}

function publicExportStory(s) {
  return {
    id: s.id,
    status: s.status,
    profession: s.profession,
    company: s.company,
    country: s.country,
    language: s.language,
    laidOffAt: s.laidOffAt,
    reason: s.reason,
    story: s.story,
    foundNewJob: s.foundNewJob,
    publicationIntent: s.publicationIntent,
    privacy: s.privacy,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt
  };
}

function publicExportVent(v) {
  return {
    id: v.id,
    status: v.status,
    visibility: v.visibility,
    body: v.body,
    country: v.country,
    language: v.language,
    publicationIntent: v.publicationIntent,
    desiredResponse: v.desiredResponse,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt
  };
}

/**
 * Anonymize a story in place (keep published for aggregates).
 */
function anonymizedStoryPatch() {
  return {
    name: ANON_LABEL,
    company: ANON_COMPANY,
    submittedBy: null,
    privacy: {
      nameDisplay: "anonymous",
      companyDisplay: "hidden",
      geoDisplay: "country",
      dateDisplay: "month"
    },
    anonymizedAt: nowIso(),
    anonymizedReason: "account_delete"
  };
}

/**
 * Full account deletion cascade.
 * Prefer anonymize for published public content; hard-delete PII and private data.
 *
 * @returns {{ ok: true, effects: object }}
 */
async function deleteAccountCascade(userId, ctx) {
  if (!userId) {
    const err = new Error("userId required");
    err.code = "VALIDATION";
    throw err;
  }

  const effects = {
    storiesAnonymized: 0,
    storiesDeleted: 0,
    ventsAnonymized: 0,
    ventsDeleted: 0,
    analyticsDeleted: 0,
    identitiesDeleted: 0,
    telegramDeleted: 0,
    userDeleted: false
  };

  const analyticsOpts = {
    usePostgres: ctx.usePostgres,
    getPool: () => ctx.getPgPool?.(),
    useMemory: !ctx.usePostgres
  };

  // 1) Analytics — hard delete (PII + linkage)
  try {
    const a = await analytics.deleteUserEvents(userId, analyticsOpts);
    effects.analyticsDeleted = a.deleted || 0;
  } catch (err) {
    console.warn("[privacy] analytics delete failed:", err.message || err);
  }

  if (usePg(ctx)) {
    const pool = ctx.getPgPool();
    await pool.query("BEGIN");
    try {
      // Stories: anonymize published; delete non-published
      const storiesRes = await pool.query(
        `SELECT id, status FROM stories WHERE submitted_by = $1`,
        [userId]
      );
      for (const row of storiesRes.rows) {
        if (row.status === "published") {
          await pool.query(
            `UPDATE stories
             SET name = $1,
                 company = $2,
                 submitted_by = NULL,
                 privacy = COALESCE(privacy, '{}'::jsonb) || $3::jsonb,
                 updated_at = NOW()
             WHERE id = $4`,
            [
              ANON_LABEL,
              ANON_COMPANY,
              JSON.stringify({
                nameDisplay: "anonymous",
                companyDisplay: "hidden",
                anonymizedAt: nowIso(),
                anonymizedReason: "account_delete"
              }),
              row.id
            ]
          );
          effects.storiesAnonymized += 1;
        } else {
          await pool.query(`DELETE FROM stories WHERE id = $1`, [row.id]);
          effects.storiesDeleted += 1;
        }
      }

      // Vents
      try {
        const ventsRes = await pool.query(
          `SELECT id, status, visibility FROM vents WHERE submitted_by = $1`,
          [userId]
        );
        for (const row of ventsRes.rows) {
          if (row.status === "published" && (row.visibility === "public" || row.visibility === "community")) {
            await pool.query(
              `UPDATE vents
               SET body = CASE
                     WHEN length(body) > 0 THEN '[Content anonymized after account deletion]'
                     ELSE body
                   END,
                   submitted_by = NULL,
                   updated_at = NOW()
               WHERE id = $1`,
              [row.id]
            );
            effects.ventsAnonymized += 1;
          } else {
            await pool.query(`DELETE FROM vents WHERE id = $1`, [row.id]);
            effects.ventsDeleted += 1;
          }
        }
      } catch (_e) {
        /* vents table may be absent in very old DBs */
      }

      // Insider signals — anonymize author
      try {
        await pool.query(
          `UPDATE insider_signals SET author_id = NULL WHERE author_id = $1`,
          [userId]
        );
      } catch (_e) {
        /* optional */
      }

      // Social / personalization soft cleanup
      const optionalDeletes = [
        `DELETE FROM resource_saves WHERE user_id = $1`,
        `DELETE FROM resource_reviews WHERE user_id = $1`,
        `DELETE FROM content_saves WHERE user_id = $1`,
        `DELETE FROM reactions WHERE user_id = $1`,
        `DELETE FROM follows WHERE follower_id = $1 OR following_id = $1`,
        `DELETE FROM blocks WHERE blocker_id = $1 OR blocked_id = $1`,
        `DELETE FROM group_members WHERE user_id = $1`,
        `DELETE FROM reputation_events WHERE user_id = $1`,
        `DELETE FROM user_intent_state WHERE user_id = $1`,
        `DELETE FROM feed_events WHERE user_id = $1`,
        `DELETE FROM cohort_members WHERE user_id = $1`,
        `DELETE FROM cohort_waitlist WHERE user_id = $1`,
        `DELETE FROM mentor_profiles WHERE user_id = $1`,
        `DELETE FROM cohort_outcomes WHERE user_id = $1`,
        `DELETE FROM saved_searches WHERE user_id = $1`,
        `DELETE FROM notification_preferences WHERE user_id = $1`,
        `DELETE FROM notification_deliveries WHERE recipient_user_id = $1`
      ];
      for (const sql of optionalDeletes) {
        try {
          await pool.query(sql, [userId]);
        } catch (_e) {
          /* table may not exist */
        }
      }

      // Forum topics/posts — anonymize author
      try {
        await pool.query(
          `UPDATE forum_topics SET created_by = NULL WHERE created_by = $1`,
          [userId]
        );
        await pool.query(
          `UPDATE forum_posts SET created_by = NULL WHERE created_by = $1`,
          [userId]
        );
      } catch (_e) {
        /* optional */
      }

      // Auth identities + telegram (FK cascade may handle some)
      const idRes = await pool.query(`DELETE FROM auth_identities WHERE user_id = $1`, [userId]);
      effects.identitiesDeleted = idRes.rowCount || 0;
      try {
        const tgRes = await pool.query(`DELETE FROM telegram_links WHERE user_id = $1`, [userId]);
        effects.telegramDeleted = tgRes.rowCount || 0;
      } catch (_e) {
        /* optional */
      }

      // Redact audit actor pointer (keep action for integrity, drop actor id)
      try {
        await pool.query(
          `UPDATE audit_log
           SET actor_id = NULL,
               metadata = COALESCE(metadata, '{}'::jsonb) || '{"actorRedacted":true}'::jsonb
           WHERE actor_id = $1`,
          [userId]
        );
      } catch (_e) {
        /* optional */
      }

      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
      effects.userDeleted = true;

      await pool.query("COMMIT");
    } catch (err) {
      await pool.query("ROLLBACK");
      throw err;
    }
  } else {
    // JSON / memory path — anonymize published, delete drafts, purge identities
    await jsonCascadeFallback(userId, ctx, effects);
    effects.userDeleted = true;
  }

  return { ok: true, effects, deletedAt: nowIso() };
}

/**
 * Dev JSON fallback when full storage hooks are not injected.
 * Mutates through context locked updates when paths are available.
 */
async function jsonCascadeFallback(userId, ctx, effects) {
  const {
    lockedJsonUpdate,
    usersPath,
    authIdentitiesPath,
    telegramLinksPath,
    storiesPath
  } = ctx;

  if (typeof lockedJsonUpdate !== "function") {
    // Last resort: call legacy storageDeleteUser if present
    if (typeof ctx.storageDeleteUserLegacy === "function") {
      await ctx.storageDeleteUserLegacy(userId);
    } else if (typeof ctx._storageDeleteUserRaw === "function") {
      await ctx._storageDeleteUserRaw(userId);
    }
    return;
  }

  if (storiesPath) {
    await lockedJsonUpdate(storiesPath, (rows) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].submittedBy !== userId) continue;
        if (rows[i].status === "published") {
          Object.assign(rows[i], anonymizedStoryPatch());
          effects.storiesAnonymized += 1;
        } else {
          rows.splice(i, 1);
          effects.storiesDeleted += 1;
        }
      }
    });
  }

  if (authIdentitiesPath) {
    await lockedJsonUpdate(authIdentitiesPath, (rows) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].userId === userId) {
          rows.splice(i, 1);
          effects.identitiesDeleted += 1;
        }
      }
    });
  }

  if (telegramLinksPath) {
    await lockedJsonUpdate(telegramLinksPath, (rows) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].userId === userId) {
          rows.splice(i, 1);
          effects.telegramDeleted += 1;
        }
      }
    });
  }

  if (usersPath) {
    await lockedJsonUpdate(usersPath, (users) => {
      const idx = users.findIndex((u) => u.id === userId);
      if (idx >= 0) users.splice(idx, 1);
    });
  }
}

module.exports = {
  exportUserData,
  deleteAccountCascade,
  anonymizedStoryPatch,
  ANON_LABEL,
  ANON_COMPANY
};
