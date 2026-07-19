/**
 * 005 — Insider signals, protected evidence, and access audit.
 *
 * Tables: insider_signals, signal_links, evidence, evidence_access_log
 *
 * Privacy invariants (enforced in app + schema):
 * - Raw evidence is never public-listable (status check + no public route).
 * - signal_links connects two reports without storing/exposing authors.
 * - legal_hold blocks delete transitions (domain-contract D-LEGAL-HOLD).
 *
 * Bead: aitj-z8q.9
 */

"use strict";

module.exports = {
  version: "005",
  name: "insider_signals",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS insider_signals (
        id TEXT PRIMARY KEY,
        company_slug TEXT NOT NULL,
        company_name TEXT NOT NULL DEFAULT '',
        roles_affected JSONB NOT NULL DEFAULT '[]'::jsonb,
        automation_type TEXT NOT NULL DEFAULT '',
        event_date DATE,
        confidence NUMERIC(4,3),
        verification_level TEXT NOT NULL DEFAULT 'uncorroborated'
          CHECK (verification_level IN (
            'uncorroborated', 'single_source', 'multi_source', 'verified'
          )),
        status TEXT NOT NULL DEFAULT 'draft'
          CHECK (status IN (
            'draft', 'submitted', 'under_review', 'published_summary',
            'rejected', 'legal_hold', 'deleted'
          )),
        visibility TEXT NOT NULL DEFAULT 'restricted'
          CHECK (visibility IN ('public', 'restricted', 'private')),
        summary_public TEXT,
        body_restricted TEXT,
        author_id TEXT,
        tracking_code TEXT,
        retention_preference TEXT NOT NULL DEFAULT 'indefinite'
          CHECK (retention_preference IN ('30d', '90d', '365d', 'indefinite')),
        purge_after TIMESTAMPTZ,
        metadata_stripped BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        submitted_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ,
        deleted_at TIMESTAMPTZ
      );
    `);

    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_insider_signals_status_created ON insider_signals (status, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_insider_signals_company_status ON insider_signals (company_slug, status);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_insider_signals_author ON insider_signals (author_id) WHERE author_id IS NOT NULL;"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_insider_signals_tracking ON insider_signals (tracking_code) WHERE tracking_code IS NOT NULL;"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_insider_signals_purge ON insider_signals (purge_after) WHERE purge_after IS NOT NULL AND status = 'deleted';"
    );

    // Link two independent reports without exposing authors on either side.
    await client.query(`
      CREATE TABLE IF NOT EXISTS signal_links (
        id TEXT PRIMARY KEY,
        signal_id_a TEXT NOT NULL REFERENCES insider_signals(id) ON DELETE CASCADE,
        signal_id_b TEXT NOT NULL REFERENCES insider_signals(id) ON DELETE CASCADE,
        linked_by TEXT NOT NULL DEFAULT 'system',
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (signal_id_a < signal_id_b)
      );
    `);
    await client.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS uq_signal_links_pair ON signal_links (signal_id_a, signal_id_b);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_signal_links_a ON signal_links (signal_id_a);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_signal_links_b ON signal_links (signal_id_b);"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        parent_type TEXT NOT NULL
          CHECK (parent_type IN ('insider_signal', 'story')),
        parent_id TEXT NOT NULL,
        uploader_id TEXT,
        status TEXT NOT NULL DEFAULT 'uploaded'
          CHECK (status IN (
            'uploaded', 'scanning', 'available', 'restricted', 'redacted', 'purged'
          )),
        visibility TEXT NOT NULL DEFAULT 'restricted'
          CHECK (visibility IN ('restricted', 'private', 'system')),
        content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
        filename_original TEXT NOT NULL DEFAULT '',
        filename_stored TEXT NOT NULL DEFAULT '',
        storage_key TEXT NOT NULL DEFAULT '',
        size_bytes INTEGER NOT NULL DEFAULT 0
          CHECK (size_bytes >= 0),
        sha256 TEXT,
        redaction_notes TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        metadata_stripped BOOLEAN NOT NULL DEFAULT FALSE,
        body_ref TEXT,
        purge_after TIMESTAMPTZ,
        purged_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_evidence_parent ON evidence (parent_type, parent_id);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_evidence_status ON evidence (status, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_evidence_purge ON evidence (purge_after) WHERE purge_after IS NOT NULL AND status <> 'purged';"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS evidence_access_log (
        id TEXT PRIMARY KEY,
        evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL
          CHECK (action IN (
            'view', 'download', 'metadata', 'redact', 'purge',
            'status_change', 'upload', 'list'
          )),
        reason TEXT,
        ip TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_evidence_access_evidence ON evidence_access_log (evidence_id, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_evidence_access_actor ON evidence_access_log (actor_id, created_at DESC);"
    );
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS evidence_access_log CASCADE;");
    await client.query("DROP TABLE IF EXISTS evidence CASCADE;");
    await client.query("DROP TABLE IF EXISTS signal_links CASCADE;");
    await client.query("DROP TABLE IF EXISTS insider_signals CASCADE;");
  }
};
