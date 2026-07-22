-- ============================================================================
-- analytics.mv_phlebos_derived
--   Every distinct phlebo (by normalized phone) who has EVER been assigned to
--   an order, with rolled-up activity + most-common location + labs served.
--
--   Also creates atlas.phlebos_all — the VIEW the app queries, which FULL
--   OUTER JOINs the derived MV with atlas.phlebos_manual (uploaded rows).
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_phlebos_derived CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_phlebos_derived AS
WITH cust_profile AS (
  -- One profile row per user (any valid pincode wins for the tiebreaker).
  SELECT DISTINCT ON ("profileUserId")
    "profileUserId", pincode, city, state
  FROM src_local."Profile"
  WHERE pincode ~ '^[0-9]{6}$'
  ORDER BY "profileUserId", pincode
),
phlebo_orders AS (
  SELECT
    regexp_replace(o."phleboNumber", '[^0-9]', '', 'g') AS phone,
    o."phleboName"                                       AS name_raw,
    o."labId",
    l."labName",
    o."createdAt",
    cp.pincode                                           AS customer_pincode,
    pc.city                                              AS customer_city_canon,
    pc.state                                             AS customer_state_canon
  FROM src_local."Order" o
  LEFT JOIN src_local."Lab" l              ON l.id = o."labId"
  LEFT JOIN cust_profile cp                ON cp."profileUserId" = o."userId"
  LEFT JOIN analytics.mv_pincode_city pc   ON pc.pincode = cp.pincode
  WHERE o."phleboNumber" IS NOT NULL
    AND o."phleboNumber" <> ''
)
SELECT
  phone,
  -- Most-common name for this phone; handles typos like "Ravi K" vs "Ravi Kumar"
  mode() WITHIN GROUP (ORDER BY name_raw)                 AS name,
  -- Most-common customer city/state/pincode this phlebo has served —
  -- a good proxy for where the phlebo operates
  mode() WITHIN GROUP (ORDER BY customer_city_canon)      AS derived_city,
  mode() WITHIN GROUP (ORDER BY customer_state_canon)     AS derived_state,
  mode() WITHIN GROUP (ORDER BY customer_pincode)         AS derived_pincode,
  COUNT(*)                                                AS orders_served,
  COUNT(DISTINCT "labId")                                 AS distinct_labs,
  ARRAY(
    SELECT DISTINCT "labName" FROM phlebo_orders po2
    WHERE po2.phone = po.phone AND "labName" IS NOT NULL
    ORDER BY "labName"
  )                                                       AS lab_names,
  MIN("createdAt")::date                                  AS first_order_at,
  MAX("createdAt")::date                                  AS last_order_at
FROM phlebo_orders po
GROUP BY phone;

CREATE UNIQUE INDEX idx_mv_phlebos_derived_phone ON analytics.mv_phlebos_derived (phone);
CREATE INDEX idx_mv_phlebos_derived_city         ON analytics.mv_phlebos_derived (lower(derived_city));
CREATE INDEX idx_mv_phlebos_derived_state        ON analytics.mv_phlebos_derived (lower(derived_state));
CREATE INDEX idx_mv_phlebos_derived_pincode      ON analytics.mv_phlebos_derived (derived_pincode);
CREATE INDEX idx_mv_phlebos_derived_orders       ON analytics.mv_phlebos_derived (orders_served DESC);

ANALYZE analytics.mv_phlebos_derived;

-- ----------------------------------------------------------------------------
-- The merged view: manual rows override derived rows on shared columns.
-- Downstream queries hit THIS, never the underlying tables.
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
  d.lab_names                                             AS labs,
  d.first_order_at,
  d.last_order_at,
  m.email,
  m.notes,
  m.uploaded_at,
  CASE
    WHEN m.phone IS NOT NULL AND d.phone IS NOT NULL THEN 'both'
    WHEN m.phone IS NOT NULL                         THEN 'manual'
    ELSE                                                  'derived'
  END                                                     AS source
FROM analytics.mv_phlebos_derived d
FULL OUTER JOIN atlas.phlebos_manual m ON m.phone = d.phone;

DO $$
DECLARE
  n_derived int; n_manual int; n_both int;
BEGIN
  SELECT COUNT(*) INTO n_derived FROM analytics.mv_phlebos_derived;
  SELECT COUNT(*) INTO n_manual  FROM atlas.phlebos_manual;
  SELECT COUNT(*) INTO n_both    FROM atlas.phlebos_all WHERE source = 'both';
  RAISE NOTICE 'mv_phlebos_derived: % phlebos · phlebos_manual: % · overlap: %',
    n_derived, n_manual, n_both;
END $$;
