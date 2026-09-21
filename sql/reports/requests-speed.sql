-- Requests page: where the time actually goes.
--
--   docker compose exec -T atlas-db psql -U atlas -d atlas -f /path/requests-speed.sql
--
-- Run it on the host that is slow. Every block is one of the queries the page
-- fires on a single load; the page fires all of them, so the page is roughly
-- the slowest of them plus the render.
\timing on
\pset pager off

\echo '== 0. size, and whether the precomputed table is there =='
SELECT (SELECT count(*) FROM analytics.mv_request_state) AS requests,
       (SELECT count(*) FROM atlas.request_item)         AS request_items,
       to_regclass('analytics.mv_request_quote')         AS precomputed,
       (SELECT count(*) FROM pg_indexes
         WHERE schemaname='analytics' AND tablename='mv_request_quote') AS its_indexes;

\echo '== 1. the list — every column, the way the page asks for it =='
SELECT count(md5(z::text)) FROM (
  SELECT q.* FROM analytics.v_request_quote q
  WHERE NOT is_converted
    AND status <> ALL(ARRAY['ORDERED','DISCHARGED','CANCELLED','DENIED','WRONG_NUMBER'])
    AND (store_id IS NULL OR atlas.store_is_tracked(store_id))
  ORDER BY created_at DESC LIMIT 150) z;

\echo '== 2. one queue, the way the team opens it =='
SELECT count(md5(z::text)) FROM (
  SELECT q.* FROM analytics.v_request_quote q
  WHERE status IN ('QUOTED') ORDER BY created_at DESC LIMIT 150) z;

\echo '== 3. the count beside it =='
SELECT COUNT(*)::int FROM analytics.v_request_quote
 WHERE NOT is_converted
   AND status <> ALL(ARRAY['ORDERED','DISCHARGED','CANCELLED','DENIED','WRONG_NUMBER']);

\echo '== 4. the three facet queries =='
SELECT store_id, COUNT(*)::int FROM analytics.v_request_quote GROUP BY 1;
SELECT city,     COUNT(*)::int FROM analytics.v_request_quote GROUP BY 1;
SELECT status,   COUNT(*)::int FROM analytics.v_request_quote GROUP BY 1;

\echo '== 5. the funnel =='
SELECT COUNT(*)::int AS received,
       COUNT(*) FILTER (WHERE state = 'SERVICEABLE' OR quote_price IS NOT NULL)::int AS priced,
       COUNT(*) FILTER (WHERE is_converted)::int AS ordered
FROM analytics.v_request_quote;

\echo '== 6. full materialisation — the number that shows whether it is precomputed =='
SELECT count(md5(z::text)) FROM analytics.v_request_quote z;

\echo '== 7. how long a refresh of the precomputed table takes =='
SELECT atlas.refresh_request_quote();
