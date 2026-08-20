'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import {
  readinessBand,
  TONE_TEXT,
  TONE_FILL,
  type ReadinessRow,
  type Gap,
} from '@/lib/readiness';

const pct = (v: string | null) => (v == null ? null : Math.round(Number(v) * 100));

const SEVERITY: Record<Gap['severity'], string> = {
  high: 'text-danger-500',
  medium: 'text-warn-600',
  low: 'text-ink-500',
};

/** Order is fixed and mirrored in the header legend, so a bar can be read positionally. */
const SUBSCORE_LABELS = ['Coverage', 'Density', 'Integration', 'SLA', 'Price'] as const;

/**
 * One subscore as a horizontal fill.
 *
 * Previously five 16px-tall vertical bars filled by height percentage. Two
 * problems: at that height 90% and 100% were indistinguishable, and a subscore
 * with no data rendered as an empty slot — which, sitting mid-row, read as a
 * broken layout rather than as missing information. Integration is NULL for
 * every non-diagnostics city by design, so that blank was on most rows.
 *
 * Horizontal fill reads at a glance, and "no data" is a dashed outline: clearly
 * deliberate, clearly not zero.
 */
function SubscoreBar({ label, value }: { label: string; value: number | null }) {
  if (value == null) {
    return (
      <div
        className="h-1.5 flex-1 rounded-full border border-dashed border-ink-300"
        title={`${label}: no data — weight redistributed`}
      />
    );
  }
  const tone = value >= 75 ? 'success' : value >= 50 ? 'warn' : 'danger';
  return (
    <div className="h-1.5 flex-1 rounded-full bg-ink-150 overflow-hidden" title={`${label}: ${value}%`}>
      <div
        className={`h-full rounded-full ${TONE_FILL[tone]}`}
        style={{ width: `${Math.max(value, 2)}%` }}
      />
    </div>
  );
}

/**
 * One row per city, expanding to the gaps behind the score.
 *
 * The gaps are the deliverable — the score only exists to rank which city's
 * gap list to read first — so expanding is a click, not a navigation, and the
 * subscore bars sit next to the gaps that explain them.
 */
