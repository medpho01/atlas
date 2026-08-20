import 'server-only';
import { query, queryOne } from './db';
import type { RequestRow, CommitmentRow } from './requests';

/**
 * Statuses that mean nobody is waiting on us. The default queue hides them,
 * because a list that mixes live work with a year of history is a list nobody
 * trusts as a to-do.
 */
const SETTLED = ['ORDERED', 'DISCHARGED', 'CANCELLED', 'DENIED', 'WRONG_NUMBER'];

export type RequestFilters = {
  state?: string;
  status?: string;
  store?: string;
  city?: string;
  pincode?: string;
  q?: string;
  /** false shows everything including settled history. */
  openOnly?: boolean;
  sort?: 'newest' | 'oldest' | 'value' | 'value_asc' | 'soonest' | 'demand';
  /** Only rows Atlas could price. */
  priced?: boolean;
  /** Only rows where the console and Atlas disagree on serviceability. */
  disputed?: boolean;
  /** Only rows with a lab already covering the pincode. */
  hasLab?: boolean;
  limit?: number;
  offset?: number;
};

function build(f: RequestFilters) {
  const params: unknown[] = [];
  const where: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };

  if (f.openOnly !== false) {
    where.push(`NOT is_converted AND status <> ALL($${params.push(SETTLED)})`);
  }
  if (f.state)   add('state = ?', f.state);
  if (f.status)  add('status = ?', f.status);
  if (f.store)   add('store_id = ?', Number(f.store));
  if (f.city)    add('lower(city) = lower(?)', f.city);
  if (f.pincode) add('pincode = ?', f.pincode);
  if (f.priced) where.push('quote_price IS NOT NULL');
  if (f.hasLab) where.push('covering_labs > 0');
  // The console flag disagreeing with Atlas is worth filtering on directly:
  // these are requests someone may have already turned away.
  if (f.disputed) where.push("NOT src_flag AND state = 'SERVICEABLE'");
  if (f.q) {
    params.push(`%${f.q}%`);
    const i = params.length;
    where.push(`(pincode ILIKE $${i} OR city ILIKE $${i} OR request_id::text ILIKE $${i}
                 OR store_name ILIKE $${i}
                 OR array_to_string(item_names, ' ') ILIKE $${i})`);
  }
  return { params, clause: where.length ? `WHERE ${where.join(' AND ')}` : '' };
}

/**
 * The ops queue. Sorted so the top of the list is the right thing to work on
 * next — with no assignment model, sort order is the whole prioritisation
 * system, so it is not an afterthought.
 */
export async function getRequests(f: RequestFilters = {}) {
  const { params, clause } = build(f);
  // Newest first by default: with no assignment, the queue is worked from the
  // top, and a request that arrived today is the one a store is waiting on.
  const order =
    f.sort === 'oldest'    ? 'created_at ASC'
    : f.sort === 'value'     ? 'quote_price DESC NULLS LAST, created_at DESC'
    : f.sort === 'value_asc' ? 'quote_price ASC NULLS LAST, created_at DESC'
    : f.sort === 'soonest'   ? 'promised_date ASC NULLS LAST, created_at DESC'
    // Demand: pincodes we keep failing in, so repeated failures surface as a
    // block rather than scattered through a year of rows.
    : f.sort === 'demand'
      ? `(SELECT COUNT(*) FROM analytics.mv_request_state s2
           WHERE s2.pincode = analytics.v_request_quote.pincode
             AND s2.state <> 'SERVICEABLE') DESC NULLS LAST, created_at DESC`
    : 'created_at DESC';
  const limit = Math.min(f.limit ?? 100, 500);
  params.push(limit, f.offset ?? 0);
  return query<RequestRow>(`
    SELECT * FROM analytics.v_request_quote
    ${clause}
    ORDER BY ${order}
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params);
}

export async function countRequests(f: RequestFilters = {}) {
  const { params, clause } = build(f);
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM analytics.v_request_quote ${clause}`, params);
  return row?.n ?? 0;
}

