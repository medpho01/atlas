import 'server-only';
import { query, queryOne } from './db';

/**
 * Catalogue discovery — browsing what we already sell.
 *
 * The rate lookup on /pricing answers "what does this test cost at which lab".
 * This answers the question that comes first in an account conversation: what
 * have we already built, for this kind of buyer, in this price range.
 *
 * Two things shape every query here.
 *
 * Every figure is a property of the package, or one named lab's price for it.
 * There are no cross-lab rollups. Prices are per-lab and don't add up across
 * labs, so an à-la-carte total or a blended cost — and any headroom computed
 * between them — described nothing anyone could buy. What replaced them is
 * adoption: how many people have actually been through the package.
 *
 * Commercial categories live in atlas.*, written by scripts/enrich-catalogue.ts.
 * Every join to them is a LEFT JOIN: the catalogue is fully browsable before
 * anything has been classified, and category filters simply return nothing
 * until it has.
 */

export type CategoryRow = {
  key: string;
  label: string;
  blurb: string | null;
  packages: number;
  tests: number;
};

/** The taxonomy with live counts, so empty categories are visibly empty. */
export async function getCategories(): Promise<CategoryRow[]> {
  return query<CategoryRow>(`
    SELECT c.key, c.label, c.blurb,
      (SELECT COUNT(*) FROM atlas.package_enrichment pe WHERE c.key = ANY(pe.categories))::int AS packages,
      (SELECT COUNT(*) FROM atlas.test_enrichment    te WHERE c.key = ANY(te.categories))::int AS tests
    FROM atlas.catalogue_category c
    ORDER BY c.sort_order
  `);
}

/** Whether anything has been classified yet — drives the empty-state copy. */
export async function getEnrichmentState(): Promise<{ tests: number; packages: number; last_run: string | null }> {
  return (await queryOne<{ tests: number; packages: number; last_run: string | null }>(`
    SELECT
      (SELECT COUNT(*) FROM atlas.test_enrichment)::int    AS tests,
      (SELECT COUNT(*) FROM atlas.package_enrichment)::int AS packages,
      (SELECT MAX(finished_at)::text FROM atlas.enrichment_run) AS last_run
  `)) ?? { tests: 0, packages: 0, last_run: null };
}

/** Labs that quote at least one package, for the lab filter. */
export async function getLabOptions(): Promise<{ value: string; label: string; count: number }[]> {
  return query(`
    SELECT lp.lab_id::text AS value,
           l."labName" || CASE WHEN l.city IS NOT NULL THEN ' · ' || l.city ELSE '' END AS label,
           COUNT(DISTINCT lp.package_id)::int AS count
    FROM analytics.mv_lab_packages lp
    JOIN src."Lab" l ON l.id = lp.lab_id
    WHERE lp.b2b > 10
    GROUP BY lp.lab_id, l."labName", l.city
    ORDER BY COUNT(DISTINCT lp.package_id) DESC, l."labName"
  `);
}

/**
 * Accounts with packages mapped to them, from "PackagesOnStore".
 *
 * This is what an account can sell, not what it has already ordered — a much
 * larger and more useful set. Plum has 30 packages mapped against 7 ordered,
 * and "what does this client have access to" is the question the filter is
 * actually being asked.
 */
export async function getStoreOptions(): Promise<{ value: string; label: string; count: number }[]> {
  return query(`
    SELECT d.store_id::text AS value, s."storeName" AS label,
           COUNT(DISTINCT d.package_id)::int AS count
    FROM analytics.mv_package_store d
    JOIN src."Store" s ON s.id = d.store_id
    GROUP BY d.store_id, s."storeName"
    ORDER BY COUNT(DISTINCT d.package_id) DESC, s."storeName"
  `);
}

