import 'server-only';
import { query, queryOne } from './db';

/**
 * Nurse repository queries. Mirrors lib/phlebosQueries.ts, minus everything
 * that depends on order attribution — see sql/nurses_derived.sql for why
 * nurses have no per-person activity count.
 *
 * The lab axis is replaced by `aggregator`: the supplier a nurse comes through.
 */

/** Radius for nearby-pincode search. Shares the phlebo convention. */
export const NURSE_REACH_RADIUS_KM = Number(process.env.NURSE_REACH_RADIUS_KM ?? 10);

export type Nurse = {
  phone: string;
  name: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  locality: string | null;
  aggregator: string | null;
  qualification: string | null;
  is_verified: boolean;
  registration_num: string | null;
  registration_body: string | null;
  experience_years: number | null;
  registered_at: string | null;
  is_shared_phone: boolean;
  variants_at_phone: number;
  email: string | null;
  notes: string | null;
  source: 'derived' | 'manual' | 'both';
  distance_km?: number | null;
  /** Appointments attributed through SlotConfig — see sql/init/29. */
  appointments: number;
  appointments_completed: number;
  appointments_cancelled: number;
  last_appointment: string | null;
  availability: ('morning' | 'afternoon' | 'evening')[];
  interest: 'interested' | 'not_interested' | null;
  interest_note: string | null;
  interest_set_at: string | null;
  interest_set_by: string | null;
};

export type NurseFilters = {
  q?: string;
  pincode?: string;
  city?: string;
  state?: string;
  /** Exact aggregator names — matches nurses supplied by ANY of them. */
  aggregators?: string[];
  source?: 'derived' | 'manual' | 'both' | 'all';
  verifiedOnly?: boolean;
  /** 'interested' | 'not_interested' | 'unasked' — nobody has rung them yet. */
  interest?: string;
  /** morning | afternoon | evening | 'unasked' | 'asked'. */
  slot?: string;
  /** Only nurses who have served at least this many appointments. */
  minAppointments?: number;
  nearby?: boolean;
  radiusKm?: number;
  sortBy?: SortKey;
  sortDir?: 'asc' | 'desc';
};

export type SortKey =
  | 'name' | 'city' | 'phone' | 'aggregator' | 'experience' | 'verified' | 'source' | 'distance'
  | 'appointments';

// Whitelisted ORDER BY expressions — sort keys arrive from the query string.
const SORT_EXPRS: Record<SortKey, string> = {
  name:       'lower(n.name)',
  city:       'lower(n.city)',
  phone:      'n.phone',
  aggregator: 'lower(n.aggregator)',
  appointments: 'COALESCE(ap.appointments, 0)',
  experience: 'n.experience_years',
  verified:   'n.is_verified',
  source:     'n.source',
  distance:   'distance_km',
};

function orderClause(filters: NurseFilters, isNearby: boolean): string {
  const key: SortKey =
    filters.sortBy && SORT_EXPRS[filters.sortBy] ? filters.sortBy : (isNearby ? 'distance' : 'name');
  // Distance counts up: nearest first unless somebody asks otherwise. Every
  // other sort here reads best-first as DESC, and distance inherited that.
  const dir = key === 'distance'
    ? (filters.sortDir === 'desc' ? 'DESC' : 'ASC')
    : (filters.sortDir === 'asc' ? 'ASC' : 'DESC');
  const expr = key === 'distance' && !isNearby ? SORT_EXPRS.name : SORT_EXPRS[key];
  // In a pincode search, whoever we can actually place comes before whoever we
  // only know the city of, whatever the chosen sort — otherwise a name sort
  // puts an Aarti with no pincode above the nurse two streets away. Written as
  // the underlying expression because Postgres takes a bare output name in
  // ORDER BY but not an expression built on one.
  const placed = isNearby ? '(g.latitude IS NULL OR t.lat IS NULL) ASC, ' : '';
  // Verified first on ties — the network team screens on it.
  return `ORDER BY ${placed}${expr} ${dir} NULLS LAST, n.is_verified DESC, lower(n.name) ASC, n.phone ASC`;
}

