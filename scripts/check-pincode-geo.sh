#!/bin/sh
# ============================================================================
# Compare a public pincode dataset against what Atlas already holds.
#
#   docker compose exec -T atlas-refresh /check-pincode-geo.sh /dev/stdin < pincodes.csv
#
# Reads only. Nothing is written, nothing overwritten — run this first, decide
# what you believe, then run /load-pincode-geo.sh to apply.
#
# Disagreement is not automatically the dataset being wrong. LabStack's own
# coordinates are unverified too, and an observed position is the median of
# real customer addresses. A large gap means one of them is wrong, and which
# is a judgement worth making with the pincodes in front of you.
# ============================================================================
set -u

. "$(dirname "$0")/lib-pincode-csv.sh" 2>/dev/null || . /lib-pincode-csv.sh

PG="psql -h ${PGHOST:-atlas-db} -U ${PGUSER:-atlas} -d ${PGDATABASE:-atlas} -X -q"
SRC="${1:-/dev/stdin}"

stage_pincode_csv "$SRC" || exit 1
CLEAN=$(pincode_clean_sql)

$PG <<SQL
CREATE OR REPLACE FUNCTION pg_temp.km(a_lat float8, a_lng float8, b_lat float8, b_lng float8)
RETURNS float8 LANGUAGE sql IMMUTABLE AS \$\$
  SELECT 6371 * 2 * asin(sqrt(
    power(sin(radians(b_lat - a_lat) / 2), 2) +
    cos(radians(a_lat)) * cos(radians(b_lat)) *
    power(sin(radians(b_lng - a_lng) / 2), 2)))
\$\$;

-- One row per pincode: post-office level data lists several per pincode, so
-- take the median before comparing anything.
CREATE TEMP VIEW theirs AS
SELECT pincode,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) AS lat,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY lng) AS lng
FROM ($CLEAN) c
WHERE lat BETWEEN 6 AND 38 AND lng BETWEEN 67 AND 98
GROUP BY pincode;

\echo ''
\echo '=== 1. What the file contains'
SELECT (SELECT count(*) FROM atlas.pincode_raw_stage) AS rows_in_file,
       (SELECT count(*) FROM ($CLEAN) c)              AS parsed_ok,
       (SELECT count(*) FROM theirs)                  AS distinct_pincodes,
       (SELECT count(*) FROM ($CLEAN) c
         WHERE NOT (lat BETWEEN 6 AND 38 AND lng BETWEEN 67 AND 98)) AS outside_india;

\echo ''
\echo '=== 2. Gaps it would fill'
SELECT (SELECT count(*) FROM atlas.pincode_geo) AS we_have_now,
       (SELECT count(*) FROM theirs t
         WHERE NOT EXISTS (SELECT 1 FROM atlas.pincode_geo g WHERE g.pincode = t.pincode)) AS new_pincodes,
       (SELECT count(*) FROM analytics.mv_pincode_summary) AS pincodes_atlas_tracks;

\echo ''
\echo '=== 3. Where we both have a position — how far apart, by our source'
SELECT g.provenance, count(*) AS compared,
       count(*) FILTER (WHERE pg_temp.km(g.latitude,g.longitude,t.lat,t.lng) <= 2)  AS within_2km,
       count(*) FILTER (WHERE pg_temp.km(g.latitude,g.longitude,t.lat,t.lng) > 2
                          AND pg_temp.km(g.latitude,g.longitude,t.lat,t.lng) <= 10) AS "2_to_10km",
       count(*) FILTER (WHERE pg_temp.km(g.latitude,g.longitude,t.lat,t.lng) > 10
                          AND pg_temp.km(g.latitude,g.longitude,t.lat,t.lng) <= 50) AS "10_to_50km",
       count(*) FILTER (WHERE pg_temp.km(g.latitude,g.longitude,t.lat,t.lng) > 50)  AS over_50km
FROM atlas.pincode_geo g JOIN theirs t ON t.pincode = g.pincode
GROUP BY g.provenance ORDER BY 2 DESC;

\echo ''
\echo '=== 4. Worst disagreements — check these by hand before trusting either side'
SELECT g.pincode, g.provenance, g.sample_size AS addresses_behind_ours,
       round(pg_temp.km(g.latitude,g.longitude,t.lat,t.lng)::numeric, 1) AS km_apart,
       round(g.latitude::numeric,3) || ', ' || round(g.longitude::numeric,3) AS ours,
       round(t.lat::numeric,3)      || ', ' || round(t.lng::numeric,3)      AS theirs
FROM atlas.pincode_geo g JOIN theirs t ON t.pincode = g.pincode
ORDER BY pg_temp.km(g.latitude,g.longitude,t.lat,t.lng) DESC
LIMIT 15;
SQL

$PG -c "DROP TABLE IF EXISTS atlas.pincode_raw_stage;"
echo ""
echo "Read-only — nothing changed. To apply it:  /load-pincode-geo.sh <file>"
