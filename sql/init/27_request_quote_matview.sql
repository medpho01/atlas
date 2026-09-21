-- ===========================================================================
-- 27_request_quote_matview.sql — stop recomputing the whole network on every
-- keystroke.
--
-- analytics.v_request_quote was a plain view with five correlated LATERALs per
-- row. The worst of them, `lb`, cross-joins every lab covering the request's
-- pincode against every item on the request against mv_lab_offering — per
-- request. `cs` does the same again for cost. `it` aggregates the item names
-- and walks _MasterToPackage for disciplines. Fully materialising the view on
-- the snapshot takes 3.9 seconds for 16,000 requests, and the page asks for it
-- eight times per load (list, count, three facets, funnel, freshness,
-- untracked) — every one of which re-derives the same answer.
--
-- None of that changes between nightly refreshes. Which labs cover a pincode,
-- what a package costs across the network, what the request asked for — these
-- move when the catalogue moves, not while somebody is clicking a filter.
--
-- So they are precomputed here, once, and the view keeps its name and its
-- exact column list. Nothing that reads it changes.
--
-- What stays live, and why:
--   * atlas.commitment      — the app writes it; a quote must appear at once.
--   * promised_date         — derived from CURRENT_DATE, so it would go stale
--                             at midnight and quietly promise yesterday.
--   * slot_policy / quote_markup — settings the team tunes and expects to see
--                             take effect on the next page load.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

DROP VIEW IF EXISTS analytics.v_request_quote CASCADE;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.mv_request_quote AS
SELECT
  s.*,
  spr.store_price,
  spr.store_mrp,
  cs.cost_min, cs.cost_avg, cs.cost_max, cs.cost_labs,
  it.packages, it.tests, it.item_names, it.unnamed,
  (SELECT array_agg(DISTINCT d.d ORDER BY d.d) FROM unnest(it.disciplines_raw) d(d)) AS disciplines,
  lb.labs_ready, lb.labs_covering, lb.missing_items,
  st."storeName" AS store_name
FROM analytics.mv_request_state s

-- What this store sells the package for, where the store carries it at all.
LEFT JOIN LATERAL (
  SELECT max(pos."storePrice")::numeric AS store_price,
         max(pos."storeMrp")::numeric   AS store_mrp
  FROM atlas.request_item ri
  JOIN src_local."PackagesOnStore" pos
    ON pos."packageId" = ri.package_id AND pos."storeId" = s.store_id
  WHERE ri.request_id = s.request_id AND ri.package_id IS NOT NULL
) spr ON true

-- What the network charges for the same items, across every lab that offers
-- them. The spread is the negotiating position.
LEFT JOIN LATERAL (
  SELECT round(min(m.lo)::numeric, 0) AS cost_min,
         round(avg(m.avg)::numeric, 0) AS cost_avg,
         round(max(m.hi)::numeric, 0) AS cost_max,
         min(m.n)::integer             AS cost_labs
  FROM (
    SELECT DISTINCT ri.kind, COALESCE(ri.package_id, ri.master_id) AS item_id
    FROM atlas.request_item ri
    WHERE ri.request_id = s.request_id
      AND (ri.package_id IS NOT NULL OR ri.master_id IS NOT NULL)
  ) w
  CROSS JOIN LATERAL (
    SELECT min(lo.cost) AS lo, avg(lo.cost) AS avg, max(lo.cost) AS hi, count(*) AS n
    FROM analytics.mv_lab_offering lo
    WHERE lo.kind = w.kind AND lo.item_id = w.item_id
  ) m
) cs ON true

-- What was actually asked for, in words a person recognises.
LEFT JOIN LATERAL (
  SELECT
    array_remove(array_agg(DISTINCT p."packageName") FILTER (WHERE p.id IS NOT NULL), NULL::text) AS packages,
    array_remove(array_agg(DISTINCT m.name) FILTER (WHERE m.id IS NOT NULL), NULL::text) AS tests,
    array_remove(array_agg(DISTINCT COALESCE(p."packageName", m.name, ri.raw_text)
                   ORDER BY (COALESCE(p."packageName", m.name, ri.raw_text)))
                 FILTER (WHERE p.id IS NOT NULL OR m.id IS NOT NULL), NULL::text)
    || array_remove(array_agg(DISTINCT ri.raw_text) FILTER (WHERE p.id IS NULL AND m.id IS NULL), NULL::text)
                                                                                    AS item_names,
    array_remove(array_agg(DISTINCT atlas.test_discipline(COALESCE(m.name, ri.raw_text)))
                 FILTER (WHERE m.id IS NOT NULL OR ri.raw_text IS NOT NULL), NULL::text)
    || COALESCE((SELECT array_agg(DISTINCT atlas.test_discipline(m2.name))
                 FROM atlas.request_item ri2
                 JOIN src_local."_MasterToPackage" mp2 ON mp2."B" = ri2.package_id
                 JOIN src_local."Master" m2 ON m2.id = mp2."A"
                 WHERE ri2.request_id = s.request_id AND ri2.package_id IS NOT NULL),
                ARRAY[]::text[])                                                    AS disciplines_raw,
    count(*) FILTER (WHERE p.id IS NULL AND m.id IS NULL)::integer                  AS unnamed
  FROM atlas.request_item ri
  LEFT JOIN src_local."Package" p ON p.id = ri.package_id
  LEFT JOIN src_local."Master"  m ON m.id = ri.master_id
  WHERE ri.request_id = s.request_id
) it ON true

