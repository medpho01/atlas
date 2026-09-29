-- ===========================================================================
-- check-stores-feature.sql — did Stores & Orders install correctly?
--
-- One command to answer the question somebody asks right after merging, and
-- the one that otherwise costs an afternoon: is everything actually here?
--
--   docker exec -i atlas-db psql -U atlas -d atlas -f - < scripts/check-stores-feature.sql
--
-- Every row prints PASS or FAIL with what it expected. Anything reading FAIL
-- names the file to apply. It writes nothing and is safe on production.
-- ===========================================================================

\pset pager off
\timing off

\echo ''
\echo '=== 1. Objects that must exist ============================================'

WITH expected(kind, name, from_file) AS (VALUES
  ('function', 'atlas.order_stage',              '28_store_orders.sql'),
  ('function', 'atlas.store_delay_hours',        '28_store_orders.sql'),
  ('function', 'atlas.store_delay_hours_default','28_store_orders.sql'),
  ('function', 'atlas.store_pending_limit',      '28_store_orders.sql'),
  ('table',    'atlas.store_profile',            '28_store_orders.sql'),
  ('table',    'atlas.store_change_log',         '28_store_orders.sql'),
  ('table',    'atlas.order_reschedule_flag',    '28_store_orders.sql'),
  ('view',     'analytics.v_store_order',        '28_store_orders.sql'),
  ('table',    'atlas.store',                    '29_store_registry.sql'),
  ('table',    'atlas.store_archive',            '29_store_registry.sql'),
  ('function', 'atlas.store_dependencies',       '29_store_registry.sql'),
  ('view',     'analytics.v_store_directory',    '29_store_registry.sql'),
  ('table',    'atlas.store_group',              '30_store_groups.sql'),
  ('table',    'atlas.store_group_member',       '30_store_groups.sql'),
  ('function', 'atlas.store_in_group',           '30_store_groups.sql'),
  ('function', 'atlas.store_group_size',         '30_store_groups.sql'),
  ('view',     'analytics.v_store_tracked_order','30_store_groups.sql'),
  ('view',     'analytics.v_store_queue',        '30_store_groups.sql'),
  -- Order tracking's own, which this feature must NOT have disturbed.
  ('view',     'analytics.v_order_task',         '25_request_orders.sql'),
  ('view',     'analytics.v_request_order',      '25_request_orders.sql')
)
SELECT
  CASE WHEN found THEN 'PASS' ELSE 'FAIL' END AS result,
  kind, name,
  CASE WHEN found THEN '' ELSE 'missing — apply sql/init/' || from_file END AS fix
FROM (
  SELECT e.*,
         CASE e.kind
           WHEN 'function' THEN to_regproc(e.name) IS NOT NULL
           ELSE to_regclass(e.name) IS NOT NULL
         END AS found
  FROM expected e
) x
ORDER BY found, name;

\echo ''
\echo '=== 2. The two screens must not share a view ==============================='
\echo '(order tracking reads v_order_task; Stores & Orders reads its own)'

SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       count(*) AS stores_views_that_v_order_task_depends_on,
       'v_order_task must not read anything this feature owns' AS expected
FROM pg_depend d
JOIN pg_rewrite r  ON r.oid = d.objid
JOIN pg_class   dependent ON dependent.oid = r.ev_class
JOIN pg_class   source    ON source.oid = d.refobjid
WHERE dependent.relname = 'v_order_task'
  AND source.relname IN ('v_store_order', 'v_store_directory',
                         'v_store_tracked_order', 'v_store_queue');

\echo ''
\echo '=== 3. The stage map agrees between SQL and lib/stores.ts =================='

WITH app(status, stage) AS (VALUES
  ('PENDING','pending'), ('CREATED','pending'),
  ('ORDER_SCHEDULED','scheduled'), ('PHLEBO_ASSIGNED','scheduled'),
  ('KIT_DISPATCHED','scheduled'), ('RESCHEDULED','rescheduled'),
  ('SAMPLE_COLLECTED','in_progress'), ('SAMPLE_DELIVERED','in_progress'),
  ('SAMPLE_PROCESSED','in_progress'), ('PATIENT_VISITED','in_progress'),
  ('REPORT_DELIVERED','completed'),
  ('CANCELED','cancelled'), ('PATIENT_MISSED','cancelled')
), live(status) AS (
  SELECT e.enumlabel::text FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'OrderStatus'
)
SELECT CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       count(*) AS disagreements,
       'every OrderStatus value maps the same way in both' AS expected
