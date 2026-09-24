-- ===========================================================================
-- 28_store_orders.sql — the store's own book of orders.
--
-- Order tracking (24, 25) answers "what needs a person today", and it answers
-- it for orders a request turned into, because that is the work this team was
-- given. It cannot answer the question a partner asks on a call: what is
-- happening to OUR orders. Those are different populations — a store's direct
-- orders never went through a request — and different shapes: one is a queue
-- that should empty, the other is a ledger that never does.
--
-- So this is the ledger. Every order, grouped by the store it came from and
-- the stage it is in, with no window and no task filter.
--
-- What Atlas owns and what it does not
-- ------------------------------------
-- "Store" and "Order" are LabStack's, reached through the read-only FDW and
-- mirrored into src_local. Atlas has never written a row there and does not
-- start here. Creating a store, editing its address or moving an appointment
-- are console operations.
--
-- What Atlas owns is the layer beside them, which is what the three tables at
-- the bottom of this file are: who on our side runs the account, when a store
-- is quiet enough to be worth an alert, which orders somebody has decided need
-- moving, and a log of who changed what. That is the same division 16 and 24
-- already drew — atlas.commitment beside "Request", atlas.order_task beside
-- "Order" — and keeping it means a partner's record can never be damaged from
-- a dashboard.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- atlas.order_stage — thirteen statuses, six stages.
--
-- "OrderStatus" has thirteen values and nobody groups orders by thirteen
-- things. Five of them mean "the sample is somewhere between the patient and
-- a result", and a partner asking about their book wants those as one line,
-- not five. The mapping lives here rather than in the app so the API, the CSV
-- and the screen cannot each invent their own.
--
-- Deliberately total: an unmapped status returns 'pending' rather than NULL,
-- so a new value added to the enum in LabStack surfaces as work to look at
-- instead of disappearing from every count on the page.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.order_stage(status text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE status
    WHEN 'PENDING'          THEN 'pending'
    WHEN 'CREATED'          THEN 'pending'
    WHEN 'ORDER_SCHEDULED'  THEN 'scheduled'
    WHEN 'PHLEBO_ASSIGNED'  THEN 'scheduled'
    WHEN 'KIT_DISPATCHED'   THEN 'scheduled'
    WHEN 'RESCHEDULED'      THEN 'rescheduled'
    WHEN 'SAMPLE_COLLECTED' THEN 'in_progress'
    WHEN 'SAMPLE_DELIVERED' THEN 'in_progress'
    WHEN 'SAMPLE_PROCESSED' THEN 'in_progress'
    WHEN 'PATIENT_VISITED'  THEN 'in_progress'
    WHEN 'REPORT_DELIVERED' THEN 'completed'
    WHEN 'CANCELED'         THEN 'cancelled'
    WHEN 'PATIENT_MISSED'   THEN 'cancelled'
    ELSE 'pending'
  END
$$;

COMMENT ON FUNCTION atlas.order_stage(text) IS
  'OrderStatus to one of six stages: pending, scheduled, rescheduled, '
  'in_progress, completed, cancelled. Total — an unknown status reads pending '
  'so a new enum value shows up as work rather than vanishing from the counts.';


-- ---------------------------------------------------------------------------
-- atlas.store_profile — the part of a store Atlas is allowed to own.
--
-- Not a copy of the store. Everything here is about how WE work the account:
-- who runs it, who to ring when an order stalls, and the two numbers that
-- decide when this store is worth interrupting somebody about. A store with
-- no row behaves on the defaults, so a new partner works without being set up
-- first.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.store_profile (
  store_id           int  PRIMARY KEY,
  /** Who on our side runs this account. */
  ops_owner_id       int  REFERENCES atlas.users(id) ON DELETE SET NULL,
  /** Who to ring at the partner. Their console record often has no usable one. */
  ops_contact_name   text,
  ops_contact_phone  text,
  ops_contact_email  text,
  /** Anything about serving this partner that the console cannot hold. */
  coverage_note      text,
  /**
   * Hours past the appointment before an unfinished order counts as delayed.
   * Per store because a corporate camp settles in a day and a home collection
   * in a small town does not, and one global number made both wrong.
   */
  delay_alert_hours  int  NOT NULL DEFAULT 48
                     CHECK (delay_alert_hours BETWEEN 1 AND 720),
  /** How many unscheduled orders may pile up before the store is flagged. */
  pending_alert_count int NOT NULL DEFAULT 5
                     CHECK (pending_alert_count BETWEEN 1 AND 10000),
  updated_by         int  REFERENCES atlas.users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE atlas.store_profile IS
  'Atlas-side overlay on a LabStack store: who runs the account and when it is '
  'worth an alert. Never the store record itself — that is the console''s.';

-- Defaults, in one place, so a store with no row and a store with a row that
-- happens to match cannot be read differently.
--
-- IMMUTABLE and constant, which means the planner folds them at plan time and
-- they cost nothing per row. They exist as functions rather than as literals
-- so the number lives in exactly one place: analytics.v_store_order needs the
-- same default through a join, and a second copy of "48" in a view definition
-- is a number that drifts.
CREATE OR REPLACE FUNCTION atlas.store_delay_hours_default()
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 48 $$;

CREATE OR REPLACE FUNCTION atlas.store_pending_limit_default()
RETURNS int LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT 5 $$;

-- The per-store lookups. Fine where they are called once — the store detail
-- page, a single row — and deliberately NOT used inside analytics.v_store_order.
--
-- They read a table, so they are STABLE, so Postgres evaluates them once per
-- row rather than folding them. In the row view that is one extra buffer per
-- order: measured at 22,788 rows in a ninety-day window, it was 17,796 of the
-- 45,602 buffers the store list touched, and it grows with the book. The view
-- joins atlas.store_profile once instead.
CREATE OR REPLACE FUNCTION atlas.store_delay_hours(sid int)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT delay_alert_hours FROM atlas.store_profile WHERE store_id = sid),
                  atlas.store_delay_hours_default())
