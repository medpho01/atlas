-- ===========================================================================
-- 24_order_tracking.sql — the three queues an order passes through.
--
-- An order that has left the request queue is not finished. Three things can
-- still go quietly wrong, and each has its own deadline:
--
--   1. It sits on the placeholder lab and never gets a real one.        (T-1)
--   2. The lab does not collect the sample on the day.                  (T)
--   3. The report never comes back.                                     (T+48h)
--
-- Two and three are filtered to labs with barely any history, because that is
-- where they actually happen. Measured across the network: labs with under
-- five orders ever fail 41.2% of the time, labs with 5-19 fail 27.2%, and
-- labs with 20 or more fail 15.9%. A new lab is 2.6x more likely to drop an
-- order than an established one.
--
-- What is derived and what is stored
-- ----------------------------------
-- The WORK is derived: analytics.v_order_task reads the order data and says
-- what is due. Nobody files a task and nobody closes one — a row appears
-- because the data says it should and disappears when the data says it is
-- done. That is what keeps the queues from rotting.
--
-- The HUMAN part is stored, because no query can work it out: who a task is
-- assigned to, who assigned it, and what the lab said when somebody called.
--
-- Idempotent throughout. Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The threshold, as a setting rather than a 5 in the code.
-- ---------------------------------------------------------------------------
INSERT INTO atlas.request_settings (key, value, note)
VALUES (
  'followup_max_lifetime_orders', '5',
  'A lab with fewer than this many orders ever is followed up on pickup and '
  'report. Measured: under 5 fails 41.2% of the time, 5-19 fails 27.2%, '
  '20+ fails 15.9%.'
)
ON CONFLICT (key) DO NOTHING;


-- ---------------------------------------------------------------------------
-- atlas.sync_orders_live — see today, not last night.
--
-- Everything order-related reads src_local."Order", which refresh-data.sh
-- rebuilds once a night. That is fine for a report and useless for a queue: a
-- lab allocated this morning, a sample collected at 8am and a report delivered
-- at 2pm are all invisible until tomorrow, and two of the three queues below
-- are same-day questions.
--
-- So this tops up the snapshot from the live foreign table, bounded to the
-- appointments anybody is working on. The column list is built from the
-- intersection of the two tables rather than written out, because the source
-- adds and drops columns and a hard-coded list turns that into a nightly
-- failure. ON CONFLICT needs the unique index 22_src_local_indexes.sql puts
-- on id.
--
-- Never throws: the poller calls it every few minutes, and a source standby
-- that is briefly unreachable must not take the loop down with it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.sync_orders_live(
  days_back int DEFAULT 7, days_ahead int DEFAULT 21
)
RETURNS TABLE (seen int, inserted int, failed text)
LANGUAGE plpgsql AS $$
DECLARE
  cols text;
  sets text;
  n_seen int := 0;
  n_new  int := 0;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum),
         string_agg(
           CASE WHEN a.attname <> 'id'
                THEN quote_ident(a.attname) || ' = EXCLUDED.' || quote_ident(a.attname) END,
           ', ' ORDER BY a.attnum)
    INTO cols, sets
  FROM pg_attribute a
  WHERE a.attrelid = 'src_local."Order"'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND EXISTS (
      SELECT 1 FROM pg_attribute b
      WHERE b.attrelid = 'src."Order"'::regclass
        AND b.attname = a.attname AND b.attnum > 0 AND NOT b.attisdropped);

  IF cols IS NULL THEN
    RETURN QUERY SELECT 0, 0, 'no shared columns between src."Order" and the snapshot'::text;
    RETURN;
  END IF;

  EXECUTE format($f$
    WITH up AS (
      INSERT INTO src_local."Order" (%1$s)
      SELECT %1$s FROM src."Order"
       WHERE "appointmentTime" IS NOT NULL
         AND "appointmentTime" >= now() - make_interval(days => %3$s)
         AND "appointmentTime" <= now() + make_interval(days => %4$s)
      ON CONFLICT (id) DO UPDATE SET %2$s
      RETURNING (xmax = 0) AS is_new
    )
    SELECT count(*)::int, count(*) FILTER (WHERE is_new)::int FROM up
  $f$, cols, sets, days_back, days_ahead)
  INTO n_seen, n_new;

  RETURN QUERY SELECT n_seen, n_new, NULL::text;
EXCEPTION WHEN OTHERS THEN
  -- Reported, never raised. The caller logs it and carries on.
  RETURN QUERY SELECT 0, 0, left(SQLERRM, 300);
END $$;

