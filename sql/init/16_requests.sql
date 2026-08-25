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

-- ---------------------------------------------------------------------------
-- Snapshot prerequisites.
--
-- v_request_quote reads src_local."PackagesOnStore" for the store-price half
-- of the pricing chain. On a host that has not run the refresh since that
-- table was added to the copy list, it does not exist yet and the whole file
-- aborts at the view — which is exactly how this failed on production, for the
-- second time, from the same cause: a schema file assuming a prerequisite
-- rather than guaranteeing one.
--
-- Bootstrap it here instead. Identifiers are quoted: to_regclass folds an
-- unquoted name to lower case and would never match "PackagesOnStore".
-- ---------------------------------------------------------------------------
DO $bootstrap$
DECLARE t text; has_rows boolean;
BEGIN
  -- Every source table this file's views read out of src_local. A snapshot is
  -- created on demand when it is missing, because the alternative is what has
  -- now happened four times: the file aborts partway, the DROP ... CASCADE at
  -- the top of a view has already run, and production is left worse than
  -- before. It is never caught locally, where the table was made by hand.
  FOREACH t IN ARRAY ARRAY['PackagesOnStore', 'LabsOnStore'] LOOP
    -- Already populated: nothing to do.
    IF to_regclass(format('src_local.%I', t)) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM src_local.%I)', t) INTO has_rows;
      IF has_rows THEN
        CONTINUE;
      END IF;

      -- Exists but empty. This is the stuck state a previous run of this
      -- bootstrap creates when the FDW import is missing: the table is made
      -- once, stays empty forever, and every later run skips it because it
      -- exists. Production sat in exactly this state with the store-lab gate
      -- silently disengaged. Fill it if the source is reachable now.
      IF to_regclass(format('src.%I', t)) IS NOT NULL THEN
        EXECUTE format('INSERT INTO src_local.%I SELECT * FROM src.%I', t, t);
        RAISE NOTICE 'Filled empty src_local.% from the foreign table.', t;
      ELSE
        RAISE WARNING 'src_local.% is empty and src.% is not imported — anything reading it stays blank.', t, t;
      END IF;
      CONTINUE;
    END IF;

    IF to_regclass(format('src.%I', t)) IS NOT NULL THEN
      EXECUTE format('CREATE TABLE src_local.%I (LIKE src.%I)', t, t);
      EXECUTE format('INSERT INTO src_local.%I SELECT * FROM src.%I', t, t);
      RAISE NOTICE 'Bootstrapped src_local.% from the foreign table.', t;
    ELSE
      -- Not even imported over the FDW. Create an empty table of the right
      -- shape so the views still build; the columns that read it come back
      -- blank until the next refresh, which is a far better outcome than
      -- refusing to build the request pipeline at all.
      IF t = 'PackagesOnStore' THEN
        EXECUTE 'CREATE TABLE src_local."PackagesOnStore" (
                   "storeId" integer, "packageId" integer,
                   "storePrice" integer, "storeMrp" integer)';
      ELSIF t = 'LabsOnStore' THEN
        EXECUTE 'CREATE TABLE src_local."LabsOnStore" (
                   "storeId" integer, "labId" integer, "storeLabRanking" integer)';
      END IF;
      RAISE WARNING 'src.% is not imported — created an empty src_local.%; anything reading it will be blank until the next refresh.', t, t;
    END IF;
  END LOOP;

  -- Indexes the views depend on for these to be joins rather than scans.
  EXECUTE 'CREATE INDEX IF NOT EXISTS idx_labs_on_store ON src_local."LabsOnStore" ("storeId", "labId")';
