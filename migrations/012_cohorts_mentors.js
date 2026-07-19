/**
 * 012 — Cohorts, buddy matching, mentors, and events.
 *
 * Extends the lean cohorts table from 003 with facilitators, waitlist/capacity
 * fields, and related tables for membership, waitlist ordering, buddy pairs,
 * mentor availability, events, and completion outcomes.
 *
 * Bead: aitj-z8q.14
 * Leave 011 free for the intent-feeds agent.
 */

"use strict";

module.exports = {
  version: "012",
  name: "cohorts_mentors",

  async up(client) {
    // ── Extend cohorts ──────────────────────────────────────────────────────
    await client.query(`
      ALTER TABLE cohorts
        ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS facilitator_id TEXT NULL,
        ADD COLUMN IF NOT EXISTS schedule_notes TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS ends_at TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public',
        ADD COLUMN IF NOT EXISTS waitlist_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS buddy_matching_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en',
        ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
    `);

    // Align status CHECK with domain contract (draft/open/full/in_progress/completed/cancelled)
    await client.query(`
      DO $$
      DECLARE
        conname text;
      BEGIN
        SELECT c.conname INTO conname
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        WHERE t.relname = 'cohorts'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%status%';
        IF conname IS NOT NULL THEN
          EXECUTE format('ALTER TABLE cohorts DROP CONSTRAINT %I', conname);
        END IF;
        ALTER TABLE cohorts
          ADD CONSTRAINT cohorts_status_chk
          CHECK (status IN (
            'draft', 'open', 'full', 'in_progress', 'completed', 'cancelled'
          ));
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END $$;
    `);

    await client.query(`
      DO $$
      BEGIN
        ALTER TABLE cohorts
          ADD CONSTRAINT cohorts_visibility_chk
          CHECK (visibility IN ('public', 'community', 'restricted'));
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END $$;
    `);

    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cohorts_facilitator ON cohorts(facilitator_id) WHERE facilitator_id IS NOT NULL;"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cohorts_profession_status ON cohorts(profession, status);"
    );

    // ── Membership ──────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cohort_members (
        cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member'
          CHECK (role IN ('member', 'facilitator', 'mentor')),
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN (
            'active', 'waitlisted', 'left', 'removed', 'banned', 'completed'
          )),
        joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        left_at TIMESTAMPTZ,
        notes TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (cohort_id, user_id)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cohort_members_user ON cohort_members(user_id) WHERE status IN ('active', 'waitlisted');"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cohort_members_cohort_status ON cohort_members(cohort_id, status);"
    );

    // ── Waitlist (ordered queue when at capacity) ───────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cohort_waitlist (
        cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'waiting'
          CHECK (status IN ('waiting', 'promoted', 'cancelled')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (cohort_id, user_id)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cohort_waitlist_order ON cohort_waitlist(cohort_id, position ASC) WHERE status = 'waiting';"
    );

    // ── Buddy pairs ─────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS buddy_pairs (
        id TEXT PRIMARY KEY,
        cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        user_a_id TEXT NOT NULL,
        user_b_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('proposed', 'active', 'completed', 'dissolved')),
        matched_by TEXT NOT NULL DEFAULT 'system',
        notes TEXT NOT NULL DEFAULT '',
        matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        dissolved_at TIMESTAMPTZ,
        CONSTRAINT buddy_pairs_distinct CHECK (user_a_id <> user_b_id)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_buddy_pairs_cohort ON buddy_pairs(cohort_id, status);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_buddy_pairs_users ON buddy_pairs(user_a_id, user_b_id);"
    );

    // ── Mentor profiles (global availability, optionally cohort-scoped use) ─
    await client.query(`
      CREATE TABLE IF NOT EXISTS mentor_profiles (
        user_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        bio TEXT NOT NULL DEFAULT '',
        expertise JSONB NOT NULL DEFAULT '[]'::jsonb,
        availability JSONB NOT NULL DEFAULT '{}'::jsonb,
        status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'paused', 'closed')),
        max_mentees INTEGER NOT NULL DEFAULT 3,
        current_mentees INTEGER NOT NULL DEFAULT 0,
        languages JSONB NOT NULL DEFAULT '["en"]'::jsonb,
        region TEXT NOT NULL DEFAULT 'global',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_mentor_profiles_status ON mentor_profiles(status) WHERE status = 'open';"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_mentor_profiles_region ON mentor_profiles(region);"
    );

    // ── Cohort events ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cohort_events (
        id TEXT PRIMARY KEY,
        cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ,
        location TEXT NOT NULL DEFAULT '',
        meeting_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'scheduled'
          CHECK (status IN ('scheduled', 'cancelled', 'completed')),
        reminder_offset_minutes INTEGER NOT NULL DEFAULT 60,
        reminder_sent_at TIMESTAMPTZ,
        created_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cohort_events_cohort_starts ON cohort_events(cohort_id, starts_at ASC);"
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cohort_events_reminder ON cohort_events(starts_at) WHERE status = 'scheduled' AND reminder_sent_at IS NULL;"
    );

    // ── Completion / outcome follow-ups ─────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS cohort_outcomes (
        id TEXT PRIMARY KEY,
        cohort_id TEXT NOT NULL REFERENCES cohorts(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        outcome_type TEXT NOT NULL DEFAULT 'completion'
          CHECK (outcome_type IN (
            'completion', 'early_exit', 'goal_met', 'goal_partial', 'needs_support'
          )),
        notes TEXT NOT NULL DEFAULT '',
        follow_up_sent_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (cohort_id, user_id, outcome_type)
      );
    `);
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_cohort_outcomes_user ON cohort_outcomes(user_id, created_at DESC);"
    );

    // ── Notification preference: cohort reminders ───────────────────────────
    await client.query(`
      ALTER TABLE notification_preferences
        ADD COLUMN IF NOT EXISTS email_cohorts BOOLEAN NOT NULL DEFAULT TRUE;
    `);

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
            'mentions', 'replies', 'follows', 'cohorts'
          ));
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END $$;
    `);
  },

  async down(client) {
    await client.query("DROP TABLE IF EXISTS cohort_outcomes CASCADE;");
    await client.query("DROP TABLE IF EXISTS cohort_events CASCADE;");
    await client.query("DROP TABLE IF EXISTS mentor_profiles CASCADE;");
    await client.query("DROP TABLE IF EXISTS buddy_pairs CASCADE;");
    await client.query("DROP TABLE IF EXISTS cohort_waitlist CASCADE;");
    await client.query("DROP TABLE IF EXISTS cohort_members CASCADE;");
    // Keep extended cohorts columns (non-destructive down for production safety)
  }
};