/** Summary strip: the shape of the queue, not just its length. */
export async function getRequestSummary(f: RequestFilters = {}) {
  const { params, clause } = build(f);
  return query<{ state: string; n: number; quoted: number; dated: number }>(`
    SELECT state, COUNT(*)::int AS n,
           COUNT(quote_price)::int AS quoted,
           COUNT(promised_date)::int AS dated
    FROM analytics.v_request_quote ${clause}
    GROUP BY 1 ORDER BY 2 DESC
  `, params);
}

export async function getRequest(id: number) {
  return queryOne<RequestRow>(
    `SELECT * FROM analytics.v_request_quote WHERE request_id = $1`, [id]);
}

/** What was asked for, and whether we could name it canonically. */
export async function getRequestItems(id: number) {
  return query<{ kind: string; label: string; source: string; resolved: boolean }>(`
    SELECT ri.kind,
           COALESCE(p."packageName", m.name, ri.raw_text, '(unnamed)') AS label,
           ri.source,
           (ri.package_id IS NOT NULL OR ri.master_id IS NOT NULL) AS resolved
    FROM atlas.request_item ri
    LEFT JOIN src_local."Package" p ON p.id = ri.package_id
    LEFT JOIN src_local."Master"  m ON m.id = ri.master_id
    WHERE ri.request_id = $1
    ORDER BY ri.kind, label
  `, [id]);
}

/**
 * Labs that can collect in this pincode, and what each is missing.
 *
 * The missing list is the negotiation: "activate these three tests at this
 * lab" is actionable in a way "package gap" is not.
 */
export async function getCoveringLabs(id: number) {
  return query<{
    lab_id: number; lab_name: string; city: string | null;
    missing: number; missing_items: string[]; cost: string | null;
  }>(`
    WITH want AS (
      SELECT DISTINCT kind, COALESCE(package_id, master_id) AS item_id
      FROM atlas.request_item
      WHERE request_id = $1 AND (package_id IS NOT NULL OR master_id IS NOT NULL)
    ),
    labs AS (
      SELECT DISTINCT lph.lab_id
      FROM analytics.mv_request_state s
      JOIN analytics.mv_lab_pincode_home lph ON lph.pincode = s.pincode
      WHERE s.request_id = $1
    )
    SELECT l.lab_id, lb."labName" AS lab_name, lb.city,
           COUNT(*) FILTER (WHERE lo.lab_id IS NULL)::int AS missing,
           ARRAY_REMOVE(ARRAY_AGG(
             CASE WHEN lo.lab_id IS NULL
                  THEN COALESCE(p."packageName", m.name, '#' || w.item_id) END), NULL) AS missing_items,
           ROUND(SUM(lo.cost)::numeric, 2) AS cost
    FROM labs l
    CROSS JOIN want w
    LEFT JOIN analytics.mv_lab_offering lo
           ON lo.lab_id = l.lab_id AND lo.kind = w.kind AND lo.item_id = w.item_id
    LEFT JOIN src_local."Package" p ON w.kind = 'PACKAGE' AND p.id = w.item_id
    LEFT JOIN src_local."Master"  m ON w.kind = 'TEST'    AND m.id = w.item_id
    JOIN src_local."Lab" lb ON lb.id = l.lab_id
    GROUP BY l.lab_id, lb."labName", lb.city
    ORDER BY missing ASC, cost ASC NULLS LAST
    LIMIT 12
  `, [id]);
}

/**
 * The tests inside each requested package.
 *
 * A package name alone tells ops nothing about what is being collected — and a
 * 56-test panel and a 3-test panel are very different conversations with a lab.
 */
export async function getPackageTests(id: number) {
  return query<{ package_id: number; package_name: string; tests: string[]; n: number }>(`
    SELECT p.id AS package_id, p."packageName" AS package_name,
           ARRAY_REMOVE(ARRAY_AGG(m.name ORDER BY m.name), NULL) AS tests,
           COUNT(m.id)::int AS n
    FROM atlas.request_item ri
    JOIN src_local."Package" p ON p.id = ri.package_id
    LEFT JOIN src_local."_MasterToPackage" mp ON mp."B" = p.id
    LEFT JOIN src_local."Master" m ON m.id = mp."A"
    WHERE ri.request_id = $1 AND ri.package_id IS NOT NULL
    GROUP BY p.id, p."packageName"
    ORDER BY p."packageName"
  `, [id]);
}

