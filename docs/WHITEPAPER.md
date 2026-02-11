# AI Took My Job Platform Whitepaper

Version: 1.0  
Date: 2026-02-11  
Status: Implementation Blueprint

## 1. Executive Summary

This document defines the product, architecture, security, moderation, anti-abuse, and delivery plan for the AI job-displacement platform. The platform is global-by-default, country-aware, and multilingual (EN, RU, DE, FR, ES), with privacy-first story sharing, moderated community interactions, and transparent analytics.

Primary goals:
- Capture and preserve worker stories about AI-related job loss.
- Protect contributors from retaliation and deanonymization.
- Provide verified, auditable, and abuse-resistant statistics.
- Enable community support, structured discussion, and practical recovery paths.

## 2. Product Scope

### 2.1 In Scope (Phase P0-P1)
- Public site with country/language routing: `/:country/:lang`.
- Story submission with privacy controls and moderation queue.
- Forum categories + topic posting/replying with anti-abuse safeguards.
- Auth with role model and restricted admin surfaces.
- Postgres-backed persistence and production deployment on Hetzner/Coolify.
- Core analytics counters and company leaderboard ticker.
- Telegram integration for notifications and moderated intake (limited MVP).

### 2.2 Out of Scope (for now)
- Native mobile apps.
- Payment/subscription systems.
- Full legal case management module.
- Advanced recommendation ML pipeline.

## 3. Stakeholders and Personas

- Displaced worker (anonymous or identified): submit/update story, find support.
- Verified contributor: trusted signal for quality metrics.
- Moderator: triage, redact, approve/reject, sanction.
- Admin: policy, ops, disputes, legal requests.
- Journalist/researcher: aggregate insights and trends.

## 4. Non-Functional Requirements

- Availability target: 99.5% monthly.
- API p95 latency: < 500ms for read endpoints.
- Moderation SLA: 80% < 2h, 95% < 12h, 100% < 48h.
- Security baseline: OWASP Top 10 controls in place.
- Privacy baseline: field-level visibility + PII separation + encryption.
- Internationalization: five languages from day one.

## 5. Threat Model and Abuse Model

### 5.1 Key Risks
- Coordinated spam and fake story campaigns.
- Corporate astroturfing and legal pressure.
- Toxicity, harassment, and victim blaming.
- Deanonymization through granular details.
- Data scraping and account farming.

### 5.2 Security Principles
- Least privilege.
- Default deny.
- Defense in depth.
- Verifiable audit trail.
- Human-in-the-loop for punitive decisions.

## 6. High-Level Architecture

### 6.1 Runtime
- Node.js + Express.
- PostgreSQL (primary data store).
- JSON fallback only for local/dev resilience.
- Coolify deployment on Hetzner host.

### 6.2 Core Services (modularized in app)
- `auth`: register/login/session/token handling.
- `identity`: role/permission checks.
- `stories`: CRUD + moderation states + privacy transforms.
- `forum`: categories/topics/replies + abuse guardrails.
- `moderation`: AI scoring adapters + queue actions.
- `antiabuse`: rate limits, fingerprint/IP signals, anomaly scoring.
- `audit`: append-only action logging.
- `integration.telegram`: bot webhook/events.

## 7. Data Model (Target)

### 7.1 Core Tables
- `users`
- `user_private` (PII split)
- `auth_identities` (email/phone states)
- `stories`
- `story_versions`
- `moderation_queue`
- `forum_topics`
- `forum_posts`
- `sanctions`
- `audit_log`
- `telegram_links`

### 7.2 Story lifecycle states
- `draft`
- `pending`
- `needs_changes`
- `published`
- `rejected`
- `hidden_legal_hold`

## 8. Privacy and Anonymity Design

### 8.1 Dual-profile model
- Private profile: legal name, email, phone, raw evidence metadata.
- Public profile: alias and visibility-masked fields.

### 8.2 Field-level privacy controls
Per-story controls for:
- Name display (`alias`, `initials`, `first_name`, `anonymous`).
- Company display (`exact`, `industry_only`, `masked`).
- Geo display (`city`, `region`, `country`, `hidden`).
- Date granularity (`exact`, `month`, `year`, `hidden`).

