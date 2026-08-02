-- ============================================================================
-- analytics.mv_nurses_derived + atlas.nurses_all
--
-- Nurses come from LabStack's provider registry (Provider ⋈ ProviderType), not
-- from order attribution. Unlike phlebos there is deliberately NO orders_served
-- column: nursing work is booked through Appointment, which joins to
-- ProviderGroup (a provider-type bucket, columns are just id/name/typeId) and
-- never to an individual provider. Nothing in the source attributes an
-- appointment to a specific nurse, so a count here would be fabricated.
--
-- What the registry does give that phlebos don't have: council registration,
-- verification status, experience, and a real lat/long on the provider record.
-- Those are the quality signals the network team actually screens on.
--
-- Grouped on (phone, name_key) for the same reason as phlebos — agencies list
-- several nurses against one coordinator number, and grouping on phone alone
-- would merge distinct people.
-- ============================================================================

DROP MATERIALIZED VIEW IF EXISTS analytics.mv_nurses_derived CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_nurses_derived AS
WITH nurse_rows AS (
  SELECT
    regexp_replace(p.mobile, '[^0-9]', '', 'g')                    AS phone,
    lower(regexp_replace(TRIM(p.name), '\s+', ' ', 'g'))           AS name_key,
    p.name                                                          AS name_raw,
    p.id                                                            AS provider_id,
    NULLIF(TRIM(p.city), '')                                        AS city_raw,
    NULLIF(TRIM(p.state), '')                                       AS state_raw,
    CASE WHEN p.pincode ~ '^[0-9]{6}$' THEN p.pincode END           AS pincode,
    NULLIF(TRIM(p.locality), '')                                    AS locality,
    p.latitude,
    p.longitude,
    COALESCE(p."isVerified", false)                                 AS is_verified,
    NULLIF(TRIM(p."registrationNum"), '')                           AS registration_num,
    NULLIF(TRIM(p."registrationBody"), '')                          AS registration_body,
    p."experienceStart",
    NULLIF(TRIM(p.email), '')                                       AS email,
    p."createdAt"
  FROM src_local."Provider" p
  JOIN src_local."ProviderType" pt ON pt.id = p."typeId"
  WHERE pt."typeName" = 'Nurse'
    AND p.mobile IS NOT NULL
    AND regexp_replace(p.mobile, '[^0-9]', '', 'g') <> ''
    AND p.name IS NOT NULL
    AND TRIM(p.name) <> ''
),
-- Distinct people sharing one number → agency coordinator line, same signal
-- the phlebo MV computes.
phone_stats AS (
  SELECT phone, COUNT(DISTINCT name_key) AS variants_at_phone
  FROM nurse_rows GROUP BY phone
)
SELECT
  nr.phone,
  nr.name_key,
  mode() WITHIN GROUP (ORDER BY nr.name_raw)              AS name,
  MIN(nr.provider_id)                                     AS provider_id,
  -- Prefer the canonical city/state for the nurse's pincode; fall back to the
  -- free-text values on the provider record.
  COALESCE(
    mode() WITHIN GROUP (ORDER BY pc.city),
    mode() WITHIN GROUP (ORDER BY nr.city_raw)
  )                                                       AS derived_city,
  COALESCE(
    mode() WITHIN GROUP (ORDER BY pc.state),
    mode() WITHIN GROUP (ORDER BY nr.state_raw)
  )                                                       AS derived_state,
  mode() WITHIN GROUP (ORDER BY nr.pincode)               AS derived_pincode,
  mode() WITHIN GROUP (ORDER BY nr.locality)              AS locality,
  AVG(nr.latitude)                                        AS latitude,
  AVG(nr.longitude)                                       AS longitude,
  bool_or(nr.is_verified)                                 AS is_verified,
  mode() WITHIN GROUP (ORDER BY nr.registration_num)      AS registration_num,
  mode() WITHIN GROUP (ORDER BY nr.registration_body)     AS registration_body,
  -- Whole years since they started practising; NULL when unrecorded.
  MAX(
    CASE WHEN nr."experienceStart" IS NOT NULL
         THEN GREATEST(0, EXTRACT(YEAR FROM age(now(), nr."experienceStart"))::int)
    END
  )                                                       AS experience_years,
  mode() WITHIN GROUP (ORDER BY nr.email)                 AS email,
  MIN(nr."createdAt")::date                               AS registered_at,
  ps.variants_at_phone,
  (ps.variants_at_phone >= 3)                             AS is_shared_phone
