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

- `GET /health`
- `GET /api/meta`
- `GET /api/stats?country=global`
- `GET /api/stories?country=global&limit=6`
- `POST /api/stories`
- `GET /api/companies/top?country=global`
- `GET /api/admin/overview?token=...`

## Detailed execution log

See `docs/implementation-log.md`.
