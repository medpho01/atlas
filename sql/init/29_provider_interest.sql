-- ===========================================================================
-- 29_provider_interest.sql — what a nurse or phlebo has actually done for us,
-- and whether they want to work with us.
--
-- Three things, in the order they depend on each other.
--
-- 1. src_local."SlotConfig" — the snapshot table the appointment count needs.
--    Bootstrapped here rather than assumed, the way 24 bootstraps its own
--    dependencies: a host that has never copied it would otherwise fail on
--    the matview below with a missing relation.
--
-- 2. analytics.mv_nurse_appointments — appointments per nurse.
--
--    sql/nurses_derived.sql says in its header that "nothing in the source
--    attributes an appointment to a specific nurse, so a count here would be
--    fabricated." That was wrong, and it is worth saying why, because the
--    reasoning was sound and the conclusion was not. It looked at
--    Appointment."providerGroup_id", which is a bucket rather than a person
--    and is set on 268 of 23,836 rows. But every appointment also carries a
--    slot_id, and a slot belongs to exactly one provider:
--
--        Appointment.slot_id → SlotConfig.id → SlotConfig.provider_id
--
--    23,810 of 23,836 appointments resolve through that chain, and every one
--    of those resolves to a provider. 364 of them to a nurse. So the count is
--    real, not fabricated.
--
-- 3. atlas.provider_interest — does this person want to work with us.
--
--    The same division every other atlas table keeps: LabStack owns the
--    provider, Atlas owns what our team learned by ringing them. Nothing here
--    writes to src or src_local.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The snapshot table the count reads.
-- ---------------------------------------------------------------------------
-- The foreign table first, because a host provisioned before SlotConfig was in
-- the import list has never seen it, and the snapshot below is defined from it.
-- The same self-bootstrap the refresh does for the pricing tables.
DO $$
BEGIN
  IF to_regclass('src."SlotConfig"') IS NULL THEN
    EXECUTE 'IMPORT FOREIGN SCHEMA public LIMIT TO ("SlotConfig") FROM SERVER labstack_src INTO src';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS src_local."SlotConfig" (LIKE src."SlotConfig");
CREATE INDEX IF NOT EXISTS idx_src_slotconfig_id       ON src_local."SlotConfig" (id);
CREATE INDEX IF NOT EXISTS idx_src_slotconfig_provider ON src_local."SlotConfig" (provider_id);
CREATE INDEX IF NOT EXISTS idx_src_appt_slot           ON src_local."Appointment" (slot_id);


-- ---------------------------------------------------------------------------
-- 2. analytics.mv_nurse_appointments — one row per nurse phone.
--
-- Keyed on the phone rather than the provider id, because that is what
-- atlas.nurses_all is keyed on and what the manual uploads match against. A
-- nurse with two provider rows on one number is one person to the team ringing
-- them, so their work adds up.
--
-- Cancelled appointments are counted separately rather than dropped: "booked
-- forty, nineteen cancelled" says something about a nurse that "twenty-one"
-- does not.
-- ---------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS analytics.mv_nurse_appointments CASCADE;

CREATE MATERIALIZED VIEW analytics.mv_nurse_appointments AS
SELECT
  regexp_replace(p.mobile, '[^0-9]', '', 'g')                        AS phone,
  COUNT(a.id)::int                                                   AS appointments,
  COUNT(*) FILTER (WHERE a."appointmentStatus"::text = 'COMPLETED')::int  AS completed,
  COUNT(*) FILTER (WHERE a."appointmentStatus"::text = 'CANCELED')::int   AS cancelled,
  COUNT(DISTINCT a."appointmentDate"::date)::int                     AS active_days,
  MIN(a."appointmentDate")::date                                     AS first_appointment,
  MAX(a."appointmentDate")::date                                     AS last_appointment
FROM src_local."Provider" p
JOIN src_local."ProviderType" pt ON pt.id = p."typeId" AND pt."typeName" = 'Nurse'
JOIN src_local."SlotConfig"   sc ON sc.provider_id = p.id
JOIN src_local."Appointment"  a  ON a.slot_id = sc.id
WHERE p.mobile IS NOT NULL
  AND regexp_replace(p.mobile, '[^0-9]', '', 'g') <> ''
GROUP BY 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_nurse_appt_phone
  ON analytics.mv_nurse_appointments (phone);

COMMENT ON MATERIALIZED VIEW analytics.mv_nurse_appointments IS
  'Appointments served per nurse, by phone. Attributed through '
  'Appointment.slot_id → SlotConfig.provider_id, which is the only link in the '
  'source that names an individual rather than a bucket.';

CREATE OR REPLACE FUNCTION atlas.refresh_nurse_appointments()
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.mv_nurse_appointments;
  RETURN NULL;
EXCEPTION
  WHEN object_not_in_prerequisite_state THEN
    REFRESH MATERIALIZED VIEW analytics.mv_nurse_appointments;
    RETURN NULL;
  WHEN OTHERS THEN
    RETURN left(SQLERRM, 200);
END $$;


-- ---------------------------------------------------------------------------
-- 3. atlas.provider_interest — the answer to "do you want to work with us".
--
-- Keyed on (kind, phone). Phone because that is the key both directories are
-- built on; kind because the same number can appear in both lists and the
-- answer is not necessarily the same — somebody may take phlebotomy rounds and
-- not home nursing.
--
-- Two states and an absence. "Not asked" is not a status, it is the lack of a
-- row, so a nurse nobody has rung cannot be mistaken for one who said no.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.provider_interest (
  kind        text        NOT NULL CHECK (kind IN ('phlebo', 'nurse')),
  phone       text        NOT NULL,
  status      text        NOT NULL CHECK (status IN ('interested', 'not_interested')),
  note        text,
  set_by      integer     REFERENCES atlas.users (id),
  set_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, phone)
);

CREATE INDEX IF NOT EXISTS idx_provider_interest_status
  ON atlas.provider_interest (kind, status);

COMMENT ON TABLE atlas.provider_interest IS
  'Whether a phlebo or nurse said they want to work with LabStack. Atlas''s '
  'own record of a phone call — the source knows nothing about it.';

-- Every change, because "who said they were interested in March" is asked in
-- June and by then the row only remembers the latest answer.
CREATE TABLE IF NOT EXISTS atlas.provider_interest_log (
  id          bigserial PRIMARY KEY,
  kind        text        NOT NULL,
  phone       text        NOT NULL,
  status      text,                      -- NULL when the answer was cleared
  note        text,
  set_by      integer     REFERENCES atlas.users (id),
  set_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_interest_log_key
  ON atlas.provider_interest_log (kind, phone, set_at DESC);
