/**
 * 005 — Expression & publication-intent flows (aitj-z8q.8).
 *
 * - vents table (separate entity /api/vents)
 * - expression author-control columns on stories
 * - expression_reports + expression_followups
 * - CHECK constraints from domain-contract enums
 */

"use strict";

const {
  PUBLICATION_INTENT,
  DESIRED_RESPONSE,
  ANONYMITY_MODE,
  ADVICE_PERMISSION,
  RETENTION_PREFERENCE,
  VISIBILITY,
  VENT_STATUS,
  valuesOf
} = require("../lib/domain-contract");

async function constraintExists(client, name) {
  const res = await client.query(
    "SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1;",
    [name]
  );
  return res.rows.length > 0;
}

async function addCheck(client, table, name, expression) {
  if (await constraintExists(client, name)) return;
  await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expression});`);
}

function sqlInList(values) {
  return values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");
}

module.exports = {
  version: "005",
  name: "expression_flows",

  async up(client) {
    const intents = valuesOf(PUBLICATION_INTENT);
    const desired = valuesOf(DESIRED_RESPONSE);
    const anonymity = valuesOf(ANONYMITY_MODE);
    const advice = valuesOf(ADVICE_PERMISSION);
    const retention = valuesOf(RETENTION_PREFERENCE);
    const visibility = valuesOf(VISIBILITY);
    const ventStatuses = valuesOf(VENT_STATUS);

    // ── Author controls on stories ──
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS publication_intent TEXT NOT NULL DEFAULT 'story';"
    );
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS desired_response TEXT NOT NULL DEFAULT 'witness';"
    );
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS advice_permission TEXT NOT NULL DEFAULT 'open';"
    );
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS anonymity_mode TEXT NOT NULL DEFAULT 'alias';"
    );
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';"
    );
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS retention_preference TEXT NOT NULL DEFAULT 'indefinite';"
    );

    // Normalize any nulls introduced by partial upgrades
    await client.query(
      `UPDATE stories SET publication_intent = 'story' WHERE publication_intent IS NULL OR publication_intent = '';`
    );
    await client.query(
      `UPDATE stories SET desired_response = 'witness' WHERE desired_response IS NULL OR desired_response = '';`
    );
    await client.query(
      `UPDATE stories SET advice_permission = 'open' WHERE advice_permission IS NULL OR advice_permission = '';`
    );
    await client.query(
      `UPDATE stories SET anonymity_mode = 'alias' WHERE anonymity_mode IS NULL OR anonymity_mode = '';`
    );
    await client.query(
      `UPDATE stories SET visibility = 'public' WHERE visibility IS NULL OR visibility = '';`
    );
    await client.query(
      `UPDATE stories SET retention_preference = 'indefinite' WHERE retention_preference IS NULL OR retention_preference = '';`
    );

    await addCheck(
      client,
      "stories",
      "stories_publication_intent_check",
      `publication_intent IN (${sqlInList(intents)})`
    );
    await addCheck(
      client,
      "stories",
      "stories_desired_response_check",
      `desired_response IN (${sqlInList(desired)})`
    );
    await addCheck(
      client,
      "stories",
      "stories_advice_permission_check",
      `advice_permission IN (${sqlInList(advice)})`
    );
    await addCheck(
      client,
      "stories",
      "stories_anonymity_mode_check",
      `anonymity_mode IN (${sqlInList(anonymity)})`
    );
    await addCheck(
      client,
      "stories",
      "stories_visibility_check",
      `visibility IN (${sqlInList(visibility)})`
    );
    await addCheck(
      client,
      "stories",
      "stories_retention_preference_check",
      `retention_preference IN (${sqlInList(retention)})`
    );

    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_stories_intent_status ON stories(publication_intent, status);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_stories_visibility_status ON stories(visibility, status);"
    );

    // ── Vents (separate entity) ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS vents (
        id TEXT PRIMARY KEY,
        title TEXT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        publication_intent TEXT NOT NULL DEFAULT 'vent',
        desired_response TEXT NOT NULL DEFAULT 'empathy',
        advice_permission TEXT NOT NULL DEFAULT 'closed',
        anonymity_mode TEXT NOT NULL DEFAULT 'anonymous',
        visibility TEXT NOT NULL DEFAULT 'community',
        retention_preference TEXT NOT NULL DEFAULT '30d',
        country TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'en',
        display_name TEXT NULL,
        company TEXT NULL,
        privacy JSONB NOT NULL DEFAULT '{}'::jsonb,
        moderation JSONB NOT NULL DEFAULT '{}'::jsonb,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        submitted_by TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_vents_status_visibility_created ON vents(status, visibility, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_vents_submitted_by ON vents(submitted_by) WHERE submitted_by IS NOT NULL;"
    );

    await client.query(
      `UPDATE vents SET status = 'pending' WHERE status IS NULL OR status NOT IN (${sqlInList(ventStatuses)});`
    );
    await addCheck(
      client,
      "vents",
      "vents_status_check",
      `status IN (${sqlInList(ventStatuses)})`
    );
    await addCheck(
      client,
      "vents",
      "vents_publication_intent_check",
      `publication_intent IN (${sqlInList(intents)})`
    );
    await addCheck(
      client,
      "vents",
      "vents_desired_response_check",
      `desired_response IN (${sqlInList(desired)})`
    );
    await addCheck(
      client,
      "vents",
      "vents_advice_permission_check",
      `advice_permission IN (${sqlInList(advice)})`
    );
    await addCheck(
      client,
      "vents",
      "vents_anonymity_mode_check",
      `anonymity_mode IN (${sqlInList(anonymity)})`
    );
    await addCheck(
      client,
      "vents",
      "vents_visibility_check",
      `visibility IN (${sqlInList(visibility)})`
    );
    await addCheck(
      client,
      "vents",
      "vents_retention_preference_check",
      `retention_preference IN (${sqlInList(retention)})`
    );

    // ── Reports ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS expression_reports (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        reporter_id TEXT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_expression_reports_status_created ON expression_reports(status, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_expression_reports_target ON expression_reports(target_type, target_id);"
    );
    await addCheck(
      client,
      "expression_reports",
      "expression_reports_target_type_check",
      "target_type IN ('story', 'vent')"
    );
    await addCheck(
      client,
      "expression_reports",
      "expression_reports_status_check",
      "status IN ('open', 'in_review', 'resolved', 'dismissed')"
    );

    // ── Follow-ups ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS expression_followups (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        body TEXT NOT NULL,
        outcome_status TEXT NULL,
        created_by TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_expression_followups_target ON expression_followups(target_type, target_id, created_at DESC);"
    );
    await addCheck(
      client,
      "expression_followups",
      "expression_followups_target_type_check",
      "target_type IN ('story', 'vent')"
    );
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS expression_followups CASCADE;");
    await client.query("DROP TABLE IF EXISTS expression_reports CASCADE;");
    await client.query("DROP TABLE IF EXISTS vents CASCADE;");
    // Keep story columns (non-destructive down for production safety)
  }
};
