import 'server-only';
import { query } from './db';

/**
 * Real data behind the provider-ranking feature.
 *
 * ranking.py's own README is explicit about what atlas.discovered_lab can and
 * cannot back today: `accredited`, `services` and `review_score` don't exist
 * on that table (or anywhere else) yet, so every candidate is genuinely
 * unknown on those three signals — the ranking engine's "unknown is not zero"
 * handling is what makes that honest rather than broken.
 *
 * `distance_km` is different: atlas.pincode_directory already has lat/long
 * for every pincode, and the app already computes haversine distance from it
 * elsewhere (see getPincodeIntel's nearest-lab query). So proximity here is
 * real, computed from the searched area's centroid to each lead's own
 * pincode — not fabricated.
 */

export interface DiscoveryCandidate {
  id: number;
  name: string;
  pincode: string;
  city: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  source_url: string | null;
  confidence: number | null;
  crm_provider_id: number | null;
  retrieved_at: string;
  /** Haversine km from the searched area's centroid; null when either side's lat/long is missing. */
  distance_km: number | null;
}

/** A 6-digit Indian pincode, as opposed to a city name. */
function isPincode(area: string): boolean {
  return /^\d{6}$/.test(area.trim());
}

/**
 * Candidates for a pincode or city, with real distance from the area's
 * centroid to each candidate's own pincode.
 *
 * Mirrors ranking.py's own pool filter exactly: a match on the lead's pincode
 * *or* its city, case-insensitively — so `--area 560034` and
 * `--area Bengaluru` both work as they do on the command line.
 */
export async function getDiscoveryCandidates(area: string): Promise<DiscoveryCandidate[]> {
  const needle = area.trim();
  if (!needle) return [];

  return query<DiscoveryCandidate>(
    `
    WITH area_pins AS (
      -- Every post office row that matches the searched pincode or city.
      SELECT latitude, longitude
      FROM atlas.pincode_directory
      WHERE (lower(pincode) = lower($1) OR lower(city) = lower($1))
        AND latitude IS NOT NULL AND longitude IS NOT NULL
    ),
    center AS (
      -- The area's centroid. Always exactly one row (NULL/NULL when nothing
      -- matched), so the CROSS JOIN below never drops candidates for want of
      -- a center -- they just come back with distance_km unknown.
      SELECT AVG(latitude) AS lat, AVG(longitude) AS lng FROM area_pins
    ),
    lead_geo AS (
      -- One representative lat/long per pincode (a pincode can have several
      -- post-office rows; the same MIN-aggregation convention used elsewhere
      -- in this app, e.g. getPincodeIntel).
      SELECT pincode, MIN(latitude) AS latitude, MIN(longitude) AS longitude
      FROM atlas.pincode_directory
      GROUP BY pincode
    )
    SELECT dl.id, dl.name, dl.pincode, dl.city, dl.state, dl.address, dl.phone,
           dl.source_url,
           -- pg returns Postgres 'numeric' columns as JS strings, not numbers
           -- (node-postgres doesn't parse arbitrary-precision numeric by
           -- default) -- lib/catalogueQueries.ts hit the same thing and
           -- settled on casting explicitly rather than string-handling every
           -- call site. Cast to double precision here so the app gets real
           -- JS numbers back, not strings that merely look numeric.
           dl.confidence::double precision AS confidence,
           dl.crm_provider_id, dl.retrieved_at,
           CASE WHEN center.lat IS NOT NULL AND lg.latitude IS NOT NULL
                THEN ROUND((6371 * acos(GREATEST(-1, LEAST(1,
                       cos(radians(center.lat)) * cos(radians(lg.latitude)) *
                       cos(radians(lg.longitude) - radians(center.lng)) +
                       sin(radians(center.lat)) * sin(radians(lg.latitude))
                     ))))::numeric, 1)::double precision
           END AS distance_km
    FROM atlas.discovered_lab dl
    LEFT JOIN lead_geo lg ON lg.pincode = dl.pincode
    CROSS JOIN center
    WHERE NOT dl.dismissed
      AND (lower(dl.pincode) = lower($1) OR lower(dl.city) = lower($1))
    ORDER BY dl.confidence DESC NULLS LAST, dl.name
    `,
    [needle],
  );
}

/** So the page can say "pincode" or "city" back to the person searching. */
export function describeArea(area: string): 'pincode' | 'city' {
  return isPincode(area) ? 'pincode' : 'city';
}
