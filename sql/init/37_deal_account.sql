-- A deal and its account stop being two records.
--
-- 36 created atlas.account and backfilled one per deal, but the Sales CRM had
-- no way to reach it: the board still read a company name typed into
-- sales_deal, so the meetings, contacts and book sizing a salesperson needs
-- were on a screen they had no link to. v_sales_deal now carries account_id,
-- and the deal page renders the account's own panels in place.

-- Any deal that 36 could not match — created since, or named differently from
-- its account — gets one now. Nothing is merged on a name here: a wrong merge
-- is far more expensive than a duplicate somebody links by hand.
INSERT INTO atlas.account (name, website, city, state, account_type, lifecycle,
                           owner_id, store_id, source, created_by, created_at)
SELECT d.company, d.website, d.city, d.state, d.account_type, 'sales',
       d.owner_id, NULL, d.source, d.created_by, d.created_at
FROM atlas.sales_deal d
WHERE d.account_id IS NULL;

UPDATE atlas.sales_deal d
   SET account_id = a.id
  FROM atlas.account a
 WHERE d.account_id IS NULL
   AND a.name = d.company
   AND a.store_id IS NOT DISTINCT FROM d.store_id;

DROP VIEW IF EXISTS analytics.v_sales_deal;

CREATE VIEW analytics.v_sales_deal AS
SELECT
  d.id                                   AS deal_id,
  d.pipeline_id,
  d.account_id,
  d.company, d.website, d.city, d.state,
  d.account_type,
  at.label                               AS account_type_label,
  d.stage_key,
  st.label                               AS stage_label,
  (st.probability)::int                  AS stage_probability,
  st.outcome                             AS stage_outcome,
  d.value_inr,
  (d.value_inr * st.probability / 100)::numeric(12,0) AS weighted_inr,
  d.expected_close::text                 AS expected_close,
  d.source,
  d.owner_id,
  u.name                                 AS owner_name,
  d.contact_name, d.contact_role, d.contact_phone, d.contact_email,
  d.store_id,
  s."storeName"                          AS store_name,
  d.lost_reason,
  (d.closed_at AT TIME ZONE 'Asia/Kolkata')::text   AS closed_at,
  (d.last_touch_at AT TIME ZONE 'Asia/Kolkata')::text AS last_touch_at,
  EXTRACT(day FROM now() - d.last_touch_at)::int     AS days_quiet,
  EXTRACT(day FROM now() - d.stage_since)::int       AS days_in_stage,
  (now() - d.last_touch_at > interval '14 days'
     AND st.outcome = 'open')                        AS is_stuck,
  (d.created_at AT TIME ZONE 'Asia/Kolkata')::text   AS created_at,

  (SELECT COUNT(*)::int FROM atlas.sales_task t
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
  (SELECT COALESCE(jsonb_agg(g.label ORDER BY g.label), '[]'::jsonb)
     FROM atlas.sales_deal_tag dt
     JOIN atlas.sales_tag g ON g.id = dt.tag_id
    WHERE dt.deal_id = d.id)                                              AS tags,

  -- What the account knows and the deal does not. Reading them here means the
  -- deal page can show a meeting history without a second round trip, and a
  -- won deal hands the next team numbers rather than a company name.
  (SELECT COUNT(*)::int FROM atlas.meeting m
     WHERE m.account_id = d.account_id AND m.happened_on IS NOT NULL)      AS meetings_done,
  (SELECT MIN(m.happened_on)::text FROM atlas.meeting m
     WHERE m.account_id = d.account_id)                                    AS first_met_on,
  (SELECT MAX(m.happened_on)::text FROM atlas.meeting m
     WHERE m.account_id = d.account_id)                                    AS last_met_on,
  (SELECT MIN(m.scheduled_on)::text FROM atlas.meeting m
     WHERE m.account_id = d.account_id
       AND m.scheduled_on >= atlas.ist_today())                            AS next_meeting_on,
  -- Who we actually talk to now lives on the account, where several people
  -- and a decision maker can exist. The deal's own four contact columns stay
  -- as the fallback for rows written before that was true.
  COALESCE((SELECT c.name FROM atlas.account_contact c
             WHERE c.account_id = d.account_id
             ORDER BY c.is_decision_maker DESC, c.id LIMIT 1),
           d.contact_name)                 AS primary_contact,
  COALESCE((SELECT c.role FROM atlas.account_contact c
             WHERE c.account_id = d.account_id
             ORDER BY c.is_decision_maker DESC, c.id LIMIT 1),
           d.contact_role)                 AS primary_contact_role,
  (SELECT c.name FROM atlas.account_contact c
     WHERE c.account_id = d.account_id AND c.is_decision_maker
     ORDER BY c.id LIMIT 1)                AS decision_maker,
  a.opd_book_cr,
  a.premium_book_cr,
  a.lifecycle                            AS account_lifecycle
FROM atlas.sales_deal d
JOIN atlas.sales_pipeline p ON p.id = d.pipeline_id
CROSS JOIN LATERAL (
  SELECT st->>'label' AS label,
         COALESCE((st->>'probability')::numeric, 0) AS probability,
         st->>'outcome' AS outcome
  FROM jsonb_array_elements(p.stages) st
  WHERE st->>'key' = d.stage_key
  LIMIT 1
) st
LEFT JOIN atlas.users u ON u.id = d.owner_id
LEFT JOIN atlas.sales_account_type at ON at.key = d.account_type
LEFT JOIN atlas.account a ON a.id = d.account_id
LEFT JOIN src_local."Store" s ON s.id = d.store_id;

COMMENT ON VIEW analytics.v_sales_deal IS
  'The sales board, with its account alongside: account_id links a deal to the '
  'row that outlives it, and the meeting counts come from atlas.meeting.';

-- Keep the two names in step. The deal is where a salesperson types, so it
-- wins; the account carries the result through onboarding and beyond.
CREATE OR REPLACE FUNCTION atlas.sync_deal_to_account() RETURNS trigger AS $$
BEGIN
  IF NEW.account_id IS NOT NULL THEN
    UPDATE atlas.account SET
      name         = NEW.company,
      city         = COALESCE(NEW.city, city),
      state        = COALESCE(NEW.state, state),
      website      = COALESCE(NEW.website, website),
      account_type = COALESCE(NEW.account_type, account_type),
      owner_id     = COALESCE(NEW.owner_id, owner_id),
      -- Never claim a store another account already holds: that is a merge,
      -- and a merge is a decision, not a side effect of a column changing.
      store_id     = CASE WHEN NEW.store_id IS NOT NULL
                           AND NOT EXISTS (SELECT 1 FROM atlas.account x
                                            WHERE x.store_id = NEW.store_id
                                              AND x.id <> NEW.account_id)
                          THEN NEW.store_id ELSE store_id END,
      updated_at   = now()
    WHERE id = NEW.account_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_deal_to_account ON atlas.sales_deal;
CREATE TRIGGER trg_sync_deal_to_account
  AFTER INSERT OR UPDATE OF company, city, state, website, account_type, owner_id, store_id
  ON atlas.sales_deal
  FOR EACH ROW EXECUTE FUNCTION atlas.sync_deal_to_account();

-- Two accounts, one company.
--
-- 36 gave every live store an account, and a deal has carried its own since it
-- was created. When that deal is won onto a store that already exists in the
-- console — the normal case, since Atlas cannot create one — the two rows are
-- the same company and only one may hold the store_id. Merging is the honest
-- answer: the store's account is the one the rest of Atlas already references,
-- so the deal's account folds into it and the sales history comes along.
CREATE OR REPLACE FUNCTION atlas.merge_account(src integer, dst integer)
RETURNS void AS $$
BEGIN
  IF src IS NULL OR dst IS NULL OR src = dst THEN RETURN; END IF;

  UPDATE atlas.meeting         SET account_id = dst WHERE account_id = src;
  UPDATE atlas.account_contact SET account_id = dst WHERE account_id = src;
  UPDATE atlas.account_task    SET account_id = dst WHERE account_id = src;
  UPDATE atlas.sales_deal      SET account_id = dst WHERE account_id = src;

  -- A line contracted on either row stays contracted; a clash keeps the
  -- destination's status, which is the one the accounts team has been editing.
  INSERT INTO atlas.account_service (account_id, stream, status, contracted_on, note, updated_by)
  SELECT dst, v.stream, v.status, v.contracted_on, v.note, v.updated_by
  FROM atlas.account_service v WHERE v.account_id = src
  ON CONFLICT (account_id, stream) DO NOTHING;

  -- Only fill what the destination is missing: a number somebody typed on the
  -- store's account is never overwritten by one typed on the deal's.
  UPDATE atlas.account d SET
    premium_book_cr = COALESCE(d.premium_book_cr, s.premium_book_cr),
    opd_book_cr     = COALESCE(d.opd_book_cr,     s.opd_book_cr),
    avg_ticket_inr  = COALESCE(d.avg_ticket_inr,  s.avg_ticket_inr),
    account_type    = COALESCE(d.account_type,    s.account_type),
    website         = COALESCE(d.website,         s.website),
    owner_id        = COALESCE(d.owner_id,        s.owner_id),
    mou_signed_on   = COALESCE(d.mou_signed_on,   s.mou_signed_on),
    source          = COALESCE(d.source,          s.source),
    updated_at      = now()
  FROM atlas.account s
  WHERE d.id = dst AND s.id = src;

  DELETE FROM atlas.account_service WHERE account_id = src;
  DELETE FROM atlas.account WHERE id = src;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.merge_account(integer, integer) IS
  'Fold the first account into the second, moving meetings, contacts, tasks, '
  'deals and contracted lines, and filling only the fields the second lacks.';
