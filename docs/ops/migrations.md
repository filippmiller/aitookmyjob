# Database migrations — operations guide

Bead: **aitj-z8q.4**  
Runner: `lib/migrate.js`  
Files: `migrations/NNN_name.js`  
Tracking table: `schema_migrations`

## Policy

| Topic | Decision |
|-------|----------|
| Primary schema mechanism | Versioned migrations (not ad-hoc `CREATE` in `initStorage`) |
| Boot behaviour | **Auto-migrate on start** when `DATABASE_URL` is set (transactional + logged) |
| Fail closed | If a migration throws, the server fails to start (`start().catch` → exit 1) |
| JSON fallback | Unchanged — no migrations when running without Postgres |
| Production preference | Prefer **forward-fix** over `down()` rollbacks |

Each migration runs in a single `BEGIN` … `COMMIT`. Failure → `ROLLBACK`; **no row** is written to `schema_migrations`.

## Observability

| Surface | What you get |
|---------|----------------|
| `npm run db:status` | Applied / pending versions, checksums |
| `npm run db:migrate` | Apply pending; prints `schemaVersion` |
| `npm run db:migrate -- --dry-run` | Plan only |
| `GET /health` | `schemaVersion`, `storage` |
| `GET /ready` | 200 only if DB up **and** no pending migrations; else 503 |
| `GET /api/meta` | `schemaVersion`, `domainContractVersion`, `storage` |

Schema version is the latest applied migration id (e.g. `"002"`).

## Current migrations

| Version | Name | Purpose |
|---------|------|---------|
| `001` | `baseline_schema` | All production tables/indexes matching pre-migration `initStorage` |
| `002` | `integrity_constraints` | Domain-aligned CHECKs, backfills, unique indexes |
| `003` | `remaining_write_entities` | resources, cohorts, company_boards, anonymous_inbox, takedowns, subscribers; forum_topics.updated_at (aitj-z8q.3) |
| `004` | `jobs` | Durable background jobs + job_runs history (aitj-z8q.5); see `docs/ops/jobs.md` |
| `005` | `notifications` | notification_deliveries, notification_preferences, email_unsubscribes (aitj-z8q.15) |

## Commands

```bash
# From repo root; requires DATABASE_URL (and PG_SSL if needed)
npm run db:status
npm run db:migrate
npm run db:migrate -- --dry-run

# Unit tests (offline always; live PG optional)
npm run test:migrations
# Live integrity against a real DB:
# RUN_PG_MIGRATION_TESTS=1 DATABASE_URL=postgres://... npm run test:migrations
```

Never paste full connection strings into tickets or chat.

## Upgrade procedure (production)

1. Deploy code that includes new files under `migrations/`.
2. On boot, the app applies pending migrations automatically **before** listening.
3. Alternatively, pre-apply:
   ```bash
   # In the container / with prod env (names only here)
   npm run db:migrate
   npm run db:status   # expect pendingCount: 0
   ```
4. Verify:
   ```bash
   curl -s https://aitookmyjob.filippmiller.com/ready
   curl -s https://aitookmyjob.filippmiller.com/api/meta
   # schemaVersion should match latest migration
   ```
5. If boot fails on migration, the process exits; previous schema remains intact (transaction rollback). Fix the migration or data, redeploy.

### Fresh install

1. Set `DATABASE_URL` on an empty database.
2. `npm start` (or `npm run db:migrate` then start).
3. Migrations `001`–`004` create schema; `initStorage` seeds petitions/news/stories/topics/resources/cohorts/boards if empty and one-shot backfills from bundled `data/*.json` when tables are empty (never writes under `data/` when `DATABASE_URL` is set).

### Upgrade from pre-migration schema

Existing DBs already have tables from the old `CREATE TABLE IF NOT EXISTS` path.

