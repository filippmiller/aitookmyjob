#!/usr/bin/env sh
# Thin shell wrapper around scripts/backup-pg.js for cron / Coolify one-offs.
# Bead: aitj-z8q.6
set -eu
cd "$(dirname "$0")/.."
exec node scripts/backup-pg.js "$@"
