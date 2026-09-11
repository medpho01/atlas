#!/usr/bin/env bash
#
# Verify sql/init/20_lab_discovery_ranking.sql against a throwaway Postgres 16.
#
#   ./scripts/test-discovery-db.sh        (or: npm run test:discovery-db)
#
# Stands up two scratch databases in one container and tears them down again:
#
#   atlas_migrated    fixture + migration, applied TWICE to prove idempotency
#   atlas_unmigrated  fixture only
#
# and runs the read path against both. The unmigrated one is the point: every
# host that already exists has a window where the new columns do not, because
# sql/init/ only runs on a database's first boot, and the request detail page
# must not 500 in that window.
#
# `docker compose up atlas-db` is deliberately NOT used. Its init runs
# 03_fdw.sh, which needs a real SOURCE_DATABASE_URL pointing at the operational
# LabStack database. The fixture in sql/test/discovery_fixture.sql is the four
# tables this migration touches, with their DDL copied verbatim out of
# sql/init/16_requests.sql, 01_schema.sql and 06_crm.sql.
#
# Needs docker. Nothing else, and no credentials.

set -euo pipefail
cd "$(dirname "$0")/.."

CONTAINER=atlas-discovery-test
PORT=${DISCOVERY_TEST_PORT:-15499}
PW=test

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup

echo "Starting a throwaway Postgres 16 on port $PORT..."
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PW" -e POSTGRES_USER=atlas -e POSTGRES_DB=postgres \
  -p "$PORT:5432" postgres:16-alpine >/dev/null

# Wait for it rather than sleeping a guess.
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U atlas -d postgres >/dev/null 2>&1; then break; fi
  if [ "$i" = 60 ]; then echo "Postgres never came up."; docker logs "$CONTAINER"; exit 1; fi
  sleep 1
done
echo "Up."

psql_in() {  # psql_in <db> <file>
  docker exec -i -e PGPASSWORD="$PW" "$CONTAINER" \
    psql -U atlas -d "$1" -v ON_ERROR_STOP=1 -q -f - < "$2"
}
psql_c() {   # psql_c <db> <sql>
  docker exec -i -e PGPASSWORD="$PW" "$CONTAINER" \
    psql -U atlas -d "$1" -v ON_ERROR_STOP=1 -qtAX -c "$2"
}

for db in atlas_migrated atlas_unmigrated; do
  docker exec -i -e PGPASSWORD="$PW" "$CONTAINER" createdb -U atlas "$db"
  psql_in "$db" sql/test/discovery_fixture.sql
done
echo "Fixture applied to both databases."

echo
echo "=============================================================="
echo "1. The migration is idempotent"
echo "=============================================================="
echo "--- first application ---"
psql_in atlas_migrated sql/init/20_lab_discovery_ranking.sql
echo "--- second application, over the top of the first ---"
psql_in atlas_migrated sql/init/20_lab_discovery_ranking.sql
echo "Applied twice, no error. Every existing host applies this by hand, and"
echo "somebody will run it twice."

# A row written before the migration must survive it, and must not be read as
# "never attempted" afterwards — claim_discovery would re-search all of them
# at once, which on a real host is a few hundred searches nobody asked for.
docker exec -i -e PGPASSWORD="$PW" "$CONTAINER" createdb -U atlas atlas_backfill
psql_in atlas_backfill sql/test/discovery_fixture.sql
psql_c atlas_backfill \
  "INSERT INTO atlas.discovery_run (pincode, ran_at, found) VALUES ('500001', now() - interval '5 days', 2)" >/dev/null
psql_in atlas_backfill sql/init/20_lab_discovery_ranking.sql
BACKFILLED=$(psql_c atlas_backfill \
  "SELECT started_at IS NOT NULL AND started_at = ran_at FROM atlas.discovery_run WHERE pincode='500001'")
if [ "$BACKFILLED" != "t" ]; then
  echo "FAIL: a pre-existing run row did not get started_at backfilled from ran_at."
  exit 1
fi
echo "  ok   a pre-existing run row keeps its history (started_at backfilled from ran_at)"
STILL_DECLINED=$(psql_c atlas_backfill "SELECT atlas.claim_discovery('500001', 30, 'request_page')")
if [ "$STILL_DECLINED" != "f" ]; then
  echo "FAIL: a row answered 5 days ago was re-claimed right after the migration."
  exit 1
fi
echo "  ok   and is not re-searched the moment the migration lands"

echo
echo "=============================================================="
echo "2. claim_discovery, promote_discovered_lab, and the invariants"
echo "=============================================================="
psql_in atlas_migrated sql/test/discovery_checks.sql

echo
echo "=============================================================="
echo "3. The read path, against BOTH databases"
echo "=============================================================="
echo
echo "--- against the MIGRATED database (catches the numeric-as-string trap) ---"
APP_DATABASE_URL="postgres://atlas:$PW@localhost:$PORT/atlas_migrated" \
  npm run --silent test:discovery-read

echo
echo "--- against the UNMIGRATED database (catches a missing 42703 fallback) ---"
APP_DATABASE_URL="postgres://atlas:$PW@localhost:$PORT/atlas_unmigrated" \
  npm run --silent test:discovery-read

echo
echo "=============================================================="
echo "All database checks passed."
echo "=============================================================="
echo "Not covered here, and not coverable without production data:"
echo "  - a live web search (needs a real ANTHROPIC_API_KEY)"
echo "  - the rendered page against real requests (needs the LabStack DB)"
