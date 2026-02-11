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
