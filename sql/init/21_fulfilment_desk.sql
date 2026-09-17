-- ============================================================================
-- 21_fulfilment_desk.sql — the day a promise comes due.
--
-- A request is quoted with a date, becomes an order, and parks on the
-- placeholder lab until somebody secures supply. Two deadlines follow from
-- that, and Atlas could see neither:
--
--   1. Between the promise and the appointment, a lab has to be found and
--      onboarded. The appointment date is the deadline, and nothing showed
--      that clock.
--   2. On the day, the order has to actually be fulfilled. The orders most
--      likely not to be are the ones with a lab that has never done one —
--      and of the 98 labs that have ever taken an order, 41 have taken
--      exactly one. Nearly half of every relationship ends at the first.
--
-- Both need memory. src_local is truncated and rebuilt nightly, so an
-- appointment that moved leaves no trace: yesterday's date is simply gone.
-- atlas.order_watch is that memory, in the same shape and for the same reason
-- as atlas.commitment — LabStack records the change as a new value, never as
-- an event, so Atlas has to notice by comparing.
--
-- sql/init/ runs ONCE, on a database's first boot. Everything here is
-- idempotent so an existing host can apply it by hand and run it twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- atlas.order_watch — what we last saw, so we can tell what changed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.order_watch (
  order_id            int PRIMARY KEY,
  -- The current values, as of the last sync.
  appointment_time    timestamptz,
  lab_id              int,
  order_status        text,
  -- What they were before the most recent change, and when it happened.
  prev_appointment_time timestamptz,
  prev_lab_id         int,
  moved_at            timestamptz,
  -- How many times each has changed since we started watching. A promise that
  -- has slipped three times is a different conversation from one booked
  -- yesterday, and only the count says which.
  appointment_moves   int NOT NULL DEFAULT 0,
  lab_moves           int NOT NULL DEFAULT 0,
  first_seen          timestamptz NOT NULL DEFAULT now(),
  last_seen           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_watch_appt ON atlas.order_watch (appointment_time);
CREATE INDEX IF NOT EXISTS idx_order_watch_moved ON atlas.order_watch (moved_at DESC)
  WHERE appointment_moves > 0;

-- ---------------------------------------------------------------------------
-- atlas.sync_order_watch — notice what moved since last time
--
-- Runs after the snapshot, beside sync_commitments. Bounded to orders with an
-- appointment in the last 180 days or in the future: the desk never looks
-- further back than that, and watching all 46k rows to serve a fortnight's
-- questions is work nobody reads.
--
-- The first run records everything and reports no moves, which is correct —
-- an order seen once has not moved. Moves accumulate from the second run on.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.sync_order_watch()
RETURNS TABLE (watched int, appointment_moved int, lab_moved int)
LANGUAGE plpgsql AS $$
DECLARE w int; am int; lm int;
BEGIN
  CREATE TEMP TABLE _live ON COMMIT DROP AS
  SELECT o.id AS order_id,
         (o."appointmentTime" AT TIME ZONE 'UTC') AS appointment_time,
         o."labId"            AS lab_id,
         o."orderStatus"::text AS order_status
  FROM src_local."Order" o
  WHERE o."appointmentTime" IS NOT NULL
    AND o."appointmentTime" >= now() - interval '180 days';

  -- Count the changes before writing them, so the report is about this run.
  SELECT count(*) FILTER (WHERE l.appointment_time IS DISTINCT FROM ow.appointment_time),
         count(*) FILTER (WHERE l.lab_id IS DISTINCT FROM ow.lab_id)
    INTO am, lm
  FROM _live l JOIN atlas.order_watch ow ON ow.order_id = l.order_id;

  INSERT INTO atlas.order_watch AS ow
    (order_id, appointment_time, lab_id, order_status, last_seen)
  SELECT order_id, appointment_time, lab_id, order_status, now() FROM _live
  ON CONFLICT (order_id) DO UPDATE SET
    -- Keep the old value only when it actually changed; otherwise the
    -- "previously" on the card would rewrite itself every night with the same
    -- date and nothing would ever look stable.
    prev_appointment_time = CASE
      WHEN EXCLUDED.appointment_time IS DISTINCT FROM ow.appointment_time
      THEN ow.appointment_time ELSE ow.prev_appointment_time END,
    prev_lab_id = CASE
      WHEN EXCLUDED.lab_id IS DISTINCT FROM ow.lab_id
      THEN ow.lab_id ELSE ow.prev_lab_id END,
    moved_at = CASE
      WHEN EXCLUDED.appointment_time IS DISTINCT FROM ow.appointment_time
        OR EXCLUDED.lab_id IS DISTINCT FROM ow.lab_id
      THEN now() ELSE ow.moved_at END,
    appointment_moves = ow.appointment_moves +
      CASE WHEN EXCLUDED.appointment_time IS DISTINCT FROM ow.appointment_time THEN 1 ELSE 0 END,
    lab_moves = ow.lab_moves +
      CASE WHEN EXCLUDED.lab_id IS DISTINCT FROM ow.lab_id THEN 1 ELSE 0 END,
    appointment_time = EXCLUDED.appointment_time,
    lab_id           = EXCLUDED.lab_id,
    order_status     = EXCLUDED.order_status,
    last_seen        = now();
  GET DIAGNOSTICS w = ROW_COUNT;

  RETURN QUERY SELECT w, COALESCE(am, 0), COALESCE(lm, 0);
END $$;

COMMENT ON FUNCTION atlas.sync_order_watch() IS
  'Records each live order''s appointment, lab and status, and counts what changed since last run.';

-- ---------------------------------------------------------------------------
-- analytics.v_lab_order_history — how much of a relationship there is
--
-- "First order" is the flag the desk needs, but it is not the whole question.
-- A lab whose only previous order was cancelled is not a lab with a track
-- record, and a lab that last saw an order nine months ago is barely warmer
-- than a new one. All three read off the same rollup.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_lab_order_history AS
SELECT o."labId"                                   AS lab_id,
       count(*)::int                               AS orders_all_time,
       count(*) FILTER (WHERE o."orderStatus"::text = 'REPORT_DELIVERED')::int AS delivered,
       count(*) FILTER (WHERE o."orderStatus"::text IN ('CANCELED','PATIENT_MISSED'))::int AS failed,
       min(o."appointmentTime")                    AS first_appointment,
       max(o."appointmentTime")                    AS last_appointment
FROM src_local."Order" o
WHERE o."labId" IS NOT NULL
GROUP BY o."labId";

-- ---------------------------------------------------------------------------
-- analytics.v_fulfilment_day — one row per appointment, with its history
--
-- The desk reads a day out of this. Everything it needs to decide what to do
-- is on the row: who the lab is, whether this is the first time we have asked
-- them for anything, whether the date has moved, and whether a request is
-- behind it.
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced: column types have changed once already, and
-- CREATE OR REPLACE VIEW cannot do that.
DROP VIEW IF EXISTS analytics.v_fulfilment_day;
CREATE VIEW analytics.v_fulfilment_day AS
SELECT
  o.id                                    AS order_id,
  -- The snapshot stores naive UTC. The desk is an Indian desk: a 6am
  -- collection belongs to that morning, not to the previous day's UTC date,
  -- so both the clock and the day are turned into IST here, once.
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')        AS appointment_time,
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date  AS appointment_date,
  o."orderStatus"::text                   AS order_status,
  o."orderType"::text                     AS order_type,
  o."createdAt"                           AS order_created_at,
  o."labId"                               AS lab_id,
  l."labName"                             AS lab_name,
  l.city                                  AS lab_city,
  o."storeId"                             AS store_id,
  s."storeName"                           AS store_name,
  -- The request behind it, where there is one.
  r.id                                    AS request_id,
  r.pincode                               AS request_pincode,
  r.city                                  AS request_city,
  r.name                                  AS requester_name,
  r.mobile                                AS requester_mobile,
  cm.id                                   AS commitment_id,
  cm.promised_date                        AS promised_date,
  cm.quoted_price                         AS quoted_price,
  -- Is this the first time this lab has been asked for anything?
  (h.first_appointment = o."appointmentTime")        AS is_first_order,
  h.orders_all_time                       AS lab_orders_all_time,
  h.delivered                             AS lab_delivered,
  h.failed                                AS lab_failed,
  h.first_appointment                     AS lab_first_appointment,
  -- Has this appointment moved since Atlas started watching?
  COALESCE(ow.appointment_moves, 0)       AS appointment_moves,
  (ow.prev_appointment_time AT TIME ZONE 'Asia/Kolkata')  AS prev_appointment_time,
  COALESCE(ow.lab_moves, 0)               AS lab_moves,
  ow.prev_lab_id                          AS prev_lab_id,
  (ow.moved_at AT TIME ZONE 'Asia/Kolkata')               AS moved_at,
  (o."labId" = atlas.request_setting('placeholder_lab_id')::int) AS on_placeholder
FROM src_local."Order" o
LEFT JOIN src_local."Lab"   l  ON l.id = o."labId"
LEFT JOIN src_local."Store" s  ON s.id = o."storeId"
LEFT JOIN src_local."Request" r ON r."convertedOrderId" = o.id
LEFT JOIN atlas.commitment cm  ON cm.order_id = o.id
LEFT JOIN analytics.v_lab_order_history h ON h.lab_id = o."labId"
LEFT JOIN atlas.order_watch ow ON ow.order_id = o.id
WHERE o."appointmentTime" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Fold it into the poller, so one call still does everything.
-- ---------------------------------------------------------------------------
-- The signature grows, and Postgres will not replace a function whose OUT
-- parameters changed. Dropping first is safe: nothing holds a reference to it
-- but the poller, which calls it by name.
DROP FUNCTION IF EXISTS atlas.sync_commitments_full();
CREATE OR REPLACE FUNCTION atlas.sync_commitments_full()
RETURNS TABLE (opened int, closed int, expired int, crm_created int,
               watched int, appointment_moved int)
LANGUAGE plpgsql AS $$
DECLARE r record; c int; ow record;
BEGIN
  SELECT * INTO r FROM atlas.sync_commitments();
  SELECT atlas.close_commitment_to_crm() INTO c;
  SELECT * INTO ow FROM atlas.sync_order_watch();
  RETURN QUERY SELECT r.opened, r.closed, r.expired, c, ow.watched, ow.appointment_moved;
END $$;
