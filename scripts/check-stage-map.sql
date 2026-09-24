-- ===========================================================================
-- check-stage-map.sql — does atlas.order_stage() still agree with the app?
--
-- The stage on every row is computed in SQL, so the screen, the API and the
-- CSV cannot disagree with each other. But lib/stores.ts carries the same
-- mapping written backwards (STAGE_STATUSES) for the filter tooltips, and a
-- second copy of anything drifts. This is the assertion that it has not.
--
-- Run it against a database with sql/init/28_store_orders.sql applied:
--
--   docker exec -i <container> psql -U atlas -d atlas -f - < scripts/check-stage-map.sql
--
-- Prints one row per status. Any row where `agrees` is false is a bug in one
-- of the two, and the expected column says which. Also fails loudly if a new
-- value has appeared in the "OrderStatus" enum that neither side knows about.
-- ===========================================================================

WITH
-- The app's mapping, transcribed from STAGE_STATUSES in lib/stores.ts. If you
-- change one, change both — that is the whole point of this file.
app(status, stage) AS (VALUES
  ('PENDING',          'pending'),
  ('CREATED',          'pending'),
  ('ORDER_SCHEDULED',  'scheduled'),
  ('PHLEBO_ASSIGNED',  'scheduled'),
  ('KIT_DISPATCHED',   'scheduled'),
  ('RESCHEDULED',      'rescheduled'),
  ('SAMPLE_COLLECTED', 'in_progress'),
  ('SAMPLE_DELIVERED', 'in_progress'),
  ('SAMPLE_PROCESSED', 'in_progress'),
  ('PATIENT_VISITED',  'in_progress'),
  ('REPORT_DELIVERED', 'completed'),
  ('CANCELED',         'cancelled'),
  ('PATIENT_MISSED',   'cancelled')
),
-- Every value the enum actually holds, so a status added in LabStack shows up
-- here rather than silently landing in 'pending' for everybody.
live(status) AS (
  SELECT e.enumlabel::text
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'OrderStatus'
)
SELECT
  COALESCE(l.status, a.status)          AS status,
  a.stage                               AS app_says,
  atlas.order_stage(COALESCE(l.status, a.status)) AS sql_says,
  CASE
    WHEN a.status IS NULL THEN 'NEW ENUM VALUE — add it to lib/stores.ts and sql/init/28'
    WHEN l.status IS NULL THEN 'app knows a status the enum does not have'
    WHEN a.stage = atlas.order_stage(l.status) THEN 'ok'
    ELSE 'MISMATCH'
  END                                   AS verdict
FROM live l
FULL OUTER JOIN app a ON a.status = l.status
ORDER BY (CASE
    WHEN a.status IS NULL OR l.status IS NULL THEN 0
    WHEN a.stage <> atlas.order_stage(l.status) THEN 0
    ELSE 1
  END), 1;
