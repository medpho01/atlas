-- ============================================================================
-- Logins, city tiers and a working CRM pipeline — local development only.
--
-- THE PASSWORD HASH BELOW IS PUBLIC. Every account here signs in with
-- "atlas1234". That is deliberate and it is why these accounts use the
-- @local.test domain: if one of them ever appears in a real database,
-- something has gone badly wrong. Never run this file against production.
--
-- Re-runnable: every insert either conflicts harmlessly or clears its own
-- rows first.
-- ============================================================================

-- bcrypt(atlas1234, 12 rounds)
\set pw '''$2b$12$Lugs0M7cTewRw8.yWAUGjeVfdSsQqqKBj0pWbvmKXPmZJxxy4bx0q'''

INSERT INTO atlas.users (email, password_hash, name, role) VALUES
  ('admin@local.test',  :pw, 'Ada Admin',     'admin'),
  ('lead@local.test',   :pw, 'Leo Lead',      'network_lead'),
  ('member@local.test', :pw, 'Mira Member',   'network'),
  ('nina@local.test',   :pw, 'Nina Networker','network'),
  ('viewer@local.test', :pw, 'Vic Viewer',    'viewer')
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      active = true;

-- ---------------------------------------------------------------------------
-- City tiers. Readiness, the reach radii and the metro/non-metro filters all
-- read these; without them every seeded city falls through as untiered.
-- ---------------------------------------------------------------------------
INSERT INTO atlas.city_tier (city_key, city, states, tier, rationale, confidence, source)
VALUES
  (atlas.city_key('Mumbai'),    'Mumbai',    'Maharashtra',    'Tier 1', 'Metro',       1.00, 'human'),
  (atlas.city_key('Delhi'),     'Delhi',     'Delhi',          'Tier 1', 'Metro',       1.00, 'human'),
  (atlas.city_key('Bengaluru'), 'Bengaluru', 'Karnataka',      'Tier 1', 'Metro',       1.00, 'human'),
  (atlas.city_key('Hyderabad'), 'Hyderabad', 'Telangana',      'Tier 1', 'Metro',       1.00, 'human'),
  (atlas.city_key('Pune'),      'Pune',      'Maharashtra',    'Tier 2', 'Large city',  1.00, 'human'),
  (atlas.city_key('Jaipur'),    'Jaipur',    'Rajasthan',      'Tier 2', 'Large city',  1.00, 'human'),
  (atlas.city_key('Indore'),    'Indore',    'Madhya Pradesh', 'Tier 2', 'Large city',  1.00, 'human'),
  (atlas.city_key('Kochi'),     'Kochi',     'Kerala',         'Tier 2', 'Large city',  1.00, 'human'),
  (atlas.city_key('Nagpur'),    'Nagpur',    'Maharashtra',    'Tier 3', 'Smaller city',1.00, 'human'),
  (atlas.city_key('Guwahati'),  'Guwahati',  'Assam',          'Tier 3', 'Smaller city',1.00, 'human')
ON CONFLICT (city_key) DO UPDATE SET tier = EXCLUDED.tier, source = 'human';

-- ---------------------------------------------------------------------------
-- The CRM, pre-loaded with a campaign in flight.
--
-- Built to exercise the parts that are easy to get wrong locally: cards at
-- every stage, some of them deliberately stale so the Score page has both
-- halves of its arithmetic, and two people with different amounts of work so
-- the team table is not a row of zeroes.
-- ---------------------------------------------------------------------------
DELETE FROM atlas.crm_activities a
 USING atlas.crm_threads t WHERE t.id = a.thread_id AND t.name LIKE '[sample]%';
DELETE FROM atlas.crm_thread_providers tp
 USING atlas.crm_threads t WHERE t.id = tp.thread_id AND t.name LIKE '[sample]%';
DELETE FROM atlas.crm_thread_members m
 USING atlas.crm_threads t WHERE t.id = m.thread_id AND t.name LIKE '[sample]%';
DELETE FROM atlas.crm_providers WHERE source = 'human';
DELETE FROM atlas.crm_threads WHERE name LIKE '[sample]%';

-- The funnel the real team uses, so the seeded points ladder matches what you
-- would see in production.
INSERT INTO atlas.crm_funnels (name, stages, is_default, success_stage_key)
SELECT 'Provider Onboarding Funnel',
  '[{"key":"identified","label":"Identified"},
    {"key":"need_help","label":"Need Help With Contact"},
    {"key":"contact_identified","label":"Contact Identified"},
    {"key":"in_progress","label":"In Progress"},
    {"key":"price_agreed","label":"Price Agreed"},
    {"key":"mou","label":"MoU in Progress"},
    {"key":"closed","label":"Closed"},
    {"key":"onboarded","label":"Onboarded on Labstack"},
    {"key":"stalled","label":"Stalled"}]'::jsonb,
  true, 'onboarded'
