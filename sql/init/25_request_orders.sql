-- ===========================================================================
-- 25_request_orders.sql — orders that came from a request, and only those.
--
-- Two changes to what 24_order_tracking.sql built.
--
-- 1. The queues are for orders a request turned into. A store's own direct
--    order has no quote to honour, no requester waiting on a date we gave,
--    and nobody on this team owns it — it was showing up as "no request
--    behind it" and taking a slot. Restricting to request-born orders also
--    cuts the base the queues are derived from by twelve times (38,820 rows
--    to 3,207 on the snapshot), which the page feels.
--
-- 2. The base is lifted into a view of its own, because there is a fourth
--    question the queues cannot answer: everything happening on one day,
--    whatever state it is in. analytics.v_request_order is that list, and
--    v_order_task now derives from it rather than repeating it.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- analytics.v_request_order — one row per order that came from a request.
--
-- No window and no status filter: this is the ledger the day view reads, so a
-- cancelled order on a date somebody is looking at has to be visible, and so
-- does one from March. The queues apply their own bounds on top.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS analytics.v_order_task;
DROP VIEW IF EXISTS analytics.v_request_order;

CREATE VIEW analytics.v_request_order AS
SELECT
  o.id                                     AS order_id,
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')        AS appointment_at,
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date  AS appointment_date,
  (o."statusUpdatedAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')        AS status_at,
  (o."createdAt"       AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')        AS order_created_at,
  o."orderStatus"::text                    AS order_status,
  o."orderType"::text                      AS order_type,
  o."labId"                                AS lab_id,
  l."labName"                              AS lab_name,
  l.city                                   AS lab_city,
  l.pincode                                AS lab_pincode,
  NULLIF(btrim(l."labCenterMobile"), '')   AS lab_phone,
  NULLIF(btrim(l."labCenterEmail"), '')    AS lab_email,
  o."storeId"                              AS store_id,
  s."storeName"                            AS store_name,
  r.id                                     AS request_id,
  r.pincode                                AS request_pincode,
  r.city                                   AS request_city,
  r.name                                   AS requester_name,
  r.mobile                                 AS requester_mobile,
  r.status::text                           AS request_status,
  cm.quoted_price                          AS quoted_price,
  cm.promised_date                         AS promised_date,
  COALESCE(h.orders_all_time, 0)           AS lab_orders_all_time,
  COALESCE(h.delivered, 0)                 AS lab_delivered,
  COALESCE(h.failed, 0)                    AS lab_failed,
  (o."labId" = atlas.request_setting('placeholder_lab_id')::int
     OR o."labId" IS NULL)                 AS on_placeholder
-- INNER, not LEFT: the whole point is that a request is behind it. It also
-- lets the planner drive from Request, which is a twelfth of the size and
-- indexed on convertedOrderId.
FROM src_local."Request" r
JOIN src_local."Order" o ON o.id = r."convertedOrderId"
LEFT JOIN src_local."Lab"   l ON l.id = o."labId"
LEFT JOIN src_local."Store" s ON s.id = o."storeId"
LEFT JOIN atlas.commitment  cm ON cm.request_id = r.id
LEFT JOIN analytics.v_lab_order_history h ON h.lab_id = o."labId"
WHERE o."appointmentTime" IS NOT NULL;

COMMENT ON VIEW analytics.v_request_order IS
  'Every order a request turned into, with its lab, that lab''s record and the '
  'request behind it. No window, no status filter — the queues bound it.';


-- ---------------------------------------------------------------------------
-- analytics.v_order_task — the three queues, now derived from the ledger.
--
-- Same three kinds and the same closing rules as before; what changed is that
-- the rows come from v_request_order, so a direct store order is no longer a
-- task for anybody.
-- ---------------------------------------------------------------------------
CREATE VIEW analytics.v_order_task AS
WITH base AS (
  SELECT v.*, COALESCE(atlas.request_setting('followup_max_lifetime_orders')::int, 5) AS max_lifetime
  FROM analytics.v_request_order v
  WHERE v.order_status NOT IN ('CANCELED', 'PATIENT_MISSED')
    -- Nothing older than a month is worked; it is history, and a queue that
    -- never empties is a queue nobody opens.
    AND v.appointment_at >= (now() AT TIME ZONE 'Asia/Kolkata') - interval '30 days'
),
tasks AS (
  SELECT 'needs_lab'::text AS kind, b.*,
         (b.appointment_date - 1)                     AS due_date,
         (b.appointment_date - 1) < atlas.ist_today() AS overdue
  FROM base b
  -- Strictly ahead of today. Once the appointment day arrives the question is
  -- no longer "which lab gets this" but "is this one happening at all", and
  -- that is the pickup queue's job — it already carries every unallocated
  -- appointment for today. Leaving them in both put the same three orders in
  -- two queues and made each look like the other's backlog.
  WHERE b.on_placeholder
    AND b.appointment_date > atlas.ist_today()

  UNION ALL

  -- Everything happening today that somebody should be watching, which is
  -- two kinds of row: an appointment at a lab with barely any history, and an
  -- appointment that still has no lab at all. The second sits here and only
  -- here — the allocation queue stops at the end of yesterday, because on the
  -- day itself an unallocated order is not an allocation problem to work
  -- through in order, it is today's emergency.
  SELECT 'confirm_pickup'::text, b.*,
         b.appointment_date AS due_date,
         b.on_placeholder   AS overdue
  FROM base b
  WHERE b.appointment_date = atlas.ist_today()
    AND (b.on_placeholder OR b.lab_orders_all_time < b.max_lifetime)
    AND b.order_status NOT IN ('SAMPLE_COLLECTED', 'SAMPLE_DELIVERED',
                               'SAMPLE_PROCESSED', 'REPORT_DELIVERED')

  UNION ALL

  -- Everything the lab still owes us.
  --
  -- This used to name three statuses — collected, delivered, processed — on the
  -- assumption that an order only becomes ours to chase once the sample is in
  -- hand. It does not. An order whose appointment was on Tuesday and is still
  -- sitting at PHLEBO_ASSIGNED or ORDER_SCHEDULED on Friday is the worst kind
  -- of outstanding report: nothing has happened at all, and under the old rule
  -- it appeared in no queue whatsoever. It left the pickup queue at midnight
  -- and never arrived anywhere else.
  --
  -- So the rule is stated the other way round: the appointment has come and
  -- gone (or the sample is already collected, which starts the clock on the
  -- same day), and no report has come back. CANCELED and PATIENT_MISSED are
  -- already gone in base — those are closed, not outstanding — and a future
  -- RESCHEDULED date takes itself out through appointment_date.
  --
  -- The clock runs from whichever came later, the appointment or the last
  -- status change. statusUpdatedAt is routinely BEFORE the appointment (a
  -- phlebo is assigned in advance — every PHLEBO_ASSIGNED order in the mirror
  -- is), so keying 48 hours off it alone made orders overdue before anybody
  -- had been to the house.
  SELECT 'chase_report'::text, b.*,
         (GREATEST(b.appointment_at, COALESCE(b.status_at, b.appointment_at))
            + interval '48 hours')::date AS due_date,
         (GREATEST(b.appointment_at, COALESCE(b.status_at, b.appointment_at))
            + interval '48 hours') < (now() AT TIME ZONE 'Asia/Kolkata') AS overdue
  FROM base b
  WHERE NOT b.on_placeholder
    AND b.lab_orders_all_time < b.max_lifetime
    AND b.order_status <> 'REPORT_DELIVERED'
    AND (b.appointment_date < atlas.ist_today()
         OR b.order_status IN ('SAMPLE_COLLECTED', 'SAMPLE_DELIVERED', 'SAMPLE_PROCESSED'))
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
  -- What the clock is actually counting from, which is not always the status
  -- change: see the chase_report branch above.
  GREATEST(t.appointment_at, COALESCE(t.status_at, t.appointment_at))::text AS clock_from,
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
  'One row per open order task — needs_lab, confirm_pickup, chase_report — '
  'for orders that came from a request. Derived: a row closes itself.';