$$;

CREATE OR REPLACE FUNCTION atlas.store_pending_limit(sid int)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT pending_alert_count FROM atlas.store_profile WHERE store_id = sid),
                  atlas.store_pending_limit_default())
$$;


-- ---------------------------------------------------------------------------
-- atlas.store_change_log — who changed what about a store, and when.
--
-- Separate from atlas.audit_log, which records that a path was visited. That
-- answers "was this seen"; this answers "who turned this partner off on the
-- fourteenth", which is the question actually asked afterwards, and it needs
-- the store id and the before/after that a path string cannot carry.
--
-- Append-only by intent: nothing in the app updates or deletes a row.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.store_change_log (
  id         bigserial   PRIMARY KEY,
  store_id   int         NOT NULL,
  /** Machine-readable: profile_updated, tracked_on, tracked_off, orders_flagged, flags_cleared. */
  action     text        NOT NULL,
  /** The same thing as a sentence, so the log reads without a decoder. */
  summary    text        NOT NULL,
  /** Before and after, for the fields that changed. */
  detail     jsonb,
  actor_id   int         REFERENCES atlas.users(id) ON DELETE SET NULL,
  ts         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_change_store_ts ON atlas.store_change_log (store_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_store_change_ts       ON atlas.store_change_log (ts DESC);

COMMENT ON TABLE atlas.store_change_log IS
  'Append-only record of Atlas-side store changes, with the before/after. '
  'atlas.audit_log says a page was opened; this says what somebody did.';


-- ---------------------------------------------------------------------------
-- atlas.order_reschedule_flag — orders somebody has decided need moving.
--
-- Atlas cannot move an appointment: "Order"."appointmentTime" is LabStack's
-- and the replica is read-only. What it can do is let one person go through a
-- store's stalled orders once, mark the ones that need a new date with the
-- reason, and hand the console operator a list — instead of that decision
-- living in a chat message and being made again tomorrow.
--
-- The flag is the intent, not the outcome. It clears when somebody says the
-- move happened, or on its own when the order leaves the stage that made it
-- stall (see analytics.v_store_order.reschedule_stale).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.order_reschedule_flag (
  order_id    int  PRIMARY KEY,
  /** Denormalised so the store page can count flags without touching Order. */
  store_id    int  NOT NULL,
  reason      text,
  flagged_by  int  REFERENCES atlas.users(id) ON DELETE SET NULL,
  flagged_at  timestamptz NOT NULL DEFAULT now(),
  cleared_at  timestamptz,
  cleared_by  int  REFERENCES atlas.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_resched_store_open
  ON atlas.order_reschedule_flag (store_id) WHERE cleared_at IS NULL;

COMMENT ON TABLE atlas.order_reschedule_flag IS
  'Orders marked as needing a new appointment. A record of the decision only — '
  'Atlas does not write appointments; the console does.';


-- ---------------------------------------------------------------------------
-- analytics.v_store_order — one row per order, from the store's point of view.
--
-- No window, no status filter, every order including cancelled ones: a partner
-- asking why something was cancelled in March is exactly the call this exists
-- for, and a ledger that hides its own failures is not a ledger.
--
-- Patient identity is deliberately thin — a name and the serving city. The
-- phone number is not selected. This screen is for judging whether a store's
-- book is healthy, which needs a row to be identifiable, not contactable; the
-- number lives in the console behind its own access rules and there is no
-- reason to copy it into a dashboard several teams can open.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS analytics.v_store_order;

CREATE VIEW analytics.v_store_order AS
SELECT
  o.id                                      AS order_id,
  o."storeId"                               AS store_id,
  o."orderStatus"::text                     AS order_status,
  atlas.order_stage(o."orderStatus"::text)  AS stage,
  o."orderType"::text                       AS order_type,
  o."referenceId"                           AS reference_id,

  -- Timestamps, all in IST. The page prints them and the analytics count from
  -- them, so converting once here stops the two disagreeing by five and a half
  -- hours — which is a whole working day's worth of "is this late".
  (o."createdAt"       AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')       AS created_at,
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')       AS appointment_at,
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS appointment_date,
  (o."statusUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')       AS status_at,
  (o."updatedAt"       AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')       AS updated_at,
  (o."assignedAt"      AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')       AS assigned_at,

  -- Who is collecting. NULLIF because the console writes '' as often as NULL,
  -- and "assigned to nobody" and "assigned to the empty string" are the same
  -- fact that should render the same way.
  NULLIF(btrim(o."phleboName"), '')   AS phlebo_name,
  NULLIF(btrim(o."phleboNumber"), '') AS phlebo_number,
  NULLIF(btrim(o."assignedBy"), '')   AS assigned_by,

  o."labId"                           AS lab_id,
  l."labName"                         AS lab_name,
  l.city                              AS lab_city,

  -- The patient, as thinly as the screen can work with.
  o."userId"                          AS patient_user_id,
  COALESCE(NULLIF(btrim(p.name), ''), NULLIF(btrim(u.name), '')) AS patient_name,
  p.city                              AS patient_city,
  p.pincode                           AS patient_pincode,

  o."requestId"                       AS request_id,
  r.id                                AS converted_request_id,
  NULLIF(btrim(o."cancelReason"), '') AS cancel_reason,

  -- Turnaround: booked to report delivered, in hours. Only ever filled for a
  -- completed order — on anything else statusUpdatedAt is the last change,
  -- not the finish, and averaging that in would quietly report a number that
  -- means nothing. Better a smaller denominator than a wrong average.
  CASE WHEN atlas.order_stage(o."orderStatus"::text) = 'completed'
            AND o."createdAt" IS NOT NULL
       THEN EXTRACT(EPOCH FROM (
              COALESCE(o."statusUpdatedAt", o."updatedAt") - o."createdAt")) / 3600.0
  END                                 AS turnaround_hours,

  -- Delayed: past its appointment, still unfinished, and past this store's
  -- own patience. Cancelled is not delayed — it is closed, badly, and counted
  -- in the cancellation rate instead.
  -- The threshold comes from the joined profile row, not from
  -- atlas.store_delay_hours() — see the note on that function. Same number,
  -- same default, one hash join instead of one subquery per order.
  (atlas.order_stage(o."orderStatus"::text) NOT IN ('completed', 'cancelled')
    AND o."appointmentTime" IS NOT NULL
    AND o."appointmentTime" < now()
        - (COALESCE(sp.delay_alert_hours, atlas.store_delay_hours_default())
           || ' hours')::interval
  )                                   AS delayed,

  -- Hours past the appointment, for sorting the worst first. Negative for an
  -- appointment still ahead, which is what lets one ORDER BY serve both
  -- "most overdue" and "soonest".
  CASE WHEN o."appointmentTime" IS NOT NULL
       THEN EXTRACT(EPOCH FROM (now() - o."appointmentTime")) / 3600.0
  END                                 AS hours_since_appointment,

  f.order_id IS NOT NULL              AS flagged_for_reschedule,
  f.reason                            AS reschedule_reason,
  f.flagged_at,
  fu.name                             AS flagged_by_name,
  -- A flag that the order has outrun. Somebody marked it for a new date and
  -- it has since been given one, or closed; the flag is now noise and the
  -- page offers to clear it rather than showing stale work.
  (f.order_id IS NOT NULL
    AND atlas.order_stage(o."orderStatus"::text) IN ('completed', 'cancelled', 'rescheduled')
  )                                   AS reschedule_stale

FROM src_local."Order" o
LEFT JOIN atlas.store_profile sp ON sp.store_id = o."storeId"
LEFT JOIN src_local."Lab"     l  ON l.id = o."labId"
LEFT JOIN src_local."Profile" p  ON p."profileUserId" = o."userId"
LEFT JOIN src_local."User"    u  ON u.id = o."userId"
LEFT JOIN src_local."Request" r  ON r."convertedOrderId" = o.id
LEFT JOIN atlas.order_reschedule_flag f
       ON f.order_id = o.id AND f.cleared_at IS NULL
LEFT JOIN atlas.users fu ON fu.id = f.flagged_by
WHERE o."storeId" IS NOT NULL;

COMMENT ON VIEW analytics.v_store_order IS
  'Every order that belongs to a store, with its stage, lab, phlebo, patient '
  'name and whether it is delayed. No window and no status filter — this is '
  'the ledger a partner asks about, not a queue.';


-- ---------------------------------------------------------------------------
-- Indexes. The store page filters by store and orders by appointment; the
-- overview groups every order by store and stage.
--
-- On the sample data none of this matters. On the real book "Order" is around
-- forty thousand rows and the store page is opened all day, so the difference
-- between an index and a scan is the difference between a page and a wait.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_src_order_store_appt
  ON src_local."Order" ("storeId", "appointmentTime" DESC);
CREATE INDEX IF NOT EXISTS idx_src_order_store_status
  ON src_local."Order" ("storeId", "orderStatus");
CREATE INDEX IF NOT EXISTS idx_src_order_created
  ON src_local."Order" ("createdAt");
CREATE INDEX IF NOT EXISTS idx_src_order_user
  ON src_local."Order" ("userId");

ANALYZE src_local."Order";
