import 'server-only';
import { query, queryOne } from './db';

/**
 * Phlebo repository queries.
 *
 * Data source: atlas.phlebos_all — a VIEW that FULL OUTER JOINs
 *   analytics.mv_phlebos_derived (auto-computed nightly from Order table) with
 *   atlas.phlebos_manual (uploaded via UI, persistent). Phone number (digits
 *   only) is the dedup key.
 */

// Configurable radius for nearby-pincode search. Matches CV lab convention.
export const PHLEBO_REACH_RADIUS_KM = Number(process.env.PHLEBO_REACH_RADIUS_KM ?? 10);

export type Phlebo = {
  phone: string;
  name: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  orders_served: number;
  labs: string[] | null;
  first_order_at: string | null;
  last_order_at: string | null;
  email: string | null;
  notes: string | null;
  source: 'derived' | 'manual' | 'both';
  distance_km?: number | null;
};

export type PhleboFilters = {
  q?: string;                     // free-text search on name/phone/city
  pincode?: string;               // exact pincode (6 digits)
  city?: string;
  state?: string;
  source?: 'derived' | 'manual' | 'both' | 'all';
  nearby?: boolean;               // if true + pincode set, radius search
  radiusKm?: number;
  minOrders?: number;
};

export type PhleboRepoStats = {
  total: number;
  derived: number;
  manual: number;
  overlap: number;
  distinct_cities: number;
  distinct_states: number;
  total_orders_covered: number;
};

/**
 * Repository-wide stats — for the top-of-page tiles.
 */
export async function getPhleboRepoStats(): Promise<PhleboRepoStats> {
  const row = await queryOne<PhleboRepoStats>(`
    SELECT
      COUNT(*)::int                                                          AS total,
      COUNT(*) FILTER (WHERE source = 'derived')::int                        AS derived,
      COUNT(*) FILTER (WHERE source = 'manual')::int                         AS manual,
      COUNT(*) FILTER (WHERE source = 'both')::int                           AS overlap,
      COUNT(DISTINCT lower(city)) FILTER (WHERE city IS NOT NULL AND TRIM(city) <> '')::int    AS distinct_cities,
      COUNT(DISTINCT lower(state)) FILTER (WHERE state IS NOT NULL AND TRIM(state) <> '')::int AS distinct_states,
      COALESCE(SUM(orders_served), 0)::int                                   AS total_orders_covered
    FROM atlas.phlebos_all
  `);
  return row ?? { total: 0, derived: 0, manual: 0, overlap: 0, distinct_cities: 0, distinct_states: 0, total_orders_covered: 0 };
}

/**
 * List phlebos with filtering + pagination.
 *
 * Nearby-pincode search: when `filters.pincode` is a valid 6-digit code AND
 * `filters.nearby` is true, we haversine-join against mv_pincode_geo to bring
 * back phlebos whose derived/manual pincode is within `radiusKm` km. Distance
 * (km) is returned so the UI can show "3.2 km away".
 */