FROM nurse_rows nr
JOIN phone_stats ps                    ON ps.phone = nr.phone
LEFT JOIN analytics.mv_pincode_city pc ON pc.pincode = nr.pincode
GROUP BY nr.phone, nr.name_key, ps.variants_at_phone;

CREATE UNIQUE INDEX idx_mv_nurses_derived_key  ON analytics.mv_nurses_derived (phone, name_key);
CREATE INDEX idx_mv_nurses_derived_phone       ON analytics.mv_nurses_derived (phone);
CREATE INDEX idx_mv_nurses_derived_city        ON analytics.mv_nurses_derived (lower(derived_city));
CREATE INDEX idx_mv_nurses_derived_state       ON analytics.mv_nurses_derived (lower(derived_state));
CREATE INDEX idx_mv_nurses_derived_pincode     ON analytics.mv_nurses_derived (derived_pincode);
CREATE INDEX idx_mv_nurses_derived_verified    ON analytics.mv_nurses_derived (is_verified);

-- ----------------------------------------------------------------------------
-- atlas.nurses_all — the view the app queries.
-- Registry nurses get aggregator 'LabStack registry'; uploaded rows carry
-- whatever supplier they were uploaded under.
-- ----------------------------------------------------------------------------
DROP VIEW IF EXISTS atlas.nurses_all CASCADE;

CREATE VIEW atlas.nurses_all AS
SELECT
  COALESCE(m.phone, d.phone)                                AS phone,
  COALESCE(NULLIF(m.name, ''), d.name)                      AS name,
  COALESCE(NULLIF(m.city, ''), d.derived_city)              AS city,
  COALESCE(NULLIF(m.state, ''), d.derived_state)            AS state,
  COALESCE(NULLIF(m.pincode, ''), d.derived_pincode)        AS pincode,
  d.locality,
  COALESCE(
    NULLIF(m.aggregator, ''),
    CASE WHEN d.phone IS NOT NULL THEN 'LabStack registry' END
  )                                                         AS aggregator,
  m.qualification,
  COALESCE(d.is_verified, false)                            AS is_verified,
  d.registration_num,
  d.registration_body,
  d.experience_years,
  d.latitude,
  d.longitude,
  d.registered_at,
  COALESCE(d.is_shared_phone, false)                        AS is_shared_phone,
  COALESCE(d.variants_at_phone, 1)                          AS variants_at_phone,
  COALESCE(NULLIF(m.email, ''), d.email)                    AS email,
  m.notes,
  m.uploaded_at,
  CASE
    WHEN m.phone IS NOT NULL AND d.phone IS NOT NULL THEN 'both'
    WHEN m.phone IS NOT NULL                         THEN 'manual'
    ELSE                                                  'derived'
  END                                                       AS source
FROM analytics.mv_nurses_derived d
FULL OUTER JOIN atlas.nurses_manual m
  ON m.phone = d.phone
 AND lower(regexp_replace(TRIM(m.name), '\s+', ' ', 'g')) = d.name_key;

DO $$
DECLARE n_derived int; n_manual int; n_verified int;
BEGIN
  SELECT COUNT(*) INTO n_derived  FROM analytics.mv_nurses_derived;
  SELECT COUNT(*) INTO n_manual   FROM atlas.nurses_manual;
  SELECT COUNT(*) INTO n_verified FROM analytics.mv_nurses_derived WHERE is_verified;
  RAISE NOTICE 'mv_nurses_derived: % registry nurses (% verified) · nurses_manual: %',
    n_derived, n_verified, n_manual;
END $$;