export type PackageRow = {
  package_id: number;
  package_name: string;
  is_custom: boolean;
  order_types: string[] | null;
  tat_hours: number | null;
  test_count: number;
  department_count: number;
  sample_type_count: number;
  /** What has to be collected, e.g. ['Blood','Urine']. Blood first. */
  sample_types: string[] | null;
  /** Tests in the package with no sample type at source — the list may be short. */
  tests_without_sample: number;
  /** What the package costs at the cheapest lab quoting it — one lab, one price. */
  pkg_cost: string | null;
  best_lab_name: string | null;
  best_lab_city: string | null;
  labs_quoting: number;
  /** How many times the package has been booked. Zero is a real signal. */
  orders: number;
  orders_l90d: number;
  last_ordered: string | null;
  categories: string[] | null;
  intent: string | null;
  positioning: string | null;
};

export type PackageFilters = {
  q?: string;
  category?: string;
  modality?: string;
  minTests?: number;
  /** Price band, against the cheapest lab's quote for the package. */
  priceMin?: number;
  priceMax?: number;
  /** Only packages someone has actually ordered. */
  provenOnly?: boolean;
  /** Packages quoted by any of these labs. */
  labIds?: number[];
  /** Packages mapped to any of these accounts. */
  storeIds?: number[];
  limit?: number;
};

export async function browsePackages(f: PackageFilters = {}): Promise<PackageRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (f.q?.trim()) {
    params.push(`%${f.q.trim().toLowerCase()}%`);
    where.push(`lower(e.package_name) LIKE $${params.length}`);
  }
  if (f.category) {
    params.push(f.category);
    where.push(`$${params.length} = ANY(pe.categories)`);
  }
  if (f.modality) {
    params.push(f.modality);
    where.push(`$${params.length} = ANY(e.order_types)`);
  }
  if (f.minTests) {
    params.push(f.minTests);
    where.push(`e.test_count >= $${params.length}`);
  }
  if (f.priceMin != null) {
    params.push(f.priceMin);
    where.push(`e.pkg_cost >= $${params.length}`);
  }
  if (f.priceMax != null) {
    params.push(f.priceMax);
    where.push(`e.pkg_cost <= $${params.length}`);
  }
  if (f.provenOnly) where.push('e.orders > 0');
  // Both are "any of", not "all of": a package quoted by one selected lab is a
  // package that lab can fulfil, which is the question being asked.
  if (f.labIds?.length) {
    params.push(f.labIds);
    where.push(`EXISTS (SELECT 1 FROM analytics.mv_lab_packages lp
                        WHERE lp.package_id = e.package_id AND lp.b2b > 10
                          AND lp.lab_id = ANY($${params.length}::int[]))`);
  }
  if (f.storeIds?.length) {
    params.push(f.storeIds);
    where.push(`EXISTS (SELECT 1 FROM analytics.mv_package_store sd
                        WHERE sd.package_id = e.package_id
                          AND sd.store_id = ANY($${params.length}::int[]))`);
  }
  // The whole package set is a few hundred rows, so it is served entire
  // rather than capped — a truncated list headed "300 packages" reads as a
  // total, and quietly hides the rest of the catalogue from the person
  // trying to find something in it.
  params.push(f.limit ?? 2000);

  return query<PackageRow>(`
    SELECT e.package_id, e.package_name, e.is_custom, e.order_types, e.tat_hours,
           e.test_count, e.department_count, e.sample_type_count,
           e.sample_types, e.tests_without_sample, e.pkg_cost::text,
           e.best_lab_name, e.best_lab_city, e.labs_quoting,
           e.orders, e.orders_l90d, e.last_ordered::text,
           pe.categories, pe.intent, pe.positioning
    FROM analytics.v_package_economics e
    LEFT JOIN atlas.package_enrichment pe ON pe.package_id = e.package_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY e.orders DESC, e.test_count DESC, e.package_name
    LIMIT $${params.length}
  `, params);
}

export type PackageDetail = PackageRow & {
  description: string | null;
  confidence: string | null;
  enrichment_source: string | null;
};

export async function getPackageDetail(id: number): Promise<PackageDetail | null> {
  return queryOne<PackageDetail>(`
    SELECT e.*, e.pkg_cost::text, e.last_ordered::text,
           pe.categories, pe.intent, pe.positioning,
           pe.confidence::text, pe.source AS enrichment_source
    FROM analytics.v_package_economics e
    LEFT JOIN atlas.package_enrichment pe ON pe.package_id = e.package_id
    WHERE e.package_id = $1
  `, [id]);
}

