# aitookmyjob — Claude Code Instructions

## Session Start Protocol

**ON EVERY NEW SESSION**, before doing any work:
1. Read `.claude/deploy-instructions.md` for deployment context
2. Read this entire CLAUDE.md for repo-specific rules and notices
3. Report to the user:
   > "I've read the deployment instructions and all important notices for **aitookmyjob**.
   > Deploy target: https://aitookmyjob.com. Last verified: 2026-04-09. Build status: no build step (Node server)."
4. Check git status and report any uncommitted changes or branch state

---

## MANDATORY RULES

### Process Management
- Before ANY Playwright test run: Stop-Process -Name chromium -Force -ErrorAction SilentlyContinue
- After ALL tests complete: ensure browser.close() is called in afterAll/teardown
- NEVER leave dev servers running in background after finishing work
- If tests hang for more than 60s, kill stale processes and retry

### Playwright Testing
- ALWAYS use --headless mode (NOT --headed) unless explicitly debugging visually
- Use --workers=1 to limit resource usage
- Set timeout per test to 30s max
- Run: npx playwright test --project=chromium --workers=1

### Resource Limits
- Only ONE dev server at a time per project
- Kill previous dev server before starting a new one
- Check port availability before starting: Test-NetConnection -ComputerName localhost -Port XXXX
