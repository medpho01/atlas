-- ============================================================================
-- LabStack Network Intelligence — Materialized Views
-- These power every screen of the app. Refresh nightly (or on-demand).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. mv_pincode_supply
--    One row per (pincode, entity_kind). Counts active providers per type.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_pincode_supply CASCADE;

CREATE MATERIALIZED VIEW mv_pincode_supply AS
WITH lab_at_pincode AS (
  SELECT
    pincode,
    'LAB' AS entity_kind,
    NULL::text AS provider_type,
    COUNT(*)::int AS cnt
  FROM "Lab"
  WHERE pincode IS NOT NULL AND pincode <> ''
  GROUP BY pincode
),
lab_serviced AS (
  SELECT
    pin AS pincode,
    'LAB_SERVICED' AS entity_kind,
    NULL::text AS provider_type,
    COUNT(DISTINCT id)::int AS cnt
  FROM "Lab", unnest("pincodesServiced") pin
  WHERE pin IS NOT NULL AND pin <> ''
  GROUP BY pin
),
providers AS (
  SELECT
    p.pincode,
    'PROVIDER' AS entity_kind,
    pt."typeName" AS provider_type,
    COUNT(*)::int AS cnt
  FROM "Provider" p
  JOIN "ProviderType" pt ON pt.id = p."typeId"
  WHERE p.pincode IS NOT NULL AND p.pincode <> ''
  GROUP BY p.pincode, pt."typeName"
),
pharmacies AS (
  SELECT
    pincode,
    'PHARMACY' AS entity_kind,
    NULL::text AS provider_type,
    COUNT(*)::int AS cnt
  FROM "Pharmacy"
  WHERE pincode IS NOT NULL AND pincode <> ''
  GROUP BY pincode
)
SELECT * FROM lab_at_pincode
UNION ALL SELECT * FROM lab_serviced
UNION ALL SELECT * FROM providers
UNION ALL SELECT * FROM pharmacies;

CREATE INDEX idx_mv_supply_pin ON mv_pincode_supply(pincode);
CREATE INDEX idx_mv_supply_kind ON mv_pincode_supply(entity_kind);

-- ----------------------------------------------------------------------------
-- 2. mv_pincode_demand
--    One row per (pincode, order_type, window) with order counts.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_pincode_demand CASCADE;

CREATE MATERIALIZED VIEW mv_pincode_demand AS
WITH order_pincodes AS (
  SELECT
    o.id,
    o."orderType"::text AS order_type,
    o."orderStatus"::text AS order_status,
    o."createdAt",
    o."storeId",
    o."labId",
    p.pincode
  FROM "Order" o
  JOIN "User" u ON u.id = o."userId"
  JOIN "Profile" p ON p."profileUserId" = u.id
  WHERE p.pincode IS NOT NULL AND p.pincode <> ''
)
SELECT
  pincode,
  order_type,
  COUNT(*)::int AS orders_all_time,
  COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days')::int AS orders_l30d,
  COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '90 days')::int AS orders_l90d,
  COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '365 days')::int AS orders_l365d,
  COUNT(*) FILTER (WHERE order_status = 'CANCELED')::int AS canceled_all_time,
  COUNT(*) FILTER (WHERE order_status = 'REPORT_DELIVERED')::int AS delivered_all_time,
  COUNT(DISTINCT "storeId")::int AS unique_stores,
  COUNT(DISTINCT "labId")::int AS unique_labs
FROM order_pincodes
GROUP BY pincode, order_type;

CREATE INDEX idx_mv_demand_pin ON mv_pincode_demand(pincode);
CREATE INDEX idx_mv_demand_type ON mv_pincode_demand(order_type);

-- ----------------------------------------------------------------------------
-- 3. mv_pincode_requests
--    Demand from Requests (leads), including unserviceable ones — gap signal.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_pincode_requests CASCADE;

