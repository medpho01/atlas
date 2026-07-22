-- ============================================================================
-- Atlas phlebo repository — schema.
--
-- Two data streams merged by phone number (digits-only, dedup key):
--
--   1. atlas.phlebos_manual   → uploaded via CSV/Excel from the admin UI.
--                               Persistent, never touched by the daily refresh.
--   2. analytics.mv_phlebos_derived (built in ../phlebos_derived.sql)
--                             → recomputed every night from src_local."Order".
--
--   3. atlas.phlebos_all      → a VIEW that FULL OUTER JOINs the two on phone.
--                               Manual fields take precedence when both exist.
--
-- Phone normalization: strip everything except digits. That way "+91 98…",
-- "98…", and "098…" all collapse to the same key. Same normalization is
-- applied on upload before insert, and to Order."phleboNumber" in the MV.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS atlas;

-- ----------------------------------------------------------------------------
-- Uploaded / manually curated phlebos
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.phlebos_manual (
  id            serial PRIMARY KEY,
  phone         text NOT NULL UNIQUE,        -- digits only; normalization enforced at write time
  name          text NOT NULL,
  city          text,
  state         text,
  pincode       text,
  email         text,
  notes         text,
  source        text NOT NULL,               -- 'upload:filename.xlsx' or 'manual:<email>'
  uploaded_by   int REFERENCES atlas.users(id),
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phlebos_manual_phone   ON atlas.phlebos_manual (phone);
CREATE INDEX IF NOT EXISTS idx_phlebos_manual_city    ON atlas.phlebos_manual (lower(city));
CREATE INDEX IF NOT EXISTS idx_phlebos_manual_pincode ON atlas.phlebos_manual (pincode);

-- Trigger to bump updated_at on any change (Postgres has no auto-column).
CREATE OR REPLACE FUNCTION atlas.phlebos_manual_touch()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_phlebos_manual_touch ON atlas.phlebos_manual;
CREATE TRIGGER trg_phlebos_manual_touch
BEFORE UPDATE ON atlas.phlebos_manual
FOR EACH ROW EXECUTE FUNCTION atlas.phlebos_manual_touch();

-- ----------------------------------------------------------------------------
-- Audit log for uploads (who imported what, when, row count) — useful for
-- rollbacks and answering "where did this phlebo come from".
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.phlebo_uploads (
  id            serial PRIMARY KEY,
  filename      text NOT NULL,
  total_rows    int NOT NULL,
  inserted      int NOT NULL DEFAULT 0,
  updated       int NOT NULL DEFAULT 0,
  skipped       int NOT NULL DEFAULT 0,
  uploaded_by   int REFERENCES atlas.users(id),
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  error         text
);

CREATE INDEX IF NOT EXISTS idx_phlebo_uploads_uploaded_at ON atlas.phlebo_uploads (uploaded_at DESC);
