-- ============================================================================
-- Wellness supply — gyms, studios, physiotherapy, instructors.
--
-- None of this exists in LabStack. There is no ProviderType for a gym and
-- Atlas cannot write to the source, so unlike every other kind this supply is
-- uploaded rather than derived. That has two consequences worth stating:
--
--   1. It is only as current as the last upload. Everything else in Atlas is
--      refreshed nightly from the source; this is not.
--   2. "Identified" and "live" are different things. A gym someone found on a
--      map is not a partner. status carries that distinction and the default
--      is 'identified', so nothing is claimed as live by accident.
--
-- Structure follows atlas.phlebos_manual / nurses_manual: an upload batch
-- table plus rows, so a bad file can be traced and removed as a unit.
-- ============================================================================

CREATE TABLE IF NOT EXISTS atlas.wellness_uploads (
  id          bigserial PRIMARY KEY,
  filename    text,
  uploaded_by int REFERENCES atlas.users(id),
  rows_loaded int NOT NULL DEFAULT 0,
  note        text,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atlas.wellness_manual (
  id          bigserial PRIMARY KEY,
  upload_id   bigint REFERENCES atlas.wellness_uploads(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('GYM', 'STUDIO', 'PHYSIO', 'INSTRUCTOR')),
  brand       text,
  city        text,
  state       text,
  pincode     text,
  address     text,
  latitude    double precision,
  longitude   double precision,
  contact     text,
  email       text,
  -- identified: found, not contracted. live: contracted and bookable.
  status      text NOT NULL DEFAULT 'identified'
              CHECK (status IN ('identified', 'live', 'dropped')),
  notes       text,
  created_by  int REFERENCES atlas.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wellness_manual_city_idx ON atlas.wellness_manual (lower(city));
CREATE INDEX IF NOT EXISTS wellness_manual_pin_idx  ON atlas.wellness_manual (pincode);
CREATE INDEX IF NOT EXISTS wellness_manual_kind_idx ON atlas.wellness_manual (kind, status);

-- One row per wellness centre, shaped like analytics.mv_provider_unified so
-- coverage queries can UNION it in without special-casing every call site.
--
-- INSTRUCTOR is excluded on purpose: it is virtual-only supply and every
-- coverage query in Atlas is keyed on pincode. Counting a remote instructor as
-- supply in a pincode would inflate coverage everywhere at once. Online
-- wellness is read as a national count, not a map layer.
CREATE OR REPLACE VIEW atlas.wellness_provider AS
SELECT
  ('W' || w.id)::text        AS entity_id,
  w.id                       AS source_id,
  'wellness_manual'::text    AS source_table,
  w.name,
  w.kind,
  w.pincode,
  w.latitude,
  w.longitude,
  w.city,
  w.state,
  NULL::int                  AS chain_id,
  (w.status = 'live')        AS active,
  CASE WHEN w.kind = 'PHYSIO' THEN ARRAY['CENTER_VISIT', 'HOME_VISIT']
       ELSE ARRAY['CENTER_VISIT'] END AS modalities,
  w.status,
  w.brand
FROM atlas.wellness_manual w
WHERE w.kind <> 'INSTRUCTOR'
  AND w.status <> 'dropped';
