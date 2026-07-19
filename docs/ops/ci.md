# CI/CD quality gates — operations guide

Bead: **aitj-z8q.7**  
Workflows: `.github/workflows/ci.yml`, `.github/workflows/deploy-smoke.yml`  
Runtime: plain Node.js ≥20 (no build step)

## Goals

| Goal | How |
|------|-----|
| Deterministic install | `npm ci` only (lockfile committed) |
| Secret scan | `npm run test:secrets` → `scripts/ci-secret-scan.js` |
| Dependency audit policy | `npm run test:audit` → high/critical fail unless allowlisted |
| API / unit tests | `npm run test:unit` (node:test) |
| Fast critical Playwright smoke | `npm run test:smoke` (separate from full E2E) |
| Migration test | Offline `test:migrate-check` + optional Postgres service job |
| Deploy smoke | `npm run test:deploy-smoke` against live `BASE_URL` |
| Failed release not promoted | PR blocked by CI; deploy-smoke failure is a hard fail (no promote) |

## PR gate (required)

Workflow **CI** runs on every pull request to `master`/`main` and on push.

Jobs:

1. **Quality gates** (single practical job, ~5–12 min)
   - `npm ci`
   - secret scan
   - dependency audit (high/critical + allowlist)
   - offline migration load/plan check
   - unit tests
   - Playwright **smoke** only (Chromium; local `webServer`)

2. **Migration apply (Postgres)** — service container `postgres:16`
   - `npm run db:migrate` twice (idempotency)
   - `npm run test:migrations` with `RUN_PG_MIGRATION_TESTS=1`

**Not in the PR gate:** full E2E suite (`npm run test:e2e`). Those specs use many fixed sleeps and are too slow/flaky for merge blocking. Run them manually or in a future nightly workflow.

### Branch protection (recommended)

In GitHub → Settings → Branches → protect `master`:

- Require status checks: **Quality gates**, **Migration apply (Postgres)**
- Require branches to be up to date before merge
- Do **not** allow bypass for routine PRs

Merge to `master` only when CI is green. Coolify deploys `master`; a red PR must not land.

## Deploy smoke (post-release)

Workflow **Deploy smoke**:

- **Manual:** Actions → Deploy smoke → run with `base_url`
- **Automatic:** after successful CI on `master` (via `workflow_run`)

Checks (HTTP poll, no fixed sleeps in assertions):

| Check | Expectation |
|-------|-------------|
| `GET /live` | 200, `live: true` |
| `GET /health` | 200, `service: aitookmyjob` |
| `GET /ready` | 200, `ready: true` |
| `GET /api/meta` | 200 |
| `GET /api/stories?limit=5` | 200 |
| `GET /api/stats` | 200 |
| `GET /` | 200 HTML |

Default production surface: `https://aitookmyjob.filippmiller.com`  
Override with repo variable `SMOKE_BASE_URL` or workflow input.

### Promotion policy

> **A failed deploy-smoke run means the release is not promoted.**

Operational meaning:

1. Do not announce the release or cut over apex DNS based on a red smoke.
2. Inspect Coolify deployment + container logs for UUID `wk848wc4oo88swk0g8oc8ksw`.
3. Rollback / redeploy previous known-good commit if `/ready` stays 503.
4. Only treat the release as good when deploy-smoke is green.

CI on the PR is the pre-merge gate; deploy-smoke is the post-deploy gate. Neither is optional for a “good” release.

## Local commands

```bash
# Full local CI mirror (no Playwright browser install required for unit-only)
npm ci
npm run ci              # secrets + audit + migrate-check + unit + smoke

# Individual gates
npm run test:secrets
npm run test:audit
npm run test:migrate-check
npm run test:unit
npm run test:smoke

# Against a running server / production
BASE_URL=https://aitookmyjob.filippmiller.com npm run test:deploy-smoke
BASE_URL=https://aitookmyjob.filippmiller.com npm run test:smoke
```

Smoke Playwright config: `playwright.smoke.config.mjs`  
When `BASE_URL` is unset, it starts `npm run dev` on `TEST_PORT` (default 8091).

