# Agent Log

## 2026-02-12 - Security Audit + Complete Frontend Overhaul + Production Deploy

### Summary

Full-scope session covering three major phases:
1. **Security audit and hardening** of the entire codebase (server.js, .gitignore, tracked artifacts).
2. **Complete frontend overhaul** — ground-up rewrite of all frontend files under the "Human Signal" design system.
3. **Production deployment** to Coolify/Hetzner with full verification.

### Phase 1: Security Audit (Commit `ecd14d1`)

Invoked `/critic` skill to review the entire repo. Found and fixed 6 security issues:

| Issue | Severity | File | Fix |
|-------|----------|------|-----|
| Admin token accepted via `req.query.token` | Critical | `server.js:1713` | Removed query string acceptance; token now only via `Authorization: Bearer` header |
| SSE endpoint set `Access-Control-Allow-Origin: *` | High | `server.js:3530` | Removed wildcard header; CORS middleware handles origins |
| CSP blocked Google Fonts and Phosphor Icons | High | `server.js:1737-1750` | Added `unpkg.com`, `cdn.jsdelivr.net`, `fonts.googleapis.com`, `fonts.gstatic.com` to CSP directives |
| PostgreSQL SSL `rejectUnauthorized: false` hardcoded | Medium | `server.js:496-498` | Made configurable via `PG_SSL_REJECT_UNAUTHORIZED` env var |
| No production guard on weak default secrets | Medium | `server.js:3601` | Added startup abort when `ADMIN_TOKEN` or `AUTH_SECRET` are defaults in production |
| Test artifacts tracked in git | Low | `.gitignore` + git cache | Added `playwright-report/`, `test-results/`, `*.log` to `.gitignore`; ran `git rm -r --cached` to remove ~1171 tracked binary files |

### Phase 2: Frontend Overhaul (Commit `55caa9a`)

Complete rewrite of all frontend files under the **"Human Signal"** design direction:
- **Aesthetic**: Dark editorial with warm amber/copper accents, subtle grain texture overlay
- **Typography**: Fraunces (display serif), DM Sans (body), JetBrains Mono (data/mono)
- **Color system**: `--amber: #D4956B`, `--teal: #4A9A8A`, `--signal-red: #D45454`, `--signal-green: #5AA86C`
- **No glassmorphism**, no purple gradients, no generic AI aesthetic

#### Files rewritten:

| File | Lines | What Changed |
|------|-------|-------------|
| `public/styles.css` | 1348 | Ground-up CSS design system using `@layer` (reset, tokens, base, components, layout, utilities, responsive). Dark/light theme tokens. All component styles (nav, buttons, cards, stats, tags, forms, modals, tabs, stories, topics, footer). Responsive breakpoints (1024/768/480). Accessibility (reduced-motion, high-contrast, print). |
| `public/index.html` | 339 | Hero section with animated stat counters and live badge. Auth modal with sign-in/register tabs. Dashboard grid with 4 chart canvases (trend, geo, industry, recovery). Stories grid container. Community section with discussions and support groups. Redesigned footer. |
| `public/forum.html` | 325 | User cabinet with login/register tabs and feature grid. Forum preview with category sidebar (6 categories), topic list (4 sample topics with avatars/stats), pagination. |
| `public/app.js` | 615 | Complete rewrite of `AITookMyJobApp` class. Fixed all broken selectors: uses correct element IDs matching new HTML, `.is-open` class for modals (not `display:flex/none`), correct button selectors for loading states. Chart colors match amber palette. Proper theme toggle (just swaps `data-theme` attribute). Mobile menu hamburger/X toggle. Scroll-triggered fade-in animations on cards. SSE real-time updates. |
| `public/manifest.json` | 26 | `theme_color` changed from `#8b5cf6` (purple) to `#D4956B` (amber). `background_color` changed to `#0A0A0B`. Icon SVGs updated with amber/dark scheme with rounded corners. Removed unused `screenshots`, `features`, `edge_side_panel` fields. |
| `public/sw.js` | 114 | Font cache URLs updated from Inter to Fraunces/DM Sans/JetBrains Mono. Added `forum.html` to static cache. Simplified caching strategies. Bumped cache version to `v2`. |
| `server.js` | +1 line | Added `cdn.jsdelivr.net` to CSP `scriptSrc` for Chart.js CDN. |

#### Critical bug fixed during overhaul:

The previous attempt wrote new HTML and CSS but left `app.js` unchanged. The old JS referenced non-existent elements (`#app`, `.glass-card`, `.loading-skeleton`, `#main-content`, `.primary-btn`) and used wrong modal toggle logic (`display:flex/none` instead of `.is-open` class). The site was completely broken. This rewrite ensures all files are coherent.

### Phase 2.5: AI News Section (Commit `802c6fc`)

