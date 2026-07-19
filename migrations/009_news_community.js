/**
 * 009 — Community-grounded news discussion.
 *
 * Extends news_items with canonical URL/hash, content hash, entities,
 * relevance/correction/source health fields. Adds news_submissions,
 * news_discussions, and news_source_health for user submit, discuss,
 * and stale/broken source tracking.
 *
 * Bead: aitj-z8q.10
 */

"use strict";

module.exports = {
  version: "009",
  name: "news_community",

  async up(client) {
    // ── Extend news_items ───────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE news_items
        ADD COLUMN IF NOT EXISTS canonical_url TEXT,
        ADD COLUMN IF NOT EXISTS url_hash TEXT,
        ADD COLUMN IF NOT EXISTS content_hash TEXT,
        ADD COLUMN IF NOT EXISTS entities JSONB NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS companies TEXT[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS professions TEXT[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS correction_note TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS corrected_by TEXT,
        ADD COLUMN IF NOT EXISTS source_status TEXT NOT NULL DEFAULT 'unknown',
        ADD COLUMN IF NOT EXISTS source_checked_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS source_http_status INTEGER,
        ADD COLUMN IF NOT EXISTS merged_into_id TEXT,
        ADD COLUMN IF NOT EXISTS duplicate_urls TEXT[] NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS discussion_topic_id TEXT,
        ADD COLUMN IF NOT EXISTS submitted_by TEXT,
        ADD COLUMN IF NOT EXISTS submission_id TEXT;
    `);

    // Backfill canonical_url / hashes from existing url when missing
    await client.query(`
      UPDATE news_items
      SET canonical_url = url
      WHERE canonical_url IS NULL OR canonical_url = '';
    `);

    // url_hash unique among non-merged items (allow null for legacy until backfill)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_news_items_url_hash
        ON news_items(url_hash)
        WHERE url_hash IS NOT NULL AND merged_into_id IS NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_news_items_content_hash
        ON news_items(content_hash)
        WHERE content_hash IS NOT NULL AND merged_into_id IS NULL;
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_news_items_companies
        ON news_items USING GIN (companies);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_news_items_professions
        ON news_items USING GIN (professions);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_news_items_source_status
        ON news_items(source_status)
        WHERE source_status <> 'ok';
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_news_items_entities
        ON news_items USING GIN (entities);
    `);

    // ── User submissions ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_submissions (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        url_hash TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        companies TEXT[] NOT NULL DEFAULT '{}',
        professions TEXT[] NOT NULL DEFAULT '{}',
        region TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'en',
        commentary TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        submitted_by TEXT,
        news_item_id TEXT,
        reject_reason TEXT NOT NULL DEFAULT '',
        moderated_by TEXT,
        moderated_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_news_submissions_status ON news_submissions(status, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_news_submissions_url_hash ON news_submissions(url_hash);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_news_submissions_submitter ON news_submissions(submitted_by, created_at DESC);"
    );

    // ── Discussion comments on news items ───────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_discussions (
        id TEXT PRIMARY KEY,
        news_item_id TEXT NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'published',
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_news_discussions_item ON news_discussions(news_item_id, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_news_discussions_status ON news_discussions(status) WHERE status <> 'published';"
    );

    // ── Source health tracking ──────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_source_health (
        source_key TEXT PRIMARY KEY,
        source_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'unknown',
        last_success_at TIMESTAMPTZ,
        last_failure_at TIMESTAMPTZ,
        last_http_status INTEGER,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        failure_reason TEXT NOT NULL DEFAULT '',
        checked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_news_source_health_status ON news_source_health(status) WHERE status <> 'ok';"
    );
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS news_discussions CASCADE;");
    await client.query("DROP TABLE IF EXISTS news_submissions CASCADE;");
    await client.query("DROP TABLE IF EXISTS news_source_health CASCADE;");
    await client.query("DROP INDEX IF EXISTS idx_news_items_url_hash;");
    await client.query("DROP INDEX IF EXISTS idx_news_items_content_hash;");
    await client.query("DROP INDEX IF EXISTS idx_news_items_companies;");
    await client.query("DROP INDEX IF EXISTS idx_news_items_professions;");
    await client.query("DROP INDEX IF EXISTS idx_news_items_source_status;");
    await client.query("DROP INDEX IF EXISTS idx_news_items_entities;");
    // Columns left in place on down to avoid data loss; full rollback of
    // ALTER ADD COLUMN is optional for this feature migration.
  }
};
