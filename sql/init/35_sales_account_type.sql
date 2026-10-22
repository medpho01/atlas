-- ===========================================================================
-- 35_sales_account_type.sql — what kind of company a deal is.
--
-- An insurer, a broker and a health-tech app buy the same diagnostics for
-- completely different reasons, on different cycles, through different people.
-- Without the type on the card, the board sorts by value and tells you nothing
-- about which conversation you are walking into.
--
-- A table rather than an enum or a CHECK, because the list will change and
-- that should not need a deploy — the same reason the role matrix and the
-- pipelines moved into the database. A deal stores the key as plain text and
-- not a foreign key: retiring a type should grey it out of the picker, never
-- orphan or rewrite the deals already on it.
--
-- Idempotent. Safe to run twice; the seed only fills what is missing, so a
-- list somebody has edited survives the next deploy.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS atlas.sales_account_type (
  key        text    PRIMARY KEY,
  label      text    NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  active     boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE atlas.sales_account_type IS
  'The kinds of company we sell to. Edited rather than deployed. A deal holds '
  'the key as text, so retiring a type never orphans the deals on it.';

INSERT INTO atlas.sales_account_type (key, label, sort_order) VALUES
  ('insurer',     'Insurer',            10),
  ('broker',      'Broker / benefits',  20),
  ('healthtech',  'HealthTech',         30),
  ('corporate',   'Corporate',          40),
  ('clinic',      'Clinic / hospital',  50),
  ('wellness',    'Wellness / fitness', 60),
  ('pharmacy',    'Pharmacy',           70),
  ('lab',         'Lab / diagnostics',  80),
  ('other',       'Other',              99)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE atlas.sales_deal
  ADD COLUMN IF NOT EXISTS account_type text;

CREATE INDEX IF NOT EXISTS idx_sales_deal_account_type
  ON atlas.sales_deal (account_type);

COMMENT ON COLUMN atlas.sales_deal.account_type IS
  'Key into atlas.sales_account_type. Text, not a foreign key, on purpose.';

-- The view carries the label beside the key so nothing downstream has to join
-- a lookup table to render a card.
DROP VIEW IF EXISTS analytics.v_sales_deal;

CREATE VIEW analytics.v_sales_deal AS
SELECT
  d.id                                   AS deal_id,
  d.pipeline_id,
  d.company, d.website, d.city, d.state,
  d.account_type,
  at.label                               AS account_type_label,
  d.stage_key,
  st.label                               AS stage_label,
  (st.probability)::int                  AS stage_probability,
  st.outcome                             AS stage_outcome,
  d.value_inr,
  ROUND(COALESCE(d.value_inr, 0) * COALESCE(st.probability, 0) / 100.0) AS weighted_inr,
  d.expected_close::text                 AS expected_close,
  d.source,
  d.owner_id,
  u.name                                 AS owner_name,
  d.contact_name, d.contact_role, d.contact_phone, d.contact_email,
  d.store_id,
  s."storeName"                          AS store_name,
  d.lost_reason,
  (d.closed_at   AT TIME ZONE 'Asia/Kolkata')::text AS closed_at,
  (d.created_at  AT TIME ZONE 'Asia/Kolkata')::text AS created_at,
  (d.last_touch_at AT TIME ZONE 'Asia/Kolkata')::text AS last_touch_at,
  EXTRACT(day FROM now() - d.last_touch_at)::int     AS days_quiet,
  EXTRACT(day FROM now() - d.stage_since)::int       AS days_in_stage,
  (now() - d.last_touch_at > interval '14 days'
     AND st.outcome = 'open')            AS is_stuck,
  (SELECT count(*)::int FROM atlas.sales_note n WHERE n.deal_id = d.id)   AS note_count,
  (SELECT count(*)::int FROM atlas.sales_task t
     WHERE t.deal_id = d.id AND t.done_at IS NULL)                        AS open_tasks,
  (SELECT t.title FROM atlas.sales_task t
     WHERE t.deal_id = d.id AND t.done_at IS NULL
     ORDER BY t.due_on NULLS LAST, t.id LIMIT 1)                          AS next_task,
  (SELECT t.due_on::text FROM atlas.sales_task t
     WHERE t.deal_id = d.id AND t.done_at IS NULL
     ORDER BY t.due_on NULLS LAST, t.id LIMIT 1)                          AS next_task_due,
  (SELECT t.due_on < atlas.ist_today() FROM atlas.sales_task t
     WHERE t.deal_id = d.id AND t.done_at IS NULL
     ORDER BY t.due_on NULLS LAST, t.id LIMIT 1)                          AS next_task_late,
  COALESCE((SELECT array_agg(tg.label ORDER BY tg.label)
              FROM atlas.sales_deal_tag dt
              JOIN atlas.sales_tag tg ON tg.id = dt.tag_id
             WHERE dt.deal_id = d.id), ARRAY[]::text[])                   AS tags
FROM atlas.sales_deal d
JOIN atlas.sales_pipeline p ON p.id = d.pipeline_id
LEFT JOIN LATERAL (
  SELECT x.key, x.label, x.probability, x.outcome
  FROM jsonb_to_recordset(p.stages)
       AS x(key text, label text, probability numeric, outcome text)
  WHERE x.key = d.stage_key
) st ON true
LEFT JOIN atlas.sales_account_type at ON at.key = d.account_type
LEFT JOIN atlas.users u ON u.id = d.owner_id
LEFT JOIN src_local."Store" s ON s.id = d.store_id;

COMMENT ON VIEW analytics.v_sales_deal IS
  'One row per deal with its stage, its kind of company, its next committed '
  'task and whether it has gone quiet. Stuck is derived — fourteen days '
  'without a note, a task or a move.';
