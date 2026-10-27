import 'server-only';
import { query, queryOne } from './db';

/**
 * The franchisee networks of the national diagnostic chains.
 *
 * Each chain publishes its collection centres on its own site in its own
 * shape; atlas.chain_centre flattens them into one table so this reads the
 * same whichever brand you are looking at. Reference data, like the NABL
 * register: a centre here is one the chain says it has, not supply we can
 * send an order to.
 *
 * Snapshots are refreshed per chain, so freshness is reported per chain
 * rather than as one date for the screen.
 *
 * Searching by pincode means searching NEAR a pincode. An exact match almost
 * never hits — a request in 110016 is served by a centre in 110017 — so a
 * six-digit search resolves to a point and returns what is within the radius,
 * nearest first. Delhi 110016: three centres share the pincode, 67 are within
 * ten kilometres.
 */

export type ChainCentre = {
  chain: string;
  external_id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  /** Km from the searched pincode, when one was given. */
  km: number | null;
  /** 'exact' when the chain published coordinates, 'pincode' when the
   *  distance is measured from the centroid of the centre's pincode. */
  geo_source: string | null;
  open_hours: string | null;
  map_link: string | null;
  matched_lab_name: string | null;
  /** How many centres of this chain share this phone number. */
  phone_shared: number;
  pulled_on: string;
};

export type CentreFilters = {
  q?: string;
  chain?: string;
  city?: string;
  state?: string;
  matched?: string;
  /** 'shared' keeps only centres whose number is used by another centre. */
  phone?: string;
  /** A six-digit pincode to measure from. Results come back nearest first. */
  near?: string;
  /** Radius in km around `near`. */
  radius?: number;
  page?: number;
};

/** Offered on the screen; the default is deliberately wider than a pincode. */
export const RADIUS_CHOICES = [5, 10, 15, 25, 50];
export const DEFAULT_RADIUS = 15;

/** A six-digit pincode, or nothing. */
export function asPincode(v?: string): string | null {
  const t = (v ?? '').trim();
  return /^\d{6}$/.test(t) ? t : null;
}

export const PAGE_SIZE = 50;

function buildWhere(f: CentreFilters) {
  const where: string[] = [];
  const params: any[] = [];
  const push = (v: any) => `$${params.push(v)}`;

  if (f.chain) where.push(`c.chain = ${push(f.chain)}`);
  if (f.city) where.push(`c.city_key = ${push(f.city)}`);
  if (f.state) where.push(`c.state = ${push(f.state)}`);
  if (f.matched === 'yes') where.push(`c.matched_lab_id IS NOT NULL`);
  if (f.matched === 'no') where.push(`c.matched_lab_id IS NULL`);
  if (f.phone === 'shared') {
    where.push(`c.phone_digits IN (
      SELECT phone_digits FROM atlas.chain_centre
       WHERE phone_digits IS NOT NULL
       GROUP BY phone_digits HAVING COUNT(*) > 1)`);
  }

  const near = asPincode(f.near);
  if (near) {
    const radius = f.radius ?? DEFAULT_RADIUS;
    const p = push(near);
    const r = push(radius);
    // The bounding box is what the index can use; the exact distance then
    // runs over the few hundred rows inside it. One degree of latitude is
    // ~111 km, and longitude shrinks with latitude, hence the cos().
    // Same pincode always counts, whatever the measured distance says. A few
    // hundred rows publish coordinates that contradict their own pincode, and
    // without this a radius search could return fewer rows than the exact
    // search it replaced — which would read as data going missing.
    where.push(`(c.pincode = ${p} OR c.geo_lat IS NOT NULL AND EXISTS (
      SELECT 1 FROM atlas.pincode_point(${p}) pt
       WHERE c.geo_lat BETWEEN pt.lat - (${r}::numeric / 111.0)
                           AND pt.lat + (${r}::numeric / 111.0)
         AND c.geo_lon BETWEEN pt.lon - (${r}::numeric / (111.0 * cos(radians(pt.lat))))
                           AND pt.lon + (${r}::numeric / (111.0 * cos(radians(pt.lat))))
         AND atlas.km_between(pt.lat, pt.lon, c.geo_lat, c.geo_lon) <= ${r}))`);
  }

  if (f.q && f.q.trim()) {
    const like = push(`%${f.q.trim()}%`);
    where.push(`(c.name ILIKE ${like} OR c.city ILIKE ${like}
                 OR c.address ILIKE ${like} OR c.pincode ILIKE ${like}
                 OR c.phone ILIKE ${like} OR c.email ILIKE ${like})`);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params, near };
}

