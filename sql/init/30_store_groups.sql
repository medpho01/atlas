-- ===========================================================================
-- 30_store_groups.sql — the tracked store list, and the two queues that hang
-- off it, for Stores & Orders.
--
-- Deliberately does NOT touch analytics.v_order_task. /order-tracking is its
-- own screen with its own three queues and its own rules, and it stays exactly
-- as it is. Everything built here is read only by Stores & Orders.
--
-- The shape
-- ---------
-- A named list of partners comes first, and the queues are what each one
-- produces. S1, S2 … are the stores themselves — "all orders originating from
-- S1" means one partner's orders — so the screen is read store by store and
-- every count belongs to a store.
--
--   needs a lab   appointment from tomorrow onward, still on the LabStack
--                 placeholder lab. Nobody has said where it is happening.
--   pickup today  every appointment today, whichever lab it is at.
--
-- Every order from a listed store counts, not only the ones a request turned
-- into: a partner's direct orders are still that partner's orders, and on the
-- sample data the request-born ones are 15 of 1,085.
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
  'Named sets of stores. TRACKED is the list Stores & Orders watches. Separate '
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
        'The partners Stores & Orders watches. Every order from these stores '
        || 'is tracked, whether or not it came from a request.', 10)
ON CONFLICT (code) DO NOTHING;

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
-- analytics.v_store_tracked_order — every order from a tracked store, with
-- the queue it falls in.
--
-- One row per order and a nullable `queue`, rather than a row per queue. An
-- order is in at most one of the two — tomorrow-onward and today cannot both
-- be true — so one column says it without duplicating the row, and the
-- per-store counts below are a single pass.
--
-- Dropped dependant-first on re-run: v_store_queue reads this one, and
-- dropping this one without that would fail on the second run. Not CASCADE,
-- which silently takes dependants with it and is how 26 leaves the order views
-- missing after a clean setup.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS analytics.v_store_queue;
DROP VIEW IF EXISTS analytics.v_store_tracked_order;

CREATE VIEW analytics.v_store_tracked_order AS
SELECT
  o.id                                     AS order_id,
  o."storeId"                              AS store_id,
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')       AS appointment_at,
  (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date AS appointment_date,
  o."orderStatus"::text                    AS order_status,
  atlas.order_stage(o."orderStatus"::text) AS stage,

  -- "with L.S lab assigned" — the placeholder the console puts on an order
  -- that has not been given a real lab yet. NULL counts too: no lab at all is
  -- the same problem wearing different clothes.
  (o."labId" = atlas.request_setting('placeholder_lab_id')::int
     OR o."labId" IS NULL)                 AS on_placeholder,

  CASE
    -- Closed is closed. A cancelled order is not work, and a missed one is a
    -- conversation for somebody else.
    WHEN o."orderStatus"::text IN ('CANCELED', 'PATIENT_MISSED') THEN NULL

    WHEN (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
           = atlas.ist_today()
      THEN 'pickup_today'

    WHEN (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
           > atlas.ist_today()
     AND (o."labId" = atlas.request_setting('placeholder_lab_id')::int
            OR o."labId" IS NULL)
     AND o."orderStatus"::text <> 'REPORT_DELIVERED'
      THEN 'needs_lab'
  END                                      AS queue

FROM src_local."Order" o
JOIN atlas.store_group_member g
  ON g.group_code = 'TRACKED' AND g.store_id = o."storeId"
WHERE o."appointmentTime" IS NOT NULL;

COMMENT ON VIEW analytics.v_store_tracked_order IS
  'Every order from a tracked store, with which of the two Stores & Orders '
  'queues it falls in. Read only by Stores & Orders — /order-tracking has its '
  'own analytics.v_order_task and is untouched by this file.';


-- ---------------------------------------------------------------------------
-- analytics.v_store_queue — one row per tracked store, the queues beside it.
--
-- The shape the spec is written in. "All orders originating from S1 with appt
-- date as Today" is a question asked of one partner, and the answer somebody
-- needs first is which partner has the pile — not a flat list of two hundred
-- orders that happens to be sorted by date.
--
-- Stores with nothing still appear, with zeros. A partner who has gone quiet
-- is exactly what a list of only-the-busy-ones cannot show, and on this screen
-- a store that suddenly reads zero is the thing worth noticing.
-- ---------------------------------------------------------------------------
CREATE VIEW analytics.v_store_queue AS
SELECT
  m.store_id,
  m.added_at,
  au.name                                                        AS added_by,

  count(*) FILTER (WHERE v.queue = 'needs_lab')::int              AS needs_lab,
  count(*) FILTER (WHERE v.queue = 'needs_lab'
                     AND v.appointment_date = atlas.ist_today() + 1)::int
                                                                  AS needs_lab_tomorrow,

  count(*) FILTER (WHERE v.queue = 'pickup_today')::int           AS pickup_today,
  -- The worst row on the screen: happening today and nobody has said where.
  count(*) FILTER (WHERE v.queue = 'pickup_today' AND v.on_placeholder)::int
                                                                  AS pickup_no_lab,
  count(*) FILTER (WHERE v.queue = 'pickup_today'
                     AND v.stage IN ('in_progress', 'completed'))::int
                                                                  AS pickup_collected
FROM atlas.store_group_member m
LEFT JOIN atlas.users au ON au.id = m.added_by
LEFT JOIN analytics.v_store_tracked_order v ON v.store_id = m.store_id
WHERE m.group_code = 'TRACKED'
GROUP BY m.store_id, m.added_at, au.name;

COMMENT ON VIEW analytics.v_store_queue IS
  'One row per tracked store with its two queue counts. The store-first shape '
  'the spec is written in — which partner has the pile, before which orders.';

-- The join that decides everything here.
CREATE INDEX IF NOT EXISTS idx_src_order_store_appt_status
  ON src_local."Order" ("storeId", "appointmentTime", "orderStatus");
