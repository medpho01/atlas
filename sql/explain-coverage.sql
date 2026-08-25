-- Why does Atlas think these labs can collect in this pincode?
--
--   docker exec -i atlas-db psql -U atlas -d atlas \
--     -v pin="'509125'" -v req=28785 -f - < sql/explain-coverage.sql
--
-- Every lab Atlas offers is there for exactly one of two reasons: the pincode
-- is the lab's own, or it appears in Lab."pincodesServiced". This prints that
-- reason per lab, alongside every other signal that ought to constrain it —
-- the store contract, whether the lab has ever actually collected there, and
-- whether it is an API partner whose real answer lives behind a live call.
--
-- Run it against production. Reasoning from a local copy is what made the last
-- several attempts at this miss.

\echo '=== The request, and whether the store gate is even switched on ==='
SELECT s.request_id, s.pincode, s.store_id, st."storeName", s.state,
       atlas.store_lab_gate_active() AS gate_active,
       (SELECT COUNT(*) FROM src_local."LabsOnStore") AS mappings_loaded
FROM analytics.mv_request_state s
LEFT JOIN src_local."Store" st ON st.id = s.store_id
WHERE s.request_id = :req;

\echo '=== Every lab Atlas offers here, and exactly why ==='
SELECT lb.id,
       LEFT(lb."labName", 34)                                   AS lab,
       lb.pincode = :pin                                        AS its_own_pincode,
       :pin = ANY(lb."pincodesServiced")                        AS in_serviced_list,
       COALESCE(array_length(lb."pincodesServiced", 1), 0)      AS list_size,
       lb."isApiHomeSample"                                     AS api_partner,
       EXISTS (SELECT 1 FROM analytics.mv_lab_pincode_served sv
                WHERE sv.lab_id = lb.id AND sv.pincode = :pin)  AS has_collected_here,
       EXISTS (SELECT 1 FROM src_local."LabsOnStore" los
                WHERE los."labId" = lb.id
                  AND los."storeId" = (SELECT store_id FROM analytics.mv_request_state
                                        WHERE request_id = :req)) AS contracted_with_store
FROM analytics.mv_lab_pincode_home lph
JOIN src_local."Lab" lb ON lb.id = lph.lab_id
WHERE lph.pincode = :pin
ORDER BY lb.id;

\echo '=== Is the Lab snapshot current, or is Atlas reading a stale copy? ==='
SELECT (SELECT COUNT(*) FROM src_local."Lab")                       AS labs_in_snapshot,
       (SELECT COUNT(*) FROM src."Lab")                             AS labs_at_source,
       (SELECT COALESCE(array_length("pincodesServiced",1),0)
          FROM src_local."Lab" WHERE id = 14)                       AS thyrocare_list_snapshot,
       (SELECT COALESCE(array_length("pincodesServiced",1),0)
          FROM src."Lab" WHERE id = 14)                             AS thyrocare_list_source,
       (SELECT :pin = ANY("pincodesServiced")
          FROM src."Lab" WHERE id = 14)                             AS source_says_thyrocare_serves_it;
