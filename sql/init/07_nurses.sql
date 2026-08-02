-- ============================================================================
-- Nurse repository — app-owned tables (atlas.*)
--
-- Mirrors 05_phlebos.sql, with one structural difference: nurses have no lab.
-- A phlebo is attributable to a lab because every Order carries phleboName +
-- phleboNumber + labId. Nursing work runs through Appointment, which links to
-- ProviderGroup (a type bucket) and never to an individual provider — so there
-- is no per-nurse activity to derive and no lab to attribute. The equivalent
-- axis for nurses is the AGGREGATOR they supply through (Portea, Nightingales,
-- Care24, freelancer, …), which the source doesn't record either: main_store_id
-- is populated for doctors only and is NULL for every nurse.
--
-- So aggregator is an uploaded/manual field. Nurses that come from LabStack's
-- own provider registry are labelled 'LabStack registry' in atlas.nurses_all.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS atlas;

-- Manually added / uploaded nurses. Phone is the identity, same as phlebos.
CREATE TABLE IF NOT EXISTS atlas.nurses_manual (
  id            serial PRIMARY KEY,
  phone         text NOT NULL UNIQUE,        -- digits only; normalized at write time
  name          text NOT NULL,
  city          text,
  state         text,
  pincode       text,
  aggregator    text,                        -- supplier/agency this nurse comes through
  qualification text,                        -- GNM / ANM / BSc Nursing / …
  email         text,
  notes         text,
  source        text NOT NULL,               -- 'upload:filename.xlsx' or 'manual:<email>'
  uploaded_by   int REFERENCES atlas.users(id),
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nurses_manual_city ON atlas.nurses_manual (lower(city));
CREATE INDEX IF NOT EXISTS idx_nurses_manual_pin  ON atlas.nurses_manual (pincode);
CREATE INDEX IF NOT EXISTS idx_nurses_manual_agg  ON atlas.nurses_manual (lower(aggregator));

-- Upload audit trail.
CREATE TABLE IF NOT EXISTS atlas.nurse_uploads (
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
