# Agent Log

## 2026-02-12 - Session Handoff (Production Recovery + Deploy)

### Summary
- Production site was failing to render via HTTPS (blank page / blocked assets behavior seen in browser).
- Root causes addressed in app code and deployment:
  - CSP defaults were causing unwanted HTTPS upgrade behavior.
  - HSTS needed to be environment-controlled to avoid breaking non-trusted cert environments.
  - Coolify deployment had not picked up latest commit automatically.
- Current state: site is reachable and rendering successfully.

### Code State
- Repo branch: `master`
- Pushed commit: `c0dedeef350730877d95aa231f77a535f01a3616`
- Key app changes:
  - `server.js`: explicit CSP directives (`useDefaults: false`), HSTS gate via `ENABLE_HSTS`.
  - `playwright.config.mjs`: stable web server startup on port `8080`.
  - E2E stabilization in `tests/e2e-full-flow.spec.js`.

### Production State (Coolify/Hetzner)
- App UUID: `wk848wc4oo88swk0g8oc8ksw`
- Live URL: `wk848wc4oo88swk0g8oc8ksw.89.167.42.128.sslip.io`
- Container now running new image tag:
  - `wk848wc4oo88swk0g8oc8ksw:c0dedeef350730877d95aa231f77a535f01a3616`
- Health check: `GET /health` returns `ok: true`.
- Assets check: `/styles.css` and `/app.js` return `200`.

### Important TLS Note
- `sslip.io` certificate issuance is currently rate-limited by Let's Encrypt for that domain group.
- HTTPS can respond, but trust warnings may still appear depending on client/cert chain state.
- To finalize clean production TLS, move to a real domain and issue cert there.

### What Still Needs To Happen
1. Attach real domain in Coolify and issue trusted TLS cert.
2. Re-enable strict HTTPS redirect after valid cert is confirmed.
3. Ensure Coolify auto-deploy webhook/signature path is fixed (manual endpoint currently unreliable).
4. Run post-deploy smoke:
   - `GET /health`
   - `GET /api/meta`
   - UI load at `/<country>/<lang>/`
   - Static assets `200`
5. Optional cleanup:
   - Remove temporary local artifact `_coolify_docker-compose.yaml` if no longer needed.

### New Operational Rule
- From now on, operations should use:
  - `hcloud` CLI for infrastructure/server actions.
  - `coolify` CLI for deployment and app lifecycle actions.
- Avoid ad-hoc manual API/webhook work when CLI path is available.

### Suggested Next Session Start
- Confirm `hcloud` and `coolify` CLIs are installed and authenticated.
- Register project shortcuts/profiles for this app (`wk848wc4oo88swk0g8oc8ksw`).
- Execute a CLI-only redeploy and verify parity with current manual recovery state.