-- Which labs could actually take it, and what the closest ones are missing.
-- The expensive one: labs in the pincode × items on the request × offerings.
LEFT JOIN LATERAL (
  SELECT
    array_remove((array_agg(l."labName" ORDER BY x.missing, l."labName")
                  FILTER (WHERE x.missing = 0))[1:3], NULL::text)                   AS labs_ready,
    array_remove((array_agg(l."labName" ORDER BY x.missing, l."labName"))[1:3], NULL::text) AS labs_covering,
    (array_agg(x.missing_names ORDER BY x.missing) FILTER (WHERE x.missing > 0))[1] AS missing_items
  FROM (
    SELECT lph.lab_id,
           count(*) FILTER (WHERE lo.lab_id IS NULL)::integer AS missing,
           string_agg(DISTINCT CASE WHEN lo.lab_id IS NULL
                                    THEN COALESCE(p2."packageName", m2.name) END, ', ') AS missing_names
    FROM analytics.mv_lab_pincode_home lph
    CROSS JOIN LATERAL (
      SELECT DISTINCT ri.kind, COALESCE(ri.package_id, ri.master_id) AS item_id
      FROM atlas.request_item ri
      WHERE ri.request_id = s.request_id
        AND (ri.package_id IS NOT NULL OR ri.master_id IS NOT NULL)
    ) w
    LEFT JOIN analytics.mv_lab_offering lo
      ON lo.lab_id = lph.lab_id AND lo.kind = w.kind AND lo.item_id = w.item_id
    LEFT JOIN src_local."Package" p2 ON w.kind = 'PACKAGE' AND p2.id = w.item_id
    LEFT JOIN src_local."Master"  m2 ON w.kind = 'TEST'    AND m2.id = w.item_id
    WHERE lph.pincode = s.pincode
      AND (s.store_id IS NULL
        OR NOT atlas.store_lab_gate_active()
        OR EXISTS (SELECT 1 FROM src_local."LabsOnStore" los
                    WHERE los."storeId" = s.store_id AND los."labId" = lph.lab_id))
    GROUP BY lph.lab_id
  ) x
  JOIN src_local."Lab" l ON l.id = x.lab_id
) lb ON true

LEFT JOIN src_local."Store" st ON st.id = s.store_id;

-- Required for REFRESH ... CONCURRENTLY, which is what keeps the page
-- readable while the refresh runs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_request_quote_id
  ON analytics.mv_request_quote (request_id);

