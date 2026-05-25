-- ============================================================================
-- Unified demand model
-- Combines Order + Appointment + PharmaOrder into one shape, tagged by service line.
-- Service lines:
--   LAB_HOME_SAMPLE         — diagnostic sample collected at home (Order.HOME_SAMPLE + KIT_BASED)
--   LAB_CENTER_VISIT        — walk-in to lab/collection center (Order.CENTER_VISIT)
--   CAMP_ORDER              — order generated at a camp event (Order.CAMP)
--   DOCTOR_CONSULT_CENTER   — in-clinic doctor visit (Appointment.CENTER_VISIT + Doctor)
--   DOCTOR_CONSULT_HOME     — doctor home visit (Appointment.HOME_VISIT + Doctor)
--   DOCTOR_CONSULT_ONLINE   — teleconsult (Appointment.ONLINE + Doctor)
--   NURSING_HOME_VISIT      — injections/IV/post-op (Appointment.HOME_VISIT + Nurse)
--   PHARMACY_DELIVERY       — medicine home delivery (PharmaOrder.HOME_DELIVERY)
--   OTHER_APPOINTMENT       — anything else (Health Coach, etc.)
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS mv_unified_demand CASCADE;

CREATE MATERIALIZED VIEW mv_unified_demand AS
-- Lab / camp orders
SELECT
  ('ORD-' || o.id) AS event_id,
  'Order' AS source_table,
  o.id AS source_id,
  CASE o."orderType"::text
    WHEN 'HOME_SAMPLE' THEN 'LAB_HOME_SAMPLE'
    WHEN 'CENTER_VISIT' THEN 'LAB_CENTER_VISIT'
    WHEN 'CAMP' THEN 'CAMP_ORDER'
    WHEN 'KIT_BASED' THEN 'LAB_HOME_SAMPLE'
    ELSE 'OTHER'
  END AS service_line,
  o."createdAt" AS created_at,
  o."orderStatus"::text AS status,
  (o."orderStatus" IN ('REPORT_DELIVERED', 'SAMPLE_PROCESSED', 'SAMPLE_DELIVERED')) AS is_fulfilled,
  (o."orderStatus" = 'CANCELED') AS is_canceled,
  o."storeId" AS store_id,
  o."labId" AS partner_id,
  'LAB'::text AS partner_kind,
  o."userId" AS user_id,
  p.pincode
FROM "Order" o
JOIN "User" u ON u.id = o."userId"
JOIN "Profile" p ON p."profileUserId" = u.id
WHERE p.pincode IS NOT NULL AND p.pincode <> ''

UNION ALL

-- Appointments → Doctor / Nursing
SELECT
  ('APT-' || a.id) AS event_id,
  'Appointment' AS source_table,
  a.id AS source_id,
  CASE
    WHEN pt."typeName" = 'Doctor' AND a."appointmentType"::text = 'CENTER_VISIT' THEN 'DOCTOR_CONSULT_CENTER'
    WHEN pt."typeName" = 'Doctor' AND a."appointmentType"::text = 'HOME_VISIT' THEN 'DOCTOR_CONSULT_HOME'
    WHEN pt."typeName" = 'Doctor' AND a."appointmentType"::text = 'ONLINE' THEN 'DOCTOR_CONSULT_ONLINE'
    WHEN pt."typeName" = 'Nurse' AND a."appointmentType"::text = 'HOME_VISIT' THEN 'NURSING_HOME_VISIT'
    WHEN pt."typeName" = 'Phlebotomist' THEN 'LAB_HOME_SAMPLE'  -- merge phlebo appts into lab home sample stream
    ELSE 'OTHER_APPOINTMENT'
  END AS service_line,
  a."createdAt" AS created_at,
  a."appointmentStatus"::text AS status,
  (a."appointmentStatus" = 'COMPLETED') AS is_fulfilled,
  (a."appointmentStatus" = 'CANCELED') AS is_canceled,
  NULL::int AS store_id,
  a."providerGroup_id" AS partner_id,
  CASE pt."typeName"
    WHEN 'Doctor' THEN 'DOCTOR'
    WHEN 'Nurse' THEN 'NURSE'
    WHEN 'Phlebotomist' THEN 'PHLEBO'
    ELSE 'OTHER'
  END AS partner_kind,
  a.user_id,
  p.pincode
FROM "Appointment" a
LEFT JOIN "ProviderType" pt ON pt.id = a."providerType_id"
JOIN "User" u ON u.id = a.user_id
JOIN "Profile" p ON p."profileUserId" = u.id
WHERE p.pincode IS NOT NULL AND p.pincode <> ''

UNION ALL

