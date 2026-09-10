-- ============================================================================
-- Network CRM — points, targets and month-end incentive.
--
-- The model, in one paragraph: every funnel stage is worth points, earned once
-- per provider by whoever moves the card into that stage. Every stage also has
-- a number of days it may reasonably sit there; crossing that costs twice the
-- stage's points, and every further full period costs twice again, charged to
-- whoever owns the card. A person's month is the earned points less the
-- penalties charged in that month, read against a target that an admin sets.
-- The incentive is a slab on the percentage of target reached.
--
-- Nothing here is hard-coded: the points, the days, the multiplier, the targets
-- and the slabs are all rows, because the first month of running this will show
-- that some of them are wrong.
-- ============================================================================

-- ---- What each stage is worth, and how long it may sit -------------------
CREATE TABLE IF NOT EXISTS atlas.crm_stage_points (
  funnel_id  int NOT NULL REFERENCES atlas.crm_funnels(id) ON DELETE CASCADE,
  stage_key  text NOT NULL,
  points     int NOT NULL DEFAULT 0,
  -- What one overstayed period costs. NULL means the default relationship —
  -- the multiplier times the stage's own points. Set it where a stage earns
  -- nothing but still must not become somewhere to park a card.
  penalty_points int,
  -- NULL = this stage never goes stale. Terminal stages are NULL: a provider
  -- that is onboarded is finished, and charging rent on it is nonsense.
  sla_days   int,
  PRIMARY KEY (funnel_id, stage_key)
);

-- ---- Everything that is a policy rather than a fact ----------------------
ALTER TABLE atlas.crm_stage_points ADD COLUMN IF NOT EXISTS penalty_points int;