END
$bootstrap$;

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
DECLARE p int := 0; m int := 0; n int := 0;
BEGIN
  -- The join tables arrive via the refresh's self-bootstrap, which may not
  -- have run yet on a freshly deployed host. Missing snapshots are a "not
  -- yet", not a failure: parse what is available and report zero for the rest.
  -- Quote the identifiers. to_regclass folds an unquoted name to lower case,
  -- so to_regclass('src_local._PackageToRequest') looks for
  -- src_local._packagetorequest, never finds it, and the guard fires every
  -- time — which is how this function silently did nothing at all on its first
  -- production run while reporting success.
  IF to_regclass('src_local."_PackageToRequest"') IS NULL
     OR to_regclass('src_local."_MasterToRequest"') IS NULL THEN
    -- Loud, not a notice. A missing prerequisite that returns zeros looks
    -- identical to "there was nothing to do", and the whole queue reads
    -- "nothing identifiable requested" with no clue why.
    RAISE EXCEPTION 'Request join tables not snapshotted yet — import _PackageToRequest and _MasterToRequest first (see docs/RUNBOOK-requests.md).';
  END IF;

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
                'Tests?\s+to\s+be\s+done\s*:\s*(.*?)' ||
                -- Every field name that has been seen following the test list.
                -- Missing one leaks the rest of the note in as a "test":
                -- "CRP Request Received Date: 2026-03-18 Hospital Code: ..."
                -- arrived as a single item before Hospital Code and HRM were
                -- added here.
                '(?:Request\s+Received|Date\s+of\s+Admission|Hospital\s+Code|HRM\s*:|' ||
                'Diagnosis\s*:|Patient\s+Name|Contact\s*:|$)',
                'is'))[1], ','))) AS item
    FROM src_local."Request" r
    WHERE r.notes ~* 'Tests?\s+to\s+be\s+done\s*:'
  ) t
  LEFT JOIN analytics.mv_master_lookup ml ON ml.norm = lower(t.item)
  WHERE NULLIF(t.item,'') IS NOT NULL
    AND length(t.item) BETWEEN 2 AND 60
    -- A test name has no colon, no date and no phone number in it. Whatever
    -- the regex above lets through, this catches: better to lose an oddly
    -- written test than to show a hospital code as the thing a patient asked
    -- for.
    AND t.item !~ ':'
    AND t.item !~ '\d{4}-\d{2}-\d{2}'
    AND t.item !~ '\d{10}'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;

  RETURN QUERY SELECT p, m, n;