/** Empty selection means no aggregator filter, matching the other filters. */
function selectedAggregators(filters: NurseFilters): string[] | null {
  const a = (filters.aggregators ?? []).map((x) => x.trim()).filter(Boolean);
  return a.length > 0 ? a : null;
}

/** Shared WHERE builder so list and count can never disagree. */
function buildConds(
  filters: NurseFilters,
  push: (v: unknown) => string,
): string[] {
  const conds: string[] = [];
  if (filters.q && filters.q.trim()) {
    const q = push(`%${filters.q.trim().toLowerCase()}%`);
    // The city half goes through the alias table too, and the state and
    // pincode are searchable because people type both into a box that offers
    // to search by city.
    const raw = push(filters.q.trim());
    conds.push(
      `(lower(n.name) LIKE ${q} OR n.phone LIKE ${q} OR lower(n.locality) LIKE ${q}
        OR lower(n.state) LIKE ${q} OR n.pincode LIKE ${q}
        OR lower(n.city) LIKE ${q} OR atlas.city_key(n.city) = atlas.city_key(${raw}))`,
    );
  }
  if (filters.city && filters.city.trim()) {
    // Through atlas.city_key, so Bangalore finds Bengaluru and Mysore finds
    // Mysuru. The alias table has known that since 08a; nothing here was
    // asking it, so the city box matched the spelling and not the place.
    conds.push(`atlas.city_key(n.city) = atlas.city_key(${push(filters.city.trim())})`);
  }
  if (filters.state && filters.state.trim()) {
    conds.push(`lower(n.state) = ${push(filters.state.trim().toLowerCase())}`);
  }
  if (filters.source && filters.source !== 'all') {
    conds.push(`n.source = ${push(filters.source)}`);
  }
  const aggs = selectedAggregators(filters);
  if (aggs) conds.push(`n.aggregator = ANY(${push(aggs)}::text[])`);
  if (filters.verifiedOnly) conds.push(`n.is_verified`);
  // "Not asked" is the absence of a row, not a third status: a nurse nobody
  // has rung must never be readable as one who said no.
  if (filters.interest === 'unasked')         conds.push(`pi.status IS NULL`);
  else if (filters.interest === 'interested') conds.push(`pi.status = 'interested'`);
  else if (filters.interest === 'not_interested') conds.push(`pi.status = 'not_interested'`);
  else if (filters.interest === 'asked')      conds.push(`pi.status IS NOT NULL`);
  if (filters.slot === 'unasked')      conds.push(`av.phone IS NULL`);
  else if (filters.slot === 'asked')   conds.push(`av.phone IS NOT NULL`);
  else if (filters.slot === 'morning')   conds.push(`av.morning`);
  else if (filters.slot === 'afternoon') conds.push(`av.afternoon`);
  else if (filters.slot === 'evening')   conds.push(`av.evening`);
  if (filters.minAppointments && filters.minAppointments > 0) {
    conds.push(`COALESCE(ap.appointments, 0) >= ${push(filters.minAppointments)}`);
  }
  return conds;
}

export type NurseRepoStats = {
  total: number;
  verified: number;
  distinct_cities: number;
  distinct_aggregators: number;
  manual: number;
  overlap: number;
};

