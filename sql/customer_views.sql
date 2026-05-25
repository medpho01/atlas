-- ============================================================================
-- Customer / Account intelligence (Feature E)
-- B2B Stores are the primary customer in this product. End-customers (Users)
-- are also surfaced but at a different grain.
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_store_health CASCADE;

CREATE MATERIALIZED VIEW mv_store_health AS
WITH anchor AS (SELECT MAX("createdAt") AS ref FROM "Order"),
store_orders AS (
  SELECT
    s.id AS store_id,
    s."storeName" AS store_name,
    s.city,
    s.state,
    s.pincode,
    s.active,
    s."mouEndDate",
    s."isDoctor",
    COUNT(o.id)::int AS orders_total,
    COUNT(o.id) FILTER (WHERE o."createdAt" >= (SELECT ref FROM anchor) - INTERVAL '30 days')::int AS orders_l30d,
    COUNT(o.id) FILTER (WHERE o."createdAt" >= (SELECT ref FROM anchor) - INTERVAL '60 days'
                          AND o."createdAt" < (SELECT ref FROM anchor) - INTERVAL '30 days')::int AS orders_l30d_prior,
    COUNT(o.id) FILTER (WHERE o."createdAt" >= (SELECT ref FROM anchor) - INTERVAL '90 days')::int AS orders_l90d,
    COUNT(o.id) FILTER (WHERE o."orderStatus" = 'CANCELED')::int AS canceled,
    COUNT(DISTINCT (SELECT p.pincode FROM "User" u JOIN "Profile" p ON p."profileUserId" = u.id WHERE u.id = o."userId"))::int AS distinct_pincodes_served,
    COUNT(DISTINCT o."labId")::int AS distinct_labs_used,
    MAX(o."createdAt") AS last_order_at,
    MIN(o."createdAt") AS first_order_at
  FROM "Store" s
  LEFT JOIN "Order" o ON o."storeId" = s.id
  GROUP BY s.id, s."storeName", s.city, s.state, s.pincode, s.active, s."mouEndDate", s."isDoctor"
)
SELECT
  store_id,
  store_name,
  city,
  state,
  pincode,
  active,
  "mouEndDate" AS mou_end_date,
  "isDoctor" AS is_doctor,
  orders_total,
  orders_l30d,
  orders_l30d_prior,
  orders_l90d,
  canceled,
  distinct_pincodes_served,
  distinct_labs_used,
  last_order_at,
  first_order_at,
  ROUND(100.0 * canceled / NULLIF(orders_total, 0), 2) AS cancel_pct,
  CASE WHEN orders_l30d_prior > 0
    THEN ROUND(100.0 * (orders_l30d - orders_l30d_prior) / orders_l30d_prior, 1)
    ELSE NULL END AS wow_growth_pct,
  -- Account health: blends recency, growth, volume
  -- 1) Days since last order
  CASE
    WHEN last_order_at IS NULL THEN 'INACTIVE'
    WHEN last_order_at < NOW() - INTERVAL '60 days' THEN 'CHURNED'
    WHEN orders_l30d = 0 AND orders_l30d_prior > 0 THEN 'AT_RISK'
    WHEN orders_l30d_prior > 0 AND orders_l30d < orders_l30d_prior * 0.5 THEN 'DECLINING'
    WHEN orders_l30d > orders_l30d_prior * 1.5 AND orders_l30d_prior > 5 THEN 'GROWING'
    WHEN orders_l30d > 0 THEN 'STABLE'
    ELSE 'NEW'
  END AS account_status
FROM store_orders;

CREATE UNIQUE INDEX idx_mv_store_id ON mv_store_health(store_id);
CREATE INDEX idx_mv_store_status ON mv_store_health(account_status);
CREATE INDEX idx_mv_store_orders ON mv_store_health(orders_total DESC);
