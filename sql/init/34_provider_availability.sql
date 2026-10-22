-- ===========================================================================
-- 34_provider_availability.sql — when a phlebo or nurse can actually work.
--
-- The directories could record whether somebody wants to work with us and
-- nothing about when they can. "Interested, and free mornings" is one phone
-- call; splitting it across two tools means the second half never gets
-- written down.
--
-- Three booleans rather than an array of labels: a filter is then
-- "WHERE morning", which indexes, and adding a night shift later is one
-- column rather than a migration of every stored value. Somebody can be
-- available in more than one — most are — so it is not an enum.
--
-- Keyed the way the directories are keyed, on (kind, phone), and separate from
-- atlas.provider_interest on purpose: availability is a fact about a person's
-- week, interest is an answer to a question. Somebody can tell you the first
-- before deciding the second.
--
-- Idempotent. Safe to run twice.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS atlas.provider_availability (
  kind      text        NOT NULL CHECK (kind IN ('phlebo', 'nurse')),
  phone     text        NOT NULL,
  morning   boolean     NOT NULL DEFAULT false,
  afternoon boolean     NOT NULL DEFAULT false,
  evening   boolean     NOT NULL DEFAULT false,
  note      text,
  set_by    integer     REFERENCES atlas.users (id),
  set_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, phone),
  -- A row with nothing ticked says nothing. The application deletes instead,
  -- so "not asked" stays the absence of a row rather than a row of falses
  -- that looks like "available never".
  CONSTRAINT provider_availability_not_empty CHECK (morning OR afternoon OR evening)
);

CREATE INDEX IF NOT EXISTS idx_provider_availability_slots
  ON atlas.provider_availability (kind, morning, afternoon, evening);

COMMENT ON TABLE atlas.provider_availability IS
  'When a phlebo or nurse said they can work. A missing row means nobody has '
  'asked — never "available at no time", which is what a row of falses would '
  'have meant, so the application deletes rather than storing one.';

-- Every change, for the same reason the interest log exists: "they said
-- mornings in October" is asked in January.
CREATE TABLE IF NOT EXISTS atlas.provider_availability_log (
  id        bigserial PRIMARY KEY,
  kind      text        NOT NULL,
  phone     text        NOT NULL,
  morning   boolean,
  afternoon boolean,
  evening   boolean,
  set_by    integer     REFERENCES atlas.users (id),
  set_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_availability_log_key
  ON atlas.provider_availability_log (kind, phone, set_at DESC);