1. Deploy this branch.
2. Boot runs `001` (all `IF NOT EXISTS` → no-op on objects) then `002` (backfill + CHECKs).
3. No intentional data loss. `002` remaps **unknown** status strings only:
   - stories → `pending`
   - forum topics/posts → `pending`
   - news → `discovered`
   - petitions → `open`
   - sanctions type → `warn`
   - invalid user roles → `user`
   - non-positive `estimated_layoffs` → `1`

## Rollback procedure

**Preferred: forward-fix**

1. Ship a new migration `003_…` that undoes or corrects the bad change.
2. Deploy; auto-migrate applies `003`.
3. Record the incident and leave `001`/`002` history intact.

**Emergency `down()` (dev / last resort)**

Some migrations export `down(client)`. Production use is discouraged.

```js
// Example (ops shell) — do not run blindly against prod
const { Pool } = require("pg");
const { rollbackLast } = require("./lib/migrate");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await rollbackLast(pool);
await pool.end();
```

`001.down` **drops all application tables** — catastrophic for production data.  
`002.down` drops CHECKs/indexes only (safer).

If `down` is missing, the runner refuses rollback and you must forward-fix.

## Writing a new migration

1. Create `migrations/003_short_snake_name.js`:
   ```js
   module.exports = {
     version: "003",
     name: "short_snake_name",
     async up(client) {
       // Use the provided client only — do NOT BEGIN/COMMIT yourself
       await client.query(`ALTER TABLE ...`);
     },
     async down(client) {
       // Optional; prefer forward-fix docs in the PR
     }
   };
   ```
2. Keep migrations **idempotent where practical** (`IF NOT EXISTS`, check `pg_constraint` before `ADD CONSTRAINT`).
3. Backfill before adding CHECKs/FKs that could fail on existing rows.
4. Add/extend `tests/migrations.test.js` for ordering or constraint expectations.
5. Update this table of versions in the same PR.
6. Conventional commit: `feat(db): …` or `fix(db): …`.

## Integrity constraints (002)

| Object | Constraint |
|--------|------------|
| `stories.status` | CHECK ∈ domain `STORY_STATUS` |
| `stories.estimated_layoffs` | CHECK ≥ 1 |
| `forum_topics.status` | CHECK ∈ `DISCUSSION_TOPIC_STATUS` |
| `forum_posts.status` | CHECK ∈ `DISCUSSION_REPLY_STATUS` |
| `news_items.status` | CHECK ∈ `NEWS_STATUS` |
| `petitions.status` | CHECK ∈ `PETITION_STATUS` |
| `petitions.goal` | CHECK ≥ 1 |
| `sanctions.type` | CHECK ∈ `SANCTION_TYPE` |
| `users.role` | CHECK ∈ runtime role list |
| `story_versions (story_id, version_no)` | UNIQUE |
| FKs (baseline) | `auth_identities→users`, `story_versions→stories`, `forum_posts→topics`, `telegram_links→users`, `petition_signatures→petitions` |

**Intentionally not FK-linked:** `stories.submitted_by`, `sanctions.target_user_id`, `forum_*.created_by` (may be `"system"` or orphaned after account deletion).

## Data-loss hazards

| Action | Risk |
|--------|------|
| `001.down` | **Drops all tables** — full data loss |
| `002` backfills | Only rows with **invalid** enum/status values are rewritten to safe defaults; valid rows untouched |
| Failed migration mid-flight | **No** partial schema from that version (transaction rollback) |
| Concurrent deploys | Two processes may race; both use transactions + PK on `schema_migrations.version` — one wins, the other may error on duplicate version insert after concurrent apply. Prefer single replica rolling deploy or pre-run `db:migrate` |

## Related

- Domain contract: `docs/domain-contract-v1.md`, `lib/domain-contract.js`
- Durable jobs: `docs/ops/jobs.md`, `lib/jobs.js`, `scripts/job-worker.js`
- Deploy: `.claude/deploy-instructions.md`
- DNS / Coolify: `docs/ops/production-dns-coolify.md`
