#!/bin/sh
# Detect the console-side transitions Atlas cannot see any other way.
#
# Run this often — every few minutes is fine. It touches only orders that
# already have an open commitment (tens of rows), so it is cheap, and running
# it frequently is what makes "who onboarded this lab" same-day rather than
# next-day.
#
#   ./scripts/sync-commitments.sh
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
for f in "$REPO/.env.production" "$REPO/.env" "$REPO/.env.local"; do
  [ -f "$f" ] && { set -a; . "$f"; set +a; }
done
: "${ATLAS_DB_PASSWORD:?not set in any env file}"

docker exec -i atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -c \
  "SELECT * FROM atlas.sync_commitments();"
