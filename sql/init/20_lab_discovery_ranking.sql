-- ===========================================================================
-- 20_lab_discovery_ranking.sql — rank web-discovered labs, and claim a search
-- ===========================================================================
--
-- Two jobs.
--
-- 1. Room to store the facts that decide a phone call. The search used to
--    return a name, an address and a confidence number, which is exactly the
--    information that cannot tell you which lab to ring first — so the network
--    team opened a Google tab and worked it out there. It also already
--    returned a `note` that the code threw away.
--
-- 2. atlas.claim_discovery(), so that a search can now be triggered by opening
--    a request rather than only by a nightly batch, without two tabs paying
--    for the same pincode twice.
--
-- sql/init/ runs ONCE, on a database's first boot. Every database that already
-- exists has to have this applied by hand — see docs/RUNBOOK-requests.md,
-- "Applying 20_lab_discovery_ranking.sql to an existing host". So everything
-- here is idempotent and safe to run twice: ADD COLUMN IF NOT EXISTS,
-- CREATE OR REPLACE, no data rewrites.

-- ---------------------------------------------------------------------------
-- atlas.discovered_lab — the facts a ranking is computed from
--
-- All nullable, all read as "not published" when absent rather than as "no".
-- A single-doctor lab in a supply-gap pincode usually has no website at all,
-- and treating that silence as a negative buries exactly the labs this feature
-- exists to find. See lib/labDiscovery.ts for how each is weighed.
-- ---------------------------------------------------------------------------
ALTER TABLE atlas.discovered_lab
  -- What it can actually perform: PATHOLOGY, RADIOLOGY, CARDIO_DIAGNOSTIC.
  -- The only field a *confirmed* mismatch can be scored down hard on.
  ADD COLUMN IF NOT EXISTS disciplines     text[],
  -- Named tests or equipment seen on the listing ("MRI 1.5T", "TMT").
  ADD COLUMN IF NOT EXISTS services        text[],
  -- Marks claimed: NABL, CAP, ICMR, NABH, ISO. Claimed, not verified.
  ADD COLUMN IF NOT EXISTS accreditation   text[],
  -- Public rating and the volume behind it. Meaningless apart: 5.0 from three
  -- people is a rating a lab can arrange for itself.
  ADD COLUMN IF NOT EXISTS rating          numeric,
  ADD COLUMN IF NOT EXISTS rating_count    int,
  ADD COLUMN IF NOT EXISTS home_collection boolean,
  -- Physically in the pincode, and how far out if not.
  ADD COLUMN IF NOT EXISTS in_pincode      boolean,
  ADD COLUMN IF NOT EXISTS distance_km     numeric,
  ADD COLUMN IF NOT EXISTS chain           text,
  ADD COLUMN IF NOT EXISTS website         text,
  ADD COLUMN IF NOT EXISTS hours           text,
  -- The search has always returned this and the code has always dropped it.
  -- It is the one line the person about to phone most wants.
  ADD COLUMN IF NOT EXISTS note            text,
  -- The pincode-level part of the score, computed at write time. The
  -- request-specific part is NOT stored: the same pincode legitimately ranks
  -- differently for a blood panel and an MRI, so fit is recomputed on read.
  ADD COLUMN IF NOT EXISTS base_score      numeric,
  -- Why that score, in words. A rank nobody can audit is a rank nobody trusts.
  ADD COLUMN IF NOT EXISTS score_reasons   text[],
  ADD COLUMN IF NOT EXISTS scored_at       timestamptz;

-- Ranked reads are always per pincode and always skip dismissed rows.
CREATE INDEX IF NOT EXISTS idx_discovered_pin_live
  ON atlas.discovered_lab (pincode) WHERE NOT dismissed;

-- ---------------------------------------------------------------------------
-- atlas.discovery_run — tell "a search is running" from "a search found nothing"
--
-- `ran_at` was NOT NULL DEFAULT now(), which was fine while the only writer
-- was a batch job that inserted the row after it finished. It is wrong now
-- that a row is inserted *before* the search to claim it: the claim row would
-- read as "searched just now, found nothing", which is the one thing the card
-- must never say — somebody would stop looking for a lab that was still being
-- looked for.
--
-- So: ran_at NULL means "no answer yet". started_at carries the in-flight
-- marker instead.
-- ---------------------------------------------------------------------------
ALTER TABLE atlas.discovery_run
  ALTER COLUMN ran_at DROP NOT NULL;

ALTER TABLE atlas.discovery_run
  -- When the current or last attempt began. Set by claim_discovery, left alone
  -- when the attempt completes, so `started_at > ran_at` means in flight.
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  -- Who wanted it: 'batch' | 'request_page' | 'manual'. Without this there is
  -- no way to answer "is the page load costing us anything" from the data.
  ADD COLUMN IF NOT EXISTS trigger    text;

-- Existing rows pre-date started_at. Backfill from ran_at so they read as
-- "last attempt finished then", not as "never attempted" — which
-- claim_discovery would treat as a reason to re-search all of them at once.
UPDATE atlas.discovery_run SET started_at = ran_at
 WHERE started_at IS NULL AND ran_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- atlas.claim_discovery — the only thing between page loads and an API bill