export async function listPhlebos(
  filters: PhleboFilters,
  limit = 100,
  offset = 0,
): Promise<Phlebo[]> {
  const radiusKm = filters.radiusKm ?? PHLEBO_REACH_RADIUS_KM;
  const isNearby = filters.nearby && filters.pincode && /^\d{6}$/.test(filters.pincode);

  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const conds: string[] = [];

  if (filters.q && filters.q.trim()) {
    const q = push(`%${filters.q.trim().toLowerCase()}%`);
    conds.push(`(lower(p.name) LIKE ${q} OR p.phone LIKE ${q} OR lower(p.city) LIKE ${q})`);
  }
  if (filters.city && filters.city.trim()) {
    conds.push(`lower(p.city) = ${push(filters.city.trim().toLowerCase())}`);
  }
  if (filters.state && filters.state.trim()) {
    conds.push(`lower(p.state) = ${push(filters.state.trim().toLowerCase())}`);
  }
  if (filters.source && filters.source !== 'all') {
    conds.push(`p.source = ${push(filters.source)}`);
  }
  if (filters.minOrders && filters.minOrders > 0) {
    conds.push(`p.orders_served >= ${push(filters.minOrders)}`);
  }

  if (isNearby) {
    // Radius search: haversine-join phlebo pincode → target pincode via mv_pincode_geo
    const targetPin = push(filters.pincode);
    const radius = push(radiusKm);

    const whereClause = conds.length > 0 ? `AND ${conds.join(' AND ')}` : '';

    return query<Phlebo>(`
      WITH target AS (
        SELECT latitude, longitude
        FROM analytics.mv_pincode_geo
        WHERE pincode = ${targetPin}
      )
      SELECT
        p.phone, p.name, p.city, p.state, p.pincode,
        p.orders_served, p.labs, p.first_order_at, p.last_order_at,
        p.email, p.notes, p.source,
        ROUND((6371 * acos(
          GREATEST(-1, LEAST(1,
            cos(radians(t.latitude)) * cos(radians(g.latitude)) *
            cos(radians(g.longitude) - radians(t.longitude)) +
            sin(radians(t.latitude)) * sin(radians(g.latitude))
          ))
        ))::numeric, 1)::float8 AS distance_km
      FROM atlas.phlebos_all p
      JOIN analytics.mv_pincode_geo g ON g.pincode = p.pincode
      CROSS JOIN target t
      WHERE g.latitude IS NOT NULL
        AND p.pincode ~ '^[0-9]{6}$'
        AND 6371 * acos(
          GREATEST(-1, LEAST(1,
            cos(radians(t.latitude)) * cos(radians(g.latitude)) *
            cos(radians(g.longitude) - radians(t.longitude)) +
            sin(radians(t.latitude)) * sin(radians(g.latitude))
          ))
        ) <= ${radius}
        ${whereClause}
      ORDER BY distance_km ASC, p.orders_served DESC NULLS LAST
      LIMIT ${push(limit)} OFFSET ${push(offset)}
    `, params);
  }

  // Non-nearby: plain filter query
  if (filters.pincode && /^\d{6}$/.test(filters.pincode)) {
    conds.push(`p.pincode = ${push(filters.pincode)}`);
  }

  const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  return query<Phlebo>(`
    SELECT
      p.phone, p.name, p.city, p.state, p.pincode,
      p.orders_served, p.labs, p.first_order_at, p.last_order_at,
      p.email, p.notes, p.source,
      NULL::float8 AS distance_km
    FROM atlas.phlebos_all p
    ${whereClause}
    ORDER BY p.orders_served DESC NULLS LAST, p.name ASC
    LIMIT ${push(limit)} OFFSET ${push(offset)}
  `, params);
}

/**
 * Count of matching rows (for pagination). Uses the same filter logic as list.
 */