CREATE MATERIALIZED VIEW mv_pincode_requests AS
SELECT
  pincode,
  COUNT(*)::int AS requests_all_time,
  COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '30 days')::int AS requests_l30d,
  COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '90 days')::int AS requests_l90d,
  COUNT(*) FILTER (WHERE "isServiceable" = true)::int AS serviceable,
  COUNT(*) FILTER (WHERE "isServiceable" = false)::int AS unserviceable,
  COUNT(*) FILTER (WHERE "isConverted" = true)::int AS converted,
  -- L90D-scoped funnel
  COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '90 days' AND "isServiceable" = true)::int AS serviceable_l90d,
  COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '90 days' AND "isServiceable" = false)::int AS unserviceable_l90d,
  COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '90 days' AND "isConverted" = true)::int AS converted_l90d,
  ROUND(100.0 * COUNT(*) FILTER (WHERE "isConverted" = true) / NULLIF(COUNT(*), 0), 2) AS conversion_pct
FROM "Request"
WHERE pincode IS NOT NULL AND pincode <> ''
GROUP BY pincode;

CREATE INDEX idx_mv_requests_pin ON mv_pincode_requests(pincode);

-- ----------------------------------------------------------------------------
-- 4. mv_pincode_summary
--    The headline view — one row per pincode with all key metrics joined.
--    Powers the home dashboard, heatmap, and gap scorer.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_pincode_summary CASCADE;

CREATE MATERIALIZED VIEW mv_pincode_summary AS
WITH all_pincodes AS (
  SELECT DISTINCT pincode FROM mv_pincode_supply WHERE pincode IS NOT NULL
  UNION
  SELECT DISTINCT pincode FROM mv_pincode_demand WHERE pincode IS NOT NULL
  UNION
  SELECT DISTINCT pincode FROM mv_pincode_requests WHERE pincode IS NOT NULL
  UNION
  SELECT DISTINCT pincode FROM "PincodeToLatLong"
),
supply_rollup AS (
  SELECT
    pincode,
    SUM(cnt) FILTER (WHERE entity_kind = 'LAB')::int AS labs_local,
    SUM(cnt) FILTER (WHERE entity_kind = 'LAB_SERVICED')::int AS labs_serviced,
    SUM(cnt) FILTER (WHERE entity_kind = 'PROVIDER' AND provider_type = 'Doctor')::int AS doctors,
    SUM(cnt) FILTER (WHERE entity_kind = 'PROVIDER' AND provider_type = 'Phlebotomist')::int AS phlebos,
    SUM(cnt) FILTER (WHERE entity_kind = 'PROVIDER' AND provider_type = 'Nurse')::int AS nurses,
    SUM(cnt) FILTER (WHERE entity_kind = 'PROVIDER')::int AS providers_total,
    SUM(cnt) FILTER (WHERE entity_kind = 'PHARMACY')::int AS pharmacies
  FROM mv_pincode_supply
  GROUP BY pincode
),
demand_rollup AS (
  SELECT
    pincode,
    SUM(orders_all_time)::int AS orders_all_time,
    SUM(orders_l30d)::int AS orders_l30d,
    SUM(orders_l90d)::int AS orders_l90d,
    SUM(orders_l365d)::int AS orders_l365d,
    SUM(orders_all_time) FILTER (WHERE order_type = 'HOME_SAMPLE')::int AS home_sample,
    SUM(orders_all_time) FILTER (WHERE order_type = 'CAMP')::int AS camp,
    SUM(orders_all_time) FILTER (WHERE order_type = 'CENTER_VISIT')::int AS center_visit
  FROM mv_pincode_demand
  GROUP BY pincode
)
SELECT
  ap.pincode,
  pl.latitude,
  pl.longitude,
  COALESCE(s.labs_local, 0) AS labs_local,
  COALESCE(s.labs_serviced, 0) AS labs_serviced,
  COALESCE(s.doctors, 0) AS doctors,
  COALESCE(s.phlebos, 0) AS phlebos,
  COALESCE(s.nurses, 0) AS nurses,
  COALESCE(s.providers_total, 0) AS providers_total,
  COALESCE(s.pharmacies, 0) AS pharmacies,
  COALESCE(d.orders_all_time, 0) AS orders_all_time,
  COALESCE(d.orders_l30d, 0) AS orders_l30d,
  COALESCE(d.orders_l90d, 0) AS orders_l90d,
  COALESCE(d.orders_l365d, 0) AS orders_l365d,
  COALESCE(d.home_sample, 0) AS home_sample,
  COALESCE(d.camp, 0) AS camp,
  COALESCE(d.center_visit, 0) AS center_visit,
  COALESCE(r.requests_l90d, 0) AS requests_l90d,
  COALESCE(r.unserviceable, 0) AS unserviceable_requests,
  COALESCE(r.conversion_pct, 0) AS conversion_pct,
  -- Total network strength: labs (local or serviced) + all providers
  GREATEST(COALESCE(s.labs_local, 0), COALESCE(s.labs_serviced, 0)) + COALESCE(s.providers_total, 0) AS network_strength,
  -- Coverage bucket: 5+ / 3-4 / 2 / 1 / 0
  CASE
    WHEN GREATEST(COALESCE(s.labs_local, 0), COALESCE(s.labs_serviced, 0)) + COALESCE(s.providers_total, 0) >= 5 THEN '5_plus'
    WHEN GREATEST(COALESCE(s.labs_local, 0), COALESCE(s.labs_serviced, 0)) + COALESCE(s.providers_total, 0) >= 3 THEN '3_to_4'
    WHEN GREATEST(COALESCE(s.labs_local, 0), COALESCE(s.labs_serviced, 0)) + COALESCE(s.providers_total, 0) = 2 THEN '2'
    WHEN GREATEST(COALESCE(s.labs_local, 0), COALESCE(s.labs_serviced, 0)) + COALESCE(s.providers_total, 0) = 1 THEN '1'
    ELSE '0'
  END AS coverage_bucket,
  -- Gap score: demand / (supply + 1), scaled 0-100, with a strategic weight bump for high-volume pincodes
  LEAST(
    100,
    ROUND(
      (COALESCE(d.orders_l90d, 0) * 1.0) /
      NULLIF(GREATEST(COALESCE(s.labs_local, 0), COALESCE(s.labs_serviced, 0)) + COALESCE(s.providers_total, 0) + 1, 0)
      / 5.0
    )::int
  ) AS gap_score