export function ReadinessTable({
  rows,
}: {
  rows: { row: ReadinessRow; gaps: Gap[] }[];
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (!rows.length) {
    return (
      <p className="px-5 py-10 text-sm text-ink-500 text-center">
        No cities scored for this category yet — supply has to exist before readiness means anything.
      </p>
    );
  }

  const isDiagnostics = rows[0]?.row.category === 'DIAGNOSTICS';

  return (
    <table className="w-full text-sm tabular-nums">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
          <th className="text-left font-medium px-5 py-2">City</th>
          <th className="text-left font-medium px-2 py-2 w-14">Band</th>
          <th className="text-right font-medium px-2 py-2 w-24">Score</th>
          <th className="text-left font-medium px-3 py-2 w-52">
            Subscores
            <span className="block normal-case tracking-normal text-[9px] text-ink-400 font-normal">
              cov · den · int · sla · price
            </span>
          </th>
          <th className="text-right font-medium px-2 py-2 w-28">Providers</th>
          <th className="text-right font-medium px-2 py-2 w-24">Pincodes</th>
          <th className="text-right font-medium px-2 py-2 w-20">Scored on</th>
          <th className="text-right font-medium px-5 py-2 w-16">Gaps</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ row: r, gaps }) => {
          const band = readinessBand(r.score);
          const isOpen = open === r.city_key;
          const subs: [string, number | null][] = [
            [SUBSCORE_LABELS[0], pct(r.coverage_score)],
            [SUBSCORE_LABELS[1], pct(r.density_score)],
            [SUBSCORE_LABELS[2], pct(r.integration_score)],
            [SUBSCORE_LABELS[3], pct(r.sla_score)],
            [SUBSCORE_LABELS[4], pct(r.price_score)],
          ];
          return (
            <Fragment key={r.city_key}>
              <tr
                onClick={() => setOpen(isOpen ? null : r.city_key)}
                className="border-b border-ink-100 last:border-0 cursor-pointer hover:bg-ink-100/40 align-middle"
              >
                <td className="px-5 py-2.5 font-medium text-ink-900">
                  <ChevronRight
                    className={`inline w-3.5 h-3.5 mr-1 text-ink-400 transition ${isOpen ? 'rotate-90' : ''}`}
                  />
                  {r.city}
                </td>
                <td className="px-2 py-2.5 text-xs text-ink-600">{r.band}</td>
                <td className="px-2 py-2.5 text-right whitespace-nowrap">
                  <span className={`num font-semibold ${TONE_TEXT[band.tone]}`}>{r.score}</span>
                  <span className={`block text-[10px] leading-tight ${TONE_TEXT[band.tone]}`}>
                    {band.label}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1 items-center">
                    {subs.map(([label, v]) => (
                      <SubscoreBar key={label} label={label} value={v} />
                    ))}
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right whitespace-nowrap">
                  <span className="num text-ink-700">{r.providers}</span>
                  <span className="text-[10px] text-ink-400">/{r.min_providers}</span>
                  {/* Centre vs home, because the total conflates them: a city can
                      read launch-ready on centres alone with no home collection. */}
                  {isDiagnostics && (
                    <span className="block text-[10px] leading-tight text-ink-400">
                      {r.providers_center} ctr ·{' '}
                      <span className={r.providers_home === 0 ? 'text-danger-500 font-medium' : ''}>
                        {r.providers_home} home
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-right whitespace-nowrap">
                  <span className="num text-ink-700">{r.pincodes_covered}</span>
                  {r.total_pincodes != null && (
                    <span className="text-[10px] text-ink-400">/{r.total_pincodes}</span>
                  )}
                </td>
                <td className="px-2 py-2.5 num text-right">
                  <span className={r.subscores_present < 4 ? 'text-warn-600' : 'text-ink-500'}>
                    {r.subscores_present}/5
                  </span>
                </td>
                <td className="px-5 py-2.5 num text-right">
                  {gaps.length
                    ? <span className={gaps.some((g) => g.severity === 'high') ? 'text-danger-500 font-medium' : 'text-warn-600'}>{gaps.length}</span>
                    : <span className="text-success-600">—</span>}
                </td>
              </tr>

              {isOpen && (
                <tr className="border-b border-ink-100 bg-ink-100/30">
                  <td colSpan={8} className="px-5 py-3">
                    {isDiagnostics && (
                      <div className="text-xs text-ink-600 mb-3">
                        <span className="text-ink-500">Delivery mode ·</span>{' '}
                        <span className="text-ink-900 font-medium">{r.providers_center}</span>{' '}
                        centre-visit across {r.pincodes_center} pincodes ·{' '}
                        {r.providers_home === 0 ? (
                          <span className="text-danger-500 font-medium">no home collection anywhere in the city</span>
                        ) : (
                          <>
                            <span className="text-ink-900 font-medium">{r.providers_home}</span>{' '}
                            home-collection across {r.pincodes_home}
                          </>
                        )}
                        .{' '}
                        {r.providers_home > 0 && (
                          <>Providers offering both are counted in each, so these do not sum to {r.providers}.</>
                        )}
                      </div>
                    )}
                    {gaps.length === 0 ? (
                      <p className="text-xs text-success-600">
                        Nothing outstanding against the {r.band} norms for this category.
                      </p>
                    ) : (
                      <ul className="space-y-1.5 mb-3">
                        {gaps.map((g) => (
                          <li key={g.kind} className="text-xs flex gap-2">
                            <span className={`font-medium w-28 shrink-0 ${SEVERITY[g.severity]}`}>{g.kind}</span>
                            <span className="text-ink-700">{g.detail}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex flex-wrap gap-3 text-xs">
                      <Link href={`/gaps?city=${encodeURIComponent(r.city)}`} className="text-brand-600 hover:underline">
                        Open the gap queue for {r.city} →
                      </Link>
                      <Link href={`/crm`} className="text-brand-600 hover:underline">
                        Onboarding pipeline →
                      </Link>
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