--
-- Returns true exactly when the caller should spend money, and takes the claim
-- in the same breath. ONE statement, so two callers arriving together cannot
-- both be told yes: the second one's ON CONFLICT DO UPDATE sees the first
-- one's committed `started_at` and its WHERE declines, so it updates no row
-- and RETURNING gives it nothing.
--
-- True when, and only when:
--   * nothing is already in flight (nothing started within 2 minutes), AND
--   * one of:
--       - never answered              (ran_at IS NULL)
--       - answered empty, or failed, and that was over a day ago
--       - answered, and that was longer ago than p_stale_days
--
-- A finished-within-2-minutes run is also declined, which is correct: nobody
-- needs a pincode re-searched thirty seconds after it was answered.
--
-- Pass p_stale_days => 0 for a deliberate human "search again": every past
-- ran_at is then older than the window, so the only remaining guard is the
-- in-flight one. That is the intended behaviour — a person may always
-- re-search, except over the top of a search already running — and it keeps
-- the manual path on this same function rather than inventing a second
-- authority that can drift from it.
--
-- lib/labDiscovery.ts shouldAutoSearch() mirrors this WHERE clause, because
-- the page needs the same answer one render earlier in order not to announce a
-- search this function is about to decline. If you change one, change the
-- other.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.claim_discovery(
  p_pincode    text,
  p_stale_days int  DEFAULT 30,
  p_trigger    text DEFAULT 'manual'
) RETURNS boolean
LANGUAGE sql AS $$
  WITH claim AS (
    INSERT INTO atlas.discovery_run AS dr (pincode, ran_at, started_at, found, trigger)
    -- ran_at explicitly NULL: claimed, not yet answered.
    VALUES (p_pincode, NULL, now(), 0, p_trigger)
    ON CONFLICT (pincode) DO UPDATE
       SET started_at = now(),
           trigger    = p_trigger
           -- ran_at, found, model and error are deliberately left alone. While
           -- this attempt runs the card can still honestly report what the
           -- last one found.
     WHERE (dr.started_at IS NULL OR dr.started_at < now() - interval '2 minutes')
       AND (
              dr.ran_at IS NULL
           OR ((dr.found = 0 OR dr.error IS NOT NULL)
               AND dr.ran_at < now() - interval '1 day')
           OR dr.ran_at < now() - make_interval(days => p_stale_days)
           )
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claim);
$$;

COMMENT ON FUNCTION atlas.claim_discovery(text, int, text) IS
  'True (and claims it) only when this pincode should be searched now. '
  'Mirrored by shouldAutoSearch() in lib/labDiscovery.ts.';

-- ---------------------------------------------------------------------------
-- Promote a web lead into CRM. A human act — this only records the decision.
--
-- Replaced here only to carry the ranking evidence into the CRM note. The
-- person who picks the card up a week later needs to know which facts put this
-- lab at the top, because those are the facts that were never verified. The
-- note said "Found by web search" and nothing else, so all of it was lost the
-- moment the row left the request screen.
--
-- Everything else is unchanged, including the two invariants: nothing is ever
-- contacted automatically, and the UNVERIFIED caveat travels with the row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.promote_discovered_lab(lead_id int, by_user int)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE new_id int; d record; evidence text;
BEGIN
  SELECT * INTO d FROM atlas.discovered_lab WHERE id = lead_id;
  IF d IS NULL THEN RAISE EXCEPTION 'No discovered lab %', lead_id; END IF;
  IF d.crm_provider_id IS NOT NULL THEN RETURN d.crm_provider_id; END IF;

  -- Why it ranked where it did. Built from the stored pincode-level score, not
  -- from the request-specific one, which is not stored and would be misleading
  -- on a CRM card that outlives the request.
  evidence := concat_ws(' · ',
    CASE WHEN d.base_score IS NOT NULL
         THEN 'Ranked ' || round(d.base_score)::text || '/100 at discovery' END,
    CASE WHEN array_length(d.score_reasons, 1) > 0
         THEN array_to_string(d.score_reasons, '; ') END,
    CASE WHEN array_length(d.accreditation, 1) > 0
         THEN 'claims ' || array_to_string(d.accreditation, '/') || ' (unverified)' END,
    CASE WHEN d.rating IS NOT NULL AND COALESCE(d.rating_count, 0) > 0
         THEN d.rating::text || ' from ' || d.rating_count || ' reviews' END,
    CASE WHEN array_length(d.disciplines, 1) > 0
         THEN 'does ' || array_to_string(d.disciplines, ', ') END,
    d.note);

  -- Same columns and same values as before, `notes` excepted. In particular
  -- `kind` stays 'LAB' even for a radiology-only lead: CRM has a RADIOLOGY
  -- kind and arguably should get it, but that is a change to what a CRM row
  -- means, so it is raised in the PR rather than slipped in here.
  INSERT INTO atlas.crm_providers
    (name, kind, city, state, pincode, phone, source, created_by, notes)
  VALUES (d.name, 'LAB', d.city, d.state, d.pincode, d.phone,
          'discovered', by_user,
          concat_ws(' · ',
            'Found by web search on ' || d.retrieved_at::date,
            d.source_url,
            NULLIF(evidence, ''),
            'UNVERIFIED at promotion — confirm before relying on it'))
  RETURNING id INTO new_id;

  UPDATE atlas.discovered_lab
     SET crm_provider_id = new_id, verified_by = by_user, verified_at = now()
   WHERE id = lead_id;

  RETURN new_id;
END $$;
