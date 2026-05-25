-- ============================================================================
-- Quality v2 — TAT, repeat rate, chain rollup.
-- TAT is "median hours from createdAt → statusUpdatedAt (when status=REPORT_DELIVERED)"
-- Repeat rate = unique users who ordered at this lab >= 2 times / unique users.
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_lab_quality_v2 CASCADE;

CREATE MATERIALIZED VIEW mv_lab_quality_v2 AS
WITH delivered AS (
  SELECT
    o."labId",
    o."userId",
    EXTRACT(EPOCH FROM (o."statusUpdatedAt" - o."createdAt")) / 3600.0 AS tat_hours
  FROM "Order" o
  WHERE o."orderStatus" = 'REPORT_DELIVERED'
    AND o."labId" IS NOT NULL
    AND o."statusUpdatedAt" > o."createdAt"
    AND EXTRACT(EPOCH FROM (o."statusUpdatedAt" - o."createdAt")) / 3600.0 BETWEEN 0 AND 720  -- cap at 30 days
),
user_repeat AS (
  SELECT
    "labId",
    COUNT(DISTINCT "userId") AS unique_users,
    COUNT(DISTINCT "userId") FILTER (WHERE u_orders >= 2) AS repeat_users
  FROM (
    SELECT "labId", "userId", COUNT(*) AS u_orders
    FROM "Order" WHERE "labId" IS NOT NULL GROUP BY "labId", "userId"
  ) x
  GROUP BY "labId"
)
SELECT
  l.id AS lab_id,
  l."labName" AS lab_name,
  l.city,
  l.pincode,
  l.chain_id,
  c."chainName" AS chain_name,
  l."centerType"::text AS center_type,
  l.active,
  -- Volume
  COUNT(o.id)::int AS orders_total,
  COUNT(o.id) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '30 days')::int AS orders_l30d,
  COUNT(o.id) FILTER (WHERE o."createdAt" >= NOW() - INTERVAL '90 days')::int AS orders_l90d,
  -- Outcomes
  COUNT(o.id) FILTER (WHERE o."orderStatus" = 'CANCELED')::int AS canceled,
  COUNT(o.id) FILTER (WHERE o."orderStatus" = 'REPORT_DELIVERED')::int AS delivered,
  ROUND(100.0 * COUNT(o.id) FILTER (WHERE o."orderStatus" = 'CANCELED') / NULLIF(COUNT(o.id), 0), 2) AS cancel_pct,
  ROUND(100.0 * COUNT(o.id) FILTER (WHERE o."orderStatus" = 'REPORT_DELIVERED') / NULLIF(COUNT(o.id), 0), 2) AS delivered_pct,
  -- TAT
  (SELECT ROUND(AVG(tat_hours)::numeric, 1) FROM delivered d WHERE d."labId" = l.id) AS avg_tat_hours,
  (SELECT ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tat_hours)::numeric, 1) FROM delivered d WHERE d."labId" = l.id) AS median_tat_hours,
  -- Repeat
  (SELECT unique_users FROM user_repeat WHERE "labId" = l.id) AS unique_users,
  (SELECT repeat_users FROM user_repeat WHERE "labId" = l.id) AS repeat_users,
  (SELECT ROUND(100.0 * repeat_users / NULLIF(unique_users, 0), 1) FROM user_repeat WHERE "labId" = l.id) AS repeat_rate_pct,
  -- Composite v2 score (0-100): blends delivery, cancel, TAT, repeat
  GREATEST(0, LEAST(100, ROUND(
    0.30 * COALESCE(100.0 * COUNT(o.id) FILTER (WHERE o."orderStatus" = 'REPORT_DELIVERED') / NULLIF(COUNT(o.id), 0), 50)
    + 0.25 * GREATEST(0, 100 - COALESCE(100.0 * COUNT(o.id) FILTER (WHERE o."orderStatus" = 'CANCELED') / NULLIF(COUNT(o.id), 0), 0) * 2)
    + 0.20 * GREATEST(0, 100 - LEAST(100, COALESCE((SELECT AVG(tat_hours) FROM delivered d WHERE d."labId" = l.id), 48) * 1.5))
    + 0.25 * COALESCE((SELECT 100.0 * repeat_users / NULLIF(unique_users, 0) FROM user_repeat WHERE "labId" = l.id), 0)
  )::int))::int AS health_score_v2
FROM "Lab" l
LEFT JOIN "Chain" c ON c.id = l.chain_id
LEFT JOIN "Order" o ON o."labId" = l.id
GROUP BY l.id, l."labName", l.city, l.pincode, l.chain_id, c."chainName", l."centerType", l.active;

CREATE INDEX idx_mv_lab_q2_id ON mv_lab_quality_v2(lab_id);
CREATE INDEX idx_mv_lab_q2_chain ON mv_lab_quality_v2(chain_id);
CREATE INDEX idx_mv_lab_q2_health ON mv_lab_quality_v2(health_score_v2);

-- ----------------------------------------------------------------------------
-- mv_chain_summary — chain-level rollup for the new Chain dashboard
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_chain_summary CASCADE;

CREATE MATERIALIZED VIEW mv_chain_summary AS
SELECT
  c.id AS chain_id,
  c."chainName" AS chain_name,
  COUNT(DISTINCT l.id) FILTER (WHERE l.active)::int AS active_branches,
  COUNT(DISTINCT l.id)::int AS total_branches,
  COUNT(DISTINCT l.pincode) FILTER (WHERE l.active)::int AS distinct_pincodes,
  COUNT(DISTINCT l.city) FILTER (WHERE l.active)::int AS distinct_cities,
  -- Pincodes serviced via home collection (deduped across all chain labs)
  (SELECT COUNT(DISTINCT sp)::int FROM "Lab" l2, unnest(COALESCE(l2."pincodesServiced", ARRAY[]::text[])) sp WHERE l2.chain_id = c.id AND l2.active AND l2."homeCollection") AS home_sample_pincodes_served,
  SUM(q.orders_total)::int AS orders_total,
  SUM(q.orders_l30d)::int AS orders_l30d,
  SUM(q.orders_l90d)::int AS orders_l90d,
  ROUND(SUM(q.orders_total * q.cancel_pct) / NULLIF(SUM(q.orders_total), 0), 2) AS weighted_cancel_pct,
  ROUND(SUM(q.orders_total * q.delivered_pct) / NULLIF(SUM(q.orders_total), 0), 2) AS weighted_delivered_pct,
  ROUND(SUM(q.orders_total * q.avg_tat_hours) / NULLIF(SUM(q.orders_total) FILTER (WHERE q.avg_tat_hours IS NOT NULL), 0), 1) AS weighted_avg_tat_hours,
  ROUND(SUM(q.orders_total * q.health_score_v2)::numeric / NULLIF(SUM(q.orders_total), 0), 0)::int AS weighted_health_score,
  ROUND(SUM(q.repeat_users)::numeric / NULLIF(SUM(q.unique_users), 0) * 100, 1) AS chain_repeat_rate_pct
FROM "Chain" c
LEFT JOIN "Lab" l ON l.chain_id = c.id
LEFT JOIN mv_lab_quality_v2 q ON q.lab_id = l.id
GROUP BY c.id, c."chainName";

CREATE INDEX idx_mv_chain_summary_id ON mv_chain_summary(chain_id);
CREATE INDEX idx_mv_chain_summary_orders ON mv_chain_summary(orders_total DESC);
