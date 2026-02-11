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
