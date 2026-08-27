import 'server-only';
import { query, queryOne } from './db';
import { CAPABILITY_MATRIX, KIND_LABEL, MODALITY_LABEL, type ProviderKind, type Modality } from './coverage';

/**
 * "Can we serve this pincode, and with what?"
 *
 * Generalised from the old bulk-coverage check, which hardcoded two questions
 * (Center Visit and Home Sample, labs and hospitals only). That left the rest
 * of the network — phlebos, nurses, doctors, pharmacies — unanswerable, even
 * though mv_pincode_coverage already carries every (kind × modality) pair.
 */

/** A service is one (kind × modality) pair, keyed as "LAB|CENTER_VISIT". */
export type ServiceKey = `${ProviderKind}|${Modality}`;

export const ALL_SERVICES: ServiceKey[] = (Object.keys(CAPABILITY_MATRIX) as ProviderKind[])
  .flatMap((k) => CAPABILITY_MATRIX[k].map((m) => `${k}|${m}` as ServiceKey));

/** Center Visit + Home Sample for labs — what the old bulk check asked. */
export const DEFAULT_SERVICES: ServiceKey[] = [
  'LAB|CENTER_VISIT', 'HOSPITAL|CENTER_VISIT', 'LAB|HOME_SAMPLE', 'HOSPITAL|HOME_SAMPLE',
];

export function serviceLabel(key: ServiceKey): string {
  const [kind, modality] = key.split('|') as [ProviderKind, Modality];
  return `${KIND_LABEL[kind]} — ${MODALITY_LABEL[modality]}`;
}

export function parseServices(input: unknown): ServiceKey[] {
  const raw = Array.isArray(input) ? input.map(String) : [];
  const valid = raw.filter((s): s is ServiceKey => (ALL_SERVICES as string[]).includes(s));
  return valid.length ? valid : DEFAULT_SERVICES;
}

export type ServiceCell = {
  service: ServiceKey;
  providers: number;
  /** Providers physically in the pincode. Differs from `providers` only for
   *  Center Visit, where reach is radius-based. */
  local_providers: number;
  top: string[];
};

export type ServiceabilityRow = {
  pincode: string;
  city: string | null;
  state: string | null;
  services: ServiceCell[];
};

/** Max pincodes per request — a bulk upload shouldn't be able to melt the DB. */
export const MAX_PINCODES = 2000;

export async function checkServiceability(
  pincodes: string[],
  services: ServiceKey[],
): Promise<ServiceabilityRow[]> {
  const unique = Array.from(new Set(pincodes.filter((p) => /^\d{6}$/.test(p)))).slice(0, MAX_PINCODES);
  if (!unique.length || !services.length) return [];

  const kinds = [...new Set(services.map((s) => s.split('|')[0]))];
  const modalities = [...new Set(services.map((s) => s.split('|')[1]))];

  const rows = await query<{
    pincode: string; city: string | null; state: string | null;
    kind: string; modality: string;
    providers: number; local_providers: number; top: string[] | null;
  }>(
    `
    WITH wanted AS (SELECT unnest($1::text[]) AS pincode),
    -- Only the (kind, modality) pairs actually asked for.
    asked AS (
      SELECT split_part(s, '|', 1) AS kind, split_part(s, '|', 2) AS modality
      FROM unnest($2::text[]) s
    ),
    grid AS (SELECT w.pincode, a.kind, a.modality FROM wanted w CROSS JOIN asked a)
    SELECT
      g.pincode,
      pc.city,
      pc.state,
      g.kind,
      g.modality,
      COALESCE(cov.providers, 0)::int       AS providers,
      COALESCE(cov.local_providers, 0)::int AS local_providers,
      CASE
        -- Center Visit reach is radius-based, so name the nearest labs and
        -- carry the distance — "covered" here can mean a lab 8 km away.
        WHEN g.modality = 'CENTER_VISIT' AND g.kind IN ('LAB','HOSPITAL') THEN
          (SELECT array_agg(x.n) FROM (
             SELECT r.name || CASE WHEN r.distance_km > 0
                      THEN ' (' || ROUND(r.distance_km::numeric, 1) || ' km)' ELSE '' END AS n
             FROM analytics.mv_pincode_cv_reach r
             WHERE r.covered_pincode = g.pincode AND r.distance_km <= 10
             ORDER BY r.distance_km ASC LIMIT 3
           ) x)
        ELSE
          (SELECT array_agg(x.n) FROM (
             SELECT pu.name AS n
             FROM analytics.mv_provider_unified pu
             WHERE pu.active
               AND pu.kind = g.kind
               AND g.modality = ANY(pu.modalities)
               AND (pu.pincode = g.pincode
                    OR (pu.serviced_pincodes IS NOT NULL AND g.pincode = ANY(pu.serviced_pincodes)))
             ORDER BY pu.name LIMIT 3
           ) x)
      END AS top
    FROM grid g
    LEFT JOIN analytics.mv_pincode_city pc ON pc.pincode = g.pincode
    LEFT JOIN analytics.mv_pincode_coverage cov
      ON cov.pincode = g.pincode AND cov.kind = g.kind AND cov.modality = g.modality
    WHERE g.kind = ANY($3::text[]) AND g.modality = ANY($4::text[])
    ORDER BY g.pincode, g.kind, g.modality
    `,
    [unique, services, kinds, modalities],
  );

  // Fold the long form into one row per pincode, preserving the caller's order.
  const byPincode = new Map<string, ServiceabilityRow>();
  for (const p of unique) byPincode.set(p, { pincode: p, city: null, state: null, services: [] });
  for (const r of rows) {
    const row = byPincode.get(r.pincode);
    if (!row) continue;
    row.city ??= r.city;
    row.state ??= r.state;
    row.services.push({
      service: `${r.kind}|${r.modality}` as ServiceKey,
      providers: r.providers,
      local_providers: r.local_providers,
      top: r.top ?? [],
    });
  }
  return [...byPincode.values()];
}

