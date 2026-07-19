/**
 * 005 — Notification deliveries, preferences, and email unsubscribes.
 *
 * Supports transactional + digest email/Telegram delivery with:
 * templates (app-layer), preferences, immediate unsubscribe, retries,
 * bounce/complaint hooks, delivery tracking, and idempotency keys.
 *
 * Bead: aitj-z8q.15
 */

"use strict";

module.exports = {
  version: "005",
  name: "notifications",

  async up(client) {
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_deliveries (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL
          CHECK (channel IN ('email', 'telegram')),
        template_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN (
            'pending', 'sending', 'delivered', 'failed',
            'cancelled', 'bounced', 'complained', 'skipped'
          )),
        recipient_email TEXT,
        recipient_user_id TEXT,
        recipient_telegram_chat_id TEXT,
        idempotency_key TEXT,
        subject TEXT,
        body_text TEXT,
        body_html TEXT,
        template_vars JSONB NOT NULL DEFAULT '{}'::jsonb,
        provider TEXT,
        provider_message_id TEXT,
        attempts INTEGER NOT NULL DEFAULT 0
          CHECK (attempts >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 5
          CHECK (max_attempts >= 1 AND max_attempts <= 20),
        last_error TEXT,
        job_id TEXT,
        scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sent_at TIMESTAMPTZ,
        delivered_at TIMESTAMPTZ,
        failed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_deliveries_idempotency
        ON notification_deliveries (idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_created ON notification_deliveries (status, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_notification_deliveries_template ON notification_deliveries (template_key, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_notification_deliveries_user ON notification_deliveries (recipient_user_id) WHERE recipient_user_id IS NOT NULL;"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_notification_deliveries_email ON notification_deliveries (recipient_email) WHERE recipient_email IS NOT NULL;"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        email TEXT,
        email_transactional BOOLEAN NOT NULL DEFAULT TRUE,
        email_digest BOOLEAN NOT NULL DEFAULT TRUE,
        email_follow_up BOOLEAN NOT NULL DEFAULT TRUE,
        email_support BOOLEAN NOT NULL DEFAULT TRUE,
        telegram_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        unsubscribe_token TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT notification_preferences_subject_chk
          CHECK (user_id IS NOT NULL OR email IS NOT NULL)
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_user
        ON notification_preferences (user_id)
        WHERE user_id IS NOT NULL;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_email
        ON notification_preferences (email)
        WHERE email IS NOT NULL;
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_preferences_token
        ON notification_preferences (unsubscribe_token);
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_unsubscribes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        email_hash TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'all'
          CHECK (scope IN ('all', 'digest', 'transactional', 'follow_up', 'support')),
        token TEXT,
        reason TEXT,
        source TEXT NOT NULL DEFAULT 'link'
          CHECK (source IN ('link', 'admin', 'bounce', 'complaint', 'preference')),
        unsubscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_email_unsubscribes_email_scope
        ON email_unsubscribes (email, scope);
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_hash ON email_unsubscribes (email_hash);"
    );
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_email_unsubscribes_token
        ON email_unsubscribes (token)
        WHERE token IS NOT NULL;
    `);
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS email_unsubscribes CASCADE;");
    await client.query("DROP TABLE IF EXISTS notification_preferences CASCADE;");
    await client.query("DROP TABLE IF EXISTS notification_deliveries CASCADE;");
  }
};
