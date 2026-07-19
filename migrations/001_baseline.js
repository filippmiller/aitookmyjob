/**
 * 001 — Baseline schema (matches pre-migration initStorage CREATE TABLE set).
 *
 * Fresh install: creates all production tables.
 * Upgrade: CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS is a no-op when
 * the legacy startup schema already exists.
 *
 * Seed data is intentionally NOT in this migration — seeds stay in initStorage
 * so re-running migrate never re-inserts product content.
 */

"use strict";

module.exports = {
  version: "001",
  name: "baseline_schema",

  async up(client) {
    // ── stories ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT NOT NULL,
        language TEXT NOT NULL,
        profession TEXT NOT NULL,
        company TEXT NOT NULL,
        laid_off_at TEXT NOT NULL,
        found_new_job BOOLEAN NOT NULL DEFAULT FALSE,
        reason TEXT NOT NULL,
        story TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        estimated_layoffs INTEGER NOT NULL DEFAULT 1,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
        privacy JSONB NOT NULL DEFAULT '{}'::jsonb,
        moderation JSONB NOT NULL DEFAULT '{}'::jsonb,
        submitted_by TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_stories_status_country_created ON stories(status, country, created_at DESC);"
    );
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;"
    );
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS metrics JSONB NOT NULL DEFAULT '{}'::jsonb;"
    );
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS privacy JSONB NOT NULL DEFAULT '{}'::jsonb;"
    );
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS moderation JSONB NOT NULL DEFAULT '{}'::jsonb;"
    );
    await client.query("ALTER TABLE stories ADD COLUMN IF NOT EXISTS submitted_by TEXT NULL;");
    await client.query(
      "ALTER TABLE stories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();"
    );

    // ── users ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        phone TEXT UNIQUE NULL,
        role TEXT NOT NULL DEFAULT 'user',
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        muted_until TIMESTAMPTZ NULL,
        banned_until TIMESTAMPTZ NULL
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);");

    // ── auth_identities ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_identities (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        email_verified BOOLEAN NOT NULL DEFAULT TRUE,
        phone TEXT NULL,
        phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
        pending_phone TEXT NULL,
        phone_otp_hash TEXT NULL,
        phone_otp_expires_at TIMESTAMPTZ NULL,
        phone_otp_attempts INTEGER NOT NULL DEFAULT 0,
        telegram_link_code TEXT NULL,
        telegram_code_expires_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── story_versions ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS story_versions (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        version_no INTEGER NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── telegram_links ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS telegram_links (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        telegram_user_id TEXT NOT NULL,
        telegram_username TEXT NULL,
        status TEXT NOT NULL DEFAULT 'linked',
        linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id),
        UNIQUE(telegram_user_id)
      );
    `);

    // ── transparency_events ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS transparency_events (
        id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        status TEXT NOT NULL,
        details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── forum ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS forum_topics (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'en',
        status TEXT NOT NULL DEFAULT 'published',
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS forum_posts (
        id TEXT PRIMARY KEY,
        topic_id TEXT NOT NULL REFERENCES forum_topics(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'en',
        status TEXT NOT NULL DEFAULT 'published',
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── moderation / audit ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS sanctions (
        id TEXT PRIMARY KEY,
        target_user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reason TEXT NOT NULL,
        duration_days INTEGER NULL,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        actor_id TEXT NULL,
        target_type TEXT NULL,
        target_id TEXT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        ip TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── news ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS news_items (
        id TEXT PRIMARY KEY,
        title JSONB NOT NULL DEFAULT '{}'::jsonb,
        source TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        published_at TIMESTAMPTZ NOT NULL,
        region TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'en',
        summary TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'published',
        relevance_score INTEGER NOT NULL DEFAULT 0,
        discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_news_items_status_region_published ON news_items(status, region, published_at DESC);"
    );

    // ── petitions / polls ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS petitions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        goal INTEGER NOT NULL DEFAULT 1000,
        base_signatures INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        featured BOOLEAN NOT NULL DEFAULT FALSE
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_petitions_status_created ON petitions(status, created_at DESC);"
    );
    await client.query(`
      CREATE TABLE IF NOT EXISTS petition_signatures (
        petition_id TEXT NOT NULL REFERENCES petitions(id) ON DELETE CASCADE,
        voter_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (petition_id, voter_hash)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS boundary_poll_votes (
        poll_id TEXT NOT NULL,
        voter_hash TEXT NOT NULL,
        choice TEXT NOT NULL CHECK (choice IN ('yes','no','unsure')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (poll_id, voter_hash)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_boundary_poll_votes_poll_choice ON boundary_poll_votes(poll_id, choice);"
    );
  },

  /**
   * down() drops application tables but NEVER drops schema_migrations.
   * Destructive — for local/dev only. Production: prefer forward-fix.
   */
  async down(client) {
    await client.query("DROP TABLE IF EXISTS boundary_poll_votes CASCADE;");
    await client.query("DROP TABLE IF EXISTS petition_signatures CASCADE;");
    await client.query("DROP TABLE IF EXISTS petitions CASCADE;");
    await client.query("DROP TABLE IF EXISTS news_items CASCADE;");
    await client.query("DROP TABLE IF EXISTS audit_log CASCADE;");
    await client.query("DROP TABLE IF EXISTS sanctions CASCADE;");
    await client.query("DROP TABLE IF EXISTS forum_posts CASCADE;");
    await client.query("DROP TABLE IF EXISTS forum_topics CASCADE;");
    await client.query("DROP TABLE IF EXISTS transparency_events CASCADE;");
    await client.query("DROP TABLE IF EXISTS telegram_links CASCADE;");
    await client.query("DROP TABLE IF EXISTS story_versions CASCADE;");
    await client.query("DROP TABLE IF EXISTS auth_identities CASCADE;");
    await client.query("DROP TABLE IF EXISTS users CASCADE;");
    await client.query("DROP TABLE IF EXISTS stories CASCADE;");
  }
};