FROM all_pincodes ap
LEFT JOIN "PincodeToLatLong" pl ON pl.pincode = ap.pincode
LEFT JOIN supply_rollup s ON s.pincode = ap.pincode
LEFT JOIN demand_rollup d ON d.pincode = ap.pincode
LEFT JOIN mv_pincode_requests r ON r.pincode = ap.pincode;

CREATE UNIQUE INDEX idx_mv_summary_pin ON mv_pincode_summary(pincode);
CREATE INDEX idx_mv_summary_strength ON mv_pincode_summary(network_strength);
CREATE INDEX idx_mv_summary_orders30 ON mv_pincode_summary(orders_l30d DESC);
CREATE INDEX idx_mv_summary_gap ON mv_pincode_summary(gap_score DESC);

-- ----------------------------------------------------------------------------
-- 5. mv_city_rollup
--    City-level KPIs for the home dashboard leaderboard.
--    City is derived from any matched provider/lab/profile city for the pincode.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_city_rollup CASCADE;

CREATE MATERIALIZED VIEW mv_city_rollup AS
WITH pincode_city AS (
  -- Best-effort city lookup per pincode (most common city across labs/providers/profiles)
  SELECT pincode, city, ROW_NUMBER() OVER (PARTITION BY pincode ORDER BY n DESC) AS rn
  FROM (
    SELECT pincode, city, COUNT(*) AS n FROM "Lab" WHERE pincode IS NOT NULL AND city IS NOT NULL GROUP BY pincode, city
    UNION ALL
    SELECT pincode, city, COUNT(*) FROM "Provider" WHERE pincode IS NOT NULL AND city IS NOT NULL GROUP BY pincode, city
    UNION ALL
    SELECT pincode, city, COUNT(*) FROM "Profile" WHERE pincode IS NOT NULL AND city IS NOT NULL AND city <> '' GROUP BY pincode, city
  ) x
)
SELECT
  pc.city,
  COUNT(DISTINCT s.pincode)::int AS active_pincodes,
  SUM(s.providers_total)::int AS providers_total,
  SUM(s.labs_local)::int AS labs_total,
  SUM(s.pharmacies)::int AS pharmacies_total,
  SUM(s.orders_l30d)::int AS orders_l30d,
  SUM(s.orders_l90d)::int AS orders_l90d,
  SUM(s.orders_all_time)::int AS orders_all_time,
  COUNT(*) FILTER (WHERE s.coverage_bucket = '5_plus')::int AS well_served,
  COUNT(*) FILTER (WHERE s.coverage_bucket = '1')::int AS single_provider,
  COUNT(*) FILTER (WHERE s.coverage_bucket = '0' AND s.orders_l90d > 0)::int AS demand_no_supply
