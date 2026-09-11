-- ===========================================================================
-- Minimal fixture for testing 20_lab_discovery_ranking.sql
-- ===========================================================================
--
-- Only the four tables the migration touches, so a scratch Postgres 16 can be
-- stood up in seconds without a LabStack source database. `docker compose up
-- atlas-db` is not an option here: its init runs 03_fdw.sh, which needs a real
-- SOURCE_DATABASE_URL pointing at the operational DB.
--
-- The DDL below is copied VERBATIM out of sql/init/16_requests.sql
-- (discovered_lab, discovery_run) and sql/init/01_schema.sql +
-- sql/init/06_crm.sql (users, crm_providers). Copied, not paraphrased — a
-- fixture that differs from the real schema tests the fixture. If either
-- source file changes, this one is stale and the tests are lying.
--
-- Used by scripts/test-discovery-db.sh.

CREATE SCHEMA IF NOT EXISTS atlas;

-- ---- from sql/init/01_schema.sql -----------------------------------------
CREATE TABLE IF NOT EXISTS atlas.users (
  id              serial      PRIMARY KEY,
  email           text        UNIQUE NOT NULL,
  password_hash   text        NOT NULL,
  name            text        NOT NULL,
  role            text        NOT NULL DEFAULT 'viewer',
  active          boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_atlas_users_email ON atlas.users (LOWER(email));

-- ---- from sql/init/06_crm.sql --------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.crm_providers (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  -- Free text by design, but the app writes keys from lib/providerKinds.ts:
  -- LAB (pathology) | RADIOLOGY | COLLECTION_CENTRE | CLINIC | HOSPITAL |
  -- PHARMACY | DOCTOR | PHLEBO | NURSE | DENTAL | VISION.
  kind           text NOT NULL DEFAULT 'LAB',
  city           text,
  state          text,
  pincode        text,
  phone          text,
  email          text,
  contact_person text,
  notes          text,
  source         text NOT NULL DEFAULT 'manual', -- manual | import | atlas
  source_lab_id  int,                            -- link to source Lab.id once known
  created_by     int REFERENCES atlas.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crm_providers_name ON atlas.crm_providers (lower(name));
CREATE INDEX IF NOT EXISTS idx_crm_providers_city ON atlas.crm_providers (lower(city));
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_providers_source_lab
  ON atlas.crm_providers (source_lab_id) WHERE source_lab_id IS NOT NULL;

-- ---- from sql/init/16_requests.sql ---------------------------------------
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

-- One user to attribute a promotion to.
INSERT INTO atlas.users (email, password_hash, name, role)
VALUES ('fixture@example.test', 'x', 'Fixture User', 'network')
ON CONFLICT (email) DO NOTHING;