export async function getNurseRepoStats(): Promise<NurseRepoStats> {
  const row = await queryOne<NurseRepoStats>(`
    SELECT
      COUNT(*)::int                                                   AS total,
      COUNT(*) FILTER (WHERE is_verified)::int                        AS verified,
      COUNT(DISTINCT lower(city)) FILTER (WHERE city IS NOT NULL)::int AS distinct_cities,
      COUNT(DISTINCT aggregator) FILTER (WHERE aggregator IS NOT NULL)::int AS distinct_aggregators,
      COUNT(*) FILTER (WHERE source IN ('manual','both'))::int        AS manual,
      COUNT(*) FILTER (WHERE source = 'both')::int                    AS overlap
    FROM atlas.nurses_all
  `);
  return row ?? { total: 0, verified: 0, distinct_cities: 0, distinct_aggregators: 0, manual: 0, overlap: 0 };
}

const SELECT_COLS = `
  n.phone, n.name, n.city, n.state, n.pincode, n.locality,
  n.aggregator, n.qualification, n.is_verified,
  n.registration_num, n.registration_body, n.experience_years,
  n.registered_at, n.is_shared_phone, n.variants_at_phone,
  n.email, n.notes, n.source,
  -- What they have actually done for us, and what they said when we rang.
  COALESCE(ap.appointments, 0)::int AS appointments,
  COALESCE(ap.completed, 0)::int    AS appointments_completed,
  COALESCE(ap.cancelled, 0)::int    AS appointments_cancelled,
  ap.last_appointment::text         AS last_appointment,
  -- When they said they can work. An array so the row renders one way
  -- whatever is ticked, and a missing row comes back empty rather than
  -- three falses, which would read as "available at no time".
  COALESCE(ARRAY_REMOVE(ARRAY[
    CASE WHEN av.morning   THEN 'morning'   END,
    CASE WHEN av.afternoon THEN 'afternoon' END,
    CASE WHEN av.evening   THEN 'evening'   END], NULL), ARRAY[]::text[]) AS availability,
  pi.status                         AS interest,
  pi.note                           AS interest_note,
  (pi.set_at AT TIME ZONE 'Asia/Kolkata')::text AS interest_set_at,
  iu.name                           AS interest_set_by
`;

/**
 * The directory row plus the two things bolted onto it.
 *
 * Joined here rather than folded into atlas.nurses_all, so sql/nurses_derived.sql
 * stays the one place that view is defined. Both joins are on phone, which is
 * what the whole directory is keyed on.
 */
const NURSE_FROM = `atlas.nurses_all n
    LEFT JOIN analytics.mv_nurse_appointments ap ON ap.phone = n.phone
    LEFT JOIN atlas.provider_interest pi ON pi.kind = 'nurse' AND pi.phone = n.phone
    LEFT JOIN atlas.users iu ON iu.id = pi.set_by
    LEFT JOIN atlas.provider_availability av ON av.kind = 'nurse' AND av.phone = n.phone`;


/**
 * The pieces of a pincode search that the list and its count must agree on.
 *
 * They were two copies of the same forty lines of trigonometry, which is how
 * a page ends up showing twenty rows above the words "4 nurses".
 */
const nearbyTarget = (targetPin: string) => `
      -- The pincode you typed, as a point and as a city. Always exactly one
      -- row, even for a pincode with no coordinates: a pincode we only know
      -- the city for should still find that city rather than nothing.
      WITH target AS (
        SELECT g.latitude AS lat, g.longitude AS lon, pc.city AS city
        FROM (SELECT ${targetPin}::text AS pincode) q
        LEFT JOIN analytics.mv_pincode_geo  g  ON g.pincode = q.pincode
        LEFT JOIN analytics.mv_pincode_city pc ON pc.pincode = q.pincode
      )`;

