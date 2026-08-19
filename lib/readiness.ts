/**
 * Readiness scoring vocabulary — thresholds, bands and gap derivation.
 *
 * Separate from readinessQueries.ts because the table that renders this is a
 * client component, and that module is 'server-only' (it imports pg). Same
 * split as lib/providerKinds.ts: shared meaning here, database access there.
 */

import { CATEGORY_LABEL, type Category } from './categories';

export type ReadinessRow = {
  city: string;
  city_key: string;
  band: 'C1' | 'C2' | 'C3';
  category: Category;
  providers: number;
  pincodes_covered: number;
  total_pincodes: number | null;
  tiers_present: number | null;
  min_providers: number;
  min_pincodes: number;
  tiers_expected: number;
  coverage_score: string | null;
  density_score: string | null;
  integration_score: string | null;
  sla_score: string | null;
  price_score: string | null;
  score: number;
  subscores_present: number;
};

/**
 * Thresholds are stated once, here, because three surfaces show them — the
 * choropleth, the drill-down and the Overview KPI — and a city that is
 * "Near-ready" on one screen and "Build" on another destroys trust in the
 * number faster than a wrong number would.
 */
export const READINESS_BANDS = [
  { min: 75, label: 'Launch-ready', tone: 'success' as const },
  { min: 50, label: 'Near-ready',   tone: 'warn'    as const },
  { min: 0,  label: 'Build',        tone: 'danger'  as const },
];

export const readinessBand = (score: number) =>
  READINESS_BANDS.find((b) => score >= b.min) ?? READINESS_BANDS[READINESS_BANDS.length - 1];

/**
 * The gaps behind a score, in the order they'd be acted on.
 *
 * Deliberately concrete — "22 pincodes with no diagnostics supply" is
 * actionable in a way "coverage 0.21" is not, and the score exists to produce
 * this list rather than the other way round.
 */
export type Gap = { kind: string; detail: string; severity: 'high' | 'medium' | 'low' };

export function gapsFor(r: ReadinessRow): Gap[] {
  const gaps: Gap[] = [];
  const num = (v: string | null) => (v == null ? null : Number(v));

  const cov = num(r.coverage_score);
  if (cov != null && r.total_pincodes && cov < 0.8) {
    gaps.push({
      kind: 'Coverage',
      detail: `${r.total_pincodes - r.pincodes_covered} of ${r.total_pincodes} pincodes have no ${CATEGORY_LABEL[r.category].toLowerCase()} supply`,
      severity: cov < 0.4 ? 'high' : 'medium',
    });
  }
  if (r.providers < r.min_providers) {
    gaps.push({
      kind: 'Density',
      detail: `${r.providers} providers against a ${r.band} target of ${r.min_providers}`,
      severity: r.providers < r.min_providers / 2 ? 'high' : 'medium',
    });
  }
  if (r.tiers_present != null && r.tiers_present < r.tiers_expected) {
    gaps.push({
      kind: 'Price choice',
      detail: r.tiers_present === 0
        ? 'No centres tiered yet — a buyer cannot choose a price point'
        : `${r.tiers_present} of ${r.tiers_expected} expected experience tiers present`,
      severity: r.tiers_present === 0 ? 'medium' : 'low',
    });
  }
  const integ = num(r.integration_score);
  if (integ != null && integ < 0.5) {
    gaps.push({
      kind: 'Integration',
      detail: `${Math.round(integ * 100)}% of centres report results back through the platform`,
      severity: integ < 0.2 ? 'high' : 'medium',
    });
  }
  const sla = num(r.sla_score);
  if (sla != null && sla < 0.9) {
    gaps.push({
      kind: 'SLA',
      detail: `Delivery running at ${Math.round(sla * 100)}% of target`,
      severity: sla < 0.7 ? 'high' : 'low',
    });
  }
  return gaps;
}

