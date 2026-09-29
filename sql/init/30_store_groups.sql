-- ===========================================================================
-- 30_store_groups.sql — the tracked store list, and order tracking on top of it.
--
-- The change in shape
-- -------------------
-- Order tracking used to be a set of queues with a store filter bolted on the
-- side. It is now the other way round: the stores come first, and the queues
-- are what each store produces. S1, S2 … in the spec are the stores
-- themselves — "all orders originating from S1" means one partner's orders —
-- so the screen is read store by store, and every count belongs to a store.
--
-- Two consequences, both deliberate and both large.
--
-- 1. Every order from an S1 store counts, not only the ones a request turned
--    into. 25_request_orders.sql INNER JOINed Request, which on the current
--    data is 15 orders out of 1,085 from tracked stores — 1.4%. A partner's
--    direct orders were invisible to the people meant to be watching them.
--
-- 2. The lab-history filter is gone. Restricting the pickup queue to labs with
--    fewer than five lifetime orders was a good proxy for "where orders fail"
--    when the queue had to be kept small. Scoped to six named partners it is
--    no longer needed, and it was hiding today's appointments at established
--    labs from a screen whose whole job is today's appointments.
--
-- A group table rather than a flag on the store, because there will be more
-- than one list before long and a boolean cannot hold the second one.
-- atlas.store_tracking stays what it is: which partners the REQUESTS queue is
-- for. The two are independent on purpose — a store can be watched here and
-- not there.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS atlas.store_group (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_]{0,15}$'),
  label       text NOT NULL,
  description text,
  /** Ordering on screen. Lower first. */
  position    int  NOT NULL DEFAULT 100,
  created_by  int  REFERENCES atlas.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE atlas.store_group IS
  'Named sets of stores. TRACKED is the set order tracking watches. Separate '
  'from atlas.store_tracking, which is about the requests queue.';

CREATE TABLE IF NOT EXISTS atlas.store_group_member (
  group_code text NOT NULL REFERENCES atlas.store_group(code) ON DELETE CASCADE,
  store_id   int  NOT NULL,
  added_by   int  REFERENCES atlas.users(id) ON DELETE SET NULL,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_code, store_id)
);
CREATE INDEX IF NOT EXISTS idx_store_group_member_store
  ON atlas.store_group_member (store_id);

COMMENT ON TABLE atlas.store_group_member IS
  'Which stores are in which group. A store may be in several.';

-- The list itself. Created empty: which partners belong in it is a decision
-- for whoever runs the desk, made on the screen, not a list baked into a
-- migration that would then be wrong the first time it changed.
INSERT INTO atlas.store_group (code, label, description, position)
VALUES ('TRACKED', 'Tracked stores',
        'The partners order tracking watches. Every order from these stores '
        || 'is tracked, whether or not it came from a request.', 10)
ON CONFLICT (code) DO NOTHING;

-- The pickup queue used to be called confirm_pickup, when it meant "confirm
-- this one happened at a lab with no track record". It now means every
-- appointment today, so it is pickup_today. Assignments and notes are keyed on
-- the name, so they move with it rather than being orphaned.
UPDATE atlas.order_task      SET kind = 'pickup_today' WHERE kind = 'confirm_pickup';
UPDATE atlas.order_task_note SET kind = 'pickup_today' WHERE kind = 'confirm_pickup';

CREATE OR REPLACE FUNCTION atlas.store_in_group(gcode text, sid int)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM atlas.store_group_member m
                  WHERE m.group_code = gcode AND m.store_id = sid)
$$;

/** How many stores are in a group — for the empty state, which matters here. */
CREATE OR REPLACE FUNCTION atlas.store_group_size(gcode text)
RETURNS int LANGUAGE sql STABLE AS $$
  SELECT count(*)::int FROM atlas.store_group_member WHERE group_code = gcode
$$;


-- ---------------------------------------------------------------------------
-- analytics.v_tracked_order — every order from a tracked store.
--
-- Not "every order a request turned into", which is what the old base was.
-- A partner's direct orders are still that partner's orders, and the desk is
-- watching the partner.
--
-- The requester columns fall back to the patient. On a request-born order the
-- request holds the name and mobile; on a direct order there is no request, and
-- the profile behind the order is who the appointment is actually for. Leaving
-- them NULL would have put a dash where the name goes on 98% of the new rows.
-- ---------------------------------------------------------------------------
-- Dropped innermost-last. v_store_queue reads v_order_task, which reads
-- v_tracked_order, so dropping the middle one first fails on the second run —
-- which is the whole point of the file being idempotent. Not CASCADE: that
-- silently takes dependants with it and is how 26 leaves the order views
-- missing after a clean setup.
DROP VIEW IF EXISTS analytics.v_store_queue;
DROP VIEW IF EXISTS analytics.v_order_task;
DROP VIEW IF EXISTS analytics.v_tracked_order;