COMMENT ON FUNCTION atlas.sync_orders_live(int, int) IS
  'Tops up src_local."Order" from the live source for appointments in the '
  'given window, so the order queues can see today. Never raises.';


-- ---------------------------------------------------------------------------
-- What a person did about a task.
--
-- Keyed on (order_id, kind) because that pair IS the task — there is no task
-- id to invent, and the derivation produces exactly one row per pair. A row
-- here is the human layer over a derived queue: delete every row and the
-- queues still work, they just stop saying who is on what.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.order_task (
  order_id     int  NOT NULL,
  kind         text NOT NULL,
  assignee_id  int  REFERENCES atlas.users(id) ON DELETE SET NULL,
  assigned_by  int  REFERENCES atlas.users(id) ON DELETE SET NULL,
  assigned_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_order_task_assignee ON atlas.order_task (assignee_id);

COMMENT ON TABLE atlas.order_task IS
  'Assignment for a derived order task. The task itself is not stored — see '
  'analytics.v_order_task.';

-- What the lab said. Kept after the task closes: "who chased this and what
-- came of it" is a question people ask a week later, and at a handful of
-- tasks a day the table stays small for years.
CREATE TABLE IF NOT EXISTS atlas.order_task_note (
  id         serial PRIMARY KEY,
  order_id   int  NOT NULL,
  kind       text NOT NULL,
  body       text NOT NULL,
  author_id  int  REFERENCES atlas.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_task_note_task
  ON atlas.order_task_note (order_id, kind, created_at DESC);


-- ---------------------------------------------------------------------------
-- analytics.v_order_task — the three queues, derived.
--
-- One row per open task. A task is open because the order data says so; it
-- leaves the view when the data says it is done:
--
--   needs_lab       closes when labId is no longer the placeholder
--   confirm_pickup  closes when the status reaches SAMPLE_COLLECTED or beyond
--   chase_report    closes when the status reaches REPORT_DELIVERED
--
-- Cancelled and patient-missed orders are not work and appear in none of them.
--
-- collected_at is "statusUpdatedAt" — the source records no separate
-- collection timestamp, and while an order is sitting at SAMPLE_COLLECTED
-- that is when it was collected. It stops meaning that the moment the status
-- moves on, which is also the moment the row leaves this view.
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced: the dates below are emitted as text, and
-- CREATE OR REPLACE VIEW cannot change a column's type.
DROP VIEW IF EXISTS analytics.v_order_task;
CREATE VIEW analytics.v_order_task AS
WITH cfg AS (
  SELECT atlas.request_setting('placeholder_lab_id')::int AS placeholder_lab,
         COALESCE(atlas.request_setting('followup_max_lifetime_orders')::int, 5) AS max_lifetime
),
base AS (
  SELECT
    o.id                                     AS order_id,
    (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')   AS appointment_at,
    (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS appointment_date,
    (o."statusUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')   AS status_at,
    o."orderStatus"::text                    AS order_status,
    o."orderType"::text                      AS order_type,
    o."labId"                                AS lab_id,
    l."labName"                              AS lab_name,
    l.city                                   AS lab_city,
    l.pincode                                AS lab_pincode,
    -- Kept apart: a phone number is a call and an email is not, and one
    -- column for both put a tel: link on an address.
    NULLIF(btrim(l."labCenterMobile"), '')  AS lab_phone,
    NULLIF(btrim(l."labCenterEmail"), '')   AS lab_email,
    o."storeId"                              AS store_id,
    s."storeName"                            AS store_name,
    r.id                                     AS request_id,
    r.pincode                                AS request_pincode,
    r.city                                   AS request_city,
    r.name                                   AS requester_name,
    r.mobile                                 AS requester_mobile,
    cm.quoted_price                          AS quoted_price,
    COALESCE(h.orders_all_time, 0)           AS lab_orders_all_time,
    COALESCE(h.delivered, 0)                 AS lab_delivered,
    COALESCE(h.failed, 0)                    AS lab_failed,
    (o."labId" = c.placeholder_lab OR o."labId" IS NULL) AS on_placeholder,
    c.max_lifetime
  FROM src_local."Order" o
  CROSS JOIN cfg c
  LEFT JOIN src_local."Lab"   l  ON l.id = o."labId"
  LEFT JOIN src_local."Store" s  ON s.id = o."storeId"
  LEFT JOIN src_local."Request" r ON r."convertedOrderId" = o.id
  LEFT JOIN atlas.commitment cm  ON cm.request_id = r.id
  LEFT JOIN analytics.v_lab_order_history h ON h.lab_id = o."labId"
  WHERE o."appointmentTime" IS NOT NULL
    AND o."orderStatus"::text NOT IN ('CANCELED', 'PATIENT_MISSED')
    -- Nothing older than a month is worked; it is history, and a queue that
    -- never empties is a queue nobody opens.
    AND o."appointmentTime" >= now() - interval '30 days'
),
tasks AS (
  -- 1 · No lab. Every unallocated order, whoever ends up serving it — this
  -- one is not filtered to new labs, because there is no lab yet.
  SELECT 'needs_lab'::text AS kind,
         b.*,
         (b.appointment_date - 1)                       AS due_date,
         (b.appointment_date - 1) < atlas.ist_today()   AS overdue
  FROM base b
  WHERE b.on_placeholder
    AND b.appointment_date >= atlas.ist_today()

  UNION ALL

  -- 2 · Pickup, on the day, at a lab with barely any history.
  SELECT 'confirm_pickup'::text,
         b.*,
         b.appointment_date                              AS due_date,
         false                                           AS overdue
  FROM base b
  WHERE NOT b.on_placeholder
    AND b.appointment_date = atlas.ist_today()
    AND b.lab_orders_all_time < b.max_lifetime
    AND b.order_status NOT IN ('SAMPLE_COLLECTED', 'SAMPLE_DELIVERED',
                               'SAMPLE_PROCESSED', 'REPORT_DELIVERED')

  UNION ALL

  -- 3 · Report, 48 hours after the sample was taken.
  SELECT 'chase_report'::text,
         b.*,
         (b.status_at + interval '48 hours')::date       AS due_date,
         (b.status_at + interval '48 hours') < (now() AT TIME ZONE 'Asia/Kolkata') AS overdue
  FROM base b
  WHERE NOT b.on_placeholder
    AND b.lab_orders_all_time < b.max_lifetime
    AND b.order_status IN ('SAMPLE_COLLECTED', 'SAMPLE_DELIVERED', 'SAMPLE_PROCESSED')
    AND b.status_at IS NOT NULL
)
SELECT
  t.kind,
  t.order_id,
  -- Dates and timestamps leave as text. node-postgres turns a date column
  -- into a JS Date, which survives to the browser as a Date and breaks every
  -- reader expecting the IST wall clock it was converted to. ISO text sorts
  -- the same, so nothing downstream loses its ordering.
  t.due_date::text                        AS due_date,
  t.overdue,
  (t.due_date - atlas.ist_today())        AS days_left,
  t.appointment_at::text                  AS appointment_at,
  t.appointment_date::text                AS appointment_date,
  t.status_at::text                       AS collected_at,
  t.order_status,
  t.order_type,
  t.lab_id, t.lab_name, t.lab_city, t.lab_pincode, t.lab_phone, t.lab_email,
  t.on_placeholder,
  t.lab_orders_all_time, t.lab_delivered, t.lab_failed,
  t.store_id, t.store_name,
  t.request_id, t.request_pincode, t.request_city,
  t.requester_name, t.requester_mobile,
  t.quoted_price,
  ot.assignee_id,
  u.name                                  AS assignee_name,
  ot.assigned_by,
  ab.name                                 AS assigned_by_name,
  (ot.assigned_at AT TIME ZONE 'Asia/Kolkata')::text AS assigned_at,
  (SELECT count(*)::int FROM atlas.order_task_note n
    WHERE n.order_id = t.order_id AND n.kind = t.kind) AS note_count
FROM tasks t
LEFT JOIN atlas.order_task ot ON ot.order_id = t.order_id AND ot.kind = t.kind
LEFT JOIN atlas.users u  ON u.id = ot.assignee_id
LEFT JOIN atlas.users ab ON ab.id = ot.assigned_by;

COMMENT ON VIEW analytics.v_order_task IS
  'One row per open order task: needs_lab, confirm_pickup, chase_report. '
  'Derived from order data — a row closes itself when the order moves on.';


-- ---------------------------------------------------------------------------
-- How many labs can reach an unallocated order's pincode.
--
-- Only the allocation queue asks this, and only for the rows on screen, so it
-- is a function rather than a column on the view above: computing it for every
-- task on every read would pay for coverage on the rows that already have a
-- lab.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.labs_in_range(p_pincode text)
RETURNS TABLE (labs int, nearest_km numeric)
LANGUAGE sql STABLE AS $$
  SELECT count(DISTINCT lph.lab_id)::int, NULL::numeric
  FROM analytics.mv_lab_pincode_home lph
  WHERE lph.pincode = p_pincode
$$;
