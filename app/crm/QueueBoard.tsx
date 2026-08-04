'use client';

import Link from 'next/link';
import { Clock } from 'lucide-react';
import type { QueueRow, QueueFunnelStage } from '@/lib/crm';

/**
 * A person's open work laid out as the funnel, not as a list.
 *
 * The thread board shows one campaign's providers by stage; this shows one
 * person's providers by stage across every campaign. Same shape, different
 * axis — so someone who has learned to read one can read the other.
 *
 * Within a column, longest-untouched first. That ordering is the whole reason
 * this view exists: the failure it guards against is forgetting something, and
 * a forgotten provider is an untouched one.
 *
 * Every stage gets a column, including the terminal ones. Hiding onboarded
 * here made this view disagree with the thread board about the same providers
 * — a stage reading 3 there and 0 here — which is worse than a column someone
 * has to scroll past.
 *
 * Cards open the provider's panel on its thread rather than just landing on
 * the thread: the reason to click a card is that specific provider.
 */
export function QueueBoard({
  rows,
  stages,
  staleAfter,
  emptyLabel,
  whoParam,
}: {
  rows: QueueRow[];
  stages: QueueFunnelStage[];
  staleAfter: number;
  emptyLabel: string;
  /** Carried onto the thread so it opens on the same person's work. */
  whoParam?: string;
}) {
  if (!rows.length) {
    return <p className="px-5 py-10 text-sm text-ink-500 text-center">{emptyLabel}</p>;
  }

  const columns = stages;
  const byStage = new Map<string, QueueRow[]>();
  for (const r of rows) {
    const list = byStage.get(r.stage_key);
    if (list) list.push(r);
    else byStage.set(r.stage_key, [r]);
  }
  for (const list of byStage.values()) list.sort((a, b) => b.days_stale - a.days_stale);

  // A stage a provider sits in that no funnel declares would otherwise vanish
  // from the board without trace. Append it rather than drop the rows.
  const known = new Set(columns.map((c) => c.stage_key));
  const orphans = [...byStage.keys()].filter((k) => !known.has(k));

  return (
    <div className="overflow-x-auto px-5 pb-1">
      <div className="flex gap-3 min-w-min">
        {[...columns.map((c) => ({ key: c.stage_key, label: c.stage_label, win: c.is_success })),
          ...orphans.map((k) => ({ key: k, label: byStage.get(k)![0].stage_label, win: false }))]
          .map((col) => {
            const list = byStage.get(col.key) ?? [];
            const lost = !col.win && /stall|drop|lost|reject|dead/i.test(col.key + col.label);
            return (
              <div key={col.key} className="w-[260px] shrink-0">
                <div
                  className={`flex items-center justify-between px-2.5 py-2 rounded-t-md border ${
                    col.win ? 'bg-success-500/10 border-success-500/30'
                    : lost ? 'bg-danger-500/10 border-danger-500/30'
                    : 'bg-ink-100/60 border-ink-200'
                  }`}
                >
                  <span
                    className={`text-xs font-medium truncate ${
                      col.win ? 'text-success-600' : lost ? 'text-danger-500' : 'text-ink-700'
                    }`}
                    title={col.label}
                  >
                    {col.label}
                  </span>
                  <span className="text-xs num text-ink-500">{list.length}</span>
                </div>

                <div className="border border-t-0 border-ink-200 rounded-b-md p-2 space-y-2 min-h-[5rem] bg-surface">
                  {list.length === 0 ? (
                    <p className="text-center text-xs text-ink-300 py-5">—</p>
                  ) : (
                    list.map((r) => (
                      <Link
                        key={`${r.thread_id}-${r.provider_id}`}
                        href={`/crm/${r.thread_id}?provider=${r.provider_id}${whoParam ? `&who=${whoParam}` : ''}`}
                        className="block rounded-md border border-ink-200 bg-surface px-2.5 py-2 hover:border-brand-400 transition"
                      >
                        <div className="text-sm font-medium text-ink-900 leading-snug">
                          {r.provider_name}
                        </div>
                        <div className="text-[11px] text-ink-500 mt-0.5">
                          {r.kind}{r.city ? ` · ${r.city}` : ''}
                        </div>
                        <div className="text-[11px] text-ink-600 mt-1.5 truncate" title={r.thread_name}>
                          {r.thread_name}
                        </div>
                        <div className="flex items-center justify-between mt-1.5">
                          <span className="text-[11px] text-ink-500 truncate">
                            {r.assignee_name ?? <span className="text-warn-600">unassigned</span>}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] tabular-nums shrink-0 ${
                              r.days_stale >= staleAfter * 2 ? 'text-danger-500 font-semibold'
                              : r.days_stale >= staleAfter ? 'text-warn-600 font-medium'
                              : 'text-ink-400'
                            }`}
                          >
                            <Clock className="w-3 h-3" />
                            {r.days_stale === 0 ? 'today' : `${r.days_stale}d`}
                          </span>
                        </div>
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