export type ComponentRow = {
  master_id: number;
  test_name: string;
  department: string | null;
  labs_count: number | null;
  mrp_min: string | null;
  b2b_min: string | null;
  sample: string | null;
  categories: string[] | null;
  why_it_matters: string | null;
  orders: number;
};

/** What's actually in the package, with how often each test is taken. */
export async function getPackageComponents(id: number): Promise<ComponentRow[]> {
  return query<ComponentRow>(`
    SELECT m.id AS master_id, m.name AS test_name, d.department,
           tc.labs_count, tc.mrp_min::text, tc.b2b_min::text,
           atlas.sample_bucket(st."sampleType") AS sample,
           te.categories, te.why_it_matters,
           COALESCE(dm.orders, 0) AS orders
    FROM src."_MasterToPackage" mp
    JOIN src."Master" m ON m.id = mp."A"
    LEFT JOIN src."SampleType" st ON st.id = m."sampleType_id"
    LEFT JOIN src."LabDepartment" d ON d.id = m."labDepartment_id"
    LEFT JOIN analytics.mv_test_catalog tc ON tc.master_id = m.id
    LEFT JOIN atlas.test_enrichment te ON te.master_id = m.id
    LEFT JOIN analytics.mv_catalogue_demand dm ON dm.kind='TEST' AND dm.entity_id = m.id
    WHERE mp."B" = $1
    ORDER BY COALESCE(dm.orders,0) DESC, tc.mrp_min DESC NULLS LAST, m.name
  `, [id]);
}

export type PackageLabRow = { lab_id: number; lab_name: string; city: string | null; b2b: string | null };

export async function getPackageLabs(id: number, limit = 12): Promise<PackageLabRow[]> {
  return query<PackageLabRow>(`
    SELECT lp.lab_id, l."labName" AS lab_name, l.city, lp.b2b::text
    FROM analytics.mv_lab_packages lp
    JOIN src."Lab" l ON l.id = lp.lab_id
    WHERE lp.package_id = $1
      -- Same floor the headline price uses. Without it a placeholder quote
      -- sorts to the top as the cheapest option and contradicts the price
      -- shown above it.
      AND lp.b2b > 10
    ORDER BY lp.b2b
    LIMIT $2
  `, [id, limit]);
}

export type TestRow = {
  master_id: number;
  test_name: string;
  department: string | null;
  labs_count: number;
  mrp_min: string | null;
  mrp_max: string | null;
  b2b_min: string | null;
  /** Normalised for reading — 'Blood', 'Urine', … */
  sample: string | null;
  /** Exactly what the source says, e.g. 'BLOOD SERUM'. */
  sample_raw: string | null;
  categories: string[] | null;
  consumer_name: string | null;
  why_it_matters: string | null;
};

export type TestFilters = {
  q?: string;
  category?: string;
  department?: string;
  priceMin?: number;
  priceMax?: number;
  limit?: number;
};

/**
 * Test search across the sellable catalogue. Matches the canonical name and
 * the aliases — aliases are how a request for "gut microbiome" or "vitamin D3"
 * finds a test filed under a different official name.
 */