CREATE VIEW analytics.v_tracked_order AS
SELECT
  o.id                                     AS order_id,
  o."storeId"                              AS store_id,
  COALESCE(NULLIF(btrim(st."storeName"), ''), 'Store ' || o."storeId") AS store_name,
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')       AS appointment_at,
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS appointment_date,
  (o."statusUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')       AS status_at,
  (o."createdAt"       AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')       AS order_created_at,
  o."orderStatus"::text                    AS order_status,
  o."orderType"::text                      AS order_type,
  atlas.order_stage(o."orderStatus"::text) AS stage,
  o."referenceId"                          AS reference_id,

  o."labId"                                AS lab_id,
  l."labName"                              AS lab_name,
  l.city                                   AS lab_city,
  l.pincode                                AS lab_pincode,
  NULLIF(btrim(l."labCenterMobile"), '')   AS lab_phone,
  NULLIF(btrim(l."labCenterEmail"), '')    AS lab_email,

  -- "with L.S lab assigned" — the placeholder the console puts on an order
  -- that has not been given a real lab yet. NULL counts too: no lab at all is
  -- the same problem wearing different clothes.
  (o."labId" = atlas.request_setting('placeholder_lab_id')::int
     OR o."labId" IS NULL)                 AS on_placeholder,

  NULLIF(btrim(o."phleboName"), '')        AS phlebo_name,
  NULLIF(btrim(o."phleboNumber"), '')      AS phlebo_number,

  r.id                                     AS request_id,
  r.pincode                                AS request_pincode,
  r.city                                   AS request_city,
  -- Request first, patient second. See the note above.
  COALESCE(NULLIF(btrim(r.name), ''), NULLIF(btrim(p.name), ''),
           NULLIF(btrim(u.name), ''))      AS requester_name,
  COALESCE(NULLIF(btrim(r.mobile), ''), NULLIF(btrim(u.phone), '')) AS requester_mobile,
  COALESCE(r.pincode, p.pincode)           AS contact_pincode,
  COALESCE(r.city, p.city)                 AS contact_city,
  cm.quoted_price                          AS quoted_price,

  COALESCE(h.orders_all_time, 0)           AS lab_orders_all_time,
  COALESCE(h.delivered, 0)                 AS lab_delivered,
  COALESCE(h.failed, 0)                    AS lab_failed

FROM src_local."Order" o
JOIN atlas.store_group_member g
  ON g.group_code = 'TRACKED' AND g.store_id = o."storeId"
LEFT JOIN src_local."Store"   st ON st.id = o."storeId"
LEFT JOIN src_local."Lab"     l  ON l.id  = o."labId"
LEFT JOIN src_local."Profile" p  ON p."profileUserId" = o."userId"
LEFT JOIN src_local."User"    u  ON u.id  = o."userId"
LEFT JOIN src_local."Request" r  ON r."convertedOrderId" = o.id
LEFT JOIN atlas.commitment    cm ON cm.request_id = r.id
LEFT JOIN analytics.v_lab_order_history h ON h.lab_id = o."labId"
WHERE o."appointmentTime" IS NOT NULL;

COMMENT ON VIEW analytics.v_tracked_order IS
  'Every order from a tracked store, request-born or not. The base order '
  'tracking derives from.';


-- ---------------------------------------------------------------------------
-- analytics.v_order_task — the queues.
--
--   needs_lab     appointment from tomorrow onward, still on the placeholder
--                 lab. Deadline the day before the appointment, because a lab
--                 named on the morning itself is a lab nobody has confirmed.
--
--   pickup_today  everything happening today. No lab condition and no history
--                 filter: the question today is "is this happening", and it is
--                 asked of every appointment, not a selected few.
--
--   chase_report  the appointment has been and gone and no report has come
--                 back. Not in the Step-1 note, kept because deleting a
--                 working queue that nothing replaces is not a tidy-up. Now
--                 scoped to the tracked stores like the other two.
-- ---------------------------------------------------------------------------
CREATE VIEW analytics.v_order_task AS
WITH base AS (
  SELECT v.* FROM analytics.v_tracked_order v
  -- Closed is closed. A cancelled order is not work, and a missed one is a
  -- conversation for somebody else.
  WHERE v.order_status NOT IN ('CANCELED', 'PATIENT_MISSED')
),
tasks AS (
  SELECT 'needs_lab'::text AS kind, b.*,
         (b.appointment_date - 1)                     AS due_date,
         (b.appointment_date - 1) < atlas.ist_today() AS overdue
  FROM base b
  WHERE b.on_placeholder
    -- T+1 onward. Today's unallocated orders are not an allocation backlog to
    -- work through in order, they are today's emergency, and the pickup queue
    -- already has every one of them.
    AND b.appointment_date > atlas.ist_today()
    AND b.order_status NOT IN ('REPORT_DELIVERED')

  UNION ALL

  SELECT 'pickup_today'::text, b.*,
         b.appointment_date AS due_date,
         b.on_placeholder   AS overdue
  FROM base b
  WHERE b.appointment_date = atlas.ist_today()

  UNION ALL

  SELECT 'chase_report'::text, b.*,
         (GREATEST(b.appointment_at, COALESCE(b.status_at, b.appointment_at))
            + interval '48 hours')::date AS due_date,
         (GREATEST(b.appointment_at, COALESCE(b.status_at, b.appointment_at))
            + interval '48 hours') < (now() AT TIME ZONE 'Asia/Kolkata') AS overdue
  FROM base b
  WHERE b.order_status <> 'REPORT_DELIVERED'
    AND b.appointment_date < atlas.ist_today()
    -- A month is the horizon. Older than that is history, and a queue that
    -- never empties is a queue nobody opens.
    AND b.appointment_date >= atlas.ist_today() - 30
)
SELECT
  t.kind,
  t.order_id,
  t.due_date::text                        AS due_date,
  t.overdue,
  (t.due_date - atlas.ist_today())        AS days_left,
  t.appointment_at::text                  AS appointment_at,
  t.appointment_date::text                AS appointment_date,
  t.status_at::text                       AS collected_at,
  GREATEST(t.appointment_at, COALESCE(t.status_at, t.appointment_at))::text AS clock_from,
  t.order_status,
  t.order_type,
  t.stage,
  t.reference_id,
  t.lab_id, t.lab_name, t.lab_city, t.lab_pincode, t.lab_phone, t.lab_email,
  t.on_placeholder,
  t.lab_orders_all_time, t.lab_delivered, t.lab_failed,
  t.phlebo_name, t.phlebo_number,
  t.store_id, t.store_name,
  t.request_id,
  COALESCE(t.request_pincode, t.contact_pincode) AS request_pincode,
  COALESCE(t.request_city, t.contact_city)       AS request_city,
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
  'Order tracking, scoped to the tracked stores. Every order from them, not '
  'only the request-born ones, and no lab-history filter.';

-- The join that decides everything now.
CREATE INDEX IF NOT EXISTS idx_src_order_store_appt_status
  ON src_local."Order" ("storeId", "appointmentTime", "orderStatus");


-- ---------------------------------------------------------------------------
-- analytics.v_store_queue — one row per tracked store, the queues beside it.
--
-- The shape the spec is written in. "All orders originating from S1 with appt
-- date as Today" is a question asked of one partner, and the answer somebody
-- needs first is which partner has the pile — not a flat list of two hundred
-- orders that happens to be sorted by date.
--
-- Stores with nothing today still appear, with zeros. A partner who has gone
-- quiet is exactly what a list of only-the-busy-ones cannot show, and on this
-- screen a store that suddenly reads zero is the thing worth noticing.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS analytics.v_store_queue;

CREATE VIEW analytics.v_store_queue AS
SELECT
  m.store_id,
  COALESCE(NULLIF(btrim(st."storeName"), ''), ats.store_name, 'Store ' || m.store_id)
                                                                AS store_name,
  COALESCE(st.city, ats.city)                                   AS city,
  COALESCE(st.active, ats.active, false)                        AS active,
  m.added_at,
  au.name                                                       AS added_by,

  count(*) FILTER (WHERE t.kind = 'needs_lab')::int             AS needs_lab,
  count(*) FILTER (WHERE t.kind = 'needs_lab'
                     AND t.appointment_date::date = atlas.ist_today() + 1)::int
                                                                AS needs_lab_tomorrow,
  count(*) FILTER (WHERE t.kind = 'needs_lab' AND t.overdue)::int AS needs_lab_overdue,

  count(*) FILTER (WHERE t.kind = 'pickup_today')::int          AS pickup_today,
  -- Of today's appointments, the ones still without a real lab. That is the
  -- overlap between the two queues and the worst row on the screen: it is
  -- happening today and nobody has said where.
  count(*) FILTER (WHERE t.kind = 'pickup_today' AND t.on_placeholder)::int
                                                                AS pickup_no_lab,
  count(*) FILTER (WHERE t.kind = 'pickup_today'
                     AND t.stage IN ('in_progress', 'completed'))::int
                                                                AS pickup_collected,

  count(*) FILTER (WHERE t.kind = 'chase_report')::int          AS chase_report,
  count(*) FILTER (WHERE t.kind = 'chase_report' AND t.overdue)::int
                                                                AS chase_report_late,

  count(*) FILTER (WHERE t.assignee_id IS NULL)::int            AS unassigned
FROM atlas.store_group_member m
LEFT JOIN src_local."Store" st  ON st.id  = m.store_id
LEFT JOIN atlas.store       ats ON ats.id = m.store_id
LEFT JOIN atlas.users       au  ON au.id  = m.added_by
LEFT JOIN analytics.v_order_task t ON t.store_id = m.store_id
WHERE m.group_code = 'TRACKED'
GROUP BY m.store_id, st."storeName", ats.store_name, st.city, ats.city,
         st.active, ats.active, m.added_at, au.name;

COMMENT ON VIEW analytics.v_store_queue IS
  'One row per tracked store with its queue counts. The store-first shape the '
  'spec is written in — which partner has the pile, before which orders.';
