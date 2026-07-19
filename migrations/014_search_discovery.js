/**
 * 014 — Search, discovery, and saved searches.
 *
 * Adds:
 * - search_documents: denormalized FTS index across public-safe entity surfaces
 * - saved_searches: user-owned query + filters with optional notification flag
 *
 * Evidence is intentionally never indexed (P-SIGNAL-PUBLIC / isPubliclyListable empty).
 * Bead: aitj-z8q.17
 * Versions 011–013 reserved for other wave agents.
 */

"use strict";

module.exports = {
  version: "014",
  name: "search_discovery",

  async up(client) {
    // ── Denormalized search documents (public-safe only) ────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS search_documents (
        id TEXT PRIMARY KEY,
        doc_type TEXT NOT NULL
          CHECK (doc_type IN (
            'story', 'vent', 'news', 'insider_summary',
            'company', 'profession', 'group', 'resource', 'region'
          )),
        source_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL DEFAULT '',
        company TEXT NOT NULL DEFAULT '',
        profession TEXT NOT NULL DEFAULT '',
        region TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'en',
        status TEXT NOT NULL DEFAULT 'published',
        visibility TEXT NOT NULL DEFAULT 'public',
        author_id TEXT,
        slug TEXT NOT NULL DEFAULT '',
        url_path TEXT NOT NULL DEFAULT '',
        published_at TIMESTAMPTZ,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        search_vector tsvector,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (doc_type, source_id)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_documents_type_status
        ON search_documents(doc_type, status);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_documents_region
        ON search_documents(region);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_documents_slug
        ON search_documents(doc_type, slug)
        WHERE slug <> '';
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_documents_company
        ON search_documents(lower(company))
        WHERE company <> '';
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_documents_profession
        ON search_documents(lower(profession))
        WHERE profession <> '';
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_documents_fts
        ON search_documents USING GIN (search_vector);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_documents_published
        ON search_documents(published_at DESC NULLS LAST);
    `);

    // Keep search_vector in sync on write (title A, body/company/profession B/C)
    await client.query(`
      CREATE OR REPLACE FUNCTION search_documents_tsvector_update() RETURNS trigger AS $$
      BEGIN
        NEW.search_vector :=
          setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(NEW.company, '') || ' ' || coalesce(NEW.profession, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(NEW.body, '')), 'C') ||
          setweight(to_tsvector('english', coalesce(NEW.region, '') || ' ' || coalesce(NEW.slug, '')), 'D');
        NEW.updated_at := NOW();
        RETURN NEW;
      END
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      DROP TRIGGER IF EXISTS trg_search_documents_tsvector ON search_documents;
    `);
    await client.query(`
      CREATE TRIGGER trg_search_documents_tsvector
        BEFORE INSERT OR UPDATE OF title, body, company, profession, region, slug
        ON search_documents
        FOR EACH ROW
        EXECUTE FUNCTION search_documents_tsvector_update();
    `);

    // ── Saved searches ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_searches (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        query TEXT NOT NULL DEFAULT '',
        types TEXT[] NOT NULL DEFAULT '{}',
        filters JSONB NOT NULL DEFAULT '{}'::jsonb,
        notify BOOLEAN NOT NULL DEFAULT FALSE,
        notify_channel TEXT NOT NULL DEFAULT 'email'
          CHECK (notify_channel IN ('email', 'telegram', 'in_app', 'none')),
        last_notified_at TIMESTAMPTZ,
        last_result_count INTEGER,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'paused', 'deleted')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_searches_user
        ON saved_searches(user_id, status, updated_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_saved_searches_notify
        ON saved_searches(notify, status)
        WHERE notify = TRUE AND status = 'active';
    `);
  },

  async down(client) {
    await client.query("DROP TRIGGER IF EXISTS trg_search_documents_tsvector ON search_documents;");
    await client.query("DROP FUNCTION IF EXISTS search_documents_tsvector_update();");
    await client.query("DROP TABLE IF EXISTS saved_searches;");
    await client.query("DROP TABLE IF EXISTS search_documents;");
  }
};
