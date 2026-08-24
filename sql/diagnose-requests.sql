-- Where do today's requests stop?
--
--   docker exec -i atlas-db psql -U atlas -d atlas -f - < sql/diagnose-requests.sql
--
-- Four layers sit between LabStack and the queue screen, and a failure in any
-- one of them looks identical from the browser: an empty page. This walks them
-- in order so the answer is the first layer whose max id stops short.
--
--   1 live source  — what the FDW can see on the read replica right now
--   2 snapshot     — src_local, rebuilt nightly and topped up every 10 min
--   3 MV           — analytics.mv_request_state, what the page reads
--   4 page query   — the queue's exact WHERE clause
--
-- If 1 has today's ids and 2 does not, the sync is not running.
-- If 2 has them and 3 does not, the MV has not been refreshed.
-- If 3 has them and 4 returns 0, a filter is excluding them — check the
-- timezone line at the end, since "today" is an IST question asked of a UTC
-- database.

\echo '=== 1. LIVE SOURCE (what Atlas can see over the FDW) ==='
SELECT id, "createdAt", "storeId", status::text
FROM src."Request" ORDER BY id DESC LIMIT 5;

\echo '=== 2. SNAPSHOT (src_local, what the MV is built from) ==='
SELECT MAX(id) AS max_id, MAX("createdAt") AS newest, COUNT(*) AS rows
FROM src_local."Request";

\echo '=== 3. MATERIALIZED VIEW (what the page queries) ==='
SELECT MAX(request_id) AS max_id, MAX(created_at) AS newest, COUNT(*) AS rows
FROM analytics.mv_request_state;

\echo '=== 4. THE PAGE QUERY, exactly as the queue runs it ==='
SELECT COUNT(*) AS would_show
FROM analytics.v_request_quote
WHERE NOT is_converted
  AND status <> ALL(ARRAY['ORDERED','DISCHARGED','CANCELLED','DENIED','WRONG_NUMBER'])
  AND created_at >= date_trunc('day', now());

\echo '=== 5. Is the sync function deployed, and did it ever run? ==='
SELECT to_regprocedure('atlas.sync_recent_requests(int)') AS sync_fn,
       to_regprocedure('atlas.ist_midnight(int)')          AS ist_fn;

\echo '=== 6. Day boundaries — "today" is an IST question in a UTC database ==='
SELECT now()                              AS utc_now,
       now() AT TIME ZONE 'Asia/Kolkata'  AS ist_now,
       atlas.ist_midnight()               AS today_starts_at_utc,
       atlas.ist_today()                  AS ist_today;

\echo '=== 7. Catch up now, if layer 2 is behind layer 1 ==='
\echo 'SELECT * FROM atlas.sync_recent_requests(168);'
\echo 'REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.mv_request_state;'