const nearbyFromWhere = (radius: string, where: string) => `
      FROM ${NURSE_FROM}
      -- LEFT, not an inner join. It dropped every nurse without a pincode
      -- before the radius was even considered, and on an uploaded list that
      -- carries a city and no pincode that is almost all of them.
      LEFT JOIN analytics.mv_pincode_geo g
        ON g.pincode = n.pincode AND n.pincode ~ '^[0-9]{6}$'
      CROSS JOIN target t
      WHERE (
          -- Near enough by their own pincode...
          (g.latitude IS NOT NULL AND t.lat IS NOT NULL
           AND 6371 * acos(GREATEST(-1, LEAST(1,
             cos(radians(t.lat)) * cos(radians(g.latitude)) *
             cos(radians(g.longitude) - radians(t.lon)) +
             sin(radians(t.lat)) * sin(radians(g.latitude))
           ))) <= ${radius})
          -- ...or in the city that pincode belongs to, which is all we know
          -- about somebody an upload gave a city and no pincode.
          -- ...or, only when we cannot place them at all, in the city that
          -- pincode belongs to. Guarded on having no coordinates rather than
          -- applied to everyone: a phlebo whose profile says Bengaluru and
          -- whose pincode is in Ghaziabad is 1,700 km away, and the pincode
          -- is the better evidence. The fallback is for the uploaded rows
          -- that carry a city and nothing else.
          OR (g.latitude IS NULL AND t.city IS NOT NULL
              AND atlas.city_key(n.city) = atlas.city_key(t.city))
        )
        ${where}`;

const NEARBY_DISTANCE = `
        CASE WHEN g.latitude IS NOT NULL AND t.lat IS NOT NULL THEN
          ROUND((6371 * acos(GREATEST(-1, LEAST(1,
            cos(radians(t.lat)) * cos(radians(g.latitude)) *
            cos(radians(g.longitude) - radians(t.lon)) +
            sin(radians(t.lat)) * sin(radians(g.latitude))
          ))))::numeric, 1)::float8
        END AS distance_km`;

/**
 * Nurses matching the filters. In nearby mode the pincode is haversine-joined
 * against mv_pincode_geo and distance_km is returned.
 */
