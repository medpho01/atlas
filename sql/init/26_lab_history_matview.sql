-- ===========================================================================
-- 26_lab_history_matview.sql — stop re-counting every order on every read.
--
-- analytics.v_lab_order_history was a plain view: a GROUP BY over the whole
-- Order table, 79,000 rows on production, computed again for every query that
-- joined it — which is every read of the order queues and every drawer that
-- shows a lab's record.
--
-- Nothing about it needs to be that fresh. It is a lab's lifetime count, which
-- moves when an order completes and is otherwise the same number all day. So
-- it becomes a matview with an index on lab_id, and the join becomes a lookup.
--
-- The view name stays, as a thin wrapper, so nothing that reads it has to
-- change or even know.
--
-- Refreshed CONCURRENTLY by the same poller that tops up the orders, which is
-- why the unique index below is not optional — REFRESH CONCURRENTLY requires
-- one, and without it the refresh takes an exclusive lock and readers wait.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

DROP VIEW IF EXISTS analytics.v_lab_order_history CASCADE;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_lab_order_history AS
SELECT o."labId"                                   AS lab_id,
       count(*)::int                               AS orders_all_time,
       count(*) FILTER (WHERE o."orderStatus"::text = 'REPORT_DELIVERED')::int AS delivered,
       count(*) FILTER (WHERE o."orderStatus"::text IN ('CANCELED','PATIENT_MISSED'))::int AS failed,
       min(o."appointmentTime")                    AS first_appointment,
       max(o."appointmentTime")                    AS last_appointment
FROM src_local."Order" o
WHERE o."labId" IS NOT NULL
GROUP BY o."labId";

-- Required for REFRESH ... CONCURRENTLY, and it is what makes the join a
-- lookup rather than a scan.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_lab_history_lab
  ON analytics.mv_lab_order_history (lab_id);

-- The old name, kept so every reader carries on unchanged.
CREATE OR REPLACE VIEW analytics.v_lab_order_history AS
  SELECT * FROM analytics.mv_lab_order_history;

COMMENT ON MATERIALIZED VIEW analytics.mv_lab_order_history IS
  'Per-lab lifetime order counts. Refreshed by the commitment poller; a few '
  'minutes stale by design, because a lifetime count does not move faster.';


-- ---------------------------------------------------------------------------
-- Refreshing it.
--
-- CONCURRENTLY so readers never block, and never raising, because the poller
-- calls it every few minutes and a refresh that throws would take the loop
-- down with it. A first refresh cannot be concurrent, so that case falls back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.refresh_lab_history()
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.mv_lab_order_history;
  RETURN NULL;
EXCEPTION
  WHEN object_not_in_prerequisite_state THEN
    -- Never populated: the concurrent form is not allowed yet.
    REFRESH MATERIALIZED VIEW analytics.mv_lab_order_history;
    RETURN NULL;
  WHEN OTHERS THEN
    RETURN left(SQLERRM, 200);
END $$;

-- ---------------------------------------------------------------------------
-- Order of application
--
-- The CASCADE at the top takes the order-queue views with it, because they
-- read the history view. So this file runs BEFORE 25_request_orders.sql, which
-- recreates them on top of the matview:
--
--   26_lab_history_matview.sql   then   25_request_orders.sql
--
-- Both are idempotent, so running the pair again is safe.
-- ---------------------------------------------------------------------------
