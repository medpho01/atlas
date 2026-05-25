#!/bin/sh
# ============================================================================
# atlas-db init #4: build the analytics MVs in atlas-db.
# Runs once on first boot, after 03_fdw.sh has set up the src foreign tables.
#
# We reuse the existing sql/*.sql files unmodified. Each one references source
# tables as unqualified "Lab", "Order", etc. — these resolve via search_path
# (analytics, atlas, src, public) which 03_fdw.sh set on the DB.
#
# The whole MV build can take a few minutes on first boot because every SELECT
# from a foreign table fetches from the remote source DB.
# ============================================================================
set -e

# atlas-sql is bind-mounted in docker-compose (./sql:/atlas-sql:ro)
SQL_DIR=/atlas-sql

PSQL="psql -v ON_ERROR_STOP=1 --username $POSTGRES_USER --dbname $POSTGRES_DB"

# Set the search_path explicitly for this session too — ALTER DATABASE only
# takes effect for NEW connections, and we're inside an already-open one.
# Also ensure analytics exists before anything else writes to it.
$PSQL <<SQL
CREATE SCHEMA IF NOT EXISTS analytics AUTHORIZATION $POSTGRES_USER;
SET search_path = analytics, atlas, src, public;
SQL

# Build the MV chain in dependency order. Each file does its own
# DROP IF EXISTS CASCADE then CREATE, so re-running is safe.
for f in \
  $SQL_DIR/materialized_views.sql \
  $SQL_DIR/coverage_views.sql     \
  $SQL_DIR/customer_views.sql     \
  $SQL_DIR/demand_views.sql       \
  $SQL_DIR/quality_v2.sql         \
  $SQL_DIR/geo_inferred.sql       ; do
  echo "→ running $(basename $f) against atlas-db…"
  # Prepend a SET search_path so the file's unqualified table names resolve
  # via src (foreign tables) without requiring any edits to the file itself.
  (echo 'SET search_path = analytics, atlas, src, public;'; cat "$f") \
    | $PSQL
done

# Summary so first-boot logs show what landed.
$PSQL <<'SQL'
DO $$
DECLARE n int;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_matviews WHERE schemaname = 'analytics';
  RAISE NOTICE 'analytics schema has % materialized views', n;
END$$;
SQL