/**
 * What a panel of labs covers, and what it misses.
 *
 * The question behind it: "we have a deal with these labs — what can they
 * collect for us, where do they leave us short, and who could fill it?"
 *
 * Coverage is the union of the selected labs' pincodes, not the intersection:
 * a pincode is served if any one of them reaches it. "Remaining" is every
 * pincode some *other* lab in the network reaches but the panel does not —
 * which is the actionable half, because each one names a lab to talk to.
 *
 * Scoped to home collection, matching mv_lab_pincode_home, since that is what
 * a panel of collection partners is for.
 */
export type PanelGapRow = {
  pincode: string;
  city: string | null;
  state: string | null;
  labs: string[];
  lab_count: number;
  orders_all_time: number | null;
};

export type PanelSummary = {
  panel_pincodes: number;
  network_pincodes: number;
  remaining_pincodes: number;
  remaining_with_demand: number;
};

export async function getPanelGap(labIds: number[], limit = 5000) {
  const ids = Array.from(new Set(labIds.filter((n) => Number.isFinite(n)))).slice(0, 200);
  if (!ids.length) {
    return {
      summary: { panel_pincodes: 0, network_pincodes: 0, remaining_pincodes: 0, remaining_with_demand: 0 },
      rows: [] as PanelGapRow[],
    };
  }

  const [summary, rows] = await Promise.all([
    queryOne<PanelSummary>(`
      WITH panel AS (
        SELECT DISTINCT pincode FROM analytics.mv_lab_pincode_home WHERE lab_id = ANY($1)
      ),
      network AS (SELECT DISTINCT pincode FROM analytics.mv_lab_pincode_home),
      remaining AS (SELECT pincode FROM network EXCEPT SELECT pincode FROM panel)
      SELECT
        (SELECT COUNT(*) FROM panel)::int      AS panel_pincodes,
        (SELECT COUNT(*) FROM network)::int    AS network_pincodes,
        (SELECT COUNT(*) FROM remaining)::int  AS remaining_pincodes,
        (SELECT COUNT(*) FROM remaining r
           JOIN analytics.mv_pincode_summary ps ON ps.pincode = r.pincode
          WHERE COALESCE(ps.orders_all_time, 0) > 0)::int AS remaining_with_demand
    `, [ids]),

    query<PanelGapRow>(`
      WITH panel AS (
        SELECT DISTINCT pincode FROM analytics.mv_lab_pincode_home WHERE lab_id = ANY($1)
      ),
      remaining AS (
        SELECT DISTINCT pincode FROM analytics.mv_lab_pincode_home
        EXCEPT SELECT pincode FROM panel
      )
      SELECT r.pincode,
             pd.city, pd.state,
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT l."labName" ORDER BY l."labName"), NULL) AS labs,
             COUNT(DISTINCT lph.lab_id)::int AS lab_count,
             MAX(ps.orders_all_time) AS orders_all_time
      FROM remaining r
      JOIN analytics.mv_lab_pincode_home lph ON lph.pincode = r.pincode
      JOIN src_local."Lab" l ON l.id = lph.lab_id
      LEFT JOIN LATERAL (
        SELECT MIN(city) AS city, MIN(state) AS state
        FROM atlas.pincode_directory WHERE pincode = r.pincode
      ) pd ON true
      LEFT JOIN analytics.mv_pincode_summary ps ON ps.pincode = r.pincode
      GROUP BY r.pincode, pd.city, pd.state
      -- Demand first: a gap nobody has ever ordered from is not the one to
      -- fix first.
      ORDER BY MAX(ps.orders_all_time) DESC NULLS LAST, r.pincode
      LIMIT $2
    `, [ids, limit]),
  ]);

  return {
    summary: summary ?? { panel_pincodes: 0, network_pincodes: 0, remaining_pincodes: 0, remaining_with_demand: 0 },
    rows,
  };
}

/** Labs that actually have home-collection coverage, for the picker. */
export async function listCoverageLabs() {
  return query<{ lab_id: number; name: string; city: string | null; pincodes: number }>(`
    SELECT lph.lab_id, l."labName" AS name, l.city, COUNT(*)::int AS pincodes
    FROM analytics.mv_lab_pincode_home lph
    JOIN src_local."Lab" l ON l.id = lph.lab_id
    GROUP BY 1, 2, 3
    ORDER BY COUNT(*) DESC, l."labName"
  `);
}