export async function listCentres(f: CentreFilters = {}) {
  const { clause, params, near } = buildWhere(f);
  const page = Math.max(1, f.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  // The count runs off the WHERE clause alone, so its parameters are the ones
  // fixed before the distance expression appends its own.
  const countParams = [...params];

  // When a pincode was given, distance replaces city/name as the sort: the
  // nearest centre is the one worth calling first.
  const kmSelect = near
    ? `(SELECT ROUND(atlas.km_between(pt.lat, pt.lon, c.geo_lat, c.geo_lon)::numeric, 1)
          FROM atlas.pincode_point($${params.push(near)}) pt)`
    : `NULL::numeric`;
  const order = near ? `km NULLS LAST, c.name` : `c.city, c.name`;

  const rows = await query<ChainCentre>(`
    SELECT c.chain, c.external_id, c.name, c.address, c.city, c.state,
           c.pincode, c.phone, c.whatsapp, c.email, c.open_hours, c.map_link,
           c.matched_lab_name, c.pulled_on::text AS pulled_on, c.geo_source,
           ${kmSelect} AS km,
           COALESCE(s.n, 1) AS phone_shared
    FROM atlas.chain_centre c
    LEFT JOIN (
      SELECT phone_digits, COUNT(*)::int AS n
      FROM atlas.chain_centre WHERE phone_digits IS NOT NULL
      GROUP BY phone_digits HAVING COUNT(*) > 1
    ) s ON s.phone_digits = c.phone_digits
    ${clause}
    ORDER BY ${order}
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `, params);

  const total = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM atlas.chain_centre c ${clause}`, countParams);

  return { rows, total: total?.n ?? 0, page, pages: Math.ceil((total?.n ?? 0) / PAGE_SIZE) };
}

/** Whether we hold a location for a pincode — the search needs one to measure from. */
export async function pincodeKnown(pin: string) {
  const r = await queryOne<{ lat: number }>(
    `SELECT lat FROM atlas.pincode_point($1)`, [pin]);
  return !!r;
}

/** One row per chain: size, reach, match rate and how old the snapshot is. */
export async function getChainSummary() {
  return query<{
    chain: string; centres: number; cities: number; states: number;
    matched: number; shared_phones: number; emails: number; pulled_on: string;
  }>(`
    SELECT c.chain,
           COUNT(*)::int                                            AS centres,
           COUNT(DISTINCT c.city_key)::int                          AS cities,
           COUNT(DISTINCT c.state) FILTER (WHERE c.state <> '')::int AS states,
           COUNT(*) FILTER (WHERE c.matched_lab_id IS NOT NULL)::int AS matched,
           COUNT(*) FILTER (WHERE s.phone_digits IS NOT NULL)::int   AS shared_phones,
           COUNT(*) FILTER (WHERE c.email IS NOT NULL)::int          AS emails,
           MAX(c.pulled_on)::text                                   AS pulled_on
    FROM atlas.chain_centre c
    LEFT JOIN (
      SELECT phone_digits FROM atlas.chain_centre
       WHERE phone_digits IS NOT NULL
       GROUP BY phone_digits HAVING COUNT(*) > 1
    ) s ON s.phone_digits = c.phone_digits
    GROUP BY c.chain ORDER BY 2 DESC
  `);
}

/** The busiest cities for the filter row, within the chain being viewed. */
export async function getCentreCities(chain?: string) {
  const params: any[] = [];
  const where = chain ? `WHERE chain = $${params.push(chain)}` : '';
  return query<{ city_key: string; city: string; n: number }>(`
    SELECT city_key, MIN(city) AS city, COUNT(*)::int AS n
    FROM atlas.chain_centre ${where}
    GROUP BY city_key HAVING city_key IS NOT NULL
    ORDER BY 3 DESC LIMIT 14
  `, params);
}