-- The three columns the team actually filters on, in the order they use them:
-- which stage, whose account, when it arrived. None of these existed on
-- mv_request_state either, so every stage filter was a sequential scan.
CREATE INDEX IF NOT EXISTS idx_mv_request_quote_status  ON analytics.mv_request_quote (status);
CREATE INDEX IF NOT EXISTS idx_mv_request_quote_store   ON analytics.mv_request_quote (store_id);
CREATE INDEX IF NOT EXISTS idx_mv_request_quote_created ON analytics.mv_request_quote (created_at DESC);
-- The queue's own shape: open work for one store, newest first.
CREATE INDEX IF NOT EXISTS idx_mv_request_quote_queue
  ON analytics.mv_request_quote (status, store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mv_request_quote_pin     ON analytics.mv_request_quote (pincode);

COMMENT ON MATERIALIZED VIEW analytics.mv_request_quote IS
  'Everything about a request that only moves when the catalogue moves: what '
  'was asked for, which labs cover it, what it costs across the network. '
  'Refreshed with mv_request_state. The live parts — commitments, the promised '
  'date, markup settings — stay in analytics.v_request_quote on top.';


-- ---------------------------------------------------------------------------
-- analytics.v_request_quote — the same name, the same columns, the live parts.
-- ---------------------------------------------------------------------------
CREATE VIEW analytics.v_request_quote AS
SELECT
  s.request_id, s.pincode, s.city, s.state_name, s.status, s.order_type,
  s.store_id, s.created_at, s.src_flag, s.is_converted, s.order_id,
  s.preferred_at, s.src_quoted_price,
  s.items_total, s.items_resolvable, s.items_unresolved,
  s.covering_labs, s.full_labs, s.best_lab_id, s.best_lab_cost,
  s.reference_cost, s.reference_n, s.reference_missing,
  s.nearest_lab_id, s.nearest_km, s.state,
  sp.label     AS state_label,
  sp.lead_days,
  CASE WHEN s.best_lab_cost IS NOT NULL   THEN s.best_lab_cost
       WHEN s.reference_missing = 0       THEN s.reference_cost
       ELSE NULL::numeric END             AS basis_cost,
  CASE WHEN s.best_lab_cost IS NOT NULL   THEN 'covering_lab'
       WHEN s.reference_missing = 0       THEN 'network_median'
       WHEN s.reference_cost IS NOT NULL  THEN 'partial'
       ELSE 'none' END                    AS price_basis,
  qm.markup_pct,
  qm.label     AS markup_label,
  CASE WHEN s.state = 'SERVICEABLE'       THEN NULL::numeric
       WHEN qm.markup_pct IS NULL         THEN NULL::numeric
       WHEN s.reference_missing > 0       THEN NULL::numeric
       WHEN COALESCE(s.best_lab_cost, s.reference_cost) IS NULL THEN NULL::numeric
       ELSE round(COALESCE(s.best_lab_cost, s.reference_cost)
                  * (1::numeric + qm.markup_pct / 100.0), 0) END AS quote_price,
  CASE WHEN sp.lead_days IS NULL THEN NULL::date
       ELSE atlas.add_working_days(CURRENT_DATE, sp.lead_days) END AS promised_date,
  CASE WHEN s.state = 'SERVICEABLE'      THEN 'Convert in console — a covering lab already offers this'
       WHEN s.state = 'NO_ITEMS'         THEN 'Cannot tell what was requested — no package, test or parseable note'
       WHEN s.state = 'NO_PINCODE'       THEN 'No pincode on the request, so it cannot be placed'
       WHEN s.state = 'PACKAGE_GAP'      THEN s.covering_labs || ' lab(s) cover this pincode; none carry the full request'
       WHEN s.state = 'SUPPLY_GAP_KNOWN' THEN 'No covering lab; nearest is ' || s.nearest_km || ' km away and onboardable'
       ELSE 'No lab within range — escalate rather than promise' END AS reason,
  c.id            AS commitment_id,
  c.promised_date AS committed_date,
  c.quoted_price  AS committed_price,
  c.closed_at,
  c.outcome,
  s.packages, s.tests, s.item_names, s.unnamed, s.disciplines,
  s.labs_ready, s.labs_covering, s.missing_items,
  s.store_name,
  s.store_price, s.store_mrp,
  s.cost_min, s.cost_avg, s.cost_max, s.cost_labs
FROM analytics.mv_request_quote s
LEFT JOIN atlas.slot_policy sp ON sp.state = s.state
LEFT JOIN LATERAL (
  SELECT q.markup_pct, q.label FROM atlas.quote_markup q
  WHERE s.nearest_km IS NOT NULL AND s.nearest_km <= q.max_km
  ORDER BY q.max_km LIMIT 1
) qm ON true
LEFT JOIN atlas.commitment c ON c.request_id = s.request_id;

COMMENT ON VIEW analytics.v_request_quote IS
  'One row per request: what it needs, what it should cost, what we promised. '
  'Reads mv_request_quote for everything precomputed and joins only the parts '
  'that must be live — commitments, today''s promised date, markup settings.';


CREATE OR REPLACE FUNCTION atlas.refresh_request_quote()
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.mv_request_quote;
  RETURN NULL;
EXCEPTION
  WHEN object_not_in_prerequisite_state THEN
    REFRESH MATERIALIZED VIEW analytics.mv_request_quote;
    RETURN NULL;
  WHEN OTHERS THEN
    RETURN left(SQLERRM, 200);
END $$;

COMMENT ON FUNCTION atlas.refresh_request_quote() IS
  'Refresh the precomputed request table. Always AFTER mv_request_state — it '
  'reads it. Never raises: the poller calls it on a loop.';
