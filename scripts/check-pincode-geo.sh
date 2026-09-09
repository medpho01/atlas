#!/bin/sh
# ============================================================================
# Compare a public pincode dataset against what Atlas already holds.
#
#   docker compose exec -T atlas-refresh /check-pincode-geo.sh /dev/stdin < pincodes.csv
#
# Reads only. Nothing is written, nothing is overwritten — run this first,
# decide what you believe, then run /load-pincode-geo.sh to apply.
#
# It answers three questions:
#
#   1. How many gaps would it fill?      Pincodes we cannot place at all.
#   2. Does it agree with what we have?  For pincodes we already know, how far
#                                        apart are the two positions.
#   3. Where does it disagree badly?     The worst offenders, named, so a
#                                        systematic problem is visible rather
#                                        than averaged away.
#
# Disagreement is not automatically the dataset being wrong. LabStack's own
# coordinates are unverified too, and a position derived from customer
# addresses is a median of real deliveries. A large gap means one of them is
# wrong and it is worth looking at which, not that the import should win.
# ============================================================================
set -u

PG="psql -h ${PGHOST:-atlas-db} -U ${PGUSER:-atlas} -d ${PGDATABASE:-atlas} -X -q"
SRC="${1:-/dev/stdin}"

$PG -c "CREATE TABLE IF NOT EXISTS atlas.pincode_geo_check (pincode text, latitude text, longitude text);"
$PG -c "TRUNCATE atlas.pincode_geo_check;"
$PG -c "\copy atlas.pincode_geo_check FROM '$SRC' WITH (FORMAT csv, HEADER true)" || {
  echo "Could not read $SRC as CSV with a header row of pincode,latitude,longitude." >&2
  exit 1; }

$PG <<'SQL'
CREATE OR REPLACE FUNCTION pg_temp.km(a_lat float8, a_lng float8, b_lat float8, b_lng float8)
RETURNS float8 LANGUAGE sql IMMUTABLE AS $$
  SELECT 6371 * 2 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2) +
    cos(radians(a_lat)) * cos(radians(b_lat)) *
    power(sin(radians(b_lng - a_lng) / 2), 2)))
$$;

CREATE TEMP VIEW theirs AS
SELECT btrim(pincode) AS pincode,
       NULLIF(btrim(latitude), '')::float8  AS lat,
       NULLIF(btrim(longitude), '')::float8 AS lng
FROM atlas.pincode_geo_check
WHERE btrim(pincode) ~ '^[0-9]{6}$';

\echo ''
\echo '=== 1. What the file contains'
SELECT count(*) AS rows_in_file,
       count(*) FILTER (WHERE lat BETWEEN 6 AND 38 AND lng BETWEEN 67 AND 98) AS usable,
       count(*) FILTER (WHERE lat IS NULL OR lng IS NULL) AS no_coordinates,
       count(*) FILTER (WHERE lat IS NOT NULL
                          AND NOT (lat BETWEEN 6 AND 38 AND lng BETWEEN 67 AND 98)) AS outside_india
FROM theirs;

\echo ''
\echo '=== 2. Gaps it would fill'
SELECT
  (SELECT count(*) FROM atlas.pincode_geo)                             AS we_have_now,
  (SELECT count(*) FROM theirs t
    WHERE t.lat BETWEEN 6 AND 38 AND t.lng BETWEEN 67 AND 98
      AND NOT EXISTS (SELECT 1 FROM atlas.pincode_geo g WHERE g.pincode = t.pincode)) AS new_pincodes,
  (SELECT count(*) FROM analytics.mv_pincode_summary)                  AS pincodes_atlas_tracks;

\echo ''
\echo '=== 3. Where we both have a position — how far apart, by our source'
SELECT g.provenance,
       count(*) AS compared,
       count(*) FILTER (WHERE pg_temp.km(g.latitude, g.longitude, t.lat, t.lng) <= 2)  AS within_2km,
       count(*) FILTER (WHERE pg_temp.km(g.latitude, g.longitude, t.lat, t.lng) > 2
                          AND pg_temp.km(g.latitude, g.longitude, t.lat, t.lng) <= 10) AS "2_to_10km",
       count(*) FILTER (WHERE pg_temp.km(g.latitude, g.longitude, t.lat, t.lng) > 10
                          AND pg_temp.km(g.latitude, g.longitude, t.lat, t.lng) <= 50) AS "10_to_50km",
       count(*) FILTER (WHERE pg_temp.km(g.latitude, g.longitude, t.lat, t.lng) > 50)  AS over_50km
FROM atlas.pincode_geo g
JOIN theirs t ON t.pincode = g.pincode
WHERE t.lat BETWEEN 6 AND 38 AND t.lng BETWEEN 67 AND 98
GROUP BY g.provenance ORDER BY 2 DESC;

\echo ''
\echo '=== 4. Worst disagreements — check these by hand before trusting either side'
SELECT g.pincode, g.provenance, g.sample_size AS addresses_behind_ours,
       round(pg_temp.km(g.latitude, g.longitude, t.lat, t.lng)::numeric, 1) AS km_apart,
       round(g.latitude::numeric,3) || ', ' || round(g.longitude::numeric,3) AS ours,
       round(t.lat::numeric,3)      || ', ' || round(t.lng::numeric,3)      AS theirs
FROM atlas.pincode_geo g
JOIN theirs t ON t.pincode = g.pincode
WHERE t.lat BETWEEN 6 AND 38 AND t.lng BETWEEN 67 AND 98
ORDER BY pg_temp.km(g.latitude, g.longitude, t.lat, t.lng) DESC
LIMIT 15;
SQL

$PG -c "TRUNCATE atlas.pincode_geo_check;"
echo ""
echo "Read-only — nothing changed. To apply it:  /load-pincode-geo.sh <file>"