END $$;
-- ===========================================================================
-- Helper functions.
--
-- Defined here, above every view and materialized view in this file, because
-- they are referenced by them. Appending a function to the end of the file
-- and expecting a view 300 lines earlier to find it is a mistake this file
-- has now made three times — and it only shows up on a host where the
-- function does not already exist, which is never the machine it was written
-- on.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- What kind of place can actually do this test.
--
-- LabStack's own taxonomy cannot answer this: testCategory is only
-- ROUTINE/NON_ROUTINE, and LabDepartment lists nine pathology disciplines with
-- no imaging among them. Yet 1,913 catalogue entries are X-rays, ultrasounds,
-- CT and MRI — work no pathology lab can take, however well equipped.
--
-- So it is inferred from the name, which is the only signal there is. Kept
-- deliberately narrow: a false RADIOLOGY sends the network team looking for an
-- imaging centre that was never needed, which wastes a call, while a missed one
-- just leaves the default. Bare "scan" is excluded for that reason — it appears
-- in plenty of pathology names.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.test_discipline(test_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN test_name IS NULL THEN 'PATHOLOGY'
    WHEN test_name ~* '(x-?ray|ultraso|\musg\M|sonograph|\mmri\M|\mct\M|ct scan|mammogra|doppler|\mopg\M|radiolog|imaging|fluorosco|angiograph|\mdexa\M|bone densito)'
      THEN 'RADIOLOGY'
    WHEN test_name ~* '(\mecg\M|\mekg\M|echocardio|\mtmt\M|holter|spirometr|\mpft\M|\meeg\M|\memg\M|audiometr)'
      THEN 'CARDIO_DIAGNOSTIC'
    ELSE 'PATHOLOGY'
  END
$$;

-- Human wording for each, used in the UI and in the search prompt.
CREATE OR REPLACE FUNCTION atlas.discipline_label(d text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE d
    WHEN 'RADIOLOGY'         THEN 'Radiology / imaging'
    WHEN 'CARDIO_DIAGNOSTIC' THEN 'Cardiac & functional testing'
    ELSE 'Pathology'
  END
$$;


-- ---------------------------------------------------------------------------
-- Day boundaries in IST, not UTC.
--
-- The container runs UTC, so date_trunc('day', now()) put the start of "today"
-- at 05:30 IST — every request from an Indian midnight to half past five in the
-- morning fell outside it — and after 18:30 UTC the window silently meant
-- yesterday. For a queue an Indian ops team works by the day, that is wrong for
-- roughly a quarter of every day.
--
-- Returns a naive timestamp in UTC, matching the source columns, which Prisma
-- writes as `timestamp without time zone`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.ist_midnight(days_ago int DEFAULT 0)
RETURNS timestamp LANGUAGE sql STABLE AS $$
  SELECT (date_trunc('day', (now() AT TIME ZONE 'Asia/Kolkata')) - make_interval(days => days_ago))
           AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC'
$$;

/** Today's date as an Indian ops person means it. */
CREATE OR REPLACE FUNCTION atlas.ist_today()
RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date
$$;


-- Deliberately NOT run here. This file defines the pipeline; it does not
-- execute it. On a fresh install the src_local snapshots do not exist yet, so
-- calling the sync from a DDL file aborts the rest of the script — which is
-- exactly how it failed the first time it met production. The nightly refresh
-- (Phase 4.6) and the deploy runbook call it, in the right order, once the
-- snapshots are there.

-- ---------------------------------------------------------------------------
-- Is the store-to-lab contract usable?
--
-- The gate below narrows coverage to labs a store is contracted with. If the
-- mapping table is empty — not imported yet, or a refresh that has not run —
-- an unguarded gate matches nothing and every request with a store silently
-- becomes a supply gap. That is a worse failure than the one it fixes, because
-- it looks like an answer rather than an error.
--
-- So the gate only applies when there is a contract to apply. Absent data
-- means "we do not know", which has to fail open.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.store_lab_gate_active()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM src_local."LabsOnStore")
$$;

-- ---------------------------------------------------------------------------
-- Where a lab has actually collected, as opposed to where it says it will.
--
-- Lab."pincodesServiced" is the only serviceability signal Atlas has, and it is
-- a claim rather than a fact. Eight national chains account for 74% of the
-- whole coverage map, each listing two to four thousand pincodes, and only
-- 12.7% of those lab-pincode pairs have ever carried a real order. That is why
-- the same handful of labs appears against every request in the country, and
-- why the console — which checks something stricter, an API call for the
-- integrated partners — can disagree with us about a specific pincode.
--
-- This is the harder evidence: a delivered order from that pincode, fulfilled
-- by that lab. It does not replace the claim (a lab has to serve somewhere for
-- the first time), but it lets the UI put proven coverage first and label the
-- rest honestly.
--
-- Order carries no pincode; the patient's is on Profile, reached through User,
-- which is how mv_pincode_demand already does it.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_lab_pincode_served CASCADE;
CREATE MATERIALIZED VIEW analytics.mv_lab_pincode_served AS
SELECT o."labId" AS lab_id, p.pincode,
       COUNT(*)::int AS orders,
       MAX(o."createdAt") AS last_served
FROM src_local."Order" o
JOIN src."User" u    ON u.id = o."userId"
JOIN src."Profile" p ON p."profileUserId" = u.id
WHERE o."labId" IS NOT NULL
  AND NULLIF(TRIM(p.pincode), '') IS NOT NULL
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_pincode_served_key
  ON analytics.mv_lab_pincode_served (lab_id, pincode);

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
  AND NULLIF(TRIM(p.pincode),'') IS NOT NULL
  -- Not the placeholder. Lab id 1 is where orders park when nobody has been
  -- found to serve them, so counting it as supply says the network can serve a
  -- pincode precisely because it could not. It claimed 623 pincodes and made 55
  -- requests read serviceable on its own.
  AND pu.source_id <> atlas.request_setting('placeholder_lab_id')::int;

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
--
-- Gated on LabsOnStore, the store-to-lab contract. Without it Atlas offered
-- every home-collection lab in the country for every request, while the console
-- only ever offers the labs mapped to that request's store — 16 to 31 of them,
-- not 198. The evidence is unambiguous: of 3,650 Star Health orders and 705
-- Sugarfit orders, every single one was fulfilled by a mapped lab.
--
-- A request with no store cannot be gated, so it keeps the unrestricted list;
-- that is a small minority and better than dropping them entirely.
covering AS (
  SELECT r.id AS request_id, lph.lab_id
  FROM req r
  JOIN analytics.mv_lab_pincode_home lph ON lph.pincode = r.pincode
  WHERE r."storeId" IS NULL
     OR NOT atlas.store_lab_gate_active()
     OR EXISTS (SELECT 1 FROM src_local."LabsOnStore" los
                 WHERE los."storeId" = r."storeId" AND los."labId" = lph.lab_id)
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

-- Working days: a two-day promise made on Friday means Tuesday, not Sunday.
-- Deliberately simple — no public-holiday calendar, because a wrong holiday
-- list would quietly move dates and nobody would notice for weeks.
CREATE OR REPLACE FUNCTION atlas.add_working_days(from_date date, n int)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d date := from_date; left_ int := GREATEST(n, 0);
BEGIN
  IF n IS NULL THEN RETURN NULL; END IF;
  WHILE left_ > 0 LOOP
    d := d + 1;
    IF EXTRACT(isodow FROM d) < 7 THEN left_ := left_ - 1; END IF;
  END LOOP;
  RETURN d;
END $$;

-- ---------------------------------------------------------------------------
-- The answer ops reads: state, price, date, and why.
--
-- A view rather than a materialized one on purpose. Markup bands and lead
-- times are config, and a pricing change that needs a refresh before it takes
-- effect is a pricing change someone will forget to apply.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW analytics.v_request_quote AS
SELECT
  s.*,
  sp.label      AS state_label,
  sp.lead_days,
  -- Reference cost, strongest basis first. A covering lab that can do the
  -- whole job is a real local price; the national median is an inference.
  CASE WHEN s.best_lab_cost IS NOT NULL THEN s.best_lab_cost
       WHEN s.reference_missing = 0     THEN s.reference_cost
       ELSE NULL END                                          AS basis_cost,
  CASE WHEN s.best_lab_cost IS NOT NULL THEN 'covering_lab'
       WHEN s.reference_missing = 0     THEN 'network_median'
       WHEN s.reference_cost IS NOT NULL THEN 'partial'
       ELSE 'none' END                                        AS price_basis,
  qm.markup_pct,
  qm.label AS markup_label,
  -- The quote itself. NULL whenever any input is missing — a confidently
  -- wrong number is worse than a blank with a reason, because ops will send it.
  CASE
    WHEN s.state = 'SERVICEABLE' THEN NULL      -- console converts it directly
    WHEN qm.markup_pct IS NULL   THEN NULL      -- beyond the bands: price by hand
    WHEN s.reference_missing > 0 THEN NULL      -- we cannot price part of the ask
    WHEN COALESCE(s.best_lab_cost, s.reference_cost) IS NULL THEN NULL
    ELSE ROUND(COALESCE(s.best_lab_cost, s.reference_cost) * (1 + qm.markup_pct/100.0), 0)
  END                                                          AS quote_price,
  -- Promised date. Bounded below by the policy lead time; NULL where policy
  -- says do not promise. Working days only.
  CASE WHEN sp.lead_days IS NULL THEN NULL
       ELSE atlas.add_working_days(CURRENT_DATE, sp.lead_days) END AS promised_date,
  CASE
    WHEN s.state = 'SERVICEABLE'        THEN 'Convert in console — a covering lab already offers this'
    WHEN s.state = 'NO_ITEMS'           THEN 'Cannot tell what was requested — no package, test or parseable note'
    WHEN s.state = 'NO_PINCODE'         THEN 'No pincode on the request, so it cannot be placed'
    WHEN s.state = 'PACKAGE_GAP'        THEN
      s.covering_labs || ' lab(s) cover this pincode; none carry the full request'
    WHEN s.state = 'SUPPLY_GAP_KNOWN'   THEN
      'No covering lab; nearest is ' || s.nearest_km || ' km away and onboardable'
    ELSE 'No lab within range — escalate rather than promise'
  END                                                          AS reason,
  c.id AS commitment_id, c.promised_date AS committed_date,
  c.quoted_price AS committed_price, c.closed_at, c.outcome,
  -- Everything below exists so the row is readable without opening it. Ops
  -- and the network team both said the same thing: if the answer needs a
  -- click, the click is the work.
  it.packages, it.tests, it.item_names, it.unnamed,
  (SELECT ARRAY_AGG(DISTINCT d ORDER BY d) FROM unnest(it.disciplines_raw) d) AS disciplines,
  lb.labs_ready, lb.labs_covering, lb.missing_items,
  st."storeName" AS store_name,
  -- Pricing, shown as a chain rather than a single number. A quote is only
  -- defensible if you can see what it was built from: what the store already
  -- pays, what the network actually charges, and what we added on top.
  spr.store_price, spr.store_mrp,
  cs.cost_min, cs.cost_avg, cs.cost_max, cs.cost_labs
FROM analytics.mv_request_state s
-- What this store already pays us for the same package, where such a rate
-- exists. It is the strongest sanity check on a quote we have: a number far
-- from it needs a reason.
LEFT JOIN LATERAL (
  SELECT MAX(pos."storePrice")::numeric AS store_price,
         MAX(pos."storeMrp")::numeric   AS store_mrp
  FROM atlas.request_item ri
  JOIN src_local."PackagesOnStore" pos
    ON pos."packageId" = ri.package_id AND pos."storeId" = s.store_id
  WHERE ri.request_id = s.request_id AND ri.package_id IS NOT NULL
) spr ON true
-- The spread of what labs charge for this ask across the whole network. The
-- median drives the quote; the range is what tells you whether the median
-- means anything.
LEFT JOIN LATERAL (
  SELECT ROUND(MIN(m.lo)::numeric, 0)  AS cost_min,
         ROUND(AVG(m.avg)::numeric, 0) AS cost_avg,
         ROUND(MAX(m.hi)::numeric, 0)  AS cost_max,
         MIN(m.n)::int                 AS cost_labs
  FROM (
    SELECT DISTINCT ri.kind, COALESCE(ri.package_id, ri.master_id) AS item_id
    FROM atlas.request_item ri
    WHERE ri.request_id = s.request_id
      AND (ri.package_id IS NOT NULL OR ri.master_id IS NOT NULL)
  ) w
  CROSS JOIN LATERAL (
    SELECT MIN(lo.cost) AS lo, AVG(lo.cost) AS avg, MAX(lo.cost) AS hi, COUNT(*) AS n
    FROM analytics.mv_lab_offering lo
    WHERE lo.kind = w.kind AND lo.item_id = w.item_id
  ) m
) cs ON true
-- Item names, aggregated once per request rather than per render.
LEFT JOIN LATERAL (
  SELECT
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT p."packageName") FILTER (WHERE p.id IS NOT NULL), NULL) AS packages,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT m.name)         FILTER (WHERE m.id IS NOT NULL), NULL) AS tests,
    -- Catalogue-matched names first: an unresolved raw string is the least
    -- useful thing in the list and should not win the two slots the row shows.
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(p."packageName", m.name, ri.raw_text)
      ORDER BY COALESCE(p."packageName", m.name, ri.raw_text)) FILTER (
        WHERE p.id IS NOT NULL OR m.id IS NOT NULL), NULL)
    || ARRAY_REMOVE(ARRAY_AGG(DISTINCT ri.raw_text) FILTER (
        WHERE p.id IS NULL AND m.id IS NULL), NULL) AS item_names,
    -- What kind of centre this request needs. A package is judged by its
    -- components, not its name: "Full Body Checkup" says nothing about whether
    -- an ultrasound is inside it.
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT atlas.test_discipline(
      COALESCE(m.name, ri.raw_text))) FILTER (WHERE m.id IS NOT NULL OR ri.raw_text IS NOT NULL), NULL)
    || COALESCE((
        SELECT ARRAY_AGG(DISTINCT atlas.test_discipline(m2.name))
        FROM atlas.request_item ri2
        JOIN src_local."_MasterToPackage" mp2 ON mp2."B" = ri2.package_id
        JOIN src_local."Master" m2 ON m2.id = mp2."A"
        WHERE ri2.request_id = s.request_id AND ri2.package_id IS NOT NULL
      ), ARRAY[]::text[]) AS disciplines_raw,
    COUNT(*) FILTER (WHERE p.id IS NULL AND m.id IS NULL)::int AS unnamed
  FROM atlas.request_item ri
  LEFT JOIN src_local."Package" p ON p.id = ri.package_id
  LEFT JOIN src_local."Master"  m ON m.id = ri.master_id
  WHERE ri.request_id = s.request_id
) it ON true
-- Who can serve it, and what the nearest-to-ready lab still lacks. Capped at
-- three names: a row is a summary, and the detail page carries the full list.
LEFT JOIN LATERAL (
  SELECT
    ARRAY_REMOVE((ARRAY_AGG(l."labName" ORDER BY x.missing ASC, l."labName")
                  FILTER (WHERE x.missing = 0))[1:3], NULL) AS labs_ready,
    ARRAY_REMOVE((ARRAY_AGG(l."labName" ORDER BY x.missing ASC, l."labName"))[1:3], NULL) AS labs_covering,
    -- The nearest-to-ready lab's shortfall.
    --
    -- Taken from the row rather than aggregated: ARRAY_AGG over an array
    -- column builds a 2-D array, and subscripting that with [1] returns NULL
    -- silently rather than the first inner array.
    (ARRAY_AGG(x.missing_names ORDER BY x.missing ASC)
      FILTER (WHERE x.missing > 0))[1] AS missing_items
  FROM (
    SELECT lph.lab_id,
           COUNT(*) FILTER (WHERE lo.lab_id IS NULL)::int AS missing,
           STRING_AGG(DISTINCT
             CASE WHEN lo.lab_id IS NULL
                  THEN COALESCE(p2."packageName", m2.name) END, ', ') AS missing_names
    FROM analytics.mv_lab_pincode_home lph
    -- Same store-to-lab gate as the classification above.
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
LEFT JOIN src_local."Store" st ON st.id = s.store_id
LEFT JOIN atlas.slot_policy sp ON sp.state = s.state
LEFT JOIN LATERAL (
  SELECT q.markup_pct, q.label FROM atlas.quote_markup q
  WHERE s.nearest_km IS NOT NULL AND s.nearest_km <= q.max_km
  ORDER BY q.max_km LIMIT 1
) qm ON true
LEFT JOIN atlas.commitment c ON c.request_id = s.request_id;

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

-- ---------------------------------------------------------------------------
-- Keep the newest requests answerable.
--
-- The item links live in the nightly src_local snapshot, but the queue is
-- worked newest-first — so without this, a request created this morning shows
-- "nothing identifiable was requested" until 3 AM tomorrow, which is precisely
-- backwards. The requests ops care about most were the ones Atlas knew least
-- about.
--
-- Pulls only the rows above the high-water mark already snapshotted, so the
-- read against the standby is a small indexed range rather than a table scan.
-- Cheap enough for the five-minute poller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.topup_request_items()
RETURNS TABLE (pkg_links int, test_links int, items int)
LANGUAGE plpgsql AS $$
DECLARE p int := 0; t int := 0; i int := 0; hw int;
BEGIN
  -- Packages
  SELECT COALESCE(MAX("B"), 0) INTO hw FROM src_local."_PackageToRequest";
  INSERT INTO src_local."_PackageToRequest"
  SELECT * FROM src."_PackageToRequest" WHERE "B" > hw;
  GET DIAGNOSTICS p = ROW_COUNT;

  -- Tests
  SELECT COALESCE(MAX("B"), 0) INTO hw FROM src_local."_MasterToRequest";
  INSERT INTO src_local."_MasterToRequest"
  SELECT * FROM src."_MasterToRequest" WHERE "B" > hw;
  GET DIAGNOSTICS t = ROW_COUNT;

  -- Then fold the new links, and any notes on requests that arrived with them,
  -- into request_item. sync_request_items is idempotent, so this is safe to
  -- run as often as we like.
  SELECT (from_packages + from_masters + from_notes) INTO i
  FROM atlas.sync_request_items();

  RETURN QUERY SELECT p, t, i;
END $$;

-- ---------------------------------------------------------------------------
-- Incremental request sync.
--
-- mv_request_state reads src_local."Request", which the nightly job rebuilds at
-- 03:00. That is fine for coverage and pricing, which change slowly, and wrong
-- for a queue: a request created at 08:28 did not appear in Atlas until the
-- following morning, so the ops screen was always a day behind the console it
-- sits next to.
--
-- This pulls only what changed recently. Two things make it cheap enough to run
-- every few minutes against a hot standby:
--
--   * The cutoff is interpolated as a literal, not now(). postgres_fdw only
--     pushes down immutable expressions — with now() the whole remote table is
--     scanned and shipped, which is what caused the recovery conflicts that
--     killed the readiness refresh twice.
--   * Only rows at or after the cutoff move, so the transfer is minutes of
--     traffic rather than a year of it.
-- ---------------------------------------------------------------------------

-- The delete-then-insert below matches on id; without this it is a sequential
-- scan of the whole snapshot on every run.
CREATE INDEX IF NOT EXISTS idx_src_local_request_id ON src_local."Request" (id);

CREATE OR REPLACE FUNCTION atlas.sync_recent_requests(hours int DEFAULT 48)
RETURNS TABLE (requests int, pkg_links int, test_links int)
LANGUAGE plpgsql AS $$
DECLARE
  cutoff   timestamp := now() - make_interval(hours => hours);
  cols     text;
  r int := 0; p int := 0; m int := 0;
BEGIN
  -- Column list from the foreign table, intersected with the snapshot, so a
  -- column added at source does not break the copy.
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'src' AND c.table_name = 'Request'
    AND EXISTS (SELECT 1 FROM information_schema.columns c2
                 WHERE c2.table_schema = 'src_local' AND c2.table_name = 'Request'
                   AND c2.column_name = c.column_name);

  -- Replace rather than upsert: the snapshot carries no primary key, and a
  -- request's status changes constantly, so the newest copy always wins.
  EXECUTE format(
    'DELETE FROM src_local."Request" WHERE id IN (SELECT id FROM src."Request" WHERE "createdAt" >= %L OR "updatedAt" >= %L)',
    cutoff, cutoff);
  EXECUTE format(
    'INSERT INTO src_local."Request" (%s) SELECT %s FROM src."Request" WHERE "createdAt" >= %L OR "updatedAt" >= %L',
    cols, cols, cutoff, cutoff);
  GET DIAGNOSTICS r = ROW_COUNT;

  -- The join tables carry no timestamps, so they are refreshed for exactly the
  -- requests that just moved.
  EXECUTE format(
    'DELETE FROM src_local."_PackageToRequest" WHERE "B" IN
       (SELECT id FROM src_local."Request" WHERE "createdAt" >= %L OR "updatedAt" >= %L)', cutoff, cutoff);
  EXECUTE format(
    'INSERT INTO src_local."_PackageToRequest" SELECT pr.* FROM src."_PackageToRequest" pr
      WHERE pr."B" IN (SELECT id FROM src_local."Request" WHERE "createdAt" >= %L OR "updatedAt" >= %L)',
    cutoff, cutoff);
  GET DIAGNOSTICS p = ROW_COUNT;

  EXECUTE format(
    'DELETE FROM src_local."_MasterToRequest" WHERE "B" IN
       (SELECT id FROM src_local."Request" WHERE "createdAt" >= %L OR "updatedAt" >= %L)', cutoff, cutoff);
  EXECUTE format(
    'INSERT INTO src_local."_MasterToRequest" SELECT mr.* FROM src."_MasterToRequest" mr
      WHERE mr."B" IN (SELECT id FROM src_local."Request" WHERE "createdAt" >= %L OR "updatedAt" >= %L)',
    cutoff, cutoff);
  GET DIAGNOSTICS m = ROW_COUNT;

  PERFORM atlas.sync_request_items();
  RETURN QUERY SELECT r, p, m;
END $$;