CREATE TABLE IF NOT EXISTS atlas.crm_score_settings (
  id                 boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- What overstaying costs, as a multiple of the stage's own points.
  penalty_multiplier numeric NOT NULL DEFAULT 2,
  -- The target a person gets for a month nobody has set one for.
  default_target     int     NOT NULL DEFAULT 100,
  -- The full month-end incentive for hitting 100% of target, per person.
  incentive_pot      numeric NOT NULL DEFAULT 0,
  -- Beyond 100%, each further point pays this much...
  bonus_per_point    numeric NOT NULL DEFAULT 0,
  -- ...up to this share of the pot, so a runaway month stays budgetable.
  max_payout_pct     int     NOT NULL DEFAULT 150,
  -- How many times one stretch may be charged. Without a stop, a card nobody
  -- ever touches bills its owner twice the stage every week forever, and a
  -- month's score turns into a number about the past rather than the month.
  -- 0 means no limit.
  max_penalty_periods int    NOT NULL DEFAULT 4,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE atlas.crm_score_settings
  ADD COLUMN IF NOT EXISTS max_penalty_periods int NOT NULL DEFAULT 4;
INSERT INTO atlas.crm_score_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- ---- The slabs: reach this % of target, earn this % of the pot -----------
CREATE TABLE IF NOT EXISTS atlas.crm_incentive_slabs (
  min_pct    int PRIMARY KEY,      -- inclusive
  payout_pct int NOT NULL
);
INSERT INTO atlas.crm_incentive_slabs (min_pct, payout_pct)
VALUES (0, 0), (60, 50), (80, 75), (100, 100)
ON CONFLICT DO NOTHING;

-- ---- Targets. A default for everyone, overridable per person per month ----
CREATE TABLE IF NOT EXISTS atlas.crm_point_targets (
  user_id       int  NOT NULL REFERENCES atlas.users(id) ON DELETE CASCADE,
  month         date NOT NULL,          -- always the 1st
  target_points int  NOT NULL,
  set_by        int REFERENCES atlas.users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);

-- ---------------------------------------------------------------------------
-- Seed a funnel's stages with a defensible starting ladder.
--
-- Points ramp with position: the first conversation is worth something, the
-- signature is worth a lot more, and the gap between them is what stops
-- someone farming the top of the funnel. A stage whose name says the work
-- stopped — stalled, dropped, lost — is worth nothing and never goes stale;
-- so is the success stage, which is the end of the road, not a waiting room.
--
-- Only fills in stages that have no row, so editing a value and re-running
-- this does not undo the edit.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.crm_seed_stage_points(p_funnel int DEFAULT NULL)
RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  WITH f AS (
    SELECT id, stages, success_stage_key FROM atlas.crm_funnels
    WHERE p_funnel IS NULL OR id = p_funnel
  ),
  s AS (
    SELECT f.id AS funnel_id,
           st.value ->> 'key'   AS stage_key,
           st.value ->> 'label' AS label,
           (st.ord - 1)         AS idx,
           f.success_stage_key
    FROM f, LATERAL jsonb_array_elements(f.stages) WITH ORDINALITY st(value, ord)
  ),
  graded AS (
    SELECT s.*,
           -- Stages that count as progress, numbered so the dead ends and the
           -- holding pens sitting among them do not stretch the ramp.
           (s.stage_key = s.success_stage_key) AS is_success,
           (s.label ~* '(stall|drop|lost|reject|dead)') AS is_dead,
           -- Asking for help is not progress and must never pay. A stage that
           -- earns points for saying you are stuck is a stage people will move
           -- cards into, and the queue fills with cards waiting on nobody.
           (s.label ~* '(help|blocked|waiting|hold|park)') AS is_help,
           COUNT(*) FILTER (WHERE NOT (s.label ~* '(stall|drop|lost|reject|dead|help|blocked|waiting|hold|park)'))
             OVER (PARTITION BY s.funnel_id) AS live_n,
           -- Counts only the stages that are on the ladder, so a holding pen
           -- in the middle of the funnel does not push the stages after it up
           -- a rung and carry the top past where the ramp was meant to end.
           COUNT(*) FILTER (WHERE NOT (s.label ~* '(stall|drop|lost|reject|dead|help|blocked|waiting|hold|park)'))
             OVER (PARTITION BY s.funnel_id ORDER BY s.idx
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS live_i
    FROM s
  )
  INSERT INTO atlas.crm_stage_points (funnel_id, stage_key, points, sla_days, penalty_points)
  SELECT g.funnel_id, g.stage_key,
         CASE WHEN g.is_dead OR g.is_help THEN 0
              ELSE GREATEST(1, ROUND(1 + 11.0 * (g.live_i - 1) / GREATEST(g.live_n - 1, 1)))::int
         END,
         CASE WHEN g.is_dead OR g.is_success THEN NULL
              -- A card asking for help is the one thing that should be picked
              -- up fastest, so it gets the shortest clock in the funnel.
              WHEN g.is_help THEN 3
              ELSE 7 END,
         -- Earning nothing would also mean costing nothing, which turns the
         -- help column into free parking. A small flat cost per period keeps
         -- it a place cards pass through rather than sit.
         CASE WHEN g.is_help THEN 2 ELSE NULL END
  FROM graded g
  ON CONFLICT (funnel_id, stage_key) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

SELECT atlas.crm_seed_stage_points();

-- ---------------------------------------------------------------------------
-- Every stretch a card spent in a stage, reconstructed from the journey log.
--
-- The log records the move, not the sitting, so the intervals have to be
-- rebuilt: a card's life is the stage it was added in, then one stretch per
-- stage_change, the last of which is still running. Both scoring halves read
-- this, which is why they can never disagree about when something happened.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW atlas.crm_stage_spells AS
WITH moves AS (
  SELECT a.thread_id, a.provider_id, a.author_id,
         a.meta ->> 'to'   AS stage_key,
         a.meta ->> 'from' AS from_key,
         a.created_at      AS entered
  FROM atlas.crm_activities a
  WHERE a.type = 'stage_change' AND a.meta ? 'to' AND a.thread_id IS NOT NULL
),
-- The opening stretch: from when the card joined the thread until its first
-- move. Its stage is what the first move came *from*, or where it still sits.
opening AS (
  SELECT tp.thread_id, tp.provider_id, tp.added_by AS author_id,
         COALESCE(
           (SELECT m.from_key FROM moves m
             WHERE m.thread_id = tp.thread_id AND m.provider_id = tp.provider_id
             ORDER BY m.entered LIMIT 1),
           tp.stage_key) AS stage_key,
         NULL::text AS from_key,
         tp.created_at AS entered
  FROM atlas.crm_thread_providers tp
),
all_spells AS (
  SELECT * FROM opening
  UNION ALL
  SELECT thread_id, provider_id, author_id, stage_key, from_key, entered FROM moves
)
SELECT
  s.thread_id, s.provider_id, s.author_id, s.stage_key, s.from_key, s.entered,
  LEAD(s.entered) OVER (
    PARTITION BY s.thread_id, s.provider_id ORDER BY s.entered
  ) AS left_at,
  -- The opening stretch is not a move anyone made, so it earns nothing.
  (s.from_key IS NOT NULL) AS is_move
FROM all_spells s;

-- ---------------------------------------------------------------------------
-- Points earned in a window: one award per provider per stage, to whoever
-- made the move.
--
-- Once per stage per card, deliberately. Bouncing a provider between two
-- stages is a normal part of the work and must not be a way to print points.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.crm_points_earned(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  user_id int, thread_id int, provider_id int,
  stage_key text, points int, earned_at timestamptz
) LANGUAGE sql STABLE AS $$
  WITH first_entry AS (
    SELECT DISTINCT ON (sp.thread_id, sp.provider_id, sp.stage_key)
           sp.thread_id, sp.provider_id, sp.stage_key, sp.author_id, sp.entered
    FROM atlas.crm_stage_spells sp
    WHERE sp.is_move
    ORDER BY sp.thread_id, sp.provider_id, sp.stage_key, sp.entered
  )
  SELECT fe.author_id, fe.thread_id, fe.provider_id, fe.stage_key,
         COALESCE(spt.points, 0), fe.entered
  FROM first_entry fe
  JOIN atlas.crm_threads t ON t.id = fe.thread_id
  LEFT JOIN atlas.crm_stage_points spt
         ON spt.funnel_id = t.funnel_id AND spt.stage_key = fe.stage_key
  WHERE fe.entered >= p_from AND fe.entered < p_to
    AND fe.author_id IS NOT NULL
    AND COALESCE(spt.points, 0) <> 0;
$$;

-- ---------------------------------------------------------------------------
-- Points lost in a window to cards left sitting.
--
-- A stretch that passes its stage's allowance costs the multiplier times the
-- stage's points, and again on every further full allowance. Charged in the
-- window the threshold was crossed in, so a card that went stale in March
-- does not also spoil April — but a card still sitting there crosses again,
-- and April pays for that one.
--
-- Charged to whoever owns the card now. That matches the queue, which is the
-- screen people actually work from: if it is in your queue, its age is yours.
-- Unowned cards charge nobody, which is what the Unassigned filter is for.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.crm_points_penalty(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  user_id int, thread_id int, provider_id int, stage_key text,
  periods int, points int, days_sitting int
) LANGUAGE sql STABLE AS $$
  -- The window may run to the end of the month; the days in it have not
  -- happened yet. Charging them would show a penalty on the 3rd for sitting
  -- through the 28th, and the month's score would fall as the calendar ran on
  -- its own. Everything below measures to now at the latest.
  WITH bound AS (SELECT LEAST(p_to, now()) AS ends_at),
  spell AS (
    SELECT sp.thread_id, sp.provider_id, sp.stage_key, sp.entered,
           LEAST(COALESCE(sp.left_at, b.ends_at), b.ends_at) AS ends,
           tp.assignee_id, t.funnel_id
    FROM atlas.crm_stage_spells sp
    CROSS JOIN bound b
    JOIN atlas.crm_thread_providers tp
      ON tp.thread_id = sp.thread_id AND tp.provider_id = sp.provider_id
    JOIN atlas.crm_threads t ON t.id = sp.thread_id
    WHERE sp.entered < b.ends_at
      AND COALESCE(sp.left_at, b.ends_at) > sp.entered
      AND tp.assignee_id IS NOT NULL
  ),
  measured AS (
    SELECT s.*, spt.points, spt.penalty_points, spt.sla_days,
           -- Days served by the end of the window...
           FLOOR(EXTRACT(EPOCH FROM (s.ends - s.entered)) / 86400.0) AS days_end,
           -- ...and by its start, so only what was crossed inside it counts.
           GREATEST(FLOOR(EXTRACT(EPOCH FROM (LEAST(p_from, s.ends) - s.entered)) / 86400.0), 0) AS days_start
    FROM spell s
    JOIN atlas.crm_stage_points spt
      ON spt.funnel_id = s.funnel_id AND spt.stage_key = s.stage_key
    WHERE spt.sla_days IS NOT NULL AND spt.sla_days > 0
      AND COALESCE(spt.penalty_points, spt.points) > 0
  ),
  capped AS (
    SELECT m.*,
           (SELECT max_penalty_periods FROM atlas.crm_score_settings) AS cap
    FROM measured m
  ),
  charged AS (
    SELECT c.assignee_id, c.thread_id, c.provider_id, c.stage_key,
           -- Both ends are capped, so a stretch charged to its limit in an
           -- earlier month adds nothing in this one.
           (LEAST(FLOOR(c.days_end / c.sla_days), CASE WHEN c.cap > 0 THEN c.cap ELSE 1e9 END)
            - LEAST(FLOOR(c.days_start / c.sla_days), CASE WHEN c.cap > 0 THEN c.cap ELSE 1e9 END))::int AS periods,
           -- What one period costs: the stage's own figure where it has one,
           -- otherwise the multiplier on what the stage is worth.
           COALESCE(
             c.penalty_points,
             ROUND(c.points * (SELECT penalty_multiplier FROM atlas.crm_score_settings))
           )::int AS per_period,
           c.days_end::int AS days_sitting
    FROM capped c
  )
  SELECT c.assignee_id, c.thread_id, c.provider_id, c.stage_key, c.periods,
         (c.periods * c.per_period)::int,
         c.days_sitting
  FROM charged c
  WHERE c.periods > 0;
$$;

-- ---------------------------------------------------------------------------
-- One row per person for a window: earned, lost, net, target, and what the
-- slabs say that is worth.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION atlas.crm_score(p_from timestamptz, p_to timestamptz)
RETURNS TABLE (
  user_id int, name text, earned int, penalty int, net int,
  target int, pct int, payout numeric
) LANGUAGE sql STABLE AS $$
  WITH e AS (
    SELECT user_id, SUM(points)::int AS earned
    FROM atlas.crm_points_earned(p_from, p_to) GROUP BY user_id
  ),
  d AS (
    SELECT user_id, SUM(points)::int AS penalty
    FROM atlas.crm_points_penalty(p_from, p_to) GROUP BY user_id
  ),
  cfg AS (SELECT * FROM atlas.crm_score_settings WHERE id),
  people AS (
    SELECT u.id, u.name
    FROM atlas.users u
    WHERE u.active AND (u.role IN ('network', 'network_lead')
                           OR u.id IN (SELECT user_id FROM e)
                           OR u.id IN (SELECT user_id FROM d))
  ),
  scored AS (
    SELECT p.id, p.name,
           COALESCE(e.earned, 0) AS earned,
           COALESCE(d.penalty, 0) AS penalty,
           COALESCE(e.earned, 0) - COALESCE(d.penalty, 0) AS net,
           COALESCE(tg.target_points, cfg.default_target) AS target
    FROM people p
    CROSS JOIN cfg
    LEFT JOIN e ON e.user_id = p.id
    LEFT JOIN d ON d.user_id = p.id
    LEFT JOIN atlas.crm_point_targets tg
           ON tg.user_id = p.id AND tg.month = date_trunc('month', p_from)::date
  ),
  pct AS (
    SELECT s.*,
           CASE WHEN s.target > 0
                THEN GREATEST(ROUND(100.0 * s.net / s.target), 0)::int
                ELSE 0 END AS pct
    FROM scored s
  )
  SELECT x.id, x.name, x.earned, x.penalty, x.net, x.target, x.pct,
         LEAST(
           -- The slab reached, plus anything earned beyond the target.
           (SELECT cfg.incentive_pot * sl.payout_pct / 100.0
              FROM atlas.crm_incentive_slabs sl
             WHERE sl.min_pct <= x.pct
             ORDER BY sl.min_pct DESC LIMIT 1)
           + CASE WHEN x.net > x.target
                  THEN (x.net - x.target) * cfg.bonus_per_point ELSE 0 END,
           cfg.incentive_pot * cfg.max_payout_pct / 100.0
         )
  FROM pct x CROSS JOIN cfg
  ORDER BY x.net DESC, x.name;
$$;