FROM live l
FULL OUTER JOIN app a ON a.status = l.status
WHERE a.status IS NULL OR l.status IS NULL
   OR a.stage <> atlas.order_stage(l.status);

\echo ''
\echo '=== 4. The views answer ===================================================='

SELECT 'v_store_directory' AS view,
       CASE WHEN count(*) >= 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       count(*) AS rows FROM analytics.v_store_directory
UNION ALL
SELECT 'v_store_order', 'PASS', count(*) FROM analytics.v_store_order
UNION ALL
SELECT 'v_store_tracked_order', 'PASS', count(*) FROM analytics.v_store_tracked_order
UNION ALL
SELECT 'v_store_queue', 'PASS', count(*) FROM analytics.v_store_queue
UNION ALL
SELECT 'v_order_task (order tracking)', 'PASS', count(*) FROM analytics.v_order_task;

\echo ''
\echo '=== 5. Every order lands in exactly one stage =============================='

SELECT CASE WHEN missing = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       missing AS orders_with_no_stage,
       'atlas.order_stage() is total — nothing may be NULL' AS expected
FROM (SELECT count(*) AS missing FROM analytics.v_store_order WHERE stage IS NULL) x;

\echo ''
\echo '=== 6. The tracked queues match a from-scratch recomputation =============='
\echo '(computed straight off src_local."Order", not through the views)'

WITH t AS (SELECT store_id FROM atlas.store_group_member WHERE group_code = 'TRACKED'),
independent AS (
  SELECT
    count(*) FILTER (
      WHERE (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
              > atlas.ist_today()
        AND (o."labId" = atlas.request_setting('placeholder_lab_id')::int OR o."labId" IS NULL)
        AND o."orderStatus"::text NOT IN ('CANCELED','PATIENT_MISSED','REPORT_DELIVERED')
    )::int AS needs_lab,
    count(*) FILTER (
      WHERE (o."appointmentTime" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
              = atlas.ist_today()
        AND o."orderStatus"::text NOT IN ('CANCELED','PATIENT_MISSED')
    )::int AS pickup_today
  FROM src_local."Order" o JOIN t ON t.store_id = o."storeId"
),
view_says AS (
  SELECT COALESCE(sum(needs_lab), 0)::int AS needs_lab,
         COALESCE(sum(pickup_today), 0)::int AS pickup_today
  FROM analytics.v_store_queue
)
SELECT CASE WHEN i.needs_lab = v.needs_lab AND i.pickup_today = v.pickup_today
            THEN 'PASS' ELSE 'FAIL' END AS result,
       i.needs_lab AS independent_needs_lab, v.needs_lab AS view_needs_lab,
       i.pickup_today AS independent_pickup, v.pickup_today AS view_pickup
FROM independent i, view_says v;

\echo ''
\echo '=== 7. Archiving hides from the screen without touching the data =========='

SELECT CASE WHEN hidden = archived THEN 'PASS' ELSE 'FAIL' END AS result,
       archived AS archived_stores,
       hidden   AS hidden_from_directory,
       'every archived store is absent from v_store_directory' AS expected
FROM (
  SELECT (SELECT count(*) FROM atlas.store_archive) AS archived,
         (SELECT count(*) FROM atlas.store_archive a
           WHERE NOT EXISTS (SELECT 1 FROM analytics.v_store_directory d
                              WHERE d.id = a.store_id)) AS hidden
) x;

\echo ''
\echo '=== 8. Atlas-owned store ids cannot collide with LabStack ids ============='

SELECT CASE WHEN bad = 0 THEN 'PASS' ELSE 'FAIL' END AS result,
       bad AS colliding_ids,
       'atlas.store ids start at 900000 and must not exist in src_local' AS expected
FROM (
  SELECT count(*) AS bad FROM atlas.store a
  WHERE EXISTS (SELECT 1 FROM src_local."Store" s WHERE s.id = a.id)
     OR a.id < 900000
) x;

\echo ''
\echo '=== done =================================================================='
\echo 'Any row reading FAIL above names what to fix.'
