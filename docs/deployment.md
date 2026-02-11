# Deployment to Coolify (Hetzner)

This project deploys as a single Node.js service.

## Required environment variables

- `PORT=8080`
- `DEFAULT_COUNTRY=global`
- `DEFAULT_LANG=en`
- `ADMIN_TOKEN=<strong-secret>`
- Optional: `CORS_ORIGINS=https://your-domain.com,https://www.your-domain.com`

## Runtime

- Build pack: Nixpacks or Dockerfile
- Start command: `npm start`
- Exposed port: `8080`

## Verify after deploy

1. `GET /health` returns `{ ok: true, ... }`
2. `GET /api/meta` returns countries and languages
3. Open `/<country>/<lang>/` (example: `/global/en/`)
4. Submit a story with the form and verify `status=pending`

## API verification checklist (curl)

Set variables:

```bash
BASE_URL=https://your-domain.com
ADMIN_TOKEN=<strong-secret>
```

1. Runtime and metadata:

```bash
curl -fsS "$BASE_URL/health"
curl -fsS "$BASE_URL/api/meta"
curl -fsS "$BASE_URL/api/locale"
```

2. Public P0 reads:

```bash
curl -fsS "$BASE_URL/api/stats?country=global"
curl -fsS "$BASE_URL/api/stories?country=global&limit=6"
curl -fsS "$BASE_URL/api/companies/top?country=global"
curl -fsS "$BASE_URL/api/forum/categories"
curl -fsS "$BASE_URL/api/forum/topics?country=global"
```

3. Story intake (must return `201` and `status=pending`):

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

4. Validation rejection (must return `422`):

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST "$BASE_URL/api/stories" \
  -H "Content-Type: application/json" \
  --data '{"name":"x"}'
```

5. Admin protection:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/admin/overview"
curl -fsS "$BASE_URL/api/admin/overview?token=$ADMIN_TOKEN"
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE_URL/api/admin/overview"
```

Expected: unauthenticated call `401`, authenticated calls `200`.

6. Route behavior:

```bash
curl -I "$BASE_URL/"
curl -I "$BASE_URL/global/en/"
```

Expected: root redirects to localized route; localized path returns `200`.

## Phase checklist and endpoint matrix (new flows)

| Phase | Flow | Endpoint | Status |
|---|---|---|---|
| P0 | Telegram webhook test | `POST /api/integrations/telegram/webhook` | Implemented |
| P1 | Phone verification (request OTP) | `POST /api/auth/phone/request-otp` | Implemented |
| P1 | Phone verification (verify code) | `POST /api/auth/phone/verify` | Implemented |
| P1 | Moderation AI score queue visibility | `GET /api/admin/moderation/queue` | Implemented |
| P1 | Moderation AI score detail visibility | `GET /api/admin/moderation/:id/scores` | Implemented |
| P2 | Research aggregate API | `GET /api/research/aggregates` | Implemented |
| P2 | Transparency reporting API | `GET /api/transparency/report` | Implemented |

## Production validation commands for new flows

Set variables:

```bash
BASE_URL=https://your-domain.com
ADMIN_TOKEN=<strong-secret>
TELEGRAM_SECRET=<telegram-webhook-secret>
STORY_ID=<existing-story-id>
ENTRY_ID=story:<existing-story-id>
ENTRY_ID_URLENCODED=story%3A<existing-story-id>
```

1. P1 phone verification:

```bash
curl -i -X POST "$BASE_URL/api/auth/phone/request-otp" \
  -H "Content-Type: application/json" \
  --data '{"phone":"+15555550123"}'

curl -i -X POST "$BASE_URL/api/auth/phone/verify" \
  -H "Content-Type: application/json" \
  --data '{"phone":"+15555550123","code":"123456"}'
```

2. P1 moderation AI score checks:

```bash
curl -i -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/admin/moderation/queue"

curl -i -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$BASE_URL/api/admin/moderation/$ENTRY_ID_URLENCODED/scores"
```

3. P0 telegram webhook ingress test:

```bash
curl -i -X POST "$BASE_URL/api/integrations/telegram/webhook" \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_SECRET" \
  --data '{"update_id":1,"message":{"message_id":1,"date":1700000000,"chat":{"id":1001,"type":"private"},"text":"/status"}}'
```

4. P2 research/transparency checks:

```bash
curl -i "$BASE_URL/api/research/aggregates?country=global&from=2026-01-01&to=2026-12-31"
curl -i "$BASE_URL/api/transparency/report?period=2026-Q1"
```
