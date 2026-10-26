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
  page?: number;
};

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
  if (f.q && f.q.trim()) {
    const like = push(`%${f.q.trim()}%`);
    where.push(`(c.name ILIKE ${like} OR c.city ILIKE ${like}
                 OR c.address ILIKE ${like} OR c.pincode ILIKE ${like}
                 OR c.phone ILIKE ${like})`);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function listCentres(f: CentreFilters = {}) {
  const { clause, params } = buildWhere(f);
  const page = Math.max(1, f.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await query<ChainCentre>(`
    SELECT c.chain, c.external_id, c.name, c.address, c.city, c.state,
           c.pincode, c.phone, c.whatsapp, c.open_hours, c.map_link,
           c.matched_lab_name, c.pulled_on::text AS pulled_on,
           COALESCE(s.n, 1) AS phone_shared
    FROM atlas.chain_centre c
    LEFT JOIN (
      SELECT phone_digits, COUNT(*)::int AS n
      FROM atlas.chain_centre WHERE phone_digits IS NOT NULL
      GROUP BY phone_digits HAVING COUNT(*) > 1
    ) s ON s.phone_digits = c.phone_digits
    ${clause}
    ORDER BY c.city, c.name
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `, params);

  const total = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM atlas.chain_centre c ${clause}`, params);

  return { rows, total: total?.n ?? 0, page, pages: Math.ceil((total?.n ?? 0) / PAGE_SIZE) };
}

/** One row per chain: size, reach, match rate and how old the snapshot is. */
export async function getChainSummary() {
  return query<{
    chain: string; centres: number; cities: number; states: number;
    matched: number; shared_phones: number; pulled_on: string;
  }>(`
    SELECT c.chain,
           COUNT(*)::int                                            AS centres,
           COUNT(DISTINCT c.city_key)::int                          AS cities,
           COUNT(DISTINCT c.state) FILTER (WHERE c.state <> '')::int AS states,
           COUNT(*) FILTER (WHERE c.matched_lab_id IS NOT NULL)::int AS matched,
           COUNT(*) FILTER (WHERE s.phone_digits IS NOT NULL)::int   AS shared_phones,
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
