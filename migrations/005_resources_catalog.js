/**
 * 005 — Verified resources & opportunities catalog.
 *
 * Extends resources with verification, source, language, cost, eligibility,
 * and link-check fields. Adds opportunities (OPPORTUNITY_STATUS), plus
 * user save / review / report tables.
 *
 * Bead: aitj-z8q.12
 */

"use strict";

module.exports = {
  version: "005",
  name: "resources_catalog",

  async up(client) {
    // ── Extend resources ────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE resources
        ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en',
        ADD COLUMN IF NOT EXISTS cost TEXT NOT NULL DEFAULT 'free',
        ADD COLUMN IF NOT EXISTS eligibility TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS verification_state TEXT NOT NULL DEFAULT 'unverified',
        ADD COLUMN IF NOT EXISTS link_status TEXT NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS link_checked_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS link_http_status INTEGER,
        ADD COLUMN IF NOT EXISTS flagged_reason TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
    `);

    await client.query(`
      UPDATE resources
      SET verification_state = 'unverified'
      WHERE verification_state IS NULL OR verification_state = '';
    `);

    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_resources_verification ON resources(verification_state, status);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_resources_link_status ON resources(link_status) WHERE link_status <> 'ok';"
    );

    // Soft-purge example.com / placeholder URLs from any prior seed
    await client.query(`
      UPDATE resources
      SET
        status = 'archived',
        verification_state = 'broken',
        link_status = 'broken',
        flagged_reason = 'placeholder_url_banned',
        updated_at = NOW()
      WHERE url ILIKE '%example.com%'
         OR url ILIKE '%example.org%'
         OR url ILIKE '%example.net%';
    `);

    // ── Opportunities (distinct entity, OPPORTUNITY_STATUS) ─────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS opportunities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'job',
        title TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        region TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'en',
        url TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        cost TEXT NOT NULL DEFAULT 'free',
        eligibility TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        verification_state TEXT NOT NULL DEFAULT 'unverified',
        last_verified_at TIMESTAMPTZ,
        link_status TEXT NOT NULL DEFAULT 'unknown',
        link_checked_at TIMESTAMPTZ,
        link_http_status INTEGER,
        profession TEXT NOT NULL DEFAULT '',
        closes_at TIMESTAMPTZ,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_opportunities_region_status ON opportunities(region, status);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_opportunities_verification ON opportunities(verification_state, status);"
    );

    // ── User interactions ───────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS resource_saves (
        user_id TEXT NOT NULL,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, resource_id)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_resource_saves_user ON resource_saves(user_id, created_at DESC);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS resource_reviews (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'published',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, resource_id)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_resource_reviews_resource ON resource_reviews(resource_id, created_at DESC);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS resource_reports (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_resource_reports_status ON resource_reports(status, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_resource_reports_resource ON resource_reports(resource_id);"
    );
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS resource_reports CASCADE;");
    await client.query("DROP TABLE IF EXISTS resource_reviews CASCADE;");
    await client.query("DROP TABLE IF EXISTS resource_saves CASCADE;");
    await client.query("DROP TABLE IF EXISTS opportunities CASCADE;");
    // Keep extended resource columns — dropping them is riskier than leaving them.
  }
};
