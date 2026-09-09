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

-- ---------------------------------------------------------------------------
-- Near-duplicate detection.
--
-- People type the same provider differently: "RXDX Labs" and "RxDx",
-- "Ekaiva Diagnostics" and "Ekiava", "Kanva Diagnostics" and "Kanva". An exact
-- key cannot catch those, and trigram similarity on the whole string is worse
-- than useless here — the generic tail dominates, so "Apollo Hospitals" and
-- "Fortis Hospitals" score higher than "Kanva Diagnostics" and "Kanva".
--
-- Stripping the descriptor words first leaves the part that actually names the
-- organisation, and on that core the two groups separate cleanly: real
-- duplicates score 1.00 or sit within an edit or two, genuinely different
-- providers are five or six edits apart.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

CREATE OR REPLACE FUNCTION atlas.crm_core_name(raw text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT btrim(regexp_replace(
    regexp_replace(atlas.crm_name_key(raw),
      '\m(diagnostics|diagnostic|diagnostix|labs|lab|laboratory|laboratories|'
      'hospitals|hospital|clinics|clinic|centre|center|centres|centers|'
      'healthcare|health|care|scans|scan|imaging|radiology|pathology|'
      'pvt|private|ltd|limited|llp|india|the|and)\M',
      ' ', 'g'), '\s+', ' ', 'g'))
$$;

CREATE INDEX IF NOT EXISTS idx_crm_providers_core_trgm
  ON atlas.crm_providers USING gin (atlas.crm_core_name(name) gin_trgm_ops);
