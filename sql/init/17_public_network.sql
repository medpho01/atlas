-- ---------------------------------------------------------------------------
-- Precomputed public-network reach.
--
-- The /network page used to derive centre-visit reach at request time: join
-- every row of mv_pincode_cv_reach to the tier of its centre's city, filter by
-- a per-centre radius, aggregate. That is a second of work on a small database
-- and a great deal more on a real one, and it ran again every time the cache
-- expired — so the page was slow for whoever arrived first.
--
-- None of it depends on the request. It is computed here, nightly, and the
-- page reads two tiny relations instead.
--
-- One radius, 5 km, everywhere. It was 5 in metros and 10 elsewhere, on the
-- reasoning that roads are quicker outside the metros — but 10 km still
-- credited a centre with pincodes nobody travels from for a blood test, and it
-- was what pushed reported centre-visit reach above home sample. A single
-- honest number beats a tiered one nobody can check.
--
-- Baked in rather than read from env: this is the number the public page
-- states, and it should not be able to drift from what was measured.
-- ---------------------------------------------------------------------------

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_public_network_pincode CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_public_network_pincode AS
WITH cv AS (
  -- Only pincodes we can actually locate.
  --
  -- mv_pincode_geo falls back to a 'prefix3' centroid when a pincode has no
  -- exact coordinates, which puts an average of 14.7 pincodes — up to 88 — on
  -- one identical point. A single centre near that point then "covered" all of
  -- them at zero distance, and 63% of reported centre-visit coverage was that
  -- artefact: 4,617 pincodes where 1,662 can be justified.
  --
  -- Restricting to exact coordinates understates reach slightly, since some
  -- guessed pincodes really are nearby. Understating what we can prove beats
  -- claiming a catchment computed from a guess.
  SELECT r.covered_pincode, r.entity_id, r.kind
  FROM analytics.mv_pincode_cv_reach r
  JOIN analytics.mv_pincode_geo g
    ON g.pincode = r.covered_pincode AND g.geo_source = 'exact'
  WHERE r.distance_km <= 5::numeric
),
cv_count AS (
  SELECT covered_pincode AS pincode,
         COUNT(DISTINCT entity_id)::int AS cv
  FROM cv GROUP BY covered_pincode
),
hs_count AS (
  -- Aggregate BEFORE joining. mv_pincode_coverage carries a row per kind, so
  -- joining it directly emitted a second row for every pincode served by both
  -- a lab and a hospital — 8,393 map points where there are 8,062 pincodes,
  -- each of the doubled ones showing only one kind's provider count.
  SELECT pincode, SUM(providers)::int AS hs
  FROM analytics.mv_pincode_coverage
  WHERE kind IN ('LAB','HOSPITAL') AND modality = 'HOME_SAMPLE'
  GROUP BY pincode
)
SELECT
  g.pincode,
  g.latitude,
  g.longitude,
  COALESCE(cv.cv, 0)::int  AS cv,
  COALESCE(hs.hs, 0)::int  AS hs
FROM analytics.mv_pincode_geo g
LEFT JOIN cv_count cv ON cv.pincode = g.pincode
LEFT JOIN hs_count  hs ON hs.pincode = g.pincode
WHERE g.latitude IS NOT NULL
  AND g.geo_source IN ('exact','prefix3')
  AND (COALESCE(cv.cv, 0) > 0 OR COALESCE(hs.hs, 0) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_network_pincode
  ON analytics.mv_public_network_pincode (pincode);

-- The headline numbers. A single row, so the page never aggregates at all.
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_public_network_summary CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_public_network_summary AS
WITH cv AS (
  -- Exact coordinates only; see mv_public_network_pincode above.
  SELECT DISTINCT r.entity_id, r.kind, r.covered_pincode
  FROM analytics.mv_pincode_cv_reach r
  JOIN analytics.mv_pincode_geo g
    ON g.pincode = r.covered_pincode AND g.geo_source = 'exact'
  WHERE r.distance_km <= 5::numeric
),
hs AS (
  SELECT DISTINCT pincode FROM analytics.mv_pincode_coverage
  WHERE kind IN ('LAB','HOSPITAL') AND modality = 'HOME_SAMPLE' AND providers > 0
)
SELECT
  (SELECT COUNT(*) FROM (
     SELECT covered_pincode AS p FROM cv UNION SELECT pincode FROM hs) u)::int AS pincodes_covered,
  (SELECT COUNT(DISTINCT pincode) FROM atlas.pincode_directory)::int           AS india_pincodes,
  (SELECT COUNT(*) FROM hs)::int                                               AS home_sample_pincodes,
  (SELECT COUNT(DISTINCT entity_id) FROM analytics.mv_provider_unified
    WHERE kind IN ('LAB','HOSPITAL')
      AND modalities @> ARRAY['HOME_SAMPLE']::text[])::int                     AS home_sample_labs,
  (SELECT COUNT(DISTINCT covered_pincode) FROM cv)::int                        AS center_visit_pincodes,
  (SELECT COUNT(DISTINCT entity_id) FROM cv)::int                              AS center_visit_centres,
  (SELECT COUNT(DISTINCT entity_id) FROM cv WHERE kind = 'LAB')::int           AS center_visit_labs,
  (SELECT COUNT(DISTINCT entity_id) FROM cv WHERE kind = 'HOSPITAL')::int      AS center_visit_hospitals,
  (SELECT COUNT(DISTINCT entity_id) FROM analytics.mv_provider_unified
    WHERE kind IN ('LAB','HOSPITAL')
      AND (modalities @> ARRAY['CENTER_VISIT']::text[]
        OR modalities @> ARRAY['HOME_SAMPLE']::text[]))::int                   AS distinct_labs,
  (SELECT COUNT(DISTINCT city) FROM analytics.mv_provider_unified
    WHERE kind IN ('LAB','HOSPITAL') AND city IS NOT NULL AND TRIM(city) <> '')::int AS distinct_cities;
