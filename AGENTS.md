# aitookmyjob Agent Instructions

This project intentionally inherits the global `C:\dev` workspace rules. Work only inside
`C:\dev\aitookmyjob`.

## Project Rules

- Read `CLAUDE.md` and `.claude/deploy-instructions.md` before starting work.
- Production URL: `https://aitookmyjob.com`.
- Runtime: plain Node.js server, no build step.
- Required production storage: PostgreSQL via `DATABASE_URL`.
- Do not add new production features that depend on browser localStorage or local JSON files.
  Local JSON fallback may exist only for development without `DATABASE_URL`.

## Verification

- Before Playwright: `Stop-Process -Name chromium -Force -ErrorAction SilentlyContinue`.
- Run Playwright headless with one worker.
- Do not leave dev servers running after verification.
