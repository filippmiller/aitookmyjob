/**
 * 003 — Tables for production write paths that still used data/*.json only.
 *
 * Covers: resources, cohorts, company_boards, anonymous_inbox, takedowns,
 * subscribers; plus forum_topics.updated_at used by topic edit.
 *
 * Seed/backfill of existing JSON content is done in initStorage (not here)
 * so re-running migrate never re-inserts product content.
 *
 * Bead: aitj-z8q.3
 */

"use strict";

module.exports = {
  version: "003",
  name: "remaining_write_entities",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'reskilling',
        title TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        region TEXT NOT NULL DEFAULT 'global',
        url TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'published',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_resources_region_status ON resources(region, status);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS cohorts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        profession TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT 'global',
        capacity INTEGER NOT NULL DEFAULT 10,
        enrolled INTEGER NOT NULL DEFAULT 0,
        starts_at TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cohorts_status_country ON cohorts(status, country);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS company_boards (
        id TEXT PRIMARY KEY,
        company_slug TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        created_by TEXT NOT NULL DEFAULT 'system',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_company_boards_slug_created ON company_boards(company_slug, created_at DESC);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS anonymous_inbox (
        id TEXT PRIMARY KEY,
        tracking_code TEXT NOT NULL UNIQUE,
        message TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'web',
        status TEXT NOT NULL DEFAULT 'received',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_anonymous_inbox_created ON anonymous_inbox(created_at DESC);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS takedowns (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        reason TEXT NOT NULL,
        target_url TEXT NOT NULL,
        legal_basis TEXT NOT NULL DEFAULT 'unspecified',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_takedowns_status_created ON takedowns(status, created_at DESC);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        country TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'en',
        subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_subscribers_subscribed_at ON subscribers(subscribed_at DESC);"
    );

    // forum topic edit path references updated_at
    await client.query(
      "ALTER TABLE forum_topics ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();"
    );
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS subscribers CASCADE;");
    await client.query("DROP TABLE IF EXISTS takedowns CASCADE;");
    await client.query("DROP TABLE IF EXISTS anonymous_inbox CASCADE;");
    await client.query("DROP TABLE IF EXISTS company_boards CASCADE;");
    await client.query("DROP TABLE IF EXISTS cohorts CASCADE;");
    await client.query("DROP TABLE IF EXISTS resources CASCADE;");
    // Keep forum_topics.updated_at — dropping columns is riskier than leaving them.
  }
};
