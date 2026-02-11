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
