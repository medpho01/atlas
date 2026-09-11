-- ===========================================================================
-- Assertions for 20_lab_discovery_ranking.sql
-- ===========================================================================
--
-- Run by scripts/test-discovery-db.sh against a scratch Postgres that has had
-- sql/test/discovery_fixture.sql and then the migration applied.
--
-- Every check RAISEs on failure, so psql -v ON_ERROR_STOP=1 turns any wrong
-- answer into a non-zero exit. The interesting ones are the claim_discovery
-- branches: that WHERE clause is the only thing between a search on every page
-- load and a per-page-load API bill, and it cannot be checked by reading it.

\set ON_ERROR_STOP on
-- NOTICE, not WARNING: the per-check "ok" lines below are RAISE NOTICE, and at
-- WARNING they vanish — leaving a silent pass that proves nothing to whoever
-- is reading the output.
SET client_min_messages = NOTICE;

CREATE OR REPLACE FUNCTION pg_temp.expect(what text, got boolean, want boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'FAIL: % — expected %, got %', what, want, COALESCE(got::text, 'NULL');
  END IF;
  RAISE NOTICE '  ok   %', what;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.expect_true(what text, got boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', what; END IF;
  RAISE NOTICE '  ok   %', what;
END $$;

-- ---------------------------------------------------------------------------
\echo ''
\echo 'The migration actually landed'
-- ---------------------------------------------------------------------------
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing FROM unnest(ARRAY[
    'disciplines','disciplines_absent','services','accreditation','rating','rating_count',
    'home_collection','in_pincode','distance_km','chain','website','hours',
    'note','base_score','score_reasons','scored_at']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema='atlas' AND table_name='discovered_lab' AND column_name=c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: discovered_lab is missing %', missing;
  END IF;
  PERFORM pg_temp.expect_true('discovered_lab has all 16 new columns', true);

  SELECT string_agg(c, ', ') INTO missing FROM unnest(ARRAY['started_at','trigger']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema='atlas' AND table_name='discovery_run' AND column_name=c);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: discovery_run is missing %', missing;
  END IF;
  PERFORM pg_temp.expect_true('discovery_run has started_at and trigger', true);
END $$;

-- Trap: ran_at was NOT NULL DEFAULT now(), so a claim row would have read as
-- "searched just now, found nothing" — the one thing the card must not say.
DO $$
BEGIN
  PERFORM pg_temp.expect('discovery_run.ran_at is now nullable',
    (SELECT is_nullable = 'YES' FROM information_schema.columns
      WHERE table_schema='atlas' AND table_name='discovery_run' AND column_name='ran_at'),
    true);
END $$;

-- ---------------------------------------------------------------------------
\echo ''
\echo 'claim_discovery: every branch'
-- ---------------------------------------------------------------------------

-- 1. Never searched. No row at all.
DO $$
BEGIN
  DELETE FROM atlas.discovery_run WHERE pincode = '400001';
  PERFORM pg_temp.expect('never searched → claims it',
    atlas.claim_discovery('400001', 30, 'request_page'), true);
  -- ...and the claim row must NOT look like a completed search.
  PERFORM pg_temp.expect('the claim leaves ran_at NULL, not now()',
    (SELECT ran_at IS NULL FROM atlas.discovery_run WHERE pincode='400001'), true);
  PERFORM pg_temp.expect('the claim records started_at',
    (SELECT started_at IS NOT NULL FROM atlas.discovery_run WHERE pincode='400001'), true);
  PERFORM pg_temp.expect('the claim records who wanted it',
    (SELECT trigger = 'request_page' FROM atlas.discovery_run WHERE pincode='400001'), true);
END $$;

-- 2. In flight. Somebody claimed it 30 seconds ago.
DO $$
BEGIN
  PERFORM pg_temp.expect('a second caller 30s later is declined',
    atlas.claim_discovery('400001', 30, 'request_page'), false);
END $$;

-- 3. Answered an hour ago, with leads.
DO $$
BEGIN
  DELETE FROM atlas.discovery_run WHERE pincode = '400002';
  INSERT INTO atlas.discovery_run (pincode, ran_at, started_at, found)
  VALUES ('400002', now() - interval '1 hour', now() - interval '1 hour', 3);
  PERFORM pg_temp.expect('answered recently with leads → declined',
    atlas.claim_discovery('400002', 30, 'request_page'), false);
END $$;

-- 4. Answered empty, but only two hours ago. Too soon to pay again.
DO $$
BEGIN
  DELETE FROM atlas.discovery_run WHERE pincode = '400003';
  INSERT INTO atlas.discovery_run (pincode, ran_at, started_at, found)
  VALUES ('400003', now() - interval '2 hours', now() - interval '2 hours', 0);
  PERFORM pg_temp.expect('found nothing 2h ago → declined',
    atlas.claim_discovery('400003', 30, 'request_page'), false);
END $$;

-- 5. Answered empty, a day on. Worth one more look.
DO $$
BEGIN
  DELETE FROM atlas.discovery_run WHERE pincode = '400004';
  INSERT INTO atlas.discovery_run (pincode, ran_at, started_at, found)
  VALUES ('400004', now() - interval '2 days', now() - interval '2 days', 0);
  PERFORM pg_temp.expect('found nothing 2 days ago → claims it',
    atlas.claim_discovery('400004', 30, 'request_page'), true);
  -- The update path must not destroy what the last run found.
  PERFORM pg_temp.expect('claiming preserves the previous ran_at',
    (SELECT ran_at IS NOT NULL FROM atlas.discovery_run WHERE pincode='400004'), true);
END $$;

-- 6. Failed, a day on. A stored error is a reason to retry, not to stop.
DO $$
BEGIN
  DELETE FROM atlas.discovery_run WHERE pincode = '400005';
  INSERT INTO atlas.discovery_run (pincode, ran_at, started_at, found, error)
  VALUES ('400005', now() - interval '2 days', now() - interval '2 days', 2, 'HTTP 429: rate limited');
  PERFORM pg_temp.expect('failed 2 days ago → claims it even though found > 0',
    atlas.claim_discovery('400005', 30, 'request_page'), true);
END $$;

-- 7. Stale: answered well, but 40 days ago.
DO $$
BEGIN
  DELETE FROM atlas.discovery_run WHERE pincode = '400006';
  INSERT INTO atlas.discovery_run (pincode, ran_at, started_at, found)
  VALUES ('400006', now() - interval '40 days', now() - interval '40 days', 4);
  PERFORM pg_temp.expect('40 days stale at stale_days 30 → claims it',
    atlas.claim_discovery('400006', 30, 'request_page'), true);

  DELETE FROM atlas.discovery_run WHERE pincode = '400007';
  INSERT INTO atlas.discovery_run (pincode, ran_at, started_at, found)
  VALUES ('400007', now() - interval '40 days', now() - interval '40 days', 4);
  PERFORM pg_temp.expect('40 days old at stale_days 90 → declined',
    atlas.claim_discovery('400007', 90, 'request_page'), false);
END $$;

-- 8. Crashed and unjammed. Claimed 10 minutes ago, never answered — the
--    process died. Two minutes is all a dead claim gets to hold a pincode.
DO $$
BEGIN
  DELETE FROM atlas.discovery_run WHERE pincode = '400008';
  INSERT INTO atlas.discovery_run (pincode, ran_at, started_at, found, trigger)
  VALUES ('400008', NULL, now() - interval '10 minutes', 0, 'request_page');
  PERFORM pg_temp.expect('a claim that crashed 10 min ago → claims it again',
    atlas.claim_discovery('400008', 30, 'request_page'), true);
END $$;

-- 9. The deliberate human "Search again": stale_days 0. Every past answer is
--    older than a zero-day window, so only the in-flight guard is left.
DO $$
BEGIN
  DELETE FROM atlas.discovery_run WHERE pincode = '400009';
  INSERT INTO atlas.discovery_run (pincode, ran_at, started_at, found)
  VALUES ('400009', now() - interval '1 hour', now() - interval '1 hour', 3);
  PERFORM pg_temp.expect('stale_days 0 re-searches a recently answered pincode',
    atlas.claim_discovery('400009', 0, 'manual'), true);
  PERFORM pg_temp.expect('stale_days 0 still declines over a running search',
    atlas.claim_discovery('400009', 0, 'manual'), false);
END $$;

-- 10. Two callers arriving together. This is the whole reason the function is
--     a single statement: exactly one of them may be told yes.
DO $$
DECLARE a boolean; b boolean;
BEGIN
  DELETE FROM atlas.discovery_run WHERE pincode = '400010';
  SELECT atlas.claim_discovery('400010', 30, 'request_page') INTO a;
  SELECT atlas.claim_discovery('400010', 30, 'request_page') INTO b;
  PERFORM pg_temp.expect('of two callers in the same moment, exactly one wins',
    (a AND NOT b), true);
END $$;

-- ---------------------------------------------------------------------------
\echo ''
\echo 'The unique index still holds, and a verified row is never overwritten'
-- ---------------------------------------------------------------------------
DO $$
DECLARE n int; kept text;
BEGIN
  DELETE FROM atlas.discovered_lab WHERE pincode = '400020';

  INSERT INTO atlas.discovered_lab (pincode, name, phone, confidence)
  VALUES ('400020', 'Same Name Lab', '111', 0.5);
  -- Same pincode, name differing only in case: the unique index is on
  -- (pincode, lower(name)), so this is the same row.
  INSERT INTO atlas.discovered_lab (pincode, name, phone, confidence)
  VALUES ('400020', 'SAME NAME LAB', '222', 0.9)
  ON CONFLICT (pincode, lower(name)) DO UPDATE SET phone = EXCLUDED.phone
   WHERE atlas.discovered_lab.verified_at IS NULL;
  SELECT COUNT(*) INTO n FROM atlas.discovered_lab WHERE pincode = '400020';
  PERFORM pg_temp.expect('(pincode, lower(name)) is still one row', n = 1, true);
  SELECT phone INTO kept FROM atlas.discovered_lab WHERE pincode = '400020';
  PERFORM pg_temp.expect('an unverified row does get updated', kept = '222', true);

  -- Now mark it checked by a human and try again.
  UPDATE atlas.discovered_lab SET verified_at = now() WHERE pincode = '400020';
  INSERT INTO atlas.discovered_lab (pincode, name, phone, confidence)
  VALUES ('400020', 'Same Name Lab', '333', 0.1)
  ON CONFLICT (pincode, lower(name)) DO UPDATE SET phone = EXCLUDED.phone
   WHERE atlas.discovered_lab.verified_at IS NULL;
  SELECT phone INTO kept FROM atlas.discovered_lab WHERE pincode = '400020';
  PERFORM pg_temp.expect('a verified row is never overwritten', kept = '222', true);
END $$;

-- ---------------------------------------------------------------------------
\echo ''
\echo 'promote_discovered_lab carries the ranking evidence into CRM'
-- ---------------------------------------------------------------------------
DO $$
DECLARE uid int; lead int; crm int; crm2 int; note text;
BEGIN
  SELECT id INTO uid FROM atlas.users WHERE email = 'fixture@example.test';
  DELETE FROM atlas.crm_providers WHERE pincode = '400030';
  DELETE FROM atlas.discovered_lab WHERE pincode = '400030';

  INSERT INTO atlas.discovered_lab
    (pincode, name, address, phone, source_url, city, state, confidence,
     disciplines, accreditation, rating, rating_count, note,
     base_score, score_reasons, scored_at)
  VALUES ('400030', 'Evidence Diagnostics', '1 Test Rd', '02299999999',
          'https://example.test/evidence', 'Mumbai', 'Maharashtra', 0.92,
          ARRAY['PATHOLOGY'], ARRAY['NABL'], 4.4, 380,
          'Branch of a regional chain; collects mornings only',
          78.5, ARRAY['nabl accredited','4.4★ from 380 reviews','in the pincode'], now())
  RETURNING id INTO lead;

  SELECT atlas.promote_discovered_lab(lead, uid) INTO crm;
  SELECT notes INTO note FROM atlas.crm_providers WHERE id = crm;
  RAISE NOTICE '  note: %', note;

  PERFORM pg_temp.expect('the CRM note still says where it came from',
    note LIKE '%Found by web search%', true);
  PERFORM pg_temp.expect('the CRM note still carries the source URL',
    note LIKE '%example.test/evidence%', true);
  PERFORM pg_temp.expect('the CRM note still carries the UNVERIFIED caveat',
    note LIKE '%UNVERIFIED at promotion%', true);
  PERFORM pg_temp.expect('the CRM note now carries the score',
    note LIKE '%79/100 at discovery%', true);
  PERFORM pg_temp.expect('the CRM note names the accreditation as a claim',
    note LIKE '%claims NABL (unverified)%', true);
  PERFORM pg_temp.expect('the CRM note carries the rating and its volume',
    note LIKE '%rated 4.4 from 380 reviews%', true);
  PERFORM pg_temp.expect('the CRM note says what it can do',
    note LIKE '%does PATHOLOGY%', true);
  -- Each fact once. score_reasons is derived from these same columns, and
  -- including both said NABL twice and the rating twice in one sentence.
  PERFORM pg_temp.expect('the CRM note does not say NABL twice',
    (length(note) - length(replace(note, 'NABL', ''))) / 4 = 1, true);
  PERFORM pg_temp.expect('the CRM note does not say the rating twice',
    (length(note) - length(replace(note, '380 reviews', ''))) / 11 = 1, true);
  PERFORM pg_temp.expect('the CRM note carries the search''s own note',
    note LIKE '%collects mornings only%', true);
  PERFORM pg_temp.expect('the lead is marked promoted and verified',
    (SELECT crm_provider_id = crm AND verified_at IS NOT NULL
       FROM atlas.discovered_lab WHERE id = lead), true);

  -- Promoting twice must not make a second card.
  SELECT atlas.promote_discovered_lab(lead, uid) INTO crm2;
  PERFORM pg_temp.expect('promoting twice returns the same CRM row', crm2 = crm, true);
  PERFORM pg_temp.expect('...and does not create a second one',
    (SELECT COUNT(*) FROM atlas.crm_providers WHERE pincode = '400030') = 1, true);
END $$;

-- A lead with none of the new fields set — every pre-migration row — must
-- still promote, with the note it always had.
DO $$
DECLARE uid int; lead int; crm int; note text;
BEGIN
  SELECT id INTO uid FROM atlas.users WHERE email = 'fixture@example.test';
  DELETE FROM atlas.crm_providers WHERE pincode = '400031';
  DELETE FROM atlas.discovered_lab WHERE pincode = '400031';
  INSERT INTO atlas.discovered_lab (pincode, name, source_url)
  VALUES ('400031', 'Bare Old Lead', 'https://example.test/bare') RETURNING id INTO lead;
  SELECT atlas.promote_discovered_lab(lead, uid) INTO crm;
  SELECT notes INTO note FROM atlas.crm_providers WHERE id = crm;
  RAISE NOTICE '  note: %', note;
  PERFORM pg_temp.expect('a lead with no ranking data still promotes',
    note LIKE '%Found by web search%' AND note LIKE '%UNVERIFIED at promotion%', true);
  PERFORM pg_temp.expect('...with no empty separators left in the note',
    note NOT LIKE '%· ·%' AND note NOT LIKE '% ·  ·%', true);
END $$;

-- Nothing here may ever contact anybody, and a discovered lead is not a
-- network record. Both invariants are structural, so assert them structurally.
DO $$
BEGIN
  PERFORM pg_temp.expect('promoted leads land in CRM as source = discovered',
    (SELECT bool_and(source = 'discovered') FROM atlas.crm_providers
      WHERE pincode IN ('400030','400031')), true);
END $$;

\echo ''
\echo 'All SQL checks passed.'
