/**
 * 013 — Admin operations: appeals, crisis cases, takedown resolution fields.
 *
 * Bead: aitj-z8q.16
 * Note: 011/012 reserved for other agents.
 */

"use strict";

module.exports = {
  version: "013",
  name: "admin_ops",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS appeals (
        id TEXT PRIMARY KEY,
        appellant_user_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'submitted'
          CHECK (status IN ('submitted','under_review','upheld','overturned','withdrawn')),
        sla_due_at TIMESTAMPTZ NOT NULL,
        sla_state TEXT NOT NULL DEFAULT 'on_track'
          CHECK (sla_state IN ('on_track','at_risk','breached','resolved')),
        resolution_note TEXT NOT NULL DEFAULT '',
        assigned_to TEXT NULL,
        resolved_by TEXT NULL,
        resolved_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_appeals_status_created ON appeals(status, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_appeals_sla ON appeals(sla_state, sla_due_at) WHERE status IN ('submitted','under_review');"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_appeals_appellant ON appeals(appellant_user_id, created_at DESC);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS crisis_cases (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT 'global',
        excerpt TEXT NOT NULL DEFAULT '',
        risk_score NUMERIC NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open','acknowledged','in_progress','escalated','resolved','false_positive')),
        sla_due_at TIMESTAMPTZ NOT NULL,
        sla_state TEXT NOT NULL DEFAULT 'on_track'
          CHECK (sla_state IN ('on_track','at_risk','breached','resolved')),
        notes TEXT NOT NULL DEFAULT '',
        assigned_to TEXT NULL,
        resources_offered JSONB NOT NULL DEFAULT '[]'::jsonb,
        resolved_by TEXT NULL,
        resolved_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_crisis_status_created ON crisis_cases(status, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_crisis_sla ON crisis_cases(sla_state, sla_due_at) WHERE status NOT IN ('resolved','false_positive');"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_crisis_source ON crisis_cases(source_type, source_id);"
    );

    // Takedown resolution metadata (status column already exists)
    await client.query(`
      ALTER TABLE takedowns
        ADD COLUMN IF NOT EXISTS resolution_note TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS resolved_by TEXT NULL,
        ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ NULL,
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    `);

    // Users.role updates already supported; no schema change needed.
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS crisis_cases CASCADE;");
    await client.query("DROP TABLE IF EXISTS appeals CASCADE;");
    // Leave takedowns extra columns — safer than DROP COLUMN in production.
  }
};
