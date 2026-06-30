-- ============================================================================
-- analytics.mv_pincode_cv_reach
-- Pre-computed center-visit reach: for every active lab/hospital that offers
-- centerVisit, store every pincode within radius (default ≤ 20 km) with the
-- haversine distance.
--
-- The /network page filters this to whatever radius the app config uses (10 km
-- by default). Storing the full ≤20 km set lets us tune the visible radius
-- without re-building the MV.
--
-- Rough size: ~1,500 CV labs × ~150 nearby pincodes each ≈ 225K rows, ~40 MB.
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_pincode_cv_reach CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_pincode_cv_reach AS
WITH lab_geo AS (
  -- Every active LAB/HOSPITAL that offers CENTER_VISIT, with coordinates.
  SELECT DISTINCT ON (pu.entity_id)
    pu.entity_id,
    pu.name,
    pu.kind,
    pu.city,
    pu.state,
    pu.pincode AS lab_pincode,
    g.latitude  AS lab_lat,
    g.longitude AS lab_lng
  FROM analytics.mv_provider_unified pu
  JOIN analytics.mv_pincode_geo g ON g.pincode = pu.pincode
  WHERE pu.active
    AND pu.kind IN ('LAB','HOSPITAL')
    AND 'CENTER_VISIT' = ANY(pu.modalities)
    AND g.latitude IS NOT NULL
    AND g.longitude IS NOT NULL
)
SELECT
  lg.entity_id,
  lg.name,
  lg.kind,
  lg.city,
  lg.state,
  lg.lab_pincode,
  ap.pincode AS covered_pincode,
  -- Haversine in km. 6371 = Earth's mean radius.
  -- LEAST/GREATEST guard against floating-point drift outside acos's [-1,1] domain.
  ROUND(
    (6371 * acos(
      GREATEST(-1, LEAST(1,
        cos(radians(lg.lab_lat)) * cos(radians(ap.latitude)) *
        cos(radians(ap.longitude) - radians(lg.lab_lng)) +
        sin(radians(lg.lab_lat)) * sin(radians(ap.latitude))
      ))
    ))::numeric, 2
  ) AS distance_km
FROM lab_geo lg
JOIN analytics.mv_pincode_geo ap
  -- Bounding-box prefilter: ~20 km in degrees ≈ 0.18 lat / 0.18 lng (varies by
  -- latitude but close enough). Speeds the join up by ~50x vs naive cross-join.
  ON ap.latitude  BETWEEN lg.lab_lat - 0.18 AND lg.lab_lat + 0.18
 AND ap.longitude BETWEEN lg.lab_lng - 0.18 AND lg.lab_lng + 0.18
 AND ap.latitude IS NOT NULL
WHERE 6371 * acos(
  GREATEST(-1, LEAST(1,
    cos(radians(lg.lab_lat)) * cos(radians(ap.latitude)) *
    cos(radians(ap.longitude) - radians(lg.lab_lng)) +
    sin(radians(lg.lab_lat)) * sin(radians(ap.latitude))
  ))
) <= 20;

-- Hot indexes — the public page does two query shapes:
--   1. "labs reaching pincode X" → filter by covered_pincode + radius
--   2. "count distinct pincodes covered" → filter by distance_km
CREATE INDEX idx_cv_reach_covered ON analytics.mv_pincode_cv_reach (covered_pincode, distance_km);
CREATE INDEX idx_cv_reach_entity  ON analytics.mv_pincode_cv_reach (entity_id);
CREATE INDEX idx_cv_reach_dist    ON analytics.mv_pincode_cv_reach (distance_km);

ANALYZE analytics.mv_pincode_cv_reach;

DO $$
DECLARE n int; pin int; lab int;
BEGIN
  SELECT COUNT(*),
         COUNT(DISTINCT covered_pincode),
         COUNT(DISTINCT entity_id)
    INTO n, pin, lab
    FROM analytics.mv_pincode_cv_reach
    WHERE distance_km <= 10;
  RAISE NOTICE 'mv_pincode_cv_reach (≤10 km): % rows, % distinct covered pincodes, % distinct labs',
    n, pin, lab;
END$$;
