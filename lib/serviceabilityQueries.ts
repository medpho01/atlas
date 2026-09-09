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
  /** Of the panel's own pincodes, how many have ever been ordered from. */
  panel_with_demand: number;
};

/**
 * Which side of the panel to report on.
 *   exclude — everything the rest of the network reaches that the panel does not
 *   include — what the panel itself reaches
 * Same sets either way; only which one is listed changes.
 */
export type PanelMode = 'include' | 'exclude';

export async function getPanelGap(
  labIds: number[],
  mode: PanelMode = 'exclude',
  limit = 5000,
) {
  const ids = Array.from(new Set(labIds.filter((n) => Number.isFinite(n)))).slice(0, 200);
  const empty: PanelSummary = {
    panel_pincodes: 0, network_pincodes: 0, remaining_pincodes: 0,
    remaining_with_demand: 0, panel_with_demand: 0,
  };
  if (!ids.length) return { summary: empty, rows: [] as PanelGapRow[], mode };

  // The row set is the only thing that differs: the panel's own pincodes, or
  // everything else the network reaches. The labs named against each row follow
  // suit — in include mode only the selected labs are worth naming, since they
  // are the ones being asked about.
  const rowScope = mode === 'include'
    ? `panel AS (SELECT DISTINCT pincode FROM analytics.mv_lab_pincode_home WHERE lab_id = ANY($1)),
       scope AS (SELECT pincode FROM panel)`
    : `panel AS (SELECT DISTINCT pincode FROM analytics.mv_lab_pincode_home WHERE lab_id = ANY($1)),
       scope AS (SELECT DISTINCT pincode FROM analytics.mv_lab_pincode_home
                 EXCEPT SELECT pincode FROM panel)`;
  const labFilter = mode === 'include' ? 'AND lph.lab_id = ANY($1)' : '';

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
          WHERE COALESCE(ps.orders_all_time, 0) > 0)::int AS remaining_with_demand,
        (SELECT COUNT(*) FROM panel p
           JOIN analytics.mv_pincode_summary ps ON ps.pincode = p.pincode
          WHERE COALESCE(ps.orders_all_time, 0) > 0)::int AS panel_with_demand
    `, [ids]),

    query<PanelGapRow>(`
      WITH ${rowScope}
      SELECT s.pincode,
             pd.city, pd.state,
             ARRAY_REMOVE(ARRAY_AGG(DISTINCT l."labName" ORDER BY l."labName"), NULL) AS labs,
             COUNT(DISTINCT lph.lab_id)::int AS lab_count,
             MAX(ps.orders_all_time) AS orders_all_time
      FROM scope s
      JOIN analytics.mv_lab_pincode_home lph ON lph.pincode = s.pincode ${labFilter}
      JOIN src_local."Lab" l ON l.id = lph.lab_id
      LEFT JOIN LATERAL (
        SELECT MIN(city) AS city, MIN(state) AS state
        FROM atlas.pincode_directory WHERE pincode = s.pincode
      ) pd ON true
      LEFT JOIN analytics.mv_pincode_summary ps ON ps.pincode = s.pincode
      GROUP BY s.pincode, pd.city, pd.state
      -- Demand first, either way: the pincodes people actually order from are
      -- the ones worth reading, whether you are defending them or chasing them.
      ORDER BY MAX(ps.orders_all_time) DESC NULLS LAST, s.pincode
      LIMIT $2
    `, [ids, limit]),
  ]);

  return { summary: summary ?? empty, rows, mode };
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

/* ────────────────────────────── tests ────────────────────────────── */

export type TestOption = { name: string; category: string | null; labs: number; entries: number };

/**
 * Search the master test catalogue, ordered by how many labs actually offer it
 * — a test nobody has is useless as a filter, so the common ones surface first.
 */
export async function searchTests(q: string, limit = 25): Promise<TestOption[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  // Master.name is NOT unique — "Glucose Fasting" is two rows, 316 and 2109,
  // with different labs behind each. Grouping by name is what a user means by
  // "can this centre do Glucose Fasting", and avoids offering the same test
  // twice with two different counts.
  return query<TestOption>(
    `
    SELECT m.name,
           max(m."testCategory") AS category,
           count(DISTINCT d.lab_id)::int AS labs,
           count(DISTINCT m.id)::int     AS entries
    FROM src."Master" m
    LEFT JOIN src."DOS" d ON d.master_id = m.id AND d.active
    WHERE m.name ILIKE '%' || $1 || '%'
    GROUP BY m.name
    ORDER BY labs DESC, length(m.name), m.name
    LIMIT $2`,
    [term, limit],
  );
}

/**
 * How complete the test catalogue is. Filtering by test silently understates
 * coverage otherwise: a lab with no DOS row is unrecorded, not incapable, and
 * that is the overwhelming majority of them.
 */
export async function getTestCatalogueCoverage() {
  const rows = await query<{ with_dos: number; active_labs: number }>(
    `SELECT (SELECT count(DISTINCT lab_id) FROM src."DOS" WHERE active)::int AS with_dos,
            (SELECT count(*) FROM src."Lab" WHERE active)::int          AS active_labs`,
  );
  return rows[0];
}

/* ────────────────────────────── cities ────────────────────────────── */

export type CityMatch = { input: string; city: string | null; state: string | null; pincodes: string[] };

/**
 * What people type against what the postal directory calls it. Lab records use
 * both spellings freely — 93 centres say "Bangalore" and 36 say "Bengaluru" —
 * so a search for either has to find both.
 */
export const CITY_ALIASES: Record<string, string> = {
  bangalore: 'Bengaluru', bengaluru: 'Bengaluru', blr: 'Bengaluru',
  bombay: 'Mumbai', mumbai: 'Mumbai',
  madras: 'Chennai', chennai: 'Chennai',
  calcutta: 'Kolkata', kolkata: 'Kolkata',
  cochin: 'Kochi', kochi: 'Kochi', ernakulam: 'Kochi',
  gurgaon: 'Gurugram', gurugram: 'Gurugram',
  poona: 'Pune', pune: 'Pune',
  hyderabad: 'Hyderabad', secunderabad: 'Hyderabad',
  'new delhi': 'Delhi', delhi: 'Delhi',
  trivandrum: 'Thiruvananthapuram', pondicherry: 'Puducherry',
  baroda: 'Vadodara', mysore: 'Mysuru', mangalore: 'Mangaluru',
  vizag: 'Visakhapatnam', vishakapatnam: 'Visakhapatnam',
};

/**
 * Metros people name as one place but the postal directory splits. "Delhi" is
 * four pincodes in the directory and the whole NCR in conversation; asking for
 * it and getting four is not a useful answer.
 */
export const METRO_EXPANSIONS: Record<string, string[]> = {
  Delhi:  ['Delhi', 'New Delhi', 'Gurugram', 'Gurgaon', 'Noida', 'Ghaziabad', 'Faridabad', 'Greater Noida'],
  Mumbai: ['Mumbai', 'Navi Mumbai', 'Thane'],
  Kochi:  ['Kochi', 'Ernakulam'],
  Hyderabad: ['Hyderabad', 'Secunderabad'],
};

/** Canonical form of a typed or recorded city name. */
export function canonicalCity(name: string | null | undefined): string {
  const k = (name ?? '').trim().toLowerCase();
  return CITY_ALIASES[k] ?? (name ?? '').trim();
}

/**
 * Resolve typed city names to their pincodes. Matching is case- and
 * whitespace-insensitive and falls back to a prefix match, because people type
 * "bangalore" for Bengaluru and "delhi" for a dozen different entries.
 */
export async function resolveCities(names: string[]): Promise<CityMatch[]> {
  // Search the canonical name, but report back what the user typed.
  const typed = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean))).slice(0, 40);
  if (!typed.length) return [];
  const clean = typed.map(canonicalCity);
  const backToTyped = new Map<string, string>();
  const search: string[] = [];
  clean.forEach((c, i) => {
    const parts = METRO_EXPANSIONS[c] ?? [c];
    for (const p of parts) {
      backToTyped.set(p.toLowerCase(), typed[i]);
      search.push(p);
    }
  });

  const rows = await query<{ input: string; city: string; state: string; pincodes: string[] }>(
    `
    WITH asked AS (SELECT unnest($1::text[]) AS input)
    SELECT a.input,
           d.city,
           max(d.state) AS state,
           array_agg(DISTINCT d.pincode) AS pincodes
    FROM asked a
    JOIN atlas.pincode_directory d
      ON lower(btrim(d.city)) = lower(btrim(a.input))
      OR lower(btrim(d.city)) LIKE lower(btrim(a.input)) || '%'
    GROUP BY a.input, d.city
    ORDER BY a.input, count(*) DESC`,
    [search],
  );

  // A typed name can hit several directory cities (Delhi -> New Delhi, ...);
  // keep them separate so the user sees which one they got.
  const merged = new Map<string, CityMatch>();
  for (const r of rows) {
    const label = backToTyped.get(r.input.toLowerCase()) ?? r.input;
    const cur = merged.get(label);
    if (cur) {
      cur.pincodes = [...new Set([...cur.pincodes, ...r.pincodes])];
      // Name the metro as asked for, not whichever suburb sorted first.
      if (r.pincodes.length > (cur.pincodes.length - r.pincodes.length)) cur.state ??= r.state;
    } else {
      merged.set(label, { input: label, city: canonicalCity(label), state: r.state, pincodes: r.pincodes });
    }
  }
  const named = [...merged.values()];
  const seen = new Set(named.map((r) => r.input.toLowerCase()));
  const misses = typed.filter((c) => !seen.has(c.toLowerCase()))
    .map((c) => ({ input: c, city: null, state: null, pincodes: [] as string[] }));
  return [...named, ...misses];
}

/**
 * Serviceability restricted to labs that actually offer the given tests.
 *
 * The fast path above reads analytics.mv_pincode_coverage, a rollup that knows
 * nothing about test catalogues — so once tests are in play the counts have to
 * be rebuilt from lab-level reach:
 *
 *   home collection -> analytics.mv_lab_pincode_home
 *   centre visit    -> analytics.mv_pincode_cv_reach  (a 20 km catchment)
 *
 * A lab qualifies only if it has an ACTIVE DOS row for EVERY test asked for —
 * "which centre can do all of this panel" is the question worth answering.
 * Only labs and hospitals are considered; a phlebo has no test catalogue.
 */
export async function checkServiceabilityWithTests(
  pincodes: string[],
  services: ServiceKey[],
  testNames: string[],
): Promise<ServiceabilityRow[]> {
  const unique = Array.from(new Set(pincodes.filter((p) => /^\d{6}$/.test(p)))).slice(0, MAX_PINCODES);
  const tests = Array.from(new Set(testNames.map((t) => t.trim()).filter(Boolean)));
  if (!unique.length || !services.length || !tests.length) return [];

  // Test filtering only means anything for lab-shaped supply.
  const labServices = services.filter((s) => {
    const kind = s.split('|')[0];
    return kind === 'LAB' || kind === 'HOSPITAL';
  });
  if (!labServices.length) return [];

  const rows = await query<{
    pincode: string; city: string | null; state: string | null;
    kind: string; modality: string; providers: number; local_providers: number; top: string[] | null;
  }>(
    `
    WITH wanted AS (SELECT unnest($1::text[]) AS pincode),
    asked AS (
      SELECT split_part(s, '|', 1) AS kind, split_part(s, '|', 2) AS modality
      FROM unnest($2::text[]) s
    ),
    -- Labs holding an active DOS row for every test asked for. Matched on
    -- name, not master id: the catalogue carries the same test under several
    -- ids, and a lab offering either one can do it.
    qualified AS (
      SELECT d.lab_id
      FROM src."DOS" d
      JOIN src."Master" m ON m.id = d.master_id
      WHERE d.active AND m.name = ANY($3::text[])
      GROUP BY d.lab_id
      HAVING count(DISTINCT m.name) = array_length($3::text[], 1)
    ),
    lab AS (
      SELECT q.lab_id, l."labName" AS name, btrim(l.pincode) AS own_pincode,
             CASE WHEN l."centerType"::text = 'HOSPITAL' THEN 'HOSPITAL' ELSE 'LAB' END AS kind
      FROM qualified q JOIN src."Lab" l ON l.id = q.lab_id
      WHERE l.active
    ),
    -- Where each qualified lab can serve, by modality.
    reach AS (
      SELECT lb.lab_id, lb.name, lb.kind, 'HOME_SAMPLE' AS modality, h.pincode, 0::numeric AS km
      FROM lab lb JOIN analytics.mv_lab_pincode_home h ON h.lab_id = lb.lab_id
      UNION ALL
      SELECT lb.lab_id, lb.name, lb.kind, 'CENTER_VISIT', r.covered_pincode, r.distance_km
      FROM lab lb JOIN analytics.mv_pincode_cv_reach r ON r.entity_id = 'LAB-' || lb.lab_id
      -- mv_pincode_coverage counts a centre as reaching a pincode within 10 km;
      -- cv_reach carries 20. Match the rollup, or a test filter would appear to
      -- INCREASE coverage.
      WHERE r.distance_km <= 10
    ),
    grid AS (SELECT w.pincode, a.kind, a.modality FROM wanted w CROSS JOIN asked a)
    SELECT g.pincode, pd.city, pd.state, g.kind, g.modality,
           count(DISTINCT rc.lab_id)::int                                        AS providers,
           count(DISTINCT rc.lab_id) FILTER (WHERE rc.km = 0)::int               AS local_providers,
           (SELECT array_agg(x.n) FROM (
              SELECT DISTINCT r2.name || CASE WHEN r2.km > 0
                       THEN ' (' || round(r2.km, 1) || ' km)' ELSE '' END AS n, min(r2.km) AS k
              FROM reach r2
              WHERE r2.pincode = g.pincode AND r2.kind = g.kind AND r2.modality = g.modality
              GROUP BY 1 ORDER BY k LIMIT 3) x)                                  AS top
    FROM grid g
    LEFT JOIN reach rc
           ON rc.pincode = g.pincode AND rc.kind = g.kind AND rc.modality = g.modality
    LEFT JOIN atlas.pincode_directory pd ON pd.pincode = g.pincode
    GROUP BY g.pincode, pd.city, pd.state, g.kind, g.modality
    ORDER BY g.pincode`,
    [unique, labServices, tests],
  );

  const byPin = new Map<string, ServiceabilityRow>();
  for (const r of rows) {
    let row = byPin.get(r.pincode);
    if (!row) {
      row = { pincode: r.pincode, city: r.city, state: r.state, services: [] };
      byPin.set(r.pincode, row);
    }
    row.services.push({
      service: `${r.kind}|${r.modality}` as ServiceKey,
      providers: r.providers,
      local_providers: r.local_providers,
      top: r.top ?? [],
    });
  }
  return unique.map((p) => byPin.get(p)).filter(Boolean) as ServiceabilityRow[];
}

export type CityServiceCell = {
  service: ServiceKey;
  covered: number;
  /** Best single provider count seen in any one pincode of the city. */
  best: number;
  top: string[];
};
export type CityRow = {
  input: string; city: string | null; state: string | null;
  pincodes: number; services: CityServiceCell[];
};

/**
 * The same question at city scale: of this city's pincodes, how many can each
 * service reach? A city is not serviceable or not — Bengaluru is 130 pincodes
 * and the answer is usually "most of it", so the useful number is the share
 * covered, not a yes/no.
 */
export async function checkCityServiceability(
  cityNames: string[],
  services: ServiceKey[],
  testNames: string[] = [],
): Promise<CityRow[]> {
  const matches = await resolveCities(cityNames);
  const found = matches.filter((m) => m.pincodes.length);
  if (!found.length || !services.length) return [];

  const out: CityRow[] = [];
  for (const m of found) {
    const rows = testNames.length
      ? await checkServiceabilityWithTests(m.pincodes, services, testNames)
      : await checkServiceability(m.pincodes, services);

    const agg = new Map<ServiceKey, CityServiceCell>();
    for (const r of rows) {
      for (const c of r.services) {
        const cur = agg.get(c.service)
          ?? { service: c.service, covered: 0, best: 0, top: [] as string[] };
        if (c.providers > 0) cur.covered += 1;
        if (c.providers > cur.best) { cur.best = c.providers; cur.top = c.top; }
        agg.set(c.service, cur);
      }
    }
    out.push({
      input: m.input, city: m.city, state: m.state,
      pincodes: m.pincodes.length,
      services: services.map((s) => agg.get(s) ?? { service: s, covered: 0, best: 0, top: [] }),
    });
  }
  // Cities the user typed that the directory does not know.
  for (const m of matches.filter((x) => !x.pincodes.length)) {
    out.push({ input: m.input, city: null, state: null, pincodes: 0, services: [] });
  }
  return out;
}

/* ───────────────────── the union of centres ───────────────────── */

export type CentreRow = {
  entity_id: string;
  name: string;
  kind: string;
  modalities: string[];
  city: string | null;
  state: string | null;
  pincode: string | null;
  /** Street address, assembled from whichever source table the row came from. */
  address: string | null;
  /** Locality — the "area" a network sheet lists. */
  area: string | null;
  /** Chain the centre belongs to; null reads as independent. */
  chain: string | null;
  /** Whether the same centre also collects from home. */
  home_collection: boolean;
  /** How many of the asked-for pincodes this centre reaches. */
  covers: number;
  /** A few of them, so the row is checkable without a second query. */
  sample: string[];
  /** Nearest distance to any asked-for pincode; 0 when it sits inside one. */
  nearest_km: number | null;
  tests_listed: number;
};

/**
 * Every distinct centre that reaches ANY of the given locations — the union,
 * not a per-location breakdown. One row per centre, whatever it covers.
 *
 * Reach follows the same rules as the coverage rollup so the two agree:
 *   centre visit    -> a 10 km catchment (mv_pincode_cv_reach)
 *   everything else -> the provider's own pincode or its serviced list
 */
export async function listCentres(
  pincodes: string[],
  services: ServiceKey[],
  testNames: string[] = [],
  limit = 5000,
): Promise<CentreRow[]> {
  const unique = Array.from(new Set(pincodes.filter((p) => /^\d{6}$/.test(p)))).slice(0, MAX_PINCODES);
  if (!unique.length || !services.length) return [];

  const kinds = [...new Set(services.map((s) => s.split('|')[0]))];
  const modalities = [...new Set(services.map((s) => s.split('|')[1]))];
  const tests = Array.from(new Set(testNames.map((t) => t.trim()).filter(Boolean)));

  return query<CentreRow>(
    `
    WITH wanted AS (SELECT unnest($1::text[]) AS pincode),
    -- Labs listing every test asked for. Empty filter = no restriction.
    qualified AS (
      SELECT d.lab_id
      FROM src."DOS" d JOIN src."Master" m ON m.id = d.master_id
      WHERE d.active AND m.name = ANY($4::text[])
      GROUP BY d.lab_id
      HAVING count(DISTINCT m.name) = array_length($4::text[], 1)
    ),
    -- Centre visit reaches through a catchment, so it needs the distance table.
    radius AS (
      SELECT 'LAB-' || split_part(r.entity_id, '-', 2) AS entity_id,
             r.covered_pincode AS pincode, r.distance_km
      FROM analytics.mv_pincode_cv_reach r
      JOIN wanted w ON w.pincode = r.covered_pincode
      WHERE r.distance_km <= 10 AND 'CENTER_VISIT' = ANY($3::text[])
    ),
    -- Everything else reaches where it sits, or where it says it serves.
    direct AS (
      SELECT pu.entity_id, w.pincode,
             CASE WHEN pu.pincode = w.pincode THEN 0 ELSE NULL END::numeric AS distance_km
      FROM analytics.mv_provider_unified pu
      JOIN wanted w
        ON w.pincode = pu.pincode OR w.pincode = ANY(pu.serviced_pincodes)
      WHERE pu.active AND pu.kind = ANY($2::text[])
        AND pu.modalities && $3::text[]
        AND NOT ('CENTER_VISIT' = ANY($3::text[]) AND array_length($3::text[], 1) = 1
                 AND pu.kind IN ('LAB','HOSPITAL'))
    ),
    hit AS (SELECT * FROM radius UNION ALL SELECT * FROM direct)
    SELECT pu.entity_id, pu.name, pu.kind,
           ARRAY(SELECT m FROM unnest(pu.modalities) m WHERE m = ANY($3::text[])) AS modalities,
           pu.city, pu.state, pu.pincode,
           -- The unified view keeps only city/state/pincode, but a walk-in
           -- centre is useless without the street address, so fetch it from
           -- whichever table the row came from.
           NULLIF(concat_ws(', ',
             NULLIF(btrim(pr."unitFloorBuilding"), ''),
             NULLIF(btrim(COALESCE(l.address, pr.address, ph.address)), ''),
             NULLIF(btrim(COALESCE(l.locality, pr.locality, ph.locality)), ''),
             NULLIF(btrim(pu.city), ''),
             NULLIF(btrim(pu.state), ''),
             NULLIF(btrim(pu.pincode), '')), '') AS address,
           NULLIF(btrim(COALESCE(l.locality, pr.locality, ph.locality)), '') AS area,
           NULLIF(btrim(ch."chainName"), '')                                  AS chain,
           COALESCE(l."homeCollection", false)                                AS home_collection,
           count(DISTINCT h.pincode)::int AS covers,
           (array_agg(DISTINCT h.pincode))[1:5]         AS sample,
           min(h.distance_km)                            AS nearest_km,
           COALESCE((SELECT count(*)::int FROM src."DOS" d
                     WHERE d.lab_id = pu.source_id AND d.active
                       AND pu.source_table = 'Lab'), 0)  AS tests_listed
    FROM hit h
    JOIN analytics.mv_provider_unified pu ON pu.entity_id = h.entity_id
    LEFT JOIN src."Lab"      l  ON pu.source_table = 'Lab'      AND l.id  = pu.source_id
    LEFT JOIN src."Provider" pr ON pu.source_table = 'Provider' AND pr.id = pu.source_id
    LEFT JOIN src."Pharmacy" ph ON pu.source_table = 'Pharmacy' AND ph.id = pu.source_id
    LEFT JOIN src."Chain"    ch ON ch.id = pu.chain_id
    WHERE pu.active AND pu.kind = ANY($2::text[])
      AND (array_length($4::text[], 1) IS NULL
           OR (pu.source_table = 'Lab' AND pu.source_id IN (SELECT lab_id FROM qualified)))
    GROUP BY pu.entity_id, pu.name, pu.kind, pu.modalities, pu.city, pu.state, pu.pincode,
             pu.source_id, pu.source_table, l.address, l.locality, l."homeCollection",
             pr."unitFloorBuilding", pr.address, pr.locality, ph.address, ph.locality,
             ch."chainName"
    ORDER BY covers DESC, pu.name
    LIMIT $5`,
    [unique, kinds, modalities, tests, limit],
  );
}
