-- ============================================================================
-- E5 · Corporate demand overlays.
--
-- /pincodes already answers "is this list serviceable". What it cannot do is
-- remember the list, or answer the question a prospect actually asks: not
-- "what is your coverage" but "what is your coverage *for my people*".
--
-- Headcount is what makes that different. A client with 4,000 employees in
-- Bengaluru and 20 in Siliguri does not care equally about both, so every
-- number here is weighted by headcount where it is known — and the weighting
-- is why this cannot be a saved filter on the existing page.
-- ============================================================================

CREATE TABLE IF NOT EXISTS atlas.corporate_overlay (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  -- Optional link to an account, so an overlay for an existing client can sit
  -- next to its activity. Prospects have no account yet, hence nullable.
  store_id    int,
  note        text,
  created_by  int REFERENCES atlas.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atlas.corporate_overlay_pincode (
  overlay_id  bigint NOT NULL REFERENCES atlas.corporate_overlay(id) ON DELETE CASCADE,
  pincode     text   NOT NULL,
  -- Nullable on purpose: plenty of HR files are a bare pincode list. When it
  -- is absent every pincode counts as one, and the UI has to say so rather
  -- than present an employee-weighted number built on an assumption.
  headcount   int,
  label       text,
  PRIMARY KEY (overlay_id, pincode)
);

CREATE INDEX IF NOT EXISTS overlay_pincode_idx ON atlas.corporate_overlay_pincode (pincode);

-- Coverage for one overlay, weighted by headcount.
--
-- Two numbers, because they answer different questions: pincode coverage is
-- "how much of their footprint can we serve", employee coverage is "how many
-- of their people can we serve". They diverge sharply when the head office is
-- covered and the branches are not, which is the common case.
CREATE OR REPLACE FUNCTION atlas.overlay_coverage(p_overlay bigint)
RETURNS TABLE (
  pincodes int, pincodes_covered int, headcount bigint, headcount_covered bigint,
  headcount_known boolean, cv_reach_pincodes int
) LANGUAGE sql STABLE AS $$
  WITH rows AS (
    SELECT op.pincode, COALESCE(op.headcount, 1) AS hc, op.headcount IS NOT NULL AS known
    FROM atlas.corporate_overlay_pincode op WHERE op.overlay_id = p_overlay
  ),
  scored AS (
    SELECT r.pincode, r.hc, r.known,
           EXISTS (SELECT 1 FROM analytics.mv_pincode_supply s
                   WHERE s.pincode = r.pincode) AS covered,
           EXISTS (SELECT 1 FROM analytics.mv_pincode_cv_reach c
                   WHERE c.covered_pincode = r.pincode) AS cv_reach
    FROM rows r
  )
  SELECT COUNT(*)::int,
         COUNT(*) FILTER (WHERE covered)::int,
         SUM(hc)::bigint,
         SUM(hc) FILTER (WHERE covered)::bigint,
         bool_or(known),
         COUNT(*) FILTER (WHERE cv_reach)::int
  FROM scored;
$$;

-- Readiness for one overlay: the city scores, weighted by how many of this
-- client's people sit in each city. A city we are strong in barely moves the
-- number if the client has nobody there.
CREATE OR REPLACE FUNCTION atlas.overlay_readiness(p_overlay bigint, p_category text DEFAULT 'DIAGNOSTICS')
RETURNS TABLE (score int, cities int, headcount_covered bigint) LANGUAGE sql STABLE AS $$
  WITH client_cities AS (
    SELECT atlas.city_key(pc.city) AS city_key,
           SUM(COALESCE(op.headcount, 1))::bigint AS hc
    FROM atlas.corporate_overlay_pincode op
    JOIN analytics.mv_pincode_city pc ON pc.pincode = op.pincode
    WHERE op.overlay_id = p_overlay
    GROUP BY 1
  )
  SELECT ROUND(SUM(r.score * cc.hc)::numeric / NULLIF(SUM(cc.hc), 0))::int,
         COUNT(*)::int,
         SUM(cc.hc)::bigint
  FROM client_cities cc
  JOIN analytics.mv_city_readiness r
    ON r.city_key = cc.city_key AND r.category = p_category;
$$;
