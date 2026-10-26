import 'server-only';
import { query, queryOne } from './db';

/**
 * The NABL accredited diagnostic centres.
 *
 * NABL accredits 11,142 labs, but 8,502 of them are industrial: corrugated
 * box R&D, fertiliser chemistry, electrical calibration. None of that is
 * supply Atlas can use, so every read here is scoped to the Medical field —
 * the pathology and imaging centres a patient is sent to. The full snapshot
 * stays in the table; this module simply never asks for the rest.
 *
 * Reference data, not supply: a row here is a centre NABL has accredited,
 * which is a different claim from one LabStack can send an order to.
 * `onboarded` marks the ones matched to a provider by pincode and name, so it
 * is a strong hint rather than a fact.
 */

/** Everything this module reads is a diagnostic centre. */
const DIAGNOSTIC_ONLY = `n.field = 'Medical'`;

export type NablLab = {
  nabl_id: string;
  cab_name: string;
  cab_id: string | null;
  certificate_no: string | null;
  field: string | null;
  application_status: string | null;
  validity: string | null;
  certificate_link: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  discipline: string | null;
  groupname: string | null;
  permanent_facility: string | null;
  nabl_updated_on: string | null;
  /** A LabStack lab at the same pincode with a name that matches closely. */
  onboarded_as: string | null;
};

export type NablFilters = {
  q?: string;
  /** One discipline from the medical list — Haematology, Molecular Testing… */
  discipline?: string;
  state?: string;
  city?: string;
  /** 'yes' or 'no' — whether we appear to have it already. */
  onboarded?: string;
  page?: number;
};

export const PAGE_SIZE = 50;

// Stored at load time by atlas.match_nabl_labs(), not computed per row: the
// similarity join is the same work for every request and only changes when a
// snapshot is loaded or a lab is onboarded.
const MATCH = 'n.matched_lab_name';

function buildWhere(f: NablFilters) {
  const where: string[] = [DIAGNOSTIC_ONLY];
  const params: any[] = [];
  const push = (v: any) => `$${params.push(v)}`;

  // discipline is a comma-separated list on the row, so a centre accredited
  // for several shows under each of them.
  if (f.discipline) where.push(`n.discipline ILIKE ${push(`%${f.discipline}%`)}`);
  if (f.state) where.push(`n.state = ${push(f.state)}`);
  if (f.city) where.push(`n.city_key = ${push(f.city)}`);
  if (f.q && f.q.trim()) {
    const like = push(`%${f.q.trim()}%`);
    where.push(`(n.cab_name ILIKE ${like} OR n.city ILIKE ${like}
                 OR n.pincode ILIKE ${like} OR n.certificate_no ILIKE ${like}
                 OR n.cab_id ILIKE ${like} OR n.discipline ILIKE ${like})`);
  }
  if (f.onboarded === 'yes') where.push(`n.matched_lab_id IS NOT NULL`);
  if (f.onboarded === 'no') where.push(`n.matched_lab_id IS NULL`);

  return { clause: `WHERE ${where.join(' AND ')}`, params };
}

export async function listNablLabs(f: NablFilters = {}) {
  const { clause, params } = buildWhere(f);
  const page = Math.max(1, f.page ?? 1);
  const offset = (page - 1) * PAGE_SIZE;

  const rows = await query<NablLab>(`
    SELECT n.nabl_id, n.cab_name, n.cab_id, n.certificate_no, n.field,
           n.application_status, n.validity, n.certificate_link,
           n.contact_name, n.phone, n.email, n.address, n.city, n.state,
           n.pincode, n.discipline, n.groupname, n.permanent_facility,
           n.nabl_updated_on,
           ${MATCH} AS onboarded_as
    FROM atlas.nabl_lab n
    ${clause}
    ORDER BY n.cab_name
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `, params);

  const total = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM atlas.nabl_lab n ${clause}`, params);

  return { rows, total: total?.n ?? 0, page, pages: Math.ceil((total?.n ?? 0) / PAGE_SIZE) };
}

/** The filter rows: disciplines, the busiest states, and how fresh this is. */
export async function getNablFacets() {
  const [disciplines, states, meta] = await Promise.all([
    query<{ discipline: string; n: number }>(`
      WITH one AS (
        SELECT trim(unnest(string_to_array(discipline, ','))) AS discipline
        FROM atlas.nabl_lab n WHERE ${DIAGNOSTIC_ONLY} AND discipline <> ''
      )
      SELECT discipline, COUNT(*)::int AS n
      FROM one GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    query<{ state: string; n: number }>(`
      SELECT COALESCE(state, 'Unstated') AS state, COUNT(*)::int AS n
      FROM atlas.nabl_lab n WHERE ${DIAGNOSTIC_ONLY}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`),
    queryOne<{ total: number; pulled_on: string; matched: number; imaging: number }>(`
      SELECT COUNT(*)::int AS total,
             MAX(pulled_on)::text AS pulled_on,
             COUNT(*) FILTER (WHERE matched_lab_id IS NOT NULL)::int AS matched,
             COUNT(*) FILTER (WHERE discipline ILIKE '%MI CAB%')::int AS imaging
      FROM atlas.nabl_lab n WHERE ${DIAGNOSTIC_ONLY}`),
  ]);
  return { disciplines, states, meta };
}
