/**
 * 002 — Integrity constraints aligned with domain-contract v1.
 *
 * Safe for existing production data:
 *   1. Backfill / normalize out-of-contract status values
 *   2. Add CHECKs only after data is clean
 *   3. Add unique indexes and supporting indexes with IF NOT EXISTS
 *   4. Skip FKs that would break historical orphan rows (documented)
 *
 * Domain enums used (subset that maps to live tables):
 *   STORY_STATUS, DISCUSSION_TOPIC_STATUS, DISCUSSION_REPLY_STATUS,
 *   NEWS_STATUS, PETITION_STATUS, SANCTION_TYPE
 */

"use strict";

const {
  STORY_STATUS,
  DISCUSSION_TOPIC_STATUS,
  DISCUSSION_REPLY_STATUS,
  NEWS_STATUS,
  PETITION_STATUS,
  SANCTION_TYPE,
  valuesOf
} = require("../lib/domain-contract");

async function constraintExists(client, name) {
  const res = await client.query(
    "SELECT 1 FROM pg_constraint WHERE conname = $1 LIMIT 1;",
    [name]
  );
  return res.rows.length > 0;
}

async function addCheck(client, table, name, expression) {
  if (await constraintExists(client, name)) return;
  await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${name} CHECK (${expression});`);
}

function sqlInList(values) {
  return values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");
}

module.exports = {
  version: "002",
  name: "integrity_constraints",

  async up(client) {
    const storyStatuses = valuesOf(STORY_STATUS);
    const topicStatuses = valuesOf(DISCUSSION_TOPIC_STATUS);
    const replyStatuses = valuesOf(DISCUSSION_REPLY_STATUS);
    const newsStatuses = valuesOf(NEWS_STATUS);
    const petitionStatuses = valuesOf(PETITION_STATUS);
    const sanctionTypes = valuesOf(SANCTION_TYPE);

    // ── Backfills: map unknown values into safe contract defaults ──
    // Stories: unknown → pending (moderation queue); never invent published.
    await client.query(
      `UPDATE stories
       SET status = 'pending'
       WHERE status IS NULL OR status NOT IN (${sqlInList(storyStatuses)});`
    );

    // Forum topics: unknown → pending
    await client.query(
      `UPDATE forum_topics
       SET status = 'pending'
       WHERE status IS NULL OR status NOT IN (${sqlInList(topicStatuses)});`
    );

    // Forum posts (replies): unknown → pending
    await client.query(
      `UPDATE forum_posts
       SET status = 'pending'
       WHERE status IS NULL OR status NOT IN (${sqlInList(replyStatuses)});`
    );

    // News: unknown → discovered (not auto-published)
    await client.query(
      `UPDATE news_items
       SET status = 'discovered'
       WHERE status IS NULL OR status NOT IN (${sqlInList(newsStatuses)});`
    );

    // Petitions: unknown → open (matches seed defaults); deleted stays if already valid
    await client.query(
      `UPDATE petitions
       SET status = 'open'
       WHERE status IS NULL OR status NOT IN (${sqlInList(petitionStatuses)});`
    );

    // Sanctions: unknown → warn (least severe)
    await client.query(
      `UPDATE sanctions
       SET type = 'warn'
       WHERE type IS NULL OR type NOT IN (${sqlInList(sanctionTypes)});`
    );

    // estimated_layoffs must be positive
    await client.query(
      `UPDATE stories SET estimated_layoffs = 1
       WHERE estimated_layoffs IS NULL OR estimated_layoffs < 1;`
    );

    // ── CHECK constraints ──
    await addCheck(
      client,
      "stories",
      "stories_status_check",
      `status IN (${sqlInList(storyStatuses)})`
    );
    await addCheck(
      client,
      "stories",
      "stories_estimated_layoffs_positive",
      "estimated_layoffs >= 1"
    );

    await addCheck(
      client,
      "forum_topics",
      "forum_topics_status_check",
      `status IN (${sqlInList(topicStatuses)})`
    );
    await addCheck(
      client,
      "forum_posts",
      "forum_posts_status_check",
      `status IN (${sqlInList(replyStatuses)})`
    );
    await addCheck(
      client,
      "news_items",
      "news_items_status_check",
      `status IN (${sqlInList(newsStatuses)})`
    );
    await addCheck(
      client,
      "petitions",
      "petitions_status_check",
      `status IN (${sqlInList(petitionStatuses)})`
    );
    await addCheck(
      client,
      "petitions",
      "petitions_goal_positive",
      "goal >= 1"
    );
    await addCheck(
      client,
      "sanctions",
      "sanctions_type_check",
      `type IN (${sqlInList(sanctionTypes)})`
    );

    // Users role: keep open-ended list used by runtime (guest…superadmin) — not full domain yet.
    // Soft CHECK for known runtime roles + admin paths.
    const runtimeRoles = [
      "guest",
      "user",
      "verified_user",
      "expert",
      "community_lead",
      "journalist",
      "moderator",
      "admin",
      "superadmin",
      "data_analyst"
    ];
    await client.query(
      `UPDATE users SET role = 'user'
       WHERE role IS NULL OR role NOT IN (${sqlInList(runtimeRoles)});`
    );
    await addCheck(
      client,
      "users",
      "users_role_check",
      `role IN (${sqlInList(runtimeRoles)})`
    );

    // ── Uniqueness & indexes ──
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_story_versions_story_version
      ON story_versions (story_id, version_no);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_forum_posts_topic_created
      ON forum_posts (topic_id, created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_forum_topics_status_created
      ON forum_topics (status, created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sanctions_target_created
      ON sanctions (target_user_id, created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_created
      ON audit_log (created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_story_versions_story
      ON story_versions (story_id);
    `);

    // submitted_by is nullable (anonymous / system). We do NOT add FK → users
    // because historical rows may reference deleted accounts and seed topics use "system".
    // petition_signatures / forum_posts already have FKs from baseline.
  },

  async down(client) {
    const drops = [
      ["stories", "stories_status_check"],
      ["stories", "stories_estimated_layoffs_positive"],
      ["forum_topics", "forum_topics_status_check"],
      ["forum_posts", "forum_posts_status_check"],
      ["news_items", "news_items_status_check"],
      ["petitions", "petitions_status_check"],
      ["petitions", "petitions_goal_positive"],
      ["sanctions", "sanctions_type_check"],
      ["users", "users_role_check"]
    ];
    for (const [table, name] of drops) {
      await client.query(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${name};`);
    }
    await client.query("DROP INDEX IF EXISTS uq_story_versions_story_version;");
    await client.query("DROP INDEX IF EXISTS idx_forum_posts_topic_created;");
    await client.query("DROP INDEX IF EXISTS idx_forum_topics_status_created;");
    await client.query("DROP INDEX IF EXISTS idx_sanctions_target_created;");
    await client.query("DROP INDEX IF EXISTS idx_audit_log_created;");
    await client.query("DROP INDEX IF EXISTS idx_story_versions_story;");
  }
};