export async function countPhlebos(filters: PhleboFilters): Promise<number> {
  const radiusKm = filters.radiusKm ?? PHLEBO_REACH_RADIUS_KM;
  const isNearby = filters.nearby && filters.pincode && /^\d{6}$/.test(filters.pincode);

  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };

  const conds: string[] = [];
  if (filters.q && filters.q.trim()) {
    const q = push(`%${filters.q.trim().toLowerCase()}%`);
    conds.push(`(lower(p.name) LIKE ${q} OR p.phone LIKE ${q} OR lower(p.city) LIKE ${q})`);
  }
  if (filters.city && filters.city.trim()) conds.push(`lower(p.city) = ${push(filters.city.trim().toLowerCase())}`);
  if (filters.state && filters.state.trim()) conds.push(`lower(p.state) = ${push(filters.state.trim().toLowerCase())}`);
  if (filters.source && filters.source !== 'all') conds.push(`p.source = ${push(filters.source)}`);
  if (filters.minOrders && filters.minOrders > 0) conds.push(`p.orders_served >= ${push(filters.minOrders)}`);

  if (isNearby) {
    const targetPin = push(filters.pincode);
    const radius = push(radiusKm);
    const whereClause = conds.length > 0 ? `AND ${conds.join(' AND ')}` : '';
    const row = await queryOne<{ n: number }>(`
      WITH target AS (
        SELECT latitude, longitude FROM analytics.mv_pincode_geo WHERE pincode = ${targetPin}
      )
      SELECT COUNT(*)::int AS n
      FROM atlas.phlebos_all p
      JOIN analytics.mv_pincode_geo g ON g.pincode = p.pincode
      CROSS JOIN target t
      WHERE g.latitude IS NOT NULL
        AND p.pincode ~ '^[0-9]{6}$'
        AND 6371 * acos(GREATEST(-1, LEAST(1,
          cos(radians(t.latitude)) * cos(radians(g.latitude)) *
          cos(radians(g.longitude) - radians(t.longitude)) +
          sin(radians(t.latitude)) * sin(radians(g.latitude))
        ))) <= ${radius}
        ${whereClause}
    `, params);
    return row?.n ?? 0;
  }

  if (filters.pincode && /^\d{6}$/.test(filters.pincode)) {
    conds.push(`p.pincode = ${push(filters.pincode)}`);
  }
  const whereClause = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM atlas.phlebos_all p ${whereClause}`,
    params,
  );
  return row?.n ?? 0;
}

/**
 * List of distinct cities present in the repo — powers the city autocomplete.
 */
export async function listPhleboCities(): Promise<{ city: string; state: string | null; n: number }[]> {
  return query<{ city: string; state: string | null; n: number }>(`
    SELECT city, MAX(state) AS state, COUNT(*)::int AS n
    FROM atlas.phlebos_all
    WHERE city IS NOT NULL AND TRIM(city) <> ''
    GROUP BY city
    ORDER BY n DESC, city ASC
    LIMIT 200
  `);
}

// ---------------------------------------------------------------------------
// Upload helpers — used by the /phlebos/upload server action.
// ---------------------------------------------------------------------------

/** Strip everything except digits. Enforce phone-key normalization at write. */
export function normalizePhone(input: string): string {
  return (input ?? '').replace(/\D/g, '');
}

/** Row shape the client sends after parsing Excel/CSV. */
export type UploadedPhlebo = {
  phone: string;
  name: string;
  city?: string;
  state?: string;
  pincode?: string;
  email?: string;
  notes?: string;
};

export type UploadResult = {
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  uploadId: number;
};

/**
 * Bulk upsert into atlas.phlebos_manual. Returns per-row disposition.
 * Skips rows where phone doesn't normalize to 10+ digits.
 */
export async function bulkUpsertPhlebos(
  rows: UploadedPhlebo[],
  meta: { filename: string; userId: number },
): Promise<UploadResult> {
  // Record upload attempt first, so even a failure leaves a trail
  const upload = await queryOne<{ id: number }>(
    `INSERT INTO atlas.phlebo_uploads (filename, total_rows, uploaded_by)
     VALUES ($1, $2, $3) RETURNING id`,
    [meta.filename, rows.length, meta.userId],
  );
  const uploadId = upload!.id;

  let inserted = 0, updated = 0, skipped = 0;

  for (const raw of rows) {
    const phone = normalizePhone(raw.phone);
    if (phone.length < 10 || !raw.name?.trim()) {
      skipped++;
      continue;
    }
    const source = `upload:${meta.filename}`;

    // Upsert — INSERT ... ON CONFLICT DO UPDATE. Latest upload wins on
    // populated fields; empty fields don't overwrite existing values.
    const result = await queryOne<{ was_insert: boolean }>(
      `
      INSERT INTO atlas.phlebos_manual (phone, name, city, state, pincode, email, notes, source, uploaded_by)
      VALUES ($1, $2, NULLIF(TRIM($3::text), ''), NULLIF(TRIM($4::text), ''),
              NULLIF(TRIM($5::text), ''), NULLIF(TRIM($6::text), ''),
              NULLIF(TRIM($7::text), ''), $8, $9)
      ON CONFLICT (phone) DO UPDATE SET
        name       = EXCLUDED.name,
        city       = COALESCE(EXCLUDED.city,    atlas.phlebos_manual.city),
        state      = COALESCE(EXCLUDED.state,   atlas.phlebos_manual.state),
        pincode    = COALESCE(EXCLUDED.pincode, atlas.phlebos_manual.pincode),
        email      = COALESCE(EXCLUDED.email,   atlas.phlebos_manual.email),
        notes      = COALESCE(EXCLUDED.notes,   atlas.phlebos_manual.notes),
        source     = EXCLUDED.source,
        uploaded_by= EXCLUDED.uploaded_by
      RETURNING (xmax = 0) AS was_insert
      `,
      [phone, raw.name.trim(), raw.city, raw.state, raw.pincode, raw.email, raw.notes, source, meta.userId],
    );
    if (result?.was_insert) inserted++;
    else updated++;
  }

  await query(
    `UPDATE atlas.phlebo_uploads
     SET inserted = $1, updated = $2, skipped = $3
     WHERE id = $4`,
    [inserted, updated, skipped, uploadId],
  );

  return { total: rows.length, inserted, updated, skipped, uploadId };
}
