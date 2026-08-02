-- ============================================================================
-- analytics.mv_account_activity
--
-- Everything a B2B store has put through the platform, in one fact table:
-- one row per (store, month, stream, service_line).
--
-- Why a separate MV rather than extending mv_unified_demand: requests are
-- *enquiries*, not fulfilled demand. Folding them into the shared demand
-- stream would inflate the order counts on every network page — momentum,
-- imbalance, gaps, pincode demand all read from it. Accounts need the wider
-- picture; the network views must keep the narrower one.
--
-- Four streams:
--   LAB_ORDER      Order      — the only stream with money attached
--   PHARMA_ORDER   PharmaOrder
--   APPOINTMENT    Appointment — see the coverage caveat below
--   REQUEST        Request     — the enquiry funnel, absent from Atlas until now
--
-- APPOINTMENT caveat: Appointment carries no storeId. The only route to a
-- store is order_id → Order.storeId, and that column is unpopulated in the
-- database this was written against, so the stream will read zero until it
-- is. The join is correct when the data arrives; the UI reports coverage
-- rather than implying the absence means "no appointments".
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_account_activity CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_account_activity AS
WITH events AS (
  -- ---- Lab / camp orders -------------------------------------------------
  SELECT
    o."storeId"                                   AS store_id,
    DATE_TRUNC('month', o."createdAt")::date      AS month,
    'LAB_ORDER'                                   AS stream,
    CASE o."orderType"::text
      WHEN 'HOME_SAMPLE'  THEN 'LAB_HOME_SAMPLE'
      WHEN 'CENTER_VISIT' THEN 'LAB_CENTER_VISIT'
      WHEN 'CAMP'         THEN 'CAMP_ORDER'
      WHEN 'KIT_BASED'    THEN 'LAB_HOME_SAMPLE'
      ELSE 'OTHER'
    END                                           AS service_line,
    o."orderStatus"::text                         AS status,
    (o."orderStatus" IN ('REPORT_DELIVERED','SAMPLE_PROCESSED','SAMPLE_DELIVERED')) AS is_fulfilled,
    (o."orderStatus" = 'CANCELED')                AS is_canceled,
    o."userId"                                    AS user_id,
    o."labId"                                     AS partner_id,
    COALESCE(o."storePayment", 0)                 AS store_payment,
    COALESCE(o."storeCollection", 0)              AS store_collection,
    COALESCE(o."labPayment", 0)                   AS lab_payment
  FROM src_local."Order" o
  WHERE o."storeId" IS NOT NULL

  UNION ALL

  -- ---- Pharmacy orders ---------------------------------------------------
  SELECT
    po."storeId", DATE_TRUNC('month', po."createdAt")::date, 'PHARMA_ORDER',
    CASE po."orderType"::text WHEN 'HOME_DELIVERY' THEN 'PHARMACY_DELIVERY' ELSE 'OTHER' END,
    po."orderStatus"::text,
    (po."orderStatus" = 'FULL_DELIVERED'),
    (po."orderStatus" = 'CANCELLED'),
    po."userId", po."pharmacyId",
    0, 0, 0
  FROM src_local."PharmaOrder" po
  WHERE po."storeId" IS NOT NULL

  UNION ALL

  -- ---- Appointments, attributed through their order ----------------------
  SELECT
    o."storeId", DATE_TRUNC('month', a."createdAt")::date, 'APPOINTMENT',
    CASE
      WHEN pt."typeName" = 'Doctor' AND a."appointmentType"::text = 'CENTER_VISIT' THEN 'DOCTOR_CONSULT_CENTER'
      WHEN pt."typeName" = 'Doctor' AND a."appointmentType"::text = 'HOME_VISIT'   THEN 'DOCTOR_CONSULT_HOME'
      WHEN pt."typeName" = 'Doctor' AND a."appointmentType"::text = 'ONLINE'       THEN 'DOCTOR_CONSULT_ONLINE'
      WHEN pt."typeName" = 'Nurse'  AND a."appointmentType"::text = 'HOME_VISIT'   THEN 'NURSING_HOME_VISIT'
      WHEN pt."typeName" = 'Phlebotomist'                                          THEN 'LAB_HOME_SAMPLE'
      ELSE 'OTHER_APPOINTMENT'
    END,
    a."appointmentStatus"::text,
    (a."appointmentStatus" = 'COMPLETED'),
    (a."appointmentStatus" = 'CANCELED'),
    a.user_id, a."providerGroup_id",
    0, 0, 0
  FROM src_local."Appointment" a
  JOIN src_local."Order" o ON o.id = a.order_id
  LEFT JOIN src_local."ProviderType" pt ON pt.id = a."providerType_id"
  WHERE o."storeId" IS NOT NULL

  UNION ALL

  -- ---- Requests — enquiries, including the ones that never converted -----
  SELECT
    r."storeId", DATE_TRUNC('month', r."createdAt")::date, 'REQUEST',
    CASE r."orderType"::text
      WHEN 'HOME_SAMPLE'  THEN 'LAB_HOME_SAMPLE'
      WHEN 'CENTER_VISIT' THEN 'LAB_CENTER_VISIT'
      ELSE 'OTHER'
    END,
    r.status::text,
    -- "Fulfilled" for an enquiry means it became an order.
    (r."isConverted" OR r.status::text = 'ORDERED'),
    (r.status::text IN ('CANCELLED','DENIED')),
    NULL::int, NULL::int,
    0, 0, 0
  FROM src_local."Request" r
  WHERE r."storeId" IS NOT NULL
)
SELECT
  store_id,
  month,
  stream,
  service_line,
  COUNT(*)::int                                   AS events,
  COUNT(*) FILTER (WHERE is_fulfilled)::int       AS fulfilled,
  COUNT(*) FILTER (WHERE is_canceled)::int        AS canceled,
  COUNT(DISTINCT user_id)::int                    AS distinct_users,
  COUNT(DISTINCT partner_id)::int                 AS distinct_partners,
  ROUND(SUM(store_payment)::numeric, 2)           AS store_payment,
  ROUND(SUM(store_collection)::numeric, 2)        AS store_collection,
  ROUND(SUM(lab_payment)::numeric, 2)             AS lab_payment
FROM events
GROUP BY store_id, month, stream, service_line;

CREATE UNIQUE INDEX idx_mv_acct_act_key   ON analytics.mv_account_activity (store_id, month, stream, service_line);
CREATE INDEX        idx_mv_acct_act_store ON analytics.mv_account_activity (store_id);
CREATE INDEX        idx_mv_acct_act_month ON analytics.mv_account_activity (month DESC);

DO $$
DECLARE r record;
BEGIN
  RAISE NOTICE 'mv_account_activity by stream:';
  FOR r IN
    SELECT stream, SUM(events)::bigint AS events, COUNT(DISTINCT store_id)::int AS stores
    FROM analytics.mv_account_activity GROUP BY stream ORDER BY 2 DESC
  LOOP
    RAISE NOTICE '  % — % events across % stores', rpad(r.stream, 14), r.events, r.stores;
  END LOOP;
END $$;
