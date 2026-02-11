# AI Took My Job

Global platform prototype for AI displacement stories.

## Features

- Country-aware routing: `/:country/:lang/`
- 5 languages out of the box: `en`, `ru`, `de`, `fr`, `es`
- Live counters and company ticker
- Story submission with moderation status
- Forum and admin overview blocks
- Security baseline: CSP, rate limits, strict payload validation

## Local run

```bash
npm install
npm run dev
```

Open `http://localhost:8080`.

## Key endpoints

### Implemented now
- `GET /health`
- `GET /api/meta`
- `GET /api/locale`
- `GET /api/stats?country=global`
- `GET /api/stories?country=global&limit=6`
- `POST /api/stories`
- `GET /api/companies/top?country=global`
- `GET /api/forum/categories`
- `GET /api/forum/topics?country=global`
- `GET /api/admin/overview?token=...`

### WHITEPAPER P0 blueprint (target API surface)
- Public: `GET /api/meta`, `GET /api/locale`, `GET /api/stats`, `GET /api/stories`, `POST /api/stories`, `GET /api/companies/top`
- Forum: `GET /api/forum/categories`, `GET /api/forum/topics`, `POST /api/forum/topics` (auth), `POST /api/forum/topics/:id/replies` (auth)
- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- Moderation/Admin: `GET /api/admin/overview`, `GET /api/admin/moderation/queue`, `POST /api/admin/moderation/:id/action`, `POST /api/admin/sanctions`
- Integration: `POST /api/integrations/telegram/webhook`

## New flows phase checklist (P0/P1/P2)

| Phase | Scope for this phase | Checklist |
|---|---|---|
| P0 | Telegram webhook production test path | [ ] Endpoint live, [ ] Signature/auth verified, [ ] Smoke test recorded |
| P1 | Phone verification and moderation AI score surfaces | [ ] OTP request/verify live, [ ] Score payload persisted, [ ] Admin score visibility validated |
| P2 | Research and transparency public reporting endpoints | [ ] Aggregate-only research API live, [ ] Transparency report endpoint live, [ ] Abuse/privacy guard checks passed |

## Implemented endpoint matrix (new flows)

| Flow | Endpoint | Target phase | Runtime status |
|---|---|---|---|
| Phone verification | `POST /api/auth/phone/request-otp` | P1 | Implemented |
| Phone verification | `POST /api/auth/phone/verify` | P1 | Implemented |
| Moderation AI scores | `GET /api/admin/moderation/queue` | P1 | Implemented |
| Moderation AI scores | `GET /api/admin/moderation/:id/scores` | P1 | Implemented |
| Telegram webhook test | `POST /api/integrations/telegram/webhook` | P0 | Implemented |
| Research aggregates | `GET /api/research/aggregates` | P2 | Implemented |
| Transparency reports | `GET /api/transparency/report` | P2 | Implemented |

## Production validation commands (new flows)

Set environment first:

```bash
BASE_URL=https://your-domain.com
ADMIN_TOKEN=change-me-admin-token
TELEGRAM_SECRET=change-me-telegram-secret
STORY_ID=replace-with-story-id
ENTRY_ID=story:$STORY_ID
ENTRY_ID_URLENCODED=story%3A$STORY_ID
```

1. Phone verification flow (P1)

```bash
curl -i -X POST "$BASE_URL/api/auth/phone/request-otp" \
  -H "Content-Type: application/json" \
  --data '{"phone":"+15555550123"}'

curl -i -X POST "$BASE_URL/api/auth/phone/verify" \
  -H "Content-Type: application/json" \
  --data '{"phone":"+15555550123","code":"123456"}'
```

2. Moderation AI score visibility (P1)

```bash
curl -i -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/admin/moderation/queue"

curl -i -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/admin/moderation/$ENTRY_ID_URLENCODED/scores"
```

3. Telegram webhook test (P0)

```bash
curl -i -X POST "$BASE_URL/api/integrations/telegram/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_SECRET" \
  --data '{"update_id":1,"message":{"message_id":1,"date":1700000000,"chat":{"id":1001,"type":"private"},"text":"/start"}}'
```

4. Research and transparency endpoints (P2)

```bash
curl -i "$BASE_URL/api/research/aggregates?country=global&from=2026-01-01&to=2026-12-31"
curl -i "$BASE_URL/api/transparency/report?period=2026-Q1"
```

## Verification checklist (curl)

Set environment first:

```bash
BASE_URL=http://localhost:8080
ADMIN_TOKEN=change-me-admin-token
```

1. Health + runtime metadata

```bash
curl -fsS "$BASE_URL/health"
curl -fsS "$BASE_URL/api/meta"
curl -fsS "$BASE_URL/api/locale"
```

2. Public country-aware read APIs

```bash
curl -fsS "$BASE_URL/api/stats?country=global"
curl -fsS "$BASE_URL/api/stories?country=global&limit=6"
curl -fsS "$BASE_URL/api/companies/top?country=global"
```

3. Story intake flow (submit -> pending moderation)

```bash
curl -fsS -X POST "$BASE_URL/api/stories" \
  -H "Content-Type: application/json" \
  --data '{
    "name":"Alex Doe",
    "country":"us",
    "language":"en",
    "profession":"QA Engineer",
    "company":"Example Corp",
    "laidOffAt":"2025-11",
    "foundNewJob":false,
    "reason":"Automation replaced most manual testing coverage in my team.",
    "story":"My team was reduced after AI tooling automated repetitive work. I am sharing this to document what happened and how long recovery is taking."
  }'
```

Expected: `201` with JSON containing `"status":"pending"`.

4. Validation guardrails (negative test)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST "$BASE_URL/api/stories" \
  -H "Content-Type: application/json" \
  --data '{"name":"x"}'
```

Expected: `422`.

5. Forum read flow

```bash
curl -fsS "$BASE_URL/api/forum/categories"
curl -fsS "$BASE_URL/api/forum/topics?country=global"
```

6. Admin overview protection flow

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/admin/overview"
curl -fsS "$BASE_URL/api/admin/overview?token=$ADMIN_TOKEN"
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/api/admin/overview"
```

Expected: first call `401`, token-authenticated calls `200`.

7. Localized route/canonical flow

```bash
curl -I "$BASE_URL/"
curl -I "$BASE_URL/global/en/"
```

## Detailed execution log

See `docs/implementation-log.md`.
