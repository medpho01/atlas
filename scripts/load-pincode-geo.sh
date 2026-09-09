#!/bin/sh
# ============================================================================
# Import pincode coordinates from a CSV.
#
#   ./scripts/load-pincode-geo.sh pincodes.csv
#   docker compose exec -T atlas-refresh /load-pincode-geo.sh < pincodes.csv
#
# CSV: a header row, then pincode,latitude,longitude. Extra columns are
# ignored, so most public pincode datasets work unedited as long as those three
# are named. Rows outside India's bounds or without a 6-digit pincode are
# skipped and counted rather than failing the run — public datasets routinely
# carry a few bad rows and losing the other 19,000 over them helps nobody.
#
# Imported rows land in atlas.pincode_geo_manual, which outranks every other
# source and is never overwritten by a refresh. Re-running updates in place.
#
# Why this matters: LabStack records coordinates for 4,384 of India's ~19,300
# pincodes. Everything else is placed by averaging its 3-digit neighbours,
# which is fine for a map and useless for measuring a catchment — so
# centre-visit reach can only be computed for the pincodes we can genuinely
# locate. Loading a real dataset here raises that directly.
# ============================================================================
set -eu

. "$(dirname "$0")/lib-pincode-csv.sh" 2>/dev/null || . /lib-pincode-csv.sh

PG="psql -h ${PGHOST:-atlas-db} -U ${PGUSER:-atlas} -d ${PGDATABASE:-atlas} -v ON_ERROR_STOP=1 -X -q"
SRC="${1:-/dev/stdin}"

# A real staging table, not a temp one: \copy has to run in its own psql
# invocation (it is a client-side meta-command and does not interpolate
# variables reliably), and a temp table would not survive between connections.
$PG -c "CREATE TABLE IF NOT EXISTS atlas.pincode_import_stage (pincode text, latitude text, longitude text);"
$PG -c "TRUNCATE atlas.pincode_import_stage;"
normalise_pincode_csv "$SRC" > /tmp/_pin_norm.csv || exit 1
$PG -c "\copy atlas.pincode_import_stage FROM '/tmp/_pin_norm.csv' WITH (FORMAT csv, HEADER true)" || {
  echo "Could not read $SRC as CSV with a header row of pincode,latitude,longitude." >&2
  exit 1; }

$PG <<'SQL'
WITH parsed AS (
  SELECT btrim(pincode) AS pincode,
         NULLIF(btrim(latitude), '')::double precision  AS lat,
         NULLIF(btrim(longitude), '')::double precision AS lng
  FROM atlas.pincode_import_stage
  WHERE btrim(pincode) ~ '^[0-9]{6}$'
),
good AS (
  SELECT pincode, lat, lng FROM parsed
  WHERE lat BETWEEN 6 AND 38 AND lng BETWEEN 67 AND 98
),
ins AS (
  INSERT INTO atlas.pincode_geo_manual (pincode, latitude, longitude, source, note)
  -- Median, not the first row: the India Post directory lists a row per post
  -- office, so a pincode with six branches has six positions. The median is
  -- the one least moved by a branch on the edge of the area.
  SELECT pincode,
         percentile_cont(0.5) WITHIN GROUP (ORDER BY lat),
         percentile_cont(0.5) WITHIN GROUP (ORDER BY lng),
         'import', 'bulk csv'
  FROM good GROUP BY pincode
  ON CONFLICT (pincode) DO UPDATE
    SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
        source = EXCLUDED.source, created_at = now()
  RETURNING 1
)
SELECT (SELECT count(*) FROM atlas.pincode_import_stage)            AS rows_in_file,
       (SELECT count(*) FROM parsed)                                AS valid_pincode,
       (SELECT count(*) FROM ins)                                   AS loaded,
       (SELECT count(*) FROM parsed) - (SELECT count(*) FROM good)  AS skipped_out_of_bounds;
SQL

$PG -c "TRUNCATE atlas.pincode_import_stage;"

echo "Rebuilding resolved coordinates…"
$PG -c "SELECT * FROM atlas.rebuild_pincode_geo();"
echo
echo "Now refresh the views that depend on them:"
echo "  REFRESH MATERIALIZED VIEW analytics.mv_pincode_geo;"
echo "  REFRESH MATERIALIZED VIEW analytics.mv_pincode_cv_reach;"
echo "  REFRESH MATERIALIZED VIEW analytics.mv_public_network_pincode;"
echo "  REFRESH MATERIALIZED VIEW analytics.mv_public_network_summary;"
echo "(or just run /refresh.sh, which does all of it)"