After the overhaul, a news section was added with multi-language support:
- New `renderNews()` method in app.js rendering `.news-card` elements
- `loadTranslations()` and `applyTranslations()` methods for i18n
- Language selector now triggers translation reload
- News data loaded from `/api/news` endpoint
- Translation files created: `public/i18n/{en,ru,de,fr,es}.json`
- New CSS styles for `.news-card`, `.news-card-accent`, `.news-card-body`, `.news-meta`, `.news-title`, `.news-link`
- New HTML section with `#newsContainer` in index.html

### Phase 3: Production Deployment

Deployed using Coolify CLI (confirmed available at `C:\Users\filip\AppData\Local\Coolify\coolify.exe`).

#### Deployment details:

| Field | Value |
|-------|-------|
| App UUID | `wk848wc4oo88swk0g8oc8ksw` |
| Live URL | `http://wk848wc4oo88swk0g8oc8ksw.89.167.42.128.sslip.io` |
| Deployment UUID | `o8s0csso44kwwo800kk408kw` |
| Deployed commit | `55caa9a591c198ec2dbdd415b6d9cebf6c008d42` |
| Status | `finished` |
| Deploy method | `coolify deploy uuid wk848wc4oo88swk0g8oc8ksw` |

#### Verification results:

| Endpoint | Status | Size |
|----------|--------|------|
| `GET /health` | 200 | 74 B, `ok: true` |
| `GET /` (index.html) | 200 | 13.8 KB |
| `GET /styles.css` | 200 | 30 KB |
| `GET /app.js` | 200 | 19.4 KB |
| `GET /forum` | 200 | 15.2 KB |
| `GET /api/meta` | 200 | 20 countries, 5 languages |
| `GET /api/stats?country=global` | 200 | Live counters |

Content verification confirmed all files serve the new "Human Signal" versions (checked headers/comments in served HTML, CSS, and JS).

### Commits This Session

| Hash | Message |
|------|---------|
| `ecd14d1` | `fix(security): Harden server against multiple vulnerabilities` |
| `55caa9a` | `feat: Complete frontend overhaul with Human Signal design system` |
| `802c6fc` | `feat: Add AI News section with multi-language support (EN/RU/DE/FR/ES)` |

### Architecture Decisions

| Decision | Rationale | Alternatives Considered |
|----------|-----------|------------------------|
| CSS `@layer` for style organization | Predictable specificity, clean override model | Single flat stylesheet, BEM-only |
| Dark-first theme with `[data-theme]` | Matches editorial tone; CSS custom properties swap cleanly | JS-based theme injection |
| Fraunces serif display font | Distinctive, warm, editorial character; supports variable font axes | Playfair Display, Libre Baskerville |
| Amber `#D4956B` as primary accent | Warm, human, unique; avoids AI-cliché purple/blue | Coral, copper, terracotta |
| Modal via `.is-open` class toggle | CSS handles animation/transitions; no inline style hacks | `display:flex/none` (old broken approach) |
| XSS escaping via DOM `textContent` | Uses browser's native escaping; safer than regex replace | Manual `replaceAll` chain (old approach) |
| Chart.js colors from design tokens | Visual consistency across dashboard charts | Hardcoded hex values |

### Production State

- Branch: `master`
- Latest deployed commit: `55caa9a` (News section `802c6fc` not yet deployed)
- Container running on Coolify with Traefik routing
- Health check passing
- All static assets serving correctly
- TLS note: `sslip.io` cert may show trust warnings; real domain needed for clean HTTPS

### Known Issues / Remaining Work

1. **News section not yet deployed** — Commit `802c6fc` adds news but needs a Coolify redeploy.
2. **No Resources page** — Nav link to `#resources` exists but no section in index.html yet.
3. **`sslip.io` TLS** — Still using sslip.io wildcard domain; needs real domain for trusted cert.
4. **Untracked scratch files** — `devaitookmyjobpublicwrite_html.py`, `public/_b64.txt`, `public/_writer.js`, `public/test_heredoc.txt` sitting in working directory. Should be cleaned up or added to `.gitignore`.
5. **`_coolify_docker-compose.yaml`** — Local deployment artifact still in repo root. Consider removing.
6. **Admin token still uses default** — `.env` has `ADMIN_TOKEN=change-me-admin-token`. Not a production issue (production env is set in Coolify) but worth noting.

### Operational Notes

- **Coolify CLI works**: `coolify deploy uuid <UUID>` is the reliable way to trigger deploys. No more manual webhook calls needed.
- **Deploy verification pattern**: `coolify deploy get <deployment-uuid>` returns status, commit hash, and app name.
- **Port conflict rule**: If port 8080 is busy, add 13 (use 8093, 8106, etc.). Never kill processes.

---

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

