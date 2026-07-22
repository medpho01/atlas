-- ============================================================================
-- analytics.mv_phlebos_derived
--   One row per (phone, name) pair — NOT just per phone. Real world reason:
--   aggregators like Orange Health tag every field phlebo's order with a
--   single shared dispatch phone. Grouping on phone alone would collapse
--   ~150 real phlebos into one 25,000-order phantom. Grouping on
--   (phone, normalized_name) restores per-phlebo attribution.
--
--   Also produces these signals so a viewer can judge attribution quality:
--     - active_days:            DISTINCT dates this phlebo appeared on an order
--     - avg_orders_per_day:     orders_served / active_days
--     - is_shared_phone:        true if 3+ distinct names share this phone
--     - name_variants_at_phone: total distinct names on this phone
--
--   Also creates atlas.phlebos_all — the VIEW the app queries, which FULL
--   OUTER JOINs the derived MV with atlas.phlebos_manual (uploaded rows).
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_phlebos_derived CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_phlebos_derived AS
WITH cust_profile AS (
  SELECT DISTINCT ON ("profileUserId")
    "profileUserId", pincode, city, state
  FROM src_local."Profile"
  WHERE pincode ~ '^[0-9]{6}$'
  ORDER BY "profileUserId", pincode
),
phlebo_orders AS (
  SELECT
    regexp_replace(o."phleboNumber", '[^0-9]', '', 'g')     AS phone,
    -- name_key: case- and whitespace-normalized for GROUP BY.
    -- Original casing preserved in name_raw for display.
    lower(regexp_replace(TRIM(o."phleboName"), '\s+', ' ', 'g')) AS name_key,
    o."phleboName"                                           AS name_raw,
    o."labId",
    l."labName",
    o."createdAt",
    cp.pincode                                               AS customer_pincode,
    pc.city                                                  AS customer_city_canon,
    pc.state                                                 AS customer_state_canon
  FROM src_local."Order" o
  LEFT JOIN src_local."Lab" l              ON l.id = o."labId"
  LEFT JOIN cust_profile cp                ON cp."profileUserId" = o."userId"
  LEFT JOIN analytics.mv_pincode_city pc   ON pc.pincode = cp.pincode
  WHERE o."phleboNumber" IS NOT NULL
    AND o."phleboNumber" <> ''
    AND o."phleboName"   IS NOT NULL
    AND TRIM(o."phleboName") <> ''
),
-- How many distinct names share each phone? Used for the shared-phone flag.
phone_stats AS (
  SELECT
    phone,
    COUNT(DISTINCT name_key) AS variants_at_phone
  FROM phlebo_orders
  GROUP BY phone
)
SELECT
  po.phone,
  po.name_key,
  mode() WITHIN GROUP (ORDER BY po.name_raw)                AS name,
  mode() WITHIN GROUP (ORDER BY po.customer_city_canon)     AS derived_city,
  mode() WITHIN GROUP (ORDER BY po.customer_state_canon)    AS derived_state,
  mode() WITHIN GROUP (ORDER BY po.customer_pincode)        AS derived_pincode,
  COUNT(*)                                                  AS orders_served,
  COUNT(DISTINCT DATE(po."createdAt"))                      AS active_days,
  ROUND(
    (COUNT(*)::numeric / NULLIF(COUNT(DISTINCT DATE(po."createdAt")), 0)),
    1
  )                                                          AS avg_orders_per_day,
  COUNT(DISTINCT po."labId")                                AS distinct_labs,
  ARRAY(
    SELECT DISTINCT "labName"
    FROM phlebo_orders po2
    WHERE po2.phone = po.phone AND po2.name_key = po.name_key
      AND "labName" IS NOT NULL
    ORDER BY "labName"
  )                                                          AS lab_names,
  MIN(po."createdAt")::date                                 AS first_order_at,
  MAX(po."createdAt")::date                                 AS last_order_at,
  ps.variants_at_phone,
  (ps.variants_at_phone >= 3)                               AS is_shared_phone
