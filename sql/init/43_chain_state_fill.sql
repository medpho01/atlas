-- Fill in the state a chain didn't bother to publish.
--
-- Thyrocare lists a centre's city and pincode but never its state, so the
-- state filter on /franchisees would silently exclude every Thyrocare centre.
-- The other chains do publish it, and between them they name the state for
-- over a thousand cities — so a city that one chain places in a state places
-- the others too.
--
-- Only where the city is unambiguous. "Hamirpur" exists in both Himachal and
-- Uttar Pradesh; a city whose name maps to more than one state is left blank
-- rather than guessed, because a wrong state on a sales screen is worse than
-- an empty one.

CREATE OR REPLACE FUNCTION atlas.fill_chain_centre_states() RETURNS integer AS $$
DECLARE
  n integer;
BEGIN
  -- One spelling per state first. The chains disagree on capitalisation —
  -- "Jammu And Kashmir" next to "Jammu and Kashmir" — and the state filter
  -- matches exactly, so two spellings mean two half-empty filter entries.
  -- The most-used spelling wins, which needs no list of state names to
  -- maintain and absorbs whatever the next chain spells differently.
  WITH canon AS (
    SELECT lower(regexp_replace(state, '[^a-zA-Z]', '', 'g')) AS k,
           mode() WITHIN GROUP (ORDER BY state) AS state
    FROM atlas.chain_centre
    WHERE coalesce(btrim(state), '') <> ''
    GROUP BY 1
  )
  UPDATE atlas.chain_centre c
     SET state = k.state, updated_at = now()
    FROM canon k
   WHERE k.k = lower(regexp_replace(c.state, '[^a-zA-Z]', '', 'g'))
     AND c.state <> k.state;

  WITH consensus AS (
    SELECT city_key, MIN(state) AS state
    FROM atlas.chain_centre
    WHERE city_key IS NOT NULL AND coalesce(btrim(state), '') <> ''
    GROUP BY city_key
    HAVING COUNT(DISTINCT lower(btrim(state))) = 1
  )
  UPDATE atlas.chain_centre c
     SET state = k.state, updated_at = now()
    FROM consensus k
   WHERE k.city_key = c.city_key
     AND coalesce(btrim(c.state), '') = '';

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION atlas.fill_chain_centre_states() IS
  'Fills a blank chain_centre.state from the state other chains give that '
  'city, where every chain agrees on it. Run after loading any chain.';

SELECT atlas.fill_chain_centre_states();
