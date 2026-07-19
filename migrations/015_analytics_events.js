/**
 * 015 — Product analytics events and outcome tracking.
 *
 * Adds:
 * - analytics_events: privacy-safe product events with seed/test flags + dedupe
 *
 * Public aggregates use k-anonymity in application code (lib/analytics.js).
 * Bead: aitj-z8q.18
 */

"use strict";

module.exports = {
  version: "015",
  name: "analytics_events",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        event_name TEXT NOT NULL,
        event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_id TEXT NULL,
        session_id TEXT NULL,
        anonymous_id TEXT NULL,
        subject_type TEXT NULL,
        subject_id TEXT NULL,
        country TEXT NULL,
        language TEXT NULL,
        properties JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_seed BOOLEAN NOT NULL DEFAULT false,
        is_test BOOLEAN NOT NULL DEFAULT false,
        dedupe_key TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_analytics_events_dedupe
        ON analytics_events (dedupe_key)
        WHERE dedupe_key IS NOT NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_events_name_at
        ON analytics_events (event_name, event_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_events_user
        ON analytics_events (user_id, event_at DESC)
        WHERE user_id IS NOT NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_events_subject
        ON analytics_events (subject_type, subject_id)
        WHERE subject_id IS NOT NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_events_flags
        ON analytics_events (is_seed, is_test, event_at DESC);
    `);
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS analytics_events;");
  }
};
