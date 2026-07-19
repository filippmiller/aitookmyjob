/**
 * 011 — Intent-aware personalized feeds.
 *
 * user_intent_state: per-user primary/secondary intent + saved prefs.
 * feed_events: optional engagement signals for ranking feedback (no PII required).
 *
 * Bead: aitj-z8q.13
 */

"use strict";

module.exports = {
  version: "011",
  name: "intent_feeds",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_intent_state (
        user_id TEXT PRIMARY KEY,
        primary_intent TEXT NOT NULL
          CHECK (primary_intent IN (
            'only_reading',
            'need_to_vent',
            'seeking_similar',
            'gathering_information',
            'ready_to_act',
            'ready_to_help'
          )),
        secondary_intents JSONB NOT NULL DEFAULT '[]'::jsonb,
        prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
        source TEXT NOT NULL DEFAULT 'explicit'
          CHECK (source IN ('explicit', 'inferred', 'default', 'anonymous_fallback')),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_user_intent_primary ON user_intent_state(primary_intent);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_user_intent_updated ON user_intent_state(updated_at DESC);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS feed_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NULL,
        session_key TEXT NULL,
        event_type TEXT NOT NULL
          CHECK (event_type IN (
            'impression', 'click', 'save', 'hide', 'dismiss', 'intent_change'
          )),
        item_type TEXT NOT NULL DEFAULT ''
          CHECK (item_type IN (
            '', 'vent', 'story', 'news', 'resource', 'opportunity',
            'topic', 'group', 'petition', 'next_step'
          )),
        item_id TEXT NOT NULL DEFAULT '',
        intent_at_time TEXT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_feed_events_user ON feed_events(user_id, created_at DESC) WHERE user_id IS NOT NULL;"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_feed_events_session ON feed_events(session_key, created_at DESC) WHERE session_key IS NOT NULL;"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_feed_events_item ON feed_events(item_type, item_id) WHERE item_id <> '';"
    );
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS feed_events CASCADE;");
    await client.query("DROP TABLE IF EXISTS user_intent_state CASCADE;");
  }
};
