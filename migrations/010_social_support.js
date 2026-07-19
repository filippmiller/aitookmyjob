/**
 * 010 — Social & support interaction system.
 *
 * Threaded comments (polymorphic), follows, blocks, content saves,
 * contextual support reactions, professional/regional groups,
 * reputation events, social reports. Extends forum_posts for parent_id
 * threading and notification_preferences for social opt-out.
 *
 * Bead: aitj-z8q.11
 * Leave 009 free for the news agent.
 */

"use strict";

module.exports = {
  version: "010",
  name: "social_support",

  async up(client) {
    // ── Forum reply threading (extend existing) ─────────────────────────────
    await client.query(`
      ALTER TABLE forum_posts
        ADD COLUMN IF NOT EXISTS parent_id TEXT NULL;
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_forum_posts_parent ON forum_posts(parent_id) WHERE parent_id IS NOT NULL;"
    );
    // Self-FK after column exists (safe if already applied)
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'forum_posts_parent_id_fkey'
        ) THEN
          ALTER TABLE forum_posts
            ADD CONSTRAINT forum_posts_parent_id_fkey
            FOREIGN KEY (parent_id) REFERENCES forum_posts(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // ── Polymorphic threaded comments (stories, vents, news, topics) ────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        target_type TEXT NOT NULL
          CHECK (target_type IN ('story', 'vent', 'news', 'topic', 'comment')),
        target_id TEXT NOT NULL,
        parent_id TEXT NULL REFERENCES comments(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT 'global',
        language TEXT NOT NULL DEFAULT 'en',
        status TEXT NOT NULL DEFAULT 'published'
          CHECK (status IN ('pending', 'published', 'hidden', 'deleted')),
        created_by TEXT NOT NULL,
        mentions JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id, created_at ASC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id) WHERE parent_id IS NOT NULL;"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_comments_author ON comments(created_by, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status) WHERE status <> 'published';"
    );

    // ── Follows ─────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS follows (
        follower_id TEXT NOT NULL,
        followee_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (follower_id, followee_id),
        CONSTRAINT follows_no_self CHECK (follower_id <> followee_id)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id, created_at DESC);"
    );

    // ── Blocks ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        blocker_id TEXT NOT NULL,
        blocked_id TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id),
        CONSTRAINT blocks_no_self CHECK (blocker_id <> blocked_id)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);"
    );

    // ── Content saves (polymorphic; resource_saves remain separate) ─────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS content_saves (
        user_id TEXT NOT NULL,
        target_type TEXT NOT NULL
          CHECK (target_type IN ('story', 'vent', 'news', 'topic', 'resource', 'opportunity')),
        target_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, target_type, target_id)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_content_saves_user ON content_saves(user_id, created_at DESC);"
    );

    // ── Contextual support reactions ────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        target_type TEXT NOT NULL
          CHECK (target_type IN ('story', 'vent', 'news', 'topic', 'comment', 'reply')),
        target_id TEXT NOT NULL,
        reaction_type TEXT NOT NULL
          CHECK (reaction_type IN (
            'solidarity', 'strength', 'gratitude', 'helpful', 'witness', 'celebrate'
          )),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id, target_type, target_id, reaction_type)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_reactions_target ON reactions(target_type, target_id);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id, created_at DESC);"
    );

    // ── Professional / regional groups ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS social_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'interest'
          CHECK (type IN ('professional', 'regional', 'interest')),
        profession TEXT NOT NULL DEFAULT '',
        region TEXT NOT NULL DEFAULT 'global',
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('draft', 'open', 'closed', 'archived', 'deleted')),
        created_by TEXT NOT NULL,
        member_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_social_groups_type_region ON social_groups(type, region, status);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_social_groups_profession ON social_groups(profession) WHERE profession <> '';"
    );

    await client.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id TEXT NOT NULL REFERENCES social_groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member'
          CHECK (role IN ('member', 'moderator', 'owner')),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'left', 'removed', 'banned')),
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ,
        PRIMARY KEY (group_id, user_id)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id) WHERE status = 'active';"
    );

    // ── Reputation (helpfulness-based) ──────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS reputation_events (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        actor_id TEXT,
        source_type TEXT NOT NULL DEFAULT '',
        source_id TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL
          CHECK (event_type IN (
            'helpful_reaction', 'helpful_comment', 'report_upheld',
            'report_dismissed', 'moderation_bonus', 'moderation_penalty',
            'group_contribution'
          )),
        points INTEGER NOT NULL DEFAULT 0,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_reputation_user ON reputation_events(user_id, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_reputation_source ON reputation_events(source_type, source_id);"
    );

    // ── Social content reports (moderation trail) ───────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS social_reports (
        id TEXT PRIMARY KEY,
        reporter_id TEXT,
        target_type TEXT NOT NULL
          CHECK (target_type IN (
            'story', 'vent', 'news', 'topic', 'comment', 'reply', 'user', 'group'
          )),
        target_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        resolved_by TEXT,
        resolution_note TEXT NOT NULL DEFAULT ''
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_social_reports_status ON social_reports(status, created_at DESC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_social_reports_target ON social_reports(target_type, target_id);"
    );

    // ── Social notification opt-out flags ───────────────────────────────────
    await client.query(`
      ALTER TABLE notification_preferences
        ADD COLUMN IF NOT EXISTS email_mentions BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS email_replies BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS email_follows BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    // Expand email_unsubscribes.scope CHECK for social categories
    await client.query(`
      DO $$
      DECLARE
        conname text;
      BEGIN
        SELECT c.conname INTO conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'email_unsubscribes'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%scope%';
        IF conname IS NOT NULL THEN
          EXECUTE format('ALTER TABLE email_unsubscribes DROP CONSTRAINT %I', conname);
        END IF;
        ALTER TABLE email_unsubscribes
          ADD CONSTRAINT email_unsubscribes_scope_chk
          CHECK (scope IN (
            'all', 'digest', 'transactional', 'follow_up', 'support',
            'mentions', 'replies', 'follows'
          ));
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END $$;
    `);
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS social_reports CASCADE;");
    await client.query("DROP TABLE IF EXISTS reputation_events CASCADE;");
    await client.query("DROP TABLE IF EXISTS group_members CASCADE;");
    await client.query("DROP TABLE IF EXISTS social_groups CASCADE;");
    await client.query("DROP TABLE IF EXISTS reactions CASCADE;");
    await client.query("DROP TABLE IF EXISTS content_saves CASCADE;");
    await client.query("DROP TABLE IF EXISTS blocks CASCADE;");
    await client.query("DROP TABLE IF EXISTS follows CASCADE;");
    await client.query("DROP TABLE IF EXISTS comments CASCADE;");
    // Keep forum_posts.parent_id and notification preference columns
  }
};