### 8.3 Deanonymization prevention
- Rule and model-based risk score.
- Pre-publish warning if uniqueness risk is high.
- Auto-suggestion for generalization.

## 9. Moderation and Sanctions

### 9.1 Queue triage
- AI-assisted scoring for toxicity/spam/PII risk.
- Confidence tiers: auto-pass, manual review, auto-reject.

### 9.2 Sanction ladder
- Warning.
- Temporary mute.
- Shadow moderation.
- Temporary suspension.
- Permanent ban.

### 9.3 Appeals and legal hold
- Single appeal window per sanction event.
- Legal hold state for disputed content.

## 10. Authentication and Identity Controls

### 10.1 Account constraints
- One normalized email per account.
- Phone verification required for publishing and topic creation.
- OTP limits and cooldown windows.

### 10.2 Session security
- Short-lived access token + refresh strategy.
- HttpOnly, secure cookies where applicable.
- Device/IP risk flags for step-up verification.

## 11. Forum Design

- Structured by profession, recovery, legal rights, regional groups.
- Reply/thread moderation and abuse scoring.
- Community lead controls per category.
- No downvote harassment mechanism in MVP.

## 12. Telegram Integration (MVP)

### 12.1 User-facing
- Account link via one-time code.
- Story-status notifications.
- Weekly digest.

### 12.2 Moderator-facing
- Queue alert summaries.
- Crisis-content alerts.
- Action deep links to admin review.

## 13. Internationalization and Country Model

- Supported languages: EN, RU, DE, FR, ES.
- Country-aware filtering and localized routing.
- Default locale from route, then header fallback.
- Language-specific translation packs under `public/i18n`.

## 14. API Blueprint (P0)

Public:
- `GET /api/meta`
- `GET /api/locale`
- `GET /api/stats`
- `GET /api/stories`
- `POST /api/stories`
- `GET /api/companies/top`

Forum:
- `GET /api/forum/categories`
- `GET /api/forum/topics`
- `POST /api/forum/topics` (auth required)
- `POST /api/forum/topics/:id/replies` (auth required)

Auth:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Moderation/Admin:
- `GET /api/admin/overview`
- `GET /api/admin/moderation/queue`
- `POST /api/admin/moderation/:id/action`
- `POST /api/admin/sanctions`

Integration:
- `POST /api/integrations/telegram/webhook`

## 15. Security Controls Checklist

- Helmet with strict CSP.
- Tight CORS allowlist.
- Request body limits.
- Global and endpoint-specific rate limiting.
- Input schema validation everywhere.
- PII masking and sanitization pipeline.
- Audit logs for privileged actions.
- Secrets via env only; no hardcoded tokens.

## 16. Observability and Operations

- Structured logs for API and moderation actions.
- Health endpoint and dependency checks.
- Deployment logs in Coolify.
- Security events in `audit_log`.
- Incident runbook for abuse spikes and legal requests.

## 17. Implementation Plan

### Phase P0 (Hardening + Core flows)
- Postgres-first storage.
- Auth endpoints and session model.
- Story moderation queue + admin actions.
- Forum write flow with anti-abuse controls.
- Audit and sanctions base.

### Phase P1 (Trust + Safety maturity)
- Phone verification enforcement.
- AI moderation adapters with confidence bands.
- Deanonymization score/warnings.
- Telegram notifications and mod alerts.

### Phase P2 (Scale and quality)
- Advanced anomaly detection and graph correlation.
- Research API with aggregate-only access.
- Transparency reporting automation.

## 18. Testing Strategy

- Unit tests: validation, policy checks, privacy transforms.
- Integration tests: auth, story lifecycle, moderation actions.
- Security tests: rate limit, payload abuse, CORS, token checks.
- Production smoke tests after each deploy.

## 19. Acceptance Criteria for “Website Built”

The build is accepted when:
- Global localized routes render correctly for 5 languages.
- Story submission, moderation, and publish flow work end-to-end.
- Forum posting/replying works with role checks and guardrails.
- Admin can view moderation queue and enforce sanctions.
- Postgres persists all core entities.
- Production deployment on Hetzner is healthy and verifiable.

## 20. Decision Log Governance

- All major decisions recorded in `docs/implementation-log.md`.
- Any scope deviation must include rationale and impact.
- Security-impacting changes require explicit log entry.
