#!/bin/sh
# ============================================================================
# Import pincode coordinates from a CSV.
#
#   docker compose exec -T atlas-refresh /load-pincode-geo.sh /dev/stdin < pincodes.csv
#
# Takes any CSV with a header that names a pincode column and latitude and
# longitude columns — the India Post directory, a GeoNames-derived mirror, or a
# plain three-column file. Columns are found by name, the file is parsed by
# Postgres so quoted fields containing commas behave, and several rows for one
# pincode collapse to their median.
#
# Rows without a six-digit pincode, without numeric coordinates, or outside
# India are skipped and counted rather than failing the run — every public
# dataset carries a few, and losing the other 19,000 over them helps nobody.
#
# Imported rows land in atlas.pincode_geo_manual, which outranks every other
# source and is never overwritten by a refresh. Re-running updates in place.
#
# Run /check-pincode-geo.sh first. It reports the same file without writing.
# ============================================================================
set -eu

. "$(dirname "$0")/lib-pincode-csv.sh" 2>/dev/null || . /lib-pincode-csv.sh

PG="psql -h ${PGHOST:-atlas-db} -U ${PGUSER:-atlas} -d ${PGDATABASE:-atlas} -v ON_ERROR_STOP=1 -X -q"
SRC="${1:-/dev/stdin}"

stage_pincode_csv "$SRC"
CLEAN=$(pincode_clean_sql)

$PG <<SQL
WITH clean AS ($CLEAN),
good AS (
  SELECT pincode, lat, lng FROM clean
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
SELECT (SELECT count(*) FROM atlas.pincode_raw_stage)         AS rows_in_file,
       (SELECT count(*) FROM clean)                           AS parsed_ok,
       (SELECT count(DISTINCT pincode) FROM good)             AS pincodes_loaded,
       (SELECT count(*) FROM clean) - (SELECT count(*) FROM good) AS skipped_outside_india;
SQL

$PG -c "DROP TABLE IF EXISTS atlas.pincode_raw_stage;"

echo "Rebuilding resolved coordinates…"
$PG -c "SELECT * FROM atlas.rebuild_pincode_geo();"
echo
echo "Now rebuild the views that use them:  /refresh-views.sh"
