-- ---------------------------------------------------------------------------
-- Why is Atlas slow? Run this first.
--
--   docker exec -i atlas-db psql -U atlas -d atlas -f - < sql/reports/speed-check.sql
--
-- Almost every "the pages are slow" report on this app has had the same cause:
-- src_local.* is created with CREATE TABLE ... (LIKE src.X), which copies no
-- indexes, so every join against a 46,000-row snapshot table is a sequential
-- scan. sql/init/22_src_local_indexes.sql fixes it and has to be applied by
-- hand on a host that already exists.
--
-- Read-only.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\timing off

\echo ''
\echo '== 1 · snapshot indexes — the usual culprit ==========================='
\echo '   Every table below should have at least one index. A 0 means the fix'
\echo '   has not been applied: run sql/init/22_src_local_indexes.sql.'
SELECT c.relname AS table_name,
       c.reltuples::bigint AS approx_rows,
       count(i.indexrelid)::int AS indexes,
       CASE WHEN count(i.indexrelid) = 0 THEN '<-- NO INDEXES' ELSE '' END AS flag
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_index i ON i.indrelid = c.oid
WHERE n.nspname = 'src_local' AND c.relkind = 'r'
GROUP BY c.relname, c.reltuples
ORDER BY (count(i.indexrelid) = 0) DESC, c.reltuples DESC;

\echo ''
\echo '== 2 · are the planner stats fresh? =================================='
\echo '   last_analyze far in the past means the planner is guessing.'
SELECT relname AS table_name,
       COALESCE(last_analyze, last_autoanalyze)::timestamp(0) AS analyzed,
       n_live_tup AS rows
FROM pg_stat_user_tables
WHERE schemaname = 'src_local'
ORDER BY n_live_tup DESC
LIMIT 8;

\echo ''
\echo '== 3 · the pages, timed ============================================='
\timing on
\echo '-- requests: the default queue (should be well under a second)'
SELECT count(*) FROM (
  SELECT * FROM analytics.v_request_quote
  WHERE NOT is_converted AND created_at >= now() - interval '7 days'
  ORDER BY created_at DESC LIMIT 150
) x;

\echo '-- requests: a text search across all time'
SELECT count(*) FROM analytics.v_request_quote
WHERE array_to_string(item_names, ' ') ILIKE '%thyro%';

\echo '-- order tracking: the three queues'
SELECT kind, count(*) FROM analytics.v_order_task GROUP BY 1;

\echo '-- order tracking: one day of request-born orders'
SELECT count(*) FROM analytics.v_request_order
WHERE appointment_date = (now() AT TIME ZONE 'Asia/Kolkata')::date;
\timing off

\echo ''
\echo '== 4 · is the live order sync working? ==============================='
\echo '   failed non-null means the queues are reading last night data.'
SELECT * FROM atlas.sync_orders_live();

\echo ''
\echo '== 5 · how stale is the snapshot? ==================================='
SELECT max("createdAt")::timestamp(0)  AS newest_order_created,
       max("updatedAt")::timestamp(0)  AS newest_order_touched,
       count(*) FILTER (WHERE "appointmentTime"
         BETWEEN now() - interval '1 day' AND now() + interval '7 days') AS orders_in_the_next_week
FROM src_local."Order";
