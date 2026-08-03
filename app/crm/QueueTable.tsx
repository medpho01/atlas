'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';
import type { QueueRow } from '@/lib/crm';

/**
 * A person's open work, oldest-untouched first.
 *
 * Ordered by staleness rather than thread or stage on purpose: the failure
 * this view exists to fix is *missing* things, not prioritising them, and a
 * missed thing is an untouched thing. Thread is a column here rather than a
 * grouping — knowing which campaign a provider belongs to matters less than
 * knowing nobody has touched it in three weeks.
 */
export function QueueTable({
  rows,
  staleAfter,
  emptyLabel,
}: {
  rows: QueueRow[];
  staleAfter: number;
  emptyLabel: string;
}) {
  if (!rows.length) {
    return <p className="px-5 py-10 text-sm text-ink-500 text-center">{emptyLabel}</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
          <th className="text-left font-medium px-5 py-2">Provider</th>
          <th className="text-left font-medium px-2 py-2">Thread</th>
          <th className="text-left font-medium px-2 py-2">Stage</th>
          <th className="text-left font-medium px-2 py-2">Owner</th>
          <th className="text-right font-medium px-5 py-2">Untouched</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.thread_id}-${r.provider_id}`} className="border-b border-ink-100 last:border-0">
            <td className="px-5 py-2">
              <Link
                href={`/crm/${r.thread_id}`}
                className="font-medium text-ink-900 hover:text-brand-700 dark:hover:text-brand-400 hover:underline"
              >
                {r.provider_name}
              </Link>
              <div className="text-[11px] text-ink-500">
                {r.kind}{r.city ? ` · ${r.city}` : ''}
              </div>
            </td>
            <td className="px-2 py-2 text-xs text-ink-600 max-w-[14rem] truncate">{r.thread_name}</td>
            <td className="px-2 py-2 text-xs text-ink-700">{r.stage_label}</td>
            <td className="px-2 py-2 text-xs">
              {r.assignee_name ?? <span className="text-warn-600">unassigned</span>}
            </td>
            <td className="px-5 py-2 text-right">
              <span
                className={`inline-flex items-center gap-1 text-xs tabular-nums ${
                  r.days_stale >= staleAfter * 2 ? 'text-danger-500 font-semibold'
                  : r.days_stale >= staleAfter ? 'text-warn-600 font-medium'
                  : 'text-ink-500'
                }`}
              >
                <Clock className="w-3 h-3" />
                {r.days_stale === 0 ? 'today' : `${r.days_stale}d`}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
