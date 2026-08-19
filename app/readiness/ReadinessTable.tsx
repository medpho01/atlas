'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { readinessBand, type ReadinessRow, type Gap } from '@/lib/readiness';

const pct = (v: string | null) => (v == null ? null : Math.round(Number(v) * 100));

const SEVERITY: Record<Gap['severity'], string> = {
  high: 'text-danger-500',
  medium: 'text-warn-600',
  low: 'text-ink-500',
};

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

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
          <th className="text-left font-medium px-5 py-2">City</th>
          <th className="text-left font-medium px-2 py-2">Band</th>
          <th className="text-right font-medium px-2 py-2">Score</th>
          <th className="text-left font-medium px-2 py-2 w-64">Subscores</th>
          <th className="text-right font-medium px-2 py-2">Providers</th>
          <th className="text-right font-medium px-2 py-2">Pincodes</th>
          <th className="text-right font-medium px-2 py-2">Scored on</th>
          <th className="text-right font-medium px-5 py-2">Gaps</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ row: r, gaps }) => {
          const band = readinessBand(r.score);
          const isOpen = open === r.city_key;
          const subs: [string, number | null][] = [
            ['Coverage', pct(r.coverage_score)],
            ['Density', pct(r.density_score)],
            ['Integration', pct(r.integration_score)],
            ['SLA', pct(r.sla_score)],
            ['Price', pct(r.price_score)],
          ];
          return (
            <>
              <tr
                key={r.city_key}
                onClick={() => setOpen(isOpen ? null : r.city_key)}
                className="border-b border-ink-100 last:border-0 cursor-pointer hover:bg-ink-100/40"
              >
                <td className="px-5 py-2 font-medium text-ink-900">
                  <ChevronRight
                    className={`inline w-3.5 h-3.5 mr-1 text-ink-400 transition ${isOpen ? 'rotate-90' : ''}`}
                  />
                  {r.city}
                </td>
                <td className="px-2 py-2 text-xs text-ink-600">{r.band}</td>
                <td className="px-2 py-2 text-right">
                  <span className={`num font-semibold text-${band.tone}-600`}>{r.score}</span>
                  <div className={`text-[10px] text-${band.tone}-600`}>{band.label}</div>
                </td>
                <td className="px-2 py-2">
                  <div className="flex gap-0.5 h-4 items-end" title={subs.map(([l, v]) => `${l}: ${v ?? 'no data'}`).join(' · ')}>
                    {subs.map(([label, v]) => (
                      <div key={label} className="flex-1 bg-ink-100 rounded-sm relative h-full">
                        {v != null && (
                          <div
                            className="absolute bottom-0 left-0 right-0 bg-brand-500 rounded-sm"
                            style={{ height: `${Math.max(v, 3)}%` }}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </td>
                <td className="px-2 py-2 num text-ink-700">
                  {r.providers}
                  <span className="text-[10px] text-ink-400">/{r.min_providers}</span>
                </td>
                <td className="px-2 py-2 num text-ink-700">
                  {r.pincodes_covered}
                  {r.total_pincodes != null && (
                    <span className="text-[10px] text-ink-400">/{r.total_pincodes}</span>
                  )}
                </td>
                <td className="px-2 py-2 num text-right">
                  <span className={r.subscores_present < 4 ? 'text-warn-600' : 'text-ink-500'}>
                    {r.subscores_present}/5
                  </span>
                </td>
                <td className="px-5 py-2 num text-right">
                  {gaps.length
                    ? <span className={gaps.some((g) => g.severity === 'high') ? 'text-danger-500 font-medium' : 'text-warn-600'}>{gaps.length}</span>
                    : <span className="text-success-600">—</span>}
                </td>
              </tr>

              {isOpen && (
                <tr key={`${r.city_key}-detail`} className="border-b border-ink-100 bg-ink-100/30">
                  <td colSpan={8} className="px-5 py-3">
                    {gaps.length === 0 ? (
                      <p className="text-xs text-success-600">
                        Nothing outstanding against the {r.band} norms for this category.
                      </p>
                    ) : (
                      <ul className="space-y-1.5 mb-3">
                        {gaps.map((g) => (
                          <li key={g.kind} className="text-xs flex gap-2">
                            <span className={`font-medium w-24 shrink-0 ${SEVERITY[g.severity]}`}>{g.kind}</span>
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
            </>
          );
        })}
      </tbody>
    </table>
  );
}