-- Pharmacy orders
SELECT
  ('PHO-' || po.id) AS event_id,
  'PharmaOrder' AS source_table,
  po.id AS source_id,
  CASE po."orderType"::text
    WHEN 'HOME_DELIVERY' THEN 'PHARMACY_DELIVERY'
    ELSE 'OTHER'
  END AS service_line,
  po."createdAt" AS created_at,
  po."orderStatus"::text AS status,
  (po."orderStatus" = 'FULL_DELIVERED') AS is_fulfilled,
  (po."orderStatus" = 'CANCELLED') AS is_canceled,
  po."storeId" AS store_id,
  po."pharmacyId" AS partner_id,
  'PHARMACY'::text AS partner_kind,
  po."userId" AS user_id,
  p.pincode
FROM "PharmaOrder" po
JOIN "User" u ON u.id = po."userId"
JOIN "Profile" p ON p."profileUserId" = u.id
WHERE p.pincode IS NOT NULL AND p.pincode <> '';

-- Index names prefixed with idx_mv_unified_demand_* so they don't collide
-- with the older mv_pincode_demand indexes defined in materialized_views.sql.
CREATE UNIQUE INDEX idx_mv_unified_demand_event   ON mv_unified_demand(event_id);
CREATE INDEX        idx_mv_unified_demand_pin     ON mv_unified_demand(pincode);
CREATE INDEX        idx_mv_unified_demand_service ON mv_unified_demand(service_line);
CREATE INDEX        idx_mv_unified_demand_created ON mv_unified_demand(created_at);
CREATE INDEX        idx_mv_unified_demand_sp_ts   ON mv_unified_demand(service_line, pincode, created_at);
CREATE INDEX        idx_mv_unified_demand_user    ON mv_unified_demand(user_id);

-- ----------------------------------------------------------------------------
-- mv_service_line_momentum
-- Per (service_line, pincode, weekly bucket) for last 26 weeks.
-- Used by the momentum dashboard and demand-supply imbalance watchlist.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_service_line_momentum CASCADE;

CREATE MATERIALIZED VIEW mv_service_line_momentum AS
SELECT
  service_line,
  pincode,
  DATE_TRUNC('week', created_at)::date AS week_start,
  COUNT(*)::int AS events,
  COUNT(*) FILTER (WHERE is_fulfilled)::int AS fulfilled,
  COUNT(*) FILTER (WHERE is_canceled)::int AS canceled
FROM mv_unified_demand
WHERE created_at >= NOW() - INTERVAL '26 weeks'
GROUP BY service_line, pincode, DATE_TRUNC('week', created_at);

CREATE INDEX idx_mv_momentum_service ON mv_service_line_momentum(service_line);
CREATE INDEX idx_mv_momentum_pin ON mv_service_line_momentum(pincode);
CREATE INDEX idx_mv_momentum_week ON mv_service_line_momentum(week_start);
CREATE INDEX idx_mv_momentum_compound ON mv_service_line_momentum(service_line, pincode, week_start);

-- ----------------------------------------------------------------------------
-- mv_service_line_city
-- City-level rollup of momentum data with last-N-day windows + WoW deltas.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS mv_service_line_city CASCADE;

CREATE MATERIALIZED VIEW mv_service_line_city AS
WITH anchor AS (
  -- Reference date = latest order in source. Allows the dashboard to behave correctly
  -- when demo/snapshot data is older than today.
  SELECT MAX(week_start) AS ref_date FROM mv_service_line_momentum
),
city_demand AS (
  SELECT pc.city, m.service_line, m.week_start, m.events, m.fulfilled, m.canceled
  FROM mv_service_line_momentum m
  JOIN mv_pincode_city pc ON pc.pincode = m.pincode
)
SELECT
  cd.city,
  cd.service_line,
  SUM(cd.events) FILTER (WHERE cd.week_start >= (a.ref_date - INTERVAL '7 days'))::int AS events_w0,
  SUM(cd.events) FILTER (WHERE cd.week_start >= (a.ref_date - INTERVAL '14 days')
                          AND cd.week_start < (a.ref_date - INTERVAL '7 days'))::int AS events_w1,
  SUM(cd.events) FILTER (WHERE cd.week_start >= (a.ref_date - INTERVAL '30 days'))::int AS events_l30d,
  SUM(cd.events) FILTER (WHERE cd.week_start >= (a.ref_date - INTERVAL '60 days')
                          AND cd.week_start < (a.ref_date - INTERVAL '30 days'))::int AS events_l30d_prior,
  SUM(cd.events) FILTER (WHERE cd.week_start >= (a.ref_date - INTERVAL '90 days'))::int AS events_l90d,
  SUM(cd.events)::int AS events_l180d
FROM city_demand cd CROSS JOIN anchor a
GROUP BY cd.city, cd.service_line;

CREATE INDEX idx_mv_slc_city ON mv_service_line_city(city);
CREATE INDEX idx_mv_slc_service ON mv_service_line_city(service_line);
