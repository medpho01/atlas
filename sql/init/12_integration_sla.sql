-- ============================================================================
-- E4 · Integration index (F/O/E) and E7 · SLA targets.
--
-- Both encode a claim the deck makes, so both live in data rather than slides:
-- a number on screen that no query can produce is a number nobody can check.
-- ============================================================================

-- --------------------------------------------------------------------------
-- Integration: how deeply a provider is wired in, on three axes.
--   F · fulfilment   can we send them work and get a result back
--   O · operations   how much of the workflow is automated vs phone-and-email
--   E · experience   what the patient sees end to end
-- Each 0-4. Level definitions live in atlas.integration_level so they can be
-- reworded without a deploy, and so the UI legend and the classifier read the
-- same text.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.integration_level (
  axis        char(1) NOT NULL CHECK (axis IN ('F', 'O', 'E')),
  level       int     NOT NULL CHECK (level BETWEEN 0 AND 4),
  label       text    NOT NULL,
  definition  text,
  PRIMARY KEY (axis, level)
);

INSERT INTO atlas.integration_level (axis, level, label, definition) VALUES
 ('F',0,'None','No commercial relationship.'),
 ('F',1,'Rates agreed','Rate card loaded — we know what they charge.'),
 ('F',2,'Bookable','Orders can be placed, manually.'),
 ('F',3,'Reporting','Results come back into the platform.'),
 ('F',4,'Settled','Billing and settlement run through us.'),
 ('O',0,'Manual','Phone and email for every order.'),
 ('O',1,'Portal','Staff use a shared portal.'),
 ('O',2,'Console','Provider works our console directly.'),
 ('O',3,'API','Orders and status flow by API.'),
 ('O',4,'Autonomous','Slots, capacity and dispatch all automated.'),
 ('E',0,'Opaque','Patient sees the provider, not us.'),
 ('E',1,'Co-branded','Patient recognises both.'),
 ('E',2,'Tracked','Patient gets status updates from us.'),
 ('E',3,'Unified','One journey, our booking to our report.'),
 ('E',4,'Owned','Full experience including support and follow-up.')
ON CONFLICT (axis, level) DO UPDATE SET label = EXCLUDED.label, definition = EXCLUDED.definition;

CREATE TABLE IF NOT EXISTS atlas.provider_integration (
  lab_id     int PRIMARY KEY,
  f_level    int NOT NULL DEFAULT 0 CHECK (f_level BETWEEN 0 AND 4),
  o_level    int NOT NULL DEFAULT 0 CHECK (o_level BETWEEN 0 AND 4),
  e_level    int NOT NULL DEFAULT 0 CHECK (e_level BETWEEN 0 AND 4),
  -- What justified each level. The network team will fill most of this by
  -- hand, and a level with no evidence is a claim nobody can audit.
  evidence   jsonb NOT NULL DEFAULT '{}'::jsonb,
  source     text NOT NULL DEFAULT 'derived' CHECK (source IN ('derived', 'upload', 'human')),
  noted_by   int REFERENCES atlas.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_integration_o_idx ON atlas.provider_integration (o_level);

-- Seed only what the database can prove, and say so in source='derived'.
--
-- F1 is genuinely derivable: a lab with rates loaded has rates loaded. F3 too
-- — if results have come back through us, reporting works. Everything above
-- that, and every O and E level, is a fact about how the partnership runs that
-- no table records; those stay 0 until someone fills them in. Seeding them
-- with guesses would make the distribution chart in the deck a fiction.
CREATE OR REPLACE FUNCTION atlas.seed_integration_from_signals()
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  INSERT INTO atlas.provider_integration (lab_id, f_level, o_level, e_level, evidence, source)
  SELECT l.id,
         GREATEST(
           CASE WHEN EXISTS (SELECT 1 FROM analytics.mv_test_rates r
                             WHERE r.lab_id = l.id AND r.b2b > 10) THEN 1 ELSE 0 END,
           CASE WHEN COALESCE(q.delivered, 0) > 0 THEN 3 ELSE 0 END
         ),
         0, 0,
         jsonb_build_object(
           'has_rates',     EXISTS (SELECT 1 FROM analytics.mv_test_rates r
                                    WHERE r.lab_id = l.id AND r.b2b > 10),
           'orders_delivered', COALESCE(q.delivered, 0),
           'seeded_at',     now()
         ),
         'derived'
  FROM src."Lab" l
  LEFT JOIN analytics.mv_lab_quality_v2 q ON q.lab_id = l.id
  WHERE l.active
  -- Never flatten a human or uploaded assessment with a derived guess.
  ON CONFLICT (lab_id) DO UPDATE SET
    f_level    = GREATEST(atlas.provider_integration.f_level, EXCLUDED.f_level),
    evidence   = atlas.provider_integration.evidence || EXCLUDED.evidence,
    updated_at = now()
  WHERE atlas.provider_integration.source = 'derived';

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END$$;

-- --------------------------------------------------------------------------
-- SLA targets. In data so /quality can show current-vs-target rather than a
-- number with no yardstick, and so changing a target is an edit, not a deploy.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas.sla_targets (
  kind        text NOT NULL,
  metric      text NOT NULL,
  target      numeric NOT NULL,
  unit        text NOT NULL,
  -- true when higher is better (fulfilment %), false when lower is (TAT, cancels)
  higher_is_better boolean NOT NULL,
  amber_band  numeric NOT NULL DEFAULT 0.1,   -- fraction of target still amber
  note        text,
  PRIMARY KEY (kind, metric)
);

INSERT INTO atlas.sla_targets (kind, metric, target, unit, higher_is_better, note) VALUES
 ('LAB',      'delivered_pct',      95,  '%',    true,  'Orders reported vs booked'),
 ('LAB',      'cancel_pct',          5,  '%',    false, 'Cancelled after booking'),
 ('LAB',      'median_tat_hours',   24,  'hours',false, 'Booking to report'),
 ('PHLEBO',   'on_time_pct',        90,  '%',    true,  'Collection within the slot'),
 ('NURSE',    'fulfilment_pct',     95,  '%',    true,  'Visits completed vs booked'),
 ('DOCTOR',   'honoured_pct',       95,  '%',    true,  'Appointments honoured'),
 ('PHARMACY', 'fulfilment_pct',     95,  '%',    true,  'Orders fulfilled'),
 ('PHARMACY', 'delivery_tat_hours', 24,  'hours',false, 'Order to delivery')
ON CONFLICT (kind, metric) DO UPDATE SET
  target = EXCLUDED.target, unit = EXCLUDED.unit,
  higher_is_better = EXCLUDED.higher_is_better, note = EXCLUDED.note;