/** Unverified web leads for a pincode. Never mixed into the lab list above. */
export async function getDiscoveredLabs(pincode: string) {
  return query<{
    id: number; name: string; address: string | null; phone: string | null;
    source_url: string | null; retrieved_at: string; crm_provider_id: number | null;
  }>(`
    SELECT id, name, address, phone, source_url, retrieved_at, crm_provider_id
    FROM atlas.discovered_lab
    WHERE pincode = $1 AND NOT dismissed
    ORDER BY confidence DESC NULLS LAST, name
  `, [pincode]);
}

export async function getCommitments(opts: { includeClosed?: boolean } = {}) {
  if (opts.includeClosed) {
    return query<CommitmentRow>(`
      SELECT * FROM analytics.v_commitment_queue ORDER BY days_left ASC NULLS LAST`);
  }
  return query<CommitmentRow>(
    `SELECT * FROM analytics.v_commitment_queue ORDER BY breached DESC, days_left ASC NULLS LAST`);
}

export async function getCommitmentStats() {
  return queryOne<{
    open: number; breached: number; due_3d: number;
    closed: number; allocated: number; kept: number;
  }>(`
    SELECT
      COUNT(*) FILTER (WHERE closed_at IS NULL)::int AS open,
      COUNT(*) FILTER (WHERE closed_at IS NULL AND promised_date < CURRENT_DATE)::int AS breached,
      COUNT(*) FILTER (WHERE closed_at IS NULL AND promised_date <= CURRENT_DATE + 3)::int AS due_3d,
      COUNT(*) FILTER (WHERE closed_at IS NOT NULL)::int AS closed,
      COUNT(*) FILTER (WHERE outcome = 'allocated')::int AS allocated,
      -- Kept: allocated on or before the date we promised. The metric the
      -- whole process is judged on, computed from the ledger rather than
      -- reported by anyone.
      COUNT(*) FILTER (WHERE outcome = 'allocated'
                         AND closed_at::date <= promised_date)::int AS kept
    FROM atlas.commitment
  `);
}

/** Pincodes ranked by unmet demand — the planning layer under both queues. */
export async function getPincodeDemand(limit = 50) {
  return query<{
    pincode: string; city: string | null; state_name: string | null;
    requests: number; open_commitments: number; nearest_km: string | null;
    states: string[]; web_leads: number;
  }>(`
    SELECT s.pincode, MIN(s.city) AS city, MIN(s.state_name) AS state_name,
           COUNT(*)::int AS requests,
           COUNT(c.id) FILTER (WHERE c.closed_at IS NULL)::int AS open_commitments,
           MIN(s.nearest_km) AS nearest_km,
           ARRAY_AGG(DISTINCT s.state) AS states,
           (SELECT COUNT(*)::int FROM atlas.discovered_lab dl
             WHERE dl.pincode = s.pincode AND NOT dl.dismissed) AS web_leads
    FROM analytics.mv_request_state s
    LEFT JOIN atlas.commitment c ON c.request_id = s.request_id
    WHERE s.pincode IS NOT NULL
      AND s.state IN ('PACKAGE_GAP','SUPPLY_GAP_KNOWN','SUPPLY_GAP_UNKNOWN')
    GROUP BY s.pincode
    ORDER BY requests DESC
    LIMIT $1
  `, [limit]);
}

export async function getFacets() {
  const [stores, cities] = await Promise.all([
    query<{ store_id: number; name: string; n: number }>(`
      SELECT s.store_id, COALESCE(st."storeName", 'Store ' || s.store_id) AS name, COUNT(*)::int AS n
      FROM analytics.mv_request_state s
      LEFT JOIN src_local."Store" st ON st.id = s.store_id
      WHERE s.store_id IS NOT NULL
      GROUP BY 1,2 ORDER BY 3 DESC LIMIT 25`),
    query<{ city: string; n: number }>(`
      SELECT city, COUNT(*)::int AS n FROM analytics.mv_request_state
      WHERE NULLIF(TRIM(city),'') IS NOT NULL
      GROUP BY 1 ORDER BY 2 DESC LIMIT 30`),
  ]);
  return { stores, cities };
}
