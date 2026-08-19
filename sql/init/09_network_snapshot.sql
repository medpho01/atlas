-- ============================================================================
-- Network growth history.
--
-- Everything else in Atlas is a projection of the source's current state:
-- refresh it tomorrow and yesterday's picture is gone. Growth cannot be
-- reconstructed after the fact — a provider onboarded in March looks identical
-- to one onboarded last week once both are simply "active".
--
-- So this table is the one place Atlas accumulates rather than derives. It is
-- written once per run by scripts/refresh-data.sh and never recomputed.
--
-- One row per (week, city, kind, tier). Category and modality roll up from
-- kind at read time rather than being stored, so re-categorising later (the
-- six-category model) reinterprets history instead of invalidating it.
--
-- backfilled marks rows reconstructed from created/onboarded dates rather than
-- observed live, so a chart can show them differently or exclude them.
-- ============================================================================

CREATE TABLE IF NOT EXISTS atlas.network_snapshot (
  week_start      date    NOT NULL,
  city            text    NOT NULL,
  kind            text    NOT NULL,
  city_tier       text,
  providers       int     NOT NULL DEFAULT 0,
  pincodes_served int     NOT NULL DEFAULT 0,
  active          int     NOT NULL DEFAULT 0,
  backfilled      boolean NOT NULL DEFAULT false,
  captured_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (week_start, city, kind)
);

CREATE INDEX IF NOT EXISTS network_snapshot_week_idx ON atlas.network_snapshot (week_start);
CREATE INDEX IF NOT EXISTS network_snapshot_city_idx ON atlas.network_snapshot (lower(city));

-- Capture the current week. Idempotent: running twice in a week overwrites
-- that week's row rather than double-counting, so the nightly job can run
-- every night and still produce one row per week.
CREATE OR REPLACE FUNCTION atlas.capture_network_snapshot(as_of date DEFAULT current_date)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  wk date := date_trunc('week', as_of)::date;
  n  int;
BEGIN
  INSERT INTO atlas.network_snapshot
    (week_start, city, kind, city_tier, providers, pincodes_served, active, backfilled)
  SELECT
    wk,
    COALESCE(NULLIF(TRIM(p.city), ''), 'Unknown') AS city,
    p.kind,
    ct.tier,
    COUNT(*)::int,
    COUNT(DISTINCT p.pincode) FILTER (WHERE p.pincode IS NOT NULL)::int,
    COUNT(*) FILTER (WHERE p.active)::int,
    false
  FROM analytics.mv_provider_unified p
  LEFT JOIN atlas.city_tier ct
    ON ct.city_key = atlas.city_key(p.city)
  GROUP BY 1, 2, 3, 4
  ON CONFLICT (week_start, city, kind) DO UPDATE SET
    city_tier       = EXCLUDED.city_tier,
    providers       = EXCLUDED.providers,
    pincodes_served = EXCLUDED.pincodes_served,
    active          = EXCLUDED.active,
    backfilled      = false,
    captured_at     = now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END$$;

-- Reconstruct history from creation dates.
--
-- Honest but weaker than an observed snapshot: it can only say how many
-- providers had been *created* by week W, not how many were active, serving
-- pincodes, or of what tier at the time. Deactivations and churn are invisible
-- — a lab created in 2024 and dropped in 2025 still counts. Rows are marked
-- backfilled=true so a chart can shade or exclude them, and any week that is
-- later observed live overwrites the reconstruction.
CREATE OR REPLACE FUNCTION atlas.backfill_network_snapshot(weeks_back int DEFAULT 104)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO atlas.network_snapshot
    (week_start, city, kind, city_tier, providers, pincodes_served, active, backfilled)
  SELECT w.wk,
         COALESCE(NULLIF(TRIM(l.city), ''), 'Unknown'),
         -- Kind comes from the spine, not a literal: one Lab row becomes LAB or
         -- HOSPITAL depending on centre type, and hardcoding 'LAB' put all 1,774
         -- into one series against an observed 1,337.
         pu.kind,
         ct.tier,
         COUNT(*)::int,
         COUNT(DISTINCT l.pincode) FILTER (WHERE l.pincode IS NOT NULL)::int,
         COUNT(*) FILTER (WHERE l.active)::int,
         true
  FROM generate_series(
         date_trunc('week', current_date) - (weeks_back || ' weeks')::interval,
         date_trunc('week', current_date) - interval '1 week',
         interval '1 week') AS w(wk)
  JOIN src."Lab" l ON l."createdAt" < w.wk + interval '1 week'
  -- Restricted to labs the spine actually counts today. Without this the
  -- reconstruction counts every Lab row (1,776) while the live snapshot counts
  -- what mv_provider_unified admits (1,337), and the series drops off a cliff
  -- at the join between reconstructed and observed weeks.
  JOIN analytics.mv_provider_unified pu
    ON pu.source_table = 'Lab' AND pu.source_id = l.id
  LEFT JOIN atlas.city_tier ct
    ON ct.city_key = atlas.city_key(l.city)
  GROUP BY 1, 2, 3, 4
  -- An observed row always wins: never overwrite live data with a guess.
  ON CONFLICT (week_start, city, kind) DO UPDATE SET
    providers       = EXCLUDED.providers,
    pincodes_served = EXCLUDED.pincodes_served,
    active          = EXCLUDED.active
  WHERE atlas.network_snapshot.backfilled;

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END$$;