export async function browseTests(f: TestFilters = {}): Promise<TestRow[]> {
  const params: unknown[] = [];
  const where: string[] = [];

  if (f.q?.trim()) {
    params.push(`%${f.q.trim().toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(`(lower(tc.test_name) LIKE ${p}
                 OR lower(te.consumer_name) LIKE ${p}
                 OR EXISTS (SELECT 1 FROM unnest(tc.aliases) a WHERE lower(a) LIKE ${p}))`);
  }
  if (f.category) {
    params.push(f.category);
    where.push(`$${params.length} = ANY(te.categories)`);
  }
  if (f.department) {
    params.push(f.department);
    where.push(`d.department = $${params.length}`);
  }
  if (f.priceMin != null) { params.push(f.priceMin); where.push(`tc.mrp_min >= $${params.length}`); }
  if (f.priceMax != null) { params.push(f.priceMax); where.push(`tc.mrp_min <= $${params.length}`); }
  params.push(f.limit ?? 300);

  return query<TestRow>(`
    SELECT tc.master_id, tc.test_name, d.department, tc.labs_count,
           tc.mrp_min::text, tc.mrp_max::text, tc.b2b_min::text,
           atlas.sample_bucket(st."sampleType") AS sample,
           st."sampleType"                      AS sample_raw,
           te.categories, te.consumer_name, te.why_it_matters
    FROM analytics.mv_test_catalog tc
    LEFT JOIN src."Master" m ON m.id = tc.master_id
    LEFT JOIN src."SampleType" st ON st.id = m."sampleType_id"
    LEFT JOIN src."LabDepartment" d ON d.id = m."labDepartment_id"
    LEFT JOIN atlas.test_enrichment te ON te.master_id = tc.master_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY tc.labs_count DESC, tc.test_name
    LIMIT $${params.length}
  `, params);
}

/** Clinical departments with counts — the axis that exists at source. */
export async function getDepartments(): Promise<{ department: string; tests: number }[]> {
  return query(`
    SELECT d.department, COUNT(*)::int AS tests
    FROM analytics.mv_test_catalog tc
    JOIN src."Master" m ON m.id = tc.master_id
    JOIN src."LabDepartment" d ON d.id = m."labDepartment_id"
    GROUP BY d.department
    ORDER BY COUNT(*) DESC
  `);
}

export const MODALITIES = ['HOME_SAMPLE', 'CENTER_VISIT', 'CAMP', 'KIT_BASED'] as const;

export const MODALITY_LABEL: Record<string, string> = {
  HOME_SAMPLE: 'Home sample',
  CENTER_VISIT: 'Center visit',
  CAMP: 'Camp',
  KIT_BASED: 'Kit',
};

export type ExportRow = {
  package_id: number;
  package_name: string;
  is_custom: boolean;
  modality: string | null;
  tat_hours: number | null;
  pkg_cost: string | null;
  best_lab_name: string | null;
  orders: number;
  sample_types: string | null;
  categories: string[] | null;
  intent: string | null;
  test_name: string | null;
  department: string | null;
  test_sample: string | null;
  mrp_min: string | null;
  labs_with_test: number | null;
};

/**
 * Flat package × test rows for export.
 *
 * One row per test, repeating the package columns, because that is the shape a
 * spreadsheet can pivot, filter and VLOOKUP against. A single row per package
 * with tests crammed into one comma-joined cell reads better on screen and is
 * useless the moment anyone tries to work with it.
 *
 * Packages with no composition still get a row, with the test columns blank —
 * dropping them would silently shorten the client's list.
 */
export async function getPackagesForExport(packageIds: number[]): Promise<ExportRow[]> {
  if (!packageIds?.length) return [];
  return query<ExportRow>(`
    SELECT
      e.package_id, e.package_name, e.is_custom,
      array_to_string(e.order_types, ' / ') AS modality,
      e.tat_hours, e.pkg_cost::text, e.best_lab_name, e.orders,
      array_to_string(e.sample_types, ' + ') AS sample_types,
      pe.categories, pe.intent,
      m.name AS test_name, d.department,
      atlas.sample_bucket(st."sampleType") AS test_sample,
      tc.mrp_min::text, tc.labs_count AS labs_with_test
    FROM analytics.v_package_economics e
    LEFT JOIN atlas.package_enrichment pe ON pe.package_id = e.package_id
    LEFT JOIN src."_MasterToPackage" mp ON mp."B" = e.package_id
    LEFT JOIN src."Master" m ON m.id = mp."A"
    LEFT JOIN src."SampleType" st ON st.id = m."sampleType_id"
    LEFT JOIN src."LabDepartment" d ON d.id = m."labDepartment_id"
    LEFT JOIN analytics.mv_test_catalog tc ON tc.master_id = m.id
    WHERE e.package_id = ANY($1::int[])
    ORDER BY e.orders DESC, e.package_name, tc.mrp_min DESC NULLS LAST, m.name
  `, [packageIds]);
}
