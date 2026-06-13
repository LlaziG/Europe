#!/usr/bin/env bash
# Copy the local europe_museum database into the production database.
# Reads the target from REMOTE_DATABASE_URL (never printed).
set -euo pipefail

if [ -z "${REMOTE_DATABASE_URL:-}" ]; then
  echo "REMOTE_DATABASE_URL is not set" >&2
  exit 1
fi

echo "Dumping local europe_museum…"
pg_dump --no-owner --no-privileges --clean --if-exists -d europe_museum -f /tmp/europe_museum.sql
echo "Restoring to remote…"
psql "$REMOTE_DATABASE_URL" -v ON_ERROR_STOP=0 -q -f /tmp/europe_museum.sql > /tmp/europe_restore.log 2>&1 || true
ERRORS=$(grep -c "^psql:.*ERROR" /tmp/europe_restore.log || true)
echo "Restore complete (errors in log: ${ERRORS})"
psql "$REMOTE_DATABASE_URL" -tc "SELECT 'periods: ' || count(*) FROM periods"
psql "$REMOTE_DATABASE_URL" -tc "SELECT 'civilizations: ' || count(*) FROM civilizations"
psql "$REMOTE_DATABASE_URL" -tc "SELECT 'events: ' || count(*) FROM events"
psql "$REMOTE_DATABASE_URL" -tc "SELECT 'artworks: ' || count(*) FROM artworks"
psql "$REMOTE_DATABASE_URL" -tc "SELECT 'chapters: ' || count(*) FROM chapters"
rm -f /tmp/europe_museum.sql
