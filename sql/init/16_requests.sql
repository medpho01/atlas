-- ===========================================================================
-- Requests: the commitment pipeline.
--
-- A partner sends a patient and a test list. If nobody in the network can
-- collect in that pincode, ops still quotes a price and a date, the store
-- accepts, and the network team then has until that date to find supply.
--
-- We commit before we have the supply. That is the whole design problem:
-- an obligation exists in atlas.commitment from the moment the order is
-- booked, and it stays open until the order moves off the placeholder lab.
--
-- Nothing here writes to LabStack. Ops and the network team act in the
-- console; Atlas computes the answer beforehand and detects the result
-- afterwards. Step 7 of the flow — "who onboarded it" — is inferred from the
-- order leaving the placeholder, never self-reported.
-- ===========================================================================

CREATE SCHEMA IF NOT EXISTS atlas;

-- ---------------------------------------------------------------------------
-- Settings. The placeholder lab id is the hinge of the whole feature — an
-- order sitting on it means "promised, not yet sourced" — so it is config,
-- not a literal buried in six queries.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.request_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  note        text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO atlas.request_settings (key, value, note) VALUES
  ('placeholder_lab_id', '1',
   'LabStack Networks - Lab. Orders parked here are promised but not yet sourced.'),
  ('home_sample_modality', 'HOME_SAMPLE',
   '98% of requests are home collection; this is the modality serviceability is judged on.'),
  ('known_candidate_km', '25',
   'A lab this close to an uncovered pincode counts as a known candidate rather than an unknown supply gap.')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION atlas.request_setting(k text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT value FROM atlas.request_settings WHERE key = k
$$;

-- ---------------------------------------------------------------------------
-- Slot policy: how many days we are willing to promise, per state.
--
-- Stated policy, not prediction — this is a new process with no comparable
-- history, and pretending otherwise would dress a guess as a forecast. Every
-- commitment records promised-vs-actual so the numbers get set by measurement
-- after the first month.
--
-- NULL lead_days means "do not promise" — the request escalates instead. That
-- is the guard that stops Atlas inventing a plausible date for supply it has
-- no route to.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.slot_policy (
  state        text PRIMARY KEY,
  lead_days    int,
  label        text NOT NULL,
  note         text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO atlas.slot_policy (state, lead_days, label, note) VALUES
  ('SERVICEABLE',         0, 'Serviceable',
   'Covering lab already offers the item. Console converts it; Atlas stays out of the way.'),
  ('PACKAGE_GAP',         2, 'Package gap',
   'Lab covers the pincode but does not carry the item. Activation at an existing partner.'),
  ('SUPPLY_GAP_KNOWN',    3, 'Supply gap — candidate known',
   'No covering lab, but one is close enough to onboard.'),
  ('SUPPLY_GAP_UNKNOWN',  NULL, 'Supply gap — no candidate',
   'Nothing within range. No date is promised; this escalates.'),
  ('NO_PINCODE',          NULL, 'No pincode',
   'Cannot be placed geographically, so cannot be classified or promised.'),
  ('NO_ITEMS',            NULL, 'Nothing identifiable requested',
   'No package, no test, and no parseable note. Cannot be priced, so cannot be promised.')
ON CONFLICT (state) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Quote markup, keyed to measured remoteness.
--
-- The ask was "15–25% depending on how interior the pincode is". Distance from
-- the request pincode to the nearest lab that could serve it is a number we
-- already hold, so the judgement is replaced by a measurement and the bands
-- stay tunable without a deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.quote_markup (
  max_km       numeric PRIMARY KEY,
  markup_pct   numeric,   -- NULL = do not auto-quote; price this by hand
  label        text NOT NULL
);

-- Drift guard: an early revision had markup_pct NOT NULL, which blocks the
-- "price this by hand" band. Harmless where it was never applied.
ALTER TABLE atlas.quote_markup ALTER COLUMN markup_pct DROP NOT NULL;

INSERT INTO atlas.quote_markup (max_km, markup_pct, label) VALUES
  (10,   15, 'Within 10 km'),
  (25,   20, '10–25 km'),
  (50,   25, '25–50 km'),
  (99999, NULL, 'Beyond 50 km — manual pricing')
ON CONFLICT (max_km) DO NOTHING;

-- ---------------------------------------------------------------------------
-- What was actually requested.
--
-- Only a quarter of requests carry a structured package or test. The rest are
-- free text — but not prose: one partner is 84% of volume and sends a fixed
-- "Tests to be done: A, B, C" template, so the majority is recoverable by
-- parsing rather than by a model.
--
-- source records how we know: 'package' and 'master' come from the source join
-- tables, 'notes' from the parser, 'human' from a correction. Human always
-- wins and is never overwritten, matching the enricher convention used
-- elsewhere in Atlas.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.request_item (
  id           serial PRIMARY KEY,
  request_id   int  NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('PACKAGE','TEST')),
  package_id   int,
  master_id    int,
  raw_text     text,
  source       text NOT NULL CHECK (source IN ('package','master','notes','human')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_request_item_req ON atlas.request_item (request_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_request_item_uniq
  ON atlas.request_item (request_id, kind, COALESCE(package_id,-1), COALESCE(master_id,-1),
                         COALESCE(lower(raw_text),''));

-- ---------------------------------------------------------------------------
-- The commitment ledger.
--
-- Opens when an order is booked against the placeholder; closes when that
-- order moves onto a real lab. LabStack records neither event as an event —
-- Order.assignedAt is unpopulated across the entire table — so Atlas detects
-- the labId transition by comparing against what it last saw. That is why the
-- poller exists and why this table is the system of record for the promise.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.commitment (
  id              serial PRIMARY KEY,
  request_id      int  NOT NULL,
  order_id        int,
  state           text NOT NULL REFERENCES atlas.slot_policy(state),
  promised_date   date,
  quoted_price    numeric,
  price_basis     text,
  markup_pct      numeric,
  reference_n     int,
  target_lab_id   int,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  allocated_lab_id int,
  outcome         text CHECK (outcome IN ('allocated','cancelled','expired')),
  attributed_to   int REFERENCES atlas.users(id),
  notes           text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_commitment_request ON atlas.commitment (request_id);
CREATE INDEX IF NOT EXISTS idx_commitment_open ON atlas.commitment (promised_date)
  WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_commitment_order ON atlas.commitment (order_id);

-- ---------------------------------------------------------------------------
-- Labs found on the open web, for pincodes where we have nothing.
--
-- Deliberately a separate table from crm_providers: these are unverified
-- third-party search results, not network records, and the UI must not let the
-- two blur. Promotion into CRM is a human act, and nothing here is ever
-- contacted automatically.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.discovered_lab (
  id            serial PRIMARY KEY,
  pincode       text NOT NULL,
  name          text NOT NULL,
  address       text,
  phone         text,
  source_url    text,
  city          text,
  state         text,
  confidence    numeric,
  retrieved_at  timestamptz NOT NULL DEFAULT now(),
  model         text,
  verified_by   int REFERENCES atlas.users(id),
  verified_at   timestamptz,
  crm_provider_id int,
  dismissed     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_discovered_pin ON atlas.discovered_lab (pincode);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovered_uniq
  ON atlas.discovered_lab (pincode, lower(name));

-- Which pincodes we have already searched, so a barren pincode is not
-- re-searched every night at cost.
CREATE TABLE IF NOT EXISTS atlas.discovery_run (
  pincode      text PRIMARY KEY,
  ran_at       timestamptz NOT NULL DEFAULT now(),
  found        int NOT NULL DEFAULT 0,
  model        text,
  error        text
);

-- ---------------------------------------------------------------------------
-- Canonical test-name lookup: every name and alias, flattened once.
--
-- The parser matches free text against this. Written as a table rather than a
-- correlated lookup because unnesting Master.aliases per parsed item turns an
-- 18k-row insert into a multi-minute scan — measured, not assumed.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_master_lookup CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_master_lookup AS
SELECT DISTINCT ON (norm) norm, master_id, is_profile
FROM (
  SELECT lower(TRIM(m.name)) AS norm, m.id AS master_id, m."isTestProfile" AS is_profile
  FROM src_local."Master" m
  WHERE NULLIF(TRIM(m.name),'') IS NOT NULL
  UNION ALL
  SELECT lower(TRIM(a)), m.id, m."isTestProfile"
  FROM src_local."Master" m, unnest(COALESCE(m.aliases, ARRAY[]::text[])) a
  WHERE NULLIF(TRIM(a),'') IS NOT NULL
) x
-- Profiles win ties: "Routine Urine Analysis" should resolve to the profile,
-- not to a same-named component buried under it.
ORDER BY norm, is_profile DESC, master_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_master_lookup_norm ON analytics.mv_master_lookup (norm);
-- ---------------------------------------------------------------------------
-- Populate atlas.request_item from the three sources.
--
-- Structured links first, then the notes parser. Idempotent: re-running adds
-- nothing that is already there, and never touches a 'human' row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.sync_request_items()
RETURNS TABLE (from_packages int, from_masters int, from_notes int)
LANGUAGE plpgsql AS $$
DECLARE p int; m int; n int;
BEGIN
  INSERT INTO atlas.request_item (request_id, kind, package_id, source)
  SELECT pr."B", 'PACKAGE', pr."A", 'package'
  FROM src_local."_PackageToRequest" pr
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS p = ROW_COUNT;

  INSERT INTO atlas.request_item (request_id, kind, master_id, source)
  SELECT mr."B", 'TEST', mr."A", 'master'
  FROM src_local."_MasterToRequest" mr
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS m = ROW_COUNT;

  -- The dominant partner sends a fixed template:
  --   "Diagnosis: X  Tests to be done: CBC, ESR, CRP  Request Received Date: ..."
  -- Capture what sits between the test header and whichever field follows it,
  -- then split on commas. Not prose, so no model is needed for the bulk of it.
  INSERT INTO atlas.request_item (request_id, kind, raw_text, master_id, source)
  -- Best-effort match to the canonical catalogue via the flattened
  -- name+alias lookup. A miss still records raw_text: knowing a test was
  -- asked for is useful even when we cannot name it canonically.
  SELECT t.request_id, 'TEST', t.item, ml.master_id, 'notes'
  FROM (
    SELECT r.id AS request_id,
           TRIM(BOTH ' .;' FROM unnest(string_to_array(
             (regexp_match(r.notes,
                'Tests?\s+to\s+be\s+done\s*:\s*(.*?)(?:Request\s+Received|Date\s+of\s+Admission|Diagnosis\s*:|$)',
                'is'))[1], ','))) AS item
    FROM src_local."Request" r
    WHERE r.notes ~* 'Tests?\s+to\s+be\s+done\s*:'
  ) t
  LEFT JOIN analytics.mv_master_lookup ml ON ml.norm = lower(t.item)
  WHERE NULLIF(t.item,'') IS NOT NULL AND length(t.item) BETWEEN 2 AND 120
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  RETURN QUERY SELECT p, m, n;
END $$;

SELECT * FROM atlas.sync_request_items();

-- ---------------------------------------------------------------------------
-- Which labs can collect in which pincode.
--
-- A lab reaches a pincode for home collection two ways: it sits there, or the
-- pincode is in its serviced list. 198 labs and ~40k serviced pairs, so this
-- flattens to a small table and turns every serviceability question into a
-- join instead of an array scan.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_lab_pincode_home CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_lab_pincode_home AS
SELECT DISTINCT pu.source_id AS lab_id, p.pincode
FROM analytics.mv_provider_unified pu
CROSS JOIN LATERAL (
  SELECT pu.pincode AS pincode
  UNION
  SELECT unnest(COALESCE(pu.serviced_pincodes, ARRAY[]::text[]))
) p
WHERE pu.kind IN ('LAB','HOSPITAL')
  AND 'HOME_SAMPLE' = ANY(pu.modalities)
  AND NULLIF(TRIM(p.pincode),'') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lab_pincode_home_pin ON analytics.mv_lab_pincode_home (pincode);
CREATE INDEX IF NOT EXISTS idx_lab_pincode_home_lab ON analytics.mv_lab_pincode_home (lab_id);

-- ---------------------------------------------------------------------------
-- What each lab can actually do, as one flat (lab, item) list.
--
-- Packages come from the priced catalogue — a lab that has no b2b rate for a
-- package cannot quote it, so price and availability are the same fact here.
-- Tests come from DOS, the per-lab rate card. Unioning them means the
-- classification asks one question regardless of what was requested.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_lab_offering CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_lab_offering AS
SELECT lp.lab_id, 'PACKAGE'::text AS kind, lp.package_id AS item_id, lp.b2b AS cost
FROM analytics.mv_lab_packages lp
WHERE lp.b2b > 0
UNION ALL
SELECT d.lab_id, 'TEST', d.master_id, COALESCE(d."labCost", d.price)
FROM src_local."DOS" d
WHERE d.master_id IS NOT NULL
  AND COALESCE(d.active, true)
  AND COALESCE(d."labCost", d.price) > 0;

CREATE INDEX IF NOT EXISTS idx_lab_offering_item ON analytics.mv_lab_offering (kind, item_id);
CREATE INDEX IF NOT EXISTS idx_lab_offering_lab  ON analytics.mv_lab_offering (lab_id);
-- ---------------------------------------------------------------------------
-- The classification. One row per request, one state each.
--
-- Serviceable means a *single* covering lab can do everything asked for.
-- Splitting a request across two labs is not something the console models, so
-- "lab A does the CBC and lab B does the ESR" is not serviceability — it is a
-- package gap wearing a disguise.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_request_state CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_request_state AS
WITH req AS (
  SELECT r.id, NULLIF(TRIM(r.pincode),'') AS pincode, r.city, r.state,
         r.status::text AS status, r."orderType"::text AS order_type,
         r."storeId", r."createdAt", r."isServiceable" AS src_flag,
         r."isConverted", r."convertedOrderId", r."preferredDateTime",
         r."quotedPrice" AS src_quoted_price
  FROM src_local."Request" r
),
-- Items we can act on. raw_text-only rows (a test name we could not resolve)
-- are counted but cannot be matched against a lab's rate card, so they are
-- tracked separately rather than silently treated as satisfied.
items AS (
  SELECT ri.request_id,
         COUNT(*) FILTER (WHERE ri.package_id IS NOT NULL OR ri.master_id IS NOT NULL)::int AS resolvable,
         COUNT(*) FILTER (WHERE ri.package_id IS NULL AND ri.master_id IS NULL)::int AS unresolved,
         COUNT(*)::int AS total_items
  FROM atlas.request_item ri GROUP BY 1
),
resolvable AS (
  SELECT DISTINCT ri.request_id, ri.kind, COALESCE(ri.package_id, ri.master_id) AS item_id
  FROM atlas.request_item ri
  WHERE ri.package_id IS NOT NULL OR ri.master_id IS NOT NULL
),
-- Labs that can collect here at all.
covering AS (
  SELECT r.id AS request_id, lph.lab_id
  FROM req r JOIN analytics.mv_lab_pincode_home lph ON lph.pincode = r.pincode
),
-- Of those, the ones that can do every resolvable item asked for.
full_service AS (
  SELECT c.request_id, c.lab_id
  FROM covering c
  JOIN resolvable rv ON rv.request_id = c.request_id
  LEFT JOIN analytics.mv_lab_offering lo
         ON lo.lab_id = c.lab_id AND lo.kind = rv.kind AND lo.item_id = rv.item_id
  GROUP BY c.request_id, c.lab_id
  HAVING COUNT(*) FILTER (WHERE lo.lab_id IS NULL) = 0
),
cov_n AS (
  SELECT request_id, COUNT(DISTINCT lab_id)::int AS covering_labs FROM covering GROUP BY 1
),
full_n AS (
  SELECT request_id, COUNT(DISTINCT lab_id)::int AS full_labs FROM full_service GROUP BY 1
),
-- Cheapest lab that could do the whole job — the target for a package-gap
-- negotiation, and the reference cost when one exists.
best AS (
  SELECT DISTINCT ON (f.request_id) f.request_id, f.lab_id, SUM(lo.cost) AS cost
  FROM full_service f
  JOIN resolvable rv ON rv.request_id = f.request_id
  JOIN analytics.mv_lab_offering lo
    ON lo.lab_id = f.lab_id AND lo.kind = rv.kind AND lo.item_id = rv.item_id
  GROUP BY f.request_id, f.lab_id
  ORDER BY f.request_id, SUM(lo.cost) ASC
),
-- National reference: what the item typically costs anywhere. Used when no
-- covering lab exists, so there is no local price to anchor to.
ref AS (
  SELECT rv.request_id,
         SUM(m.med) AS cost,
         MIN(m.n)::int AS weakest_n,
         COUNT(*) FILTER (WHERE m.med IS NULL)::int AS missing
  FROM resolvable rv
  LEFT JOIN LATERAL (
    SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY lo.cost) AS med, COUNT(*) AS n
    FROM analytics.mv_lab_offering lo
    WHERE lo.kind = rv.kind AND lo.item_id = rv.item_id
  ) m ON true
  GROUP BY rv.request_id
),
-- Distance to the nearest lab of any kind, for the markup band and to tell a
-- known candidate from an unknown supply gap.
pin AS (
  SELECT DISTINCT r.pincode FROM req r WHERE r.pincode IS NOT NULL
),
-- atlas.pincode_directory, not src."PincodeToLatLong".
--
-- The source table is foreign, on a hot standby, and a lateral nearest-lab
-- join against it issues one remote scan per pincode — the exact shape that
-- has twice killed a refresh with "conflict with recovery". The directory is
-- local, already maintained, and carries the same centroids.
pin_geo AS (
  SELECT p.pincode, pd.latitude AS lat, pd.longitude AS lng
  FROM pin p
  JOIN atlas.pincode_directory pd ON pd.pincode = p.pincode
  WHERE pd.latitude IS NOT NULL AND pd.longitude IS NOT NULL
),
nearest AS (
  SELECT g.pincode, n.lab_id AS nearest_lab_id, ROUND(n.km::numeric, 1) AS nearest_km
  FROM pin_geo g
  CROSS JOIN LATERAL (
    SELECT pu.source_id AS lab_id,
           6371 * acos(GREATEST(-1, LEAST(1,
             cos(radians(g.lat)) * cos(radians(pu.latitude)) *
             cos(radians(pu.longitude) - radians(g.lng)) +
             sin(radians(g.lat)) * sin(radians(pu.latitude))))) AS km
    FROM analytics.mv_provider_unified pu
    WHERE pu.kind IN ('LAB','HOSPITAL')
      AND pu.latitude IS NOT NULL AND pu.longitude IS NOT NULL
      -- bbox prefilter: 1.5° ≈ 165 km, comfortably wider than any band
      AND pu.latitude BETWEEN g.lat - 1.5 AND g.lat + 1.5
      AND pu.longitude BETWEEN g.lng - 1.5 AND g.lng + 1.5
    ORDER BY km ASC LIMIT 1
  ) n
)
SELECT
  r.id AS request_id, r.pincode, r.city, r.state AS state_name, r.status, r.order_type,
  r."storeId" AS store_id, r."createdAt" AS created_at, r.src_flag,
  r."isConverted" AS is_converted, r."convertedOrderId" AS order_id,
  r."preferredDateTime" AS preferred_at, r.src_quoted_price,
  COALESCE(i.total_items,0) AS items_total,
  COALESCE(i.resolvable,0)  AS items_resolvable,
  COALESCE(i.unresolved,0)  AS items_unresolved,
  COALESCE(cn.covering_labs,0) AS covering_labs, COALESCE(fn.full_labs,0) AS full_labs,
  b.lab_id AS best_lab_id, ROUND(b.cost::numeric,2) AS best_lab_cost,
  ROUND(ref.cost::numeric,2) AS reference_cost,
  ref.weakest_n AS reference_n, COALESCE(ref.missing,0) AS reference_missing,
  n.nearest_lab_id, n.nearest_km,
  CASE
    WHEN r.pincode IS NULL                       THEN 'NO_PINCODE'
    WHEN COALESCE(i.resolvable,0) = 0            THEN 'NO_ITEMS'
    WHEN COALESCE(fn.full_labs,0) > 0            THEN 'SERVICEABLE'
    WHEN COALESCE(cn.covering_labs,0) > 0        THEN 'PACKAGE_GAP'
    WHEN n.nearest_km IS NOT NULL
     AND n.nearest_km <= atlas.request_setting('known_candidate_km')::numeric
                                                 THEN 'SUPPLY_GAP_KNOWN'
    ELSE 'SUPPLY_GAP_UNKNOWN'
  END AS state
FROM req r
LEFT JOIN items i   ON i.request_id = r.id
LEFT JOIN cov_n cn  ON cn.request_id = r.id
LEFT JOIN full_n fn ON fn.request_id = r.id
LEFT JOIN best b    ON b.request_id = r.id
LEFT JOIN ref       ON ref.request_id = r.id
LEFT JOIN nearest n ON n.pincode = r.pincode;

CREATE UNIQUE INDEX IF NOT EXISTS idx_request_state_id ON analytics.mv_request_state (request_id);
CREATE INDEX IF NOT EXISTS idx_request_state_state ON analytics.mv_request_state (state);
CREATE INDEX IF NOT EXISTS idx_request_state_pin ON analytics.mv_request_state (pincode);
CREATE INDEX IF NOT EXISTS idx_request_state_created ON analytics.mv_request_state (created_at DESC);
-- ---------------------------------------------------------------------------
-- Commitment lifecycle.
--
-- Open: an order exists for the request and sits on the placeholder lab.
-- Close: that order has moved onto a real lab.
--
-- Both are detected, never reported. LabStack records no event for either —
-- Order.assignedAt is unpopulated across the whole table — so the transition
-- is found by comparing the order's current labId against what we last saw.
-- Nobody writes a status update; moving the order off the placeholder IS the
-- status update, which is what keeps the network handover from rotting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.sync_commitments()
RETURNS TABLE (opened int, closed int, expired int)
LANGUAGE plpgsql AS $$
DECLARE ph int := atlas.request_setting('placeholder_lab_id')::int;
        o int; c int; e int;
BEGIN
  -- Open a commitment for every order parked on the placeholder that does not
  -- have one yet. Quote and date are captured from the live view at the moment
  -- the obligation appears — later policy changes must not silently rewrite a
  -- promise already made to a store.
  INSERT INTO atlas.commitment
    (request_id, order_id, state, promised_date, quoted_price, price_basis,
     markup_pct, reference_n, target_lab_id, attributed_to)
  SELECT q.request_id, ord.id, q.state,
         COALESCE(q.promised_date, atlas.add_working_days(CURRENT_DATE, 3)),
         q.quote_price, q.price_basis, q.markup_pct, q.reference_n,
         COALESCE(q.best_lab_id, q.nearest_lab_id),
         (SELECT id FROM atlas.users WHERE role = 'network' AND active ORDER BY id LIMIT 1)
  FROM src_local."Order" ord
  JOIN analytics.v_request_quote q ON q.order_id = ord.id
  WHERE ord."labId" = ph
    -- Live orders only. An order that already reached a terminal status is
    -- not an outstanding promise, whatever lab it is sitting on — the first
    -- run without this guard opened 410 "urgent" commitments that were all
    -- delivered months ago.
    AND ord."orderStatus"::text NOT IN
        ('REPORT_DELIVERED','CANCELED','PATIENT_MISSED','SAMPLE_PROCESSED')
  ON CONFLICT (request_id) DO NOTHING;
  GET DIAGNOSTICS o = ROW_COUNT;

  -- Close: the order has left the placeholder. Whoever held the commitment
  -- gets the credit, because Atlas already knew who that was.
  UPDATE atlas.commitment cm
     SET closed_at = now(), allocated_lab_id = ord."labId",
         outcome = 'allocated', updated_at = now()
  FROM src_local."Order" ord
  WHERE ord.id = cm.order_id
    AND cm.closed_at IS NULL
    AND ord."labId" IS DISTINCT FROM ph;
  GET DIAGNOSTICS c = ROW_COUNT;

  -- Terminal while still on the placeholder. Cancelled means the promise died
  -- with the order; delivered-without-reallocation means it was served but the
  -- allocation was never recorded, which is the exact hole this feature closes
  -- and is worth distinguishing from a clean allocation.
  UPDATE atlas.commitment cm
     SET closed_at = now(), updated_at = now(),
         outcome = CASE WHEN ord."orderStatus"::text = 'CANCELED'
                        THEN 'cancelled' ELSE 'expired' END,
         notes = CASE WHEN ord."orderStatus"::text <> 'CANCELED'
                      THEN 'Reached ' || ord."orderStatus"::text ||
                           ' without ever leaving the placeholder lab'
                      ELSE cm.notes END
  FROM src_local."Order" ord
  WHERE ord.id = cm.order_id
    AND cm.closed_at IS NULL
    AND ord."orderStatus"::text IN
        ('CANCELED','REPORT_DELIVERED','PATIENT_MISSED','SAMPLE_PROCESSED');
  GET DIAGNOSTICS e = ROW_COUNT;

  RETURN QUERY SELECT o, c, e;
END $$;

-- ---------------------------------------------------------------------------
-- The network bucket: every open promise, most urgent first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_commitment_queue AS
SELECT cm.id AS commitment_id, cm.request_id, cm.order_id, cm.state,
       sp.label AS state_label,
       cm.promised_date, cm.quoted_price, cm.price_basis, cm.target_lab_id,
       (cm.promised_date - CURRENT_DATE)::int AS days_left,
       cm.promised_date < CURRENT_DATE AS breached,
       s.pincode, s.city, s.state_name, s.store_id, s.nearest_km,
       tl."labName" AS target_lab_name, tl.city AS target_lab_city,
       -- What the network team has to actually achieve, spelled out rather
       -- than left to be worked out from the state name.
       CASE cm.state
         WHEN 'PACKAGE_GAP'      THEN 'Activate the requested items at ' || COALESCE(tl."labName", 'the covering lab')
         WHEN 'SUPPLY_GAP_KNOWN' THEN 'Onboard ' || COALESCE(tl."labName", 'the nearest lab') ||
                                      ' (' || COALESCE(s.nearest_km::text,'?') || ' km) for home collection'
         ELSE 'Find and onboard a lab for this pincode'
       END AS ask,
       (SELECT COUNT(*) FROM atlas.discovered_lab dl
         WHERE dl.pincode = s.pincode AND NOT dl.dismissed)::int AS web_leads,
       u.name AS attributed_to_name
FROM atlas.commitment cm
JOIN analytics.mv_request_state s ON s.request_id = cm.request_id
LEFT JOIN atlas.slot_policy sp ON sp.state = cm.state
LEFT JOIN src_local."Lab" tl ON tl.id = cm.target_lab_id
LEFT JOIN atlas.users u ON u.id = cm.attributed_to
WHERE cm.closed_at IS NULL;
-- ---------------------------------------------------------------------------
-- Step 7: closing a commitment writes the CRM record.
--
-- The network team onboards a lab in the console and moves the order onto it.
-- That move is the only trace of their work anywhere in the system, so closing
-- the commitment is also when the lab enters CRM and gets attributed. If this
-- were a separate manual step it would be the step that never happens.
--
-- source='commitment' marks these apart from labs added by hand, so it stays
-- visible which relationships came out of a promise under time pressure.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.close_commitment_to_crm()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH allocated AS (
    SELECT cm.id, cm.allocated_lab_id, cm.attributed_to, cm.request_id,
           l."labName", l.city, l.state, l.pincode
    FROM atlas.commitment cm
    JOIN src_local."Lab" l ON l.id = cm.allocated_lab_id
    WHERE cm.outcome = 'allocated'
      AND cm.allocated_lab_id IS NOT NULL
      -- Not already represented in CRM by this lab id.
      AND NOT EXISTS (
        SELECT 1 FROM atlas.crm_providers cp WHERE cp.source_lab_id = cm.allocated_lab_id
      )
  ),
  ins AS (
    INSERT INTO atlas.crm_providers
      (name, kind, city, state, pincode, source, source_lab_id, created_by, notes)
    SELECT a."labName", 'LAB', a.city, a.state, a.pincode,
           'commitment', a.allocated_lab_id, a.attributed_to,
           'Onboarded to fulfil request #' || a.request_id
    FROM allocated a
    ON CONFLICT DO NOTHING
    RETURNING source_lab_id
  )
  SELECT COUNT(*)::int INTO n FROM ins;

  -- Link the commitment to whatever CRM row now represents that lab, whether
  -- we just created it or it already existed.
  UPDATE atlas.commitment cm
     SET notes = COALESCE(cm.notes, '') ||
                 CASE WHEN cm.notes IS NULL THEN '' ELSE ' · ' END ||
                 'CRM provider #' || cp.id,
         updated_at = now()
  FROM atlas.crm_providers cp
  WHERE cp.source_lab_id = cm.allocated_lab_id
    AND cm.outcome = 'allocated'
    AND COALESCE(cm.notes, '') NOT LIKE '%CRM provider #%';

  RETURN n;
END $$;

-- Fold it into the poller so there is one entry point, not two to remember.
CREATE OR REPLACE FUNCTION atlas.sync_commitments_full()
RETURNS TABLE (opened int, closed int, expired int, crm_created int)
LANGUAGE plpgsql AS $$
DECLARE r record; c int;
BEGIN
  SELECT * INTO r FROM atlas.sync_commitments();
  SELECT atlas.close_commitment_to_crm() INTO c;
  RETURN QUERY SELECT r.opened, r.closed, r.expired, c;
END $$;

-- ---------------------------------------------------------------------------
-- Promote a web lead into CRM. A human act — this only records the decision.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.promote_discovered_lab(lead_id int, by_user int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE new_id int; d record;
BEGIN
  SELECT * INTO d FROM atlas.discovered_lab WHERE id = lead_id;
  IF d IS NULL THEN RAISE EXCEPTION 'No discovered lab %', lead_id; END IF;
  IF d.crm_provider_id IS NOT NULL THEN RETURN d.crm_provider_id; END IF;

  INSERT INTO atlas.crm_providers
    (name, kind, city, state, pincode, phone, source, created_by, notes)
  VALUES (d.name, 'LAB', d.city, d.state, d.pincode, d.phone,
          'discovered', by_user,
          'Found by web search on ' || d.retrieved_at::date ||
          COALESCE(' · ' || d.source_url, '') ||
          ' · UNVERIFIED at promotion — confirm before relying on it')
  RETURNING id INTO new_id;

  UPDATE atlas.discovered_lab
     SET crm_provider_id = new_id, verified_by = by_user, verified_at = now()
   WHERE id = lead_id;

  RETURN new_id;
END $$;
