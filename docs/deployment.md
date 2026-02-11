# Deployment to Coolify (Hetzner)

This project is configured for Coolify to build from GitHub.

## Required environment variables

- `PORT=8080`
- `SITE_TITLE=AI Took My Job`
- `SITE_TAGLINE=Ship fast. Automate harder.`

## Runtime

- Build pack: Nixpacks (auto)
- Start command: `npm start`
- Port: `8080`

## Verify

- Site URL from Coolify should return `public/index.html`
- Health check: `/health`