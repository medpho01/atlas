import 'server-only';
import { query } from './db';

/**
 * Pricing intelligence queries — /pricing page.
 *
 * Sources:
 *   analytics.mv_test_catalog  (one row per test; search + availability)
 *   analytics.mv_test_rates    (one row per test × lab; MRP + B2B)
 *
 * Terminology mapping to source DOS table:
 *   mrp = DOS.price   (customer-facing rate)
 *   b2b = DOS.labCost (rate LabStack pays the lab)
 */

export type TestHit = {
  master_id: number;
  test_name: string;
  ls_id: string;
  category: string;
  is_profile: boolean;
  labs_count: number;
  mrp_min: number | null;
  b2b_min: number | null;
  b2b_max: number | null;
};

/**
 * Typeahead search across test name + aliases. Exact-prefix matches rank
 * first, then substring, then alias hits — so "cbc" surfaces "CBC" before
 * "MCBC-something".
 */
export async function searchTests(q: string, limit = 12): Promise<TestHit[]> {
  const needle = q.trim().toLowerCase();
  if (needle.length < 2) return [];
  return query<TestHit>(
    `
    SELECT master_id, test_name, ls_id, category, is_profile,
           labs_count, mrp_min, b2b_min, b2b_max
    FROM analytics.mv_test_catalog
    WHERE lower(test_name) LIKE '%' || $1 || '%'
       OR EXISTS (SELECT 1 FROM unnest(aliases) a WHERE lower(a) LIKE '%' || $1 || '%')
    ORDER BY
      (lower(test_name) = $1) DESC,
      (lower(test_name) LIKE $1 || '%') DESC,
      labs_count DESC,
      test_name ASC
    LIMIT $2
    `,
    [needle, limit],
  );
}

export type TestRate = {
  master_id: number;
  test_name: string;
  lab_id: number;
  lab_name: string;
  lab_city: string | null;
  lab_state: string | null;
  mrp: number;
  b2b: number | null;
  tat_hours: number | null;
  nabl: boolean;
  in_house: boolean;
};

export type LabPackage = {
  package_id: number;
  package_name: string;
  canonical_name: string;
  mrp: number | null;
  b2b: number | null;
  component_count: number;
  overlap: number;
  covered_ids: number[];
};

/**
 * Packages available at a lab whose components cover ≥75% of the basket —
 * the "you could quote this existing package instead" suggestions.
 */
export async function getLabPackages(labId: number, masterIds: number[]): Promise<LabPackage[]> {
  if (!masterIds.length || !Number.isInteger(labId)) return [];
  const ids = masterIds.filter((n) => Number.isInteger(n)).slice(0, 100);
  return query<LabPackage>(
    `
    SELECT
      lp.package_id,
      lp.package_name,
      lp.canonical_name,
      lp.mrp,
      lp.b2b,
      lp.component_count,
      (SELECT COUNT(*) FROM unnest(lp.component_master_ids) c WHERE c = ANY($2::int[]))::int AS overlap,
      ARRAY(SELECT c FROM unnest(lp.component_master_ids) c WHERE c = ANY($2::int[]))        AS covered_ids
    FROM analytics.mv_lab_packages lp
    WHERE lp.lab_id = $1
      AND (SELECT COUNT(*) FROM unnest(lp.component_master_ids) c WHERE c = ANY($2::int[]))::float
          >= 0.75 * cardinality($2::int[])
    ORDER BY overlap DESC,
             (lp.b2b IS NULL OR lp.b2b <= 0) ASC,   -- placeholder prices sink below real ones
             lp.b2b ASC
    LIMIT 10
    `,
    [labId, ids],
  );
}

/**
 * All (test × lab) rates for a basket of master_ids. The client groups by lab,
 * applies the ≥80% coverage rule, and computes discounted totals.
 */
export async function getRatesForTests(masterIds: number[]): Promise<TestRate[]> {
  if (!masterIds.length) return [];
  const ids = masterIds.filter((n) => Number.isInteger(n)).slice(0, 100);
  return query<TestRate>(
    `
    SELECT master_id, test_name, lab_id, lab_name, lab_city, lab_state,
           mrp, b2b, tat_hours, nabl, in_house
    FROM analytics.mv_test_rates
    WHERE master_id = ANY($1::int[])
    ORDER BY lab_name, test_name
    `,
    [ids],
  );
}
