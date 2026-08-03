import type { QueueFunnel as Funnel } from '@/lib/crm';

/**
 * The queue's shape, above the queue itself.
 *
 * Bars are scaled against the largest stage rather than the total, because the
 * interesting comparison is between stages — scaling to the total makes every
 * bar short as soon as work is spread across more than a few stages.
 *
 * Stalled/dropped stages are coloured as losses. They sit in funnel order
 * rather than being moved to the end: where a provider stalls is the useful
 * information, and reordering would hide it.
 */
export function QueueFunnel({
  funnel,
  staleCount,
  staleAfter,
}: {
  funnel: Funnel;
  staleCount: number;
  staleAfter: number;
}) {
  if (!funnel.total) return null;

  const peak = funnel.stages.reduce((n, s) => Math.max(n, s.n), 0) || 1;
  const conversion = Math.round((funnel.onboarded / funnel.total) * 100);

  const stats: { label: string; value: string; tone?: string }[] = [
    { label: 'In pipeline', value: String(funnel.total) },
    { label: 'Still open', value: String(funnel.open) },
    { label: 'Onboarded', value: String(funnel.onboarded), tone: 'text-success-600' },
    { label: 'Converted', value: `${conversion}%` },
    { label: `Untouched ${staleAfter}d+`, value: String(staleCount), tone: staleCount ? 'text-warn-600' : undefined },
    { label: 'Threads', value: String(funnel.threads) },
  ];

  return (
    <div className="mb-4 rounded-lg border border-ink-200 bg-surface">
      <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-ink-100 border-b border-ink-100">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3">
            <div className={`text-xl font-semibold num ${s.tone ?? 'text-ink-900'}`}>{s.value}</div>
            <div className="text-[11px] text-ink-500 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 space-y-1.5">
        {funnel.stages.map((s) => {
          const isLost = !s.is_success && /stall|drop|lost|reject|dead/i.test(s.stage_key + s.stage_label);
          const share = Math.round((s.n / funnel.total) * 100);
          return (
            <div key={s.stage_key} className="flex items-center gap-3">
              <div className="w-40 shrink-0 text-xs text-ink-600 truncate" title={s.stage_label}>
                {s.stage_label}
              </div>
              <div className="flex-1 h-5 rounded bg-ink-100/60 overflow-hidden">
                <div
                  className={`h-full rounded ${
                    s.is_success ? 'bg-success-500' : isLost ? 'bg-danger-500' : 'bg-brand-500'
                  } ${s.n === 0 ? 'opacity-0' : ''}`}
                  style={{ width: `${Math.max((s.n / peak) * 100, s.n ? 3 : 0)}%` }}
                />
              </div>
              <div className="w-20 shrink-0 text-right text-xs num">
                <span className="font-medium text-ink-900">{s.n}</span>
                <span className="text-ink-400 ml-1.5">{share}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
