-- The console match is computed once at load, not once per row per request.
--
-- The NABL list ran a similarity() lookup against src_local."Lab" inside the
-- SELECT, for every row on the page and again for the header count. It is a
-- trigram comparison over an 11,000-row table joined to a 1,700-row one: fine
-- once, wasteful fifty times a page load, and it made /nabl the slowest screen
-- in Atlas at 1.1 seconds.
--
-- The match only changes when one of the two sides changes, which is when a
-- snapshot is loaded or a lab is onboarded. So it is stored.

ALTER TABLE atlas.nabl_lab ADD COLUMN IF NOT EXISTS matched_lab_id   integer;
ALTER TABLE atlas.nabl_lab ADD COLUMN IF NOT EXISTS matched_lab_name text;
ALTER TABLE atlas.nabl_lab ADD COLUMN IF NOT EXISTS matched_score    numeric(4,3);
ALTER TABLE atlas.nabl_lab ADD COLUMN IF NOT EXISTS matched_on       timestamptz;

CREATE INDEX IF NOT EXISTS idx_nabl_lab_matched
  ON atlas.nabl_lab ((matched_lab_id IS NOT NULL));

/*
 * Pair each accredited lab with the console lab that looks like it.
 *
 * Same pincode and a name similarity above 0.45 — deliberately strict enough
 * that the screen can say "already on our network" without a human checking
 * every row, and deliberately presented as a hint rather than a fact, because
 * two labs at one pincode can share most of a name.
 */
CREATE OR REPLACE FUNCTION atlas.match_nabl_labs() RETURNS integer AS $$
DECLARE
  n integer;
BEGIN
  UPDATE atlas.nabl_lab n SET
    matched_lab_id   = best.id,
    matched_lab_name = best."labName",
    matched_score    = best.score,
    matched_on       = now()
  FROM (
    SELECT DISTINCT ON (nl.nabl_id)
           nl.nabl_id, l.id, l."labName",
           similarity(lower(l."labName"), lower(nl.cab_name)) AS score
    FROM atlas.nabl_lab nl
    JOIN src_local."Lab" l
      ON l.active AND l.pincode = nl.pincode
     AND similarity(lower(l."labName"), lower(nl.cab_name)) > 0.45
    ORDER BY nl.nabl_id, score DESC
  ) best
  WHERE best.nabl_id = n.nabl_id;

  GET DIAGNOSTICS n = ROW_COUNT;

  -- A lab that no longer matches must lose its mark, or the screen keeps
  -- claiming a provider that was renamed or deactivated.
  UPDATE atlas.nabl_lab SET
    matched_lab_id = NULL, matched_lab_name = NULL,
    matched_score = NULL, matched_on = now()
  WHERE matched_lab_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM src_local."Lab" l
       WHERE l.id = atlas.nabl_lab.matched_lab_id AND l.active
         AND l.pincode = atlas.nabl_lab.pincode
    );

  RETURN n;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.match_nabl_labs() IS
  'Stores the console lab each accredited lab resembles. Run after '
  'atlas.load_nabl_labs(), and after a provider refresh if the match matters.';

SELECT atlas.match_nabl_labs();