WHERE NOT EXISTS (SELECT 1 FROM atlas.crm_funnels WHERE name = 'Provider Onboarding Funnel');

SELECT atlas.crm_seed_stage_points();

DO $$
DECLARE
  f_id  int;
  lead  int; mira int; nina int;
  t_hosp int; t_rad int;
  p record; i int := 0;
  stages text[] := ARRAY['identified','need_help','contact_identified','in_progress',
                         'price_agreed','mou','closed','onboarded'];
  st text; owner_id int; age int;
BEGIN
  SELECT id INTO f_id FROM atlas.crm_funnels WHERE name = 'Provider Onboarding Funnel';
  SELECT id INTO lead FROM atlas.users WHERE email = 'lead@local.test';
  SELECT id INTO mira FROM atlas.users WHERE email = 'member@local.test';
  SELECT id INTO nina FROM atlas.users WHERE email = 'nina@local.test';

  INSERT INTO atlas.crm_threads (name, description, funnel_id, target_count, provider_kind, region, status, created_by)
  VALUES ('[sample] Large Hospital Chains', 'Metro hospitals with in-house labs',
          f_id, 20, 'HOSPITAL', 'West', 'active', lead)
  RETURNING id INTO t_hosp;

  INSERT INTO atlas.crm_threads (name, description, funnel_id, target_count, provider_kind, region, status, created_by)
  VALUES ('[sample] Radiology Network', 'Imaging centres for centre-visit coverage',
          f_id, 15, 'RADIOLOGY', 'South', 'active', lead)
  RETURNING id INTO t_rad;

  INSERT INTO atlas.crm_thread_members (thread_id, user_id, added_by) VALUES
    (t_hosp, mira, lead), (t_hosp, lead, lead), (t_rad, nina, lead), (t_rad, lead, lead)
  ON CONFLICT DO NOTHING;

  -- One CRM card per seeded lab, up to 24, walked through the funnel.
  FOR p IN SELECT id, "labName", city, state, pincode FROM src_local."Lab" ORDER BY id LIMIT 24 LOOP
    i := i + 1;
    st := stages[1 + (i % array_length(stages, 1))];
    owner_id := CASE WHEN i % 3 = 0 THEN nina WHEN i % 3 = 1 THEN mira ELSE lead END;
    -- Every fourth card is left old enough to have gone stale — deliberately
    -- not the same cycle as the owner above, or one person would own every
    -- stale card and the Score page would read as a story about them rather
    -- than as an example of the arithmetic.
    age := CASE WHEN i % 4 = 0 THEN 25 + (i % 20) ELSE 2 + (i % 5) END;

    WITH np AS (
      INSERT INTO atlas.crm_providers (name, kind, city, state, pincode, phone, email,
                                       contact_person, source, created_by)
      VALUES (p."labName",
              (ARRAY['HOSPITAL','LAB','RADIOLOGY','COLLECTION_CENTRE'])[1 + (i % 4)],
              p.city, p.state, p.pincode,
              '90000' || lpad(p.id::text, 5, '0'), 'ops' || p.id || '@example.test',
              'Contact ' || p.id, 'seed', lead)
      RETURNING id
    )
    INSERT INTO atlas.crm_thread_providers (thread_id, provider_id, stage_key, assignee_id, added_by, created_at, updated_at)
    SELECT CASE WHEN i % 2 = 0 THEN t_hosp ELSE t_rad END, np.id, st, owner_id, lead,
           now() - ((age + 20) || ' days')::interval,
           now() - (age || ' days')::interval
    FROM np;
  END LOOP;

  -- The journey log. Points are earned from these, so without them the Score
  -- page is honest but empty.
  INSERT INTO atlas.crm_activities (thread_id, provider_id, author_id, type, body, meta, created_at)
  SELECT tp.thread_id, tp.provider_id, tp.assignee_id, 'stage_change',
         'Moved on', jsonb_build_object('from', 'identified', 'to', tp.stage_key),
         tp.updated_at
  FROM atlas.crm_thread_providers tp
  JOIN atlas.crm_threads t ON t.id = tp.thread_id
  WHERE t.name LIKE '[sample]%' AND tp.stage_key <> 'identified';

  INSERT INTO atlas.crm_activities (thread_id, provider_id, author_id, type, body, created_at)
  SELECT tp.thread_id, tp.provider_id, tp.assignee_id, 'note',
         'Spoke to the centre head; sending the rate list across.',
         tp.updated_at + interval '2 hours'
  FROM atlas.crm_thread_providers tp
  JOIN atlas.crm_threads t ON t.id = tp.thread_id
  WHERE t.name LIKE '[sample]%' AND tp.provider_id % 3 = 0;
END $$;

ANALYZE;