First-time Playwright:

```bash
npx playwright install chromium
```

## Secret scan

Script: `scripts/ci-secret-scan.js`

- High-confidence patterns only (AWS keys, PEM private keys, GitHub PATs, Stripe live keys, Postgres URLs with passwords, hard-coded API key assignments)
- Skips `node_modules`, `.git`, `data/`, binaries
- Placeholders containing `change-me`, `example`, etc. are ignored

If CI fails: remove the secret from git history if committed, rotate the credential, re-run.

Optional future hardening: add [gitleaks](https://github.com/gitleaks/gitleaks) as a second action; the Node scan is enough for free GitHub Actions without extra binaries.

## Dependency audit policy

Script: `scripts/ci-audit.js`  
Allowlist: `scripts/audit-allowlist.json`

| Severity | Gate |
|----------|------|
| critical | Fail unless allowlisted |
| high | Fail unless allowlisted |
| moderate / low | Reported; do not fail |

Allowlist entry shape:

```json
{
  "name": "package-name",
  "severity": "high",
  "advisory": "GHSA-xxxx-xxxx-xxxx",
  "reason": "why temporary accept is safe + remediation plan",
  "reviewBy": "YYYY-MM-DD"
}
```

Rules:

- Every entry needs a **reason** and **reviewBy** date
- After `reviewBy`, the entry no longer suppresses the finding (CI fails until fixed or re-reviewed)
- Prefer fixing (`npm audit fix` / major bump PR) over growing the allowlist

Current known high: `nodemailer` (SMTP envelope issues; app does not pass attacker-controlled `envelope.size`). Tracked for a dedicated upgrade PR.

Equivalent raw command (without allowlist):

```bash
npm audit --audit-level=high
```

## Migration checks

| Mode | Command | DB |
|------|---------|-----|
| Offline load/plan | `npm run test:migrate-check` | none |
| Offline unit suite | `npm run test:migrations` | none (mock client) |
| Live apply | CI job + `RUN_PG_MIGRATION_TESTS=1` | Postgres service |

See also `docs/ops/migrations.md`.

## Smoke vs full E2E

| Suite | Config | Sleeps | CI PR |
|-------|--------|--------|-------|
| Smoke | `playwright.smoke.config.mjs` + `tests/smoke.spec.js` | **None** (`waitForTimeout` forbidden) | Yes |
| Full E2E | `playwright.config.mjs` + `e2e-*.spec.js` | Many fixed sleeps | No |

Smoke tests use:

- `expect(locator).toBeVisible()` / response status assertions
- deploy script uses **poll with backoff** (`SMOKE_RETRIES` × `SMOKE_POLL_MS`), not `page.waitForTimeout`

## Package scripts

| Script | Purpose |
|--------|---------|
| `test:unit` | All node:test API/unit files |
| `test:secrets` | Secret pattern scan |
| `test:audit` | Audit + allowlist gate |
| `test:migrate-check` | Offline migration integrity |
| `test:smoke` | Fast Playwright smoke |
| `test:deploy-smoke` | Live HTTP `/ready` + critical reads |
| `ci` | secrets → audit → migrate-check → unit → smoke |

## Troubleshooting

| Symptom | Action |
|---------|--------|
| `npm ci` fails | Ensure `package-lock.json` is committed and in sync |
| secret-scan false positive | Narrow pattern or use a documented placeholder; do not commit real secrets |
| audit fails on new high | Upgrade package or add temporary allowlist with `reviewBy` |
| smoke fails locally on port | Set `TEST_PORT=8092` or free the port (do not kill other agents' processes) |
| deploy-smoke `/ready` 503 | DB down, pending migrations, or strict secrets — check Coolify env + logs |
| migrate-pg job flaky health | Service healthcheck retries; re-run job |

## Related docs

- [`docs/ops/migrations.md`](./migrations.md)
- [`docs/ops/observability.md`](./observability.md) — `/live`, `/ready`, `/health`
- [`.claude/deploy-instructions.md`](../../.claude/deploy-instructions.md)
