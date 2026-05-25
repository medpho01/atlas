-- ============================================================================
-- mv_pincode_geo — best-effort lat/long for EVERY pincode in our network.
--
-- For pincodes present in PincodeToLatLong (and within the India bbox), use the
-- exact coordinates.
-- For pincodes missing or with invalid lat/long, fall back to the centroid of
-- all pincodes sharing the same first 3 digits (Indian pincode "sorting district"
-- which groups pincodes within ~30km usually).
-- This puts ~5,300 previously-invisible pincodes on the map, with a
-- `is_exact` flag so the UI can render them differently (smaller, dimmed).
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_pincode_geo CASCADE;

-- atlas.pincode_directory lives in the app DB now (Atlas's own Postgres in
-- the docker container), so source-DB MVs can no longer JOIN it. This MV
-- falls back to PincodeToLatLong + prefix-centroid inference only.
-- Trade-off accepted: heatmap shows fewer "exact" markers than the brief
-- experiment where the directory was joined here. A future improvement is to
-- backfill PincodeToLatLong from the directory CSV as a one-time admin task
-- in the source DB.
CREATE MATERIALIZED VIEW mv_pincode_geo AS
WITH valid_lat_long AS (
  SELECT pincode, latitude, longitude
  FROM "PincodeToLatLong"
  WHERE latitude BETWEEN 6 AND 38 AND longitude BETWEEN 67 AND 98
),
prefix_centroids AS (
  SELECT
    SUBSTRING(pincode, 1, 3) AS prefix,
    AVG(latitude) AS lat,
    AVG(longitude) AS lng,
    COUNT(*) AS sample_size
  FROM valid_lat_long
  WHERE pincode ~ '^[0-9]{6}$'
  GROUP BY SUBSTRING(pincode, 1, 3)
),
two_digit_centroids AS (
  SELECT
    SUBSTRING(pincode, 1, 2) AS prefix,
    AVG(latitude) AS lat,
    AVG(longitude) AS lng
  FROM valid_lat_long
  WHERE pincode ~ '^[0-9]{6}$'
  GROUP BY SUBSTRING(pincode, 1, 2)
),
all_pincodes AS (
  SELECT pincode FROM mv_pincode_summary
)
SELECT
  ap.pincode,
  COALESCE(v.latitude,  pc.lat, tc.lat) AS latitude,
  COALESCE(v.longitude, pc.lng, tc.lng) AS longitude,
  CASE
    WHEN v.latitude IS NOT NULL THEN 'exact'
    WHEN pc.lat IS NOT NULL THEN 'prefix3'   -- ~30km accuracy
    WHEN tc.lat IS NOT NULL THEN 'prefix2'   -- ~100km accuracy
    ELSE 'none'
  END AS geo_source
FROM all_pincodes ap
LEFT JOIN valid_lat_long      v  ON v.pincode  = ap.pincode
LEFT JOIN prefix_centroids    pc ON pc.prefix  = SUBSTRING(ap.pincode, 1, 3) AND ap.pincode ~ '^[0-9]{6}$'
LEFT JOIN two_digit_centroids tc ON tc.prefix = SUBSTRING(ap.pincode, 1, 2) AND ap.pincode ~ '^[0-9]{6}$';

CREATE UNIQUE INDEX idx_mv_pincode_geo_pin ON mv_pincode_geo(pincode);
CREATE INDEX idx_mv_pincode_geo_latlng ON mv_pincode_geo(latitude, longitude) WHERE latitude IS NOT NULL;
CREATE INDEX idx_mv_pincode_geo_source ON mv_pincode_geo(geo_source);
