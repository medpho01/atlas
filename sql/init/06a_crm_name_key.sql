-- ---------------------------------------------------------------------------
-- One organisation, one CRM card.
--
-- The duplicate check used to compare lower(name) exactly, so "Apollo
-- Hospitals Pvt Ltd", "Apollo Hospitals Pvt. Ltd." and "apollo  hospitals pvt
-- ltd" were three different providers. Someone opening the add-provider form
-- to record a note would type the name slightly differently and get a second
-- card instead of matching the first — which is how a note turns into a
-- duplicate.
--
-- This is the same normalisation sql/crm-merge-duplicate-providers.sql uses to
-- fold the existing duplicates together, so the check and the clean-up agree.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.crm_name_key(raw text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(regexp_replace(lower(raw), '[^a-z0-9]+', ' ', 'g'),
                              '\s+', ' ', 'g'))
$$;

CREATE INDEX IF NOT EXISTS idx_crm_providers_name_key
  ON atlas.crm_providers (atlas.crm_name_key(name));
