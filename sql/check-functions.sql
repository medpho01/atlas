-- Do the database objects the app calls actually exist here?
--
--   docker exec -i atlas-db psql -U atlas -d atlas -f - < sql/check-functions.sql
--
-- Every one of these is referenced from lib/requestQueries.ts. A missing one
-- does not degrade — it throws on every query that goes through build(), which
-- takes down the Overview page as well as Requests, because the summary tile
-- runs the same builder.
SELECT 'store_is_tracked'       AS fn, to_regprocedure('atlas.store_is_tracked(int)')::text        AS exists
UNION ALL SELECT 'ist_midnight',      to_regprocedure('atlas.ist_midnight(int)')::text
UNION ALL SELECT 'ist_today',         to_regprocedure('atlas.ist_today()')::text
UNION ALL SELECT 'store_lab_gate_active', to_regprocedure('atlas.store_lab_gate_active()')::text
UNION ALL SELECT 'sync_recent_requests',  to_regprocedure('atlas.sync_recent_requests(int)')::text
UNION ALL SELECT 'test_discipline',    to_regprocedure('atlas.test_discipline(text)')::text
UNION ALL SELECT 'add_working_days',   to_regprocedure('atlas.add_working_days(date,int)')::text
UNION ALL SELECT 'tbl store_tracking', to_regclass('atlas.store_tracking')::text
UNION ALL SELECT 'tbl lab_pincode_block', to_regclass('atlas.lab_pincode_block')::text
UNION ALL SELECT 'view v_request_quote',  to_regclass('analytics.v_request_quote')::text;