FROM phlebo_orders po
JOIN phone_stats ps ON ps.phone = po.phone
GROUP BY po.phone, po.name_key, ps.variants_at_phone;

CREATE UNIQUE INDEX idx_mv_phlebos_derived_key     ON analytics.mv_phlebos_derived (phone, name_key);
CREATE INDEX idx_mv_phlebos_derived_phone          ON analytics.mv_phlebos_derived (phone);
CREATE INDEX idx_mv_phlebos_derived_city           ON analytics.mv_phlebos_derived (lower(derived_city));
CREATE INDEX idx_mv_phlebos_derived_state          ON analytics.mv_phlebos_derived (lower(derived_state));
CREATE INDEX idx_mv_phlebos_derived_pincode        ON analytics.mv_phlebos_derived (derived_pincode);
CREATE INDEX idx_mv_phlebos_derived_orders         ON analytics.mv_phlebos_derived (orders_served DESC);
CREATE INDEX idx_mv_phlebos_derived_shared         ON analytics.mv_phlebos_derived (is_shared_phone);

ANALYZE analytics.mv_phlebos_derived;

-- ----------------------------------------------------------------------------
-- Merged view — manual rows take precedence on shared columns.
--
-- Match on (phone, name_key). A manual entry gets its own name_key computed
-- from the uploaded name. If the same phone has manual + derived variants,
-- each surfaces as its own row (correct: Ha Raghavendra and Harish S both
-- work through the Orange Health dispatch number but are different people).
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS atlas.phlebos_all CASCADE;

CREATE VIEW atlas.phlebos_all AS
SELECT
  COALESCE(m.phone, d.phone)                              AS phone,
  COALESCE(NULLIF(m.name, ''), d.name)                    AS name,
  COALESCE(NULLIF(m.city, ''), d.derived_city)            AS city,
  COALESCE(NULLIF(m.state, ''), d.derived_state)          AS state,
  COALESCE(NULLIF(m.pincode, ''), d.derived_pincode)      AS pincode,
  COALESCE(d.orders_served, 0)                            AS orders_served,
  d.active_days,
  d.avg_orders_per_day,
  d.lab_names                                             AS labs,
  d.first_order_at,
  d.last_order_at,
  COALESCE(d.is_shared_phone, false)                      AS is_shared_phone,
  COALESCE(d.variants_at_phone, 1)                        AS variants_at_phone,
  m.email,
  m.notes,
  m.uploaded_at,
  CASE
    WHEN m.phone IS NOT NULL AND d.phone IS NOT NULL THEN 'both'
    WHEN m.phone IS NOT NULL                         THEN 'manual'
    ELSE                                                  'derived'
  END                                                     AS source
FROM analytics.mv_phlebos_derived d
FULL OUTER JOIN atlas.phlebos_manual m
  ON m.phone = d.phone
 -- match manual to derived by phone only (manual is a canonical upload with
 -- one owner per phone; if it exists it overrides display for ALL variants
 -- of that phone — usually fine for genuine 1-phlebo-1-phone rows).
 AND lower(regexp_replace(TRIM(m.name), '\s+', ' ', 'g')) = d.name_key;

DO $$
DECLARE
  n_derived int; n_manual int; n_shared_orders bigint;
BEGIN
  SELECT COUNT(*) INTO n_derived FROM analytics.mv_phlebos_derived;
  SELECT COUNT(*) INTO n_manual  FROM atlas.phlebos_manual;
  SELECT COALESCE(SUM(orders_served), 0) INTO n_shared_orders
    FROM analytics.mv_phlebos_derived WHERE is_shared_phone;
  RAISE NOTICE 'mv_phlebos_derived: % (phone, name) pairs · phlebos_manual: % · orders on shared phones: %',
    n_derived, n_manual, n_shared_orders;
END $$;