export async function listNurses(
  filters: NurseFilters,
  limit = 200,
  offset = 0,
): Promise<Nurse[]> {
  const radiusKm = filters.radiusKm ?? NURSE_REACH_RADIUS_KM;
  const isNearby = !!(filters.nearby && filters.pincode && /^\d{6}$/.test(filters.pincode));

  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const conds = buildConds(filters, push);

  if (isNearby) {
    const targetPin = push(filters.pincode);
    const radius = push(radiusKm);
    const where = conds.length ? `AND ${conds.join(' AND ')}` : '';
    return query<Nurse>(`
${nearbyTarget(targetPin)}
      SELECT ${SELECT_COLS},${NEARBY_DISTANCE}
      ${nearbyFromWhere(radius, where)}
      ${orderClause(filters, true)}
      LIMIT ${push(limit)} OFFSET ${push(offset)}
    `, params);
  }

  if (filters.pincode && /^\d{6}$/.test(filters.pincode)) {
    conds.push(`n.pincode = ${push(filters.pincode)}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  return query<Nurse>(`
    SELECT ${SELECT_COLS}, NULL::float8 AS distance_km
    FROM ${NURSE_FROM}
    ${where}
    ${orderClause(filters, false)}
    LIMIT ${push(limit)} OFFSET ${push(offset)}
  `, params);
}

/** Count of matching rows. Uses the same condition builder as listNurses. */
export async function countNurses(filters: NurseFilters): Promise<number> {
  const radiusKm = filters.radiusKm ?? NURSE_REACH_RADIUS_KM;
  const isNearby = !!(filters.nearby && filters.pincode && /^\d{6}$/.test(filters.pincode));

  const params: unknown[] = [];
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const conds = buildConds(filters, push);

  if (isNearby) {
    const targetPin = push(filters.pincode);
    const radius = push(radiusKm);
    const where = conds.length ? `AND ${conds.join(' AND ')}` : '';
    const row = await queryOne<{ n: number }>(`
${nearbyTarget(targetPin)}
      SELECT COUNT(*)::int AS n
      ${nearbyFromWhere(radius, where)}
    `, params);
    return row?.n ?? 0;
  }

  if (filters.pincode && /^\d{6}$/.test(filters.pincode)) {
    conds.push(`n.pincode = ${push(filters.pincode)}`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM ${NURSE_FROM} ${where}`, params,
  );
  return row?.n ?? 0;
}

/** Distinct aggregators — powers the multi-select filter. */
export async function listNurseAggregators(): Promise<{ aggregator: string; n: number }[]> {
  return query<{ aggregator: string; n: number }>(`
    SELECT aggregator, COUNT(*)::int AS n
    FROM atlas.nurses_all
    WHERE aggregator IS NOT NULL AND TRIM(aggregator) <> ''
    GROUP BY aggregator
    ORDER BY n DESC, aggregator ASC
  `);
}

/** Strip to digits; drop a leading 91/0 so uploads and registry rows match. */
export function normalizePhone(input: string): string {
  let d = String(input ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

export type UploadedNurse = {
  phone: string;
  name: string;
  city?: string;
  state?: string;
  pincode?: string;
  aggregator?: string;
  qualification?: string;
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

export async function bulkUpsertNurses(
  rows: UploadedNurse[],
  meta: { filename: string; userId: number },
): Promise<UploadResult> {
  // Record the attempt first so a failure still leaves a trail.
  const upload = await queryOne<{ id: number }>(
    `INSERT INTO atlas.nurse_uploads (filename, total_rows, uploaded_by)
     VALUES ($1, $2, $3) RETURNING id`,
    [meta.filename, rows.length, meta.userId],
  );
  const uploadId = upload!.id;

  let inserted = 0, updated = 0, skipped = 0;

  for (const raw of rows) {
    const phone = normalizePhone(raw.phone);
    if (phone.length < 10 || !raw.name?.trim()) { skipped++; continue; }

    // Latest upload wins on populated fields; blanks don't erase existing data.
    const result = await queryOne<{ was_insert: boolean }>(
      `
      INSERT INTO atlas.nurses_manual
        (phone, name, city, state, pincode, aggregator, qualification, email, notes, source, uploaded_by)
      VALUES ($1, $2, NULLIF(TRIM($3::text), ''), NULLIF(TRIM($4::text), ''),
              NULLIF(TRIM($5::text), ''), NULLIF(TRIM($6::text), ''),
              NULLIF(TRIM($7::text), ''), NULLIF(TRIM($8::text), ''),
              NULLIF(TRIM($9::text), ''), $10, $11)
      ON CONFLICT (phone) DO UPDATE SET
        name          = EXCLUDED.name,
        city          = COALESCE(EXCLUDED.city,          atlas.nurses_manual.city),
        state         = COALESCE(EXCLUDED.state,         atlas.nurses_manual.state),
        pincode       = COALESCE(EXCLUDED.pincode,       atlas.nurses_manual.pincode),
        aggregator    = COALESCE(EXCLUDED.aggregator,    atlas.nurses_manual.aggregator),
        qualification = COALESCE(EXCLUDED.qualification, atlas.nurses_manual.qualification),
        email         = COALESCE(EXCLUDED.email,         atlas.nurses_manual.email),
        notes         = COALESCE(EXCLUDED.notes,         atlas.nurses_manual.notes),
        source        = EXCLUDED.source,
        uploaded_by   = EXCLUDED.uploaded_by,
        updated_at    = now()
      RETURNING (xmax = 0) AS was_insert
      `,
      [phone, raw.name.trim(), raw.city, raw.state, raw.pincode, raw.aggregator,
       raw.qualification, raw.email, raw.notes, `upload:${meta.filename}`, meta.userId],
    );
    if (result?.was_insert) inserted++; else updated++;
  }

  await query(
    `UPDATE atlas.nurse_uploads SET inserted = $1, updated = $2, skipped = $3 WHERE id = $4`,
    [inserted, updated, skipped, uploadId],
  );

  return { total: rows.length, inserted, updated, skipped, uploadId };
}