FROM mv_pincode_summary s
JOIN pincode_city pc ON pc.pincode = s.pincode AND pc.rn = 1
GROUP BY pc.city
ORDER BY orders_l30d DESC;

CREATE INDEX idx_mv_city_orders ON mv_city_rollup(orders_l30d DESC);

-- ----------------------------------------------------------------------------
-- 6. mv_lab_health
--    Lab quality score from order outcomes.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_lab_health CASCADE;

CREATE MATERIALIZED VIEW mv_lab_health AS
SELECT
  l.id AS lab_id,
  l."labName" AS lab_name,
  l.city,
  l.pincode,
  l.chain_id,
  c."chainName" AS chain_name,
  l.active,
  l."mouEndDate",
  COUNT(o.id)::int AS orders_total,
  COUNT(o.id) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '30 days')::int AS orders_l30d,
  COUNT(o.id) FILTER (WHERE o."orderStatus" = 'CANCELED')::int AS canceled,
  COUNT(o.id) FILTER (WHERE o."orderStatus" = 'REPORT_DELIVERED')::int AS delivered,
  ROUND(100.0 * COUNT(o.id) FILTER (WHERE o."orderStatus" = 'CANCELED') / NULLIF(COUNT(o.id), 0), 2) AS cancel_pct,
  ROUND(100.0 * COUNT(o.id) FILTER (WHERE o."orderStatus" = 'REPORT_DELIVERED') / NULLIF(COUNT(o.id), 0), 2) AS delivered_pct,
  -- Composite health score (0-100): high delivered_pct + low cancel_pct
  GREATEST(0, LEAST(100, ROUND(
    COALESCE(100.0 * COUNT(o.id) FILTER (WHERE o."orderStatus" = 'REPORT_DELIVERED') / NULLIF(COUNT(o.id), 0), 50)
    - COALESCE(100.0 * COUNT(o.id) FILTER (WHERE o."orderStatus" = 'CANCELED') / NULLIF(COUNT(o.id), 0), 0) * 1.5
  )::int))::int AS health_score
FROM "Lab" l
LEFT JOIN "Chain" c ON c.id = l.chain_id
LEFT JOIN "Order" o ON o."labId" = l.id
GROUP BY l.id, l."labName", l.city, l.pincode, l.chain_id, c."chainName", l.active, l."mouEndDate";

CREATE INDEX idx_mv_lab_health_id ON mv_lab_health(lab_id);
CREATE INDEX idx_mv_lab_health_score ON mv_lab_health(health_score);
CREATE INDEX idx_mv_lab_health_city ON mv_lab_health(city);
