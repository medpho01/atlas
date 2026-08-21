import Link from 'next/link';

export type Funnel = {
  received: number; answerable: number; priced: number;
  quoted: number; ordered: number; sourced: number;
  no_ask: number; no_pincode: number; supply_gap: number; awaiting: number;
};

const n = (v: number) => v.toLocaleString('en-IN');

/**
 * The shape of a window of arrivals, above the queue itself.
 *
 * Stages are cumulative subsets, so the gap between two bars is a real loss
 * and the drop-off label is honest. Bars scale against the first stage rather
 * than the largest, because the question is always "how much of what arrived
 * got this far".
 *
 * Windowed on purpose. A running total of every request ever received is a
 * fact about the year, not a thing to act on this morning.
 */
export function RequestFunnel({
  funnel, windowLabel, hrefFor,
}: {
  funnel: Funnel;
  windowLabel: string;
  hrefFor: (key: string, value?: string) => string;
}) {
  const top = funnel.received || 1;

  const stages: {
    key: string; label: string; value: number; tone: string; href?: string; note?: string;
  }[] = [
    { key: 'received', label: 'Received', value: funnel.received, tone: 'bg-ink-400' },
    {
      key: 'answerable', label: 'We can read the ask', value: funnel.answerable, tone: 'bg-brand-400',
      note: funnel.no_ask + funnel.no_pincode > 0
        ? `${n(funnel.no_ask)} unreadable · ${n(funnel.no_pincode)} no pincode` : undefined,
      href: hrefFor('state', 'NO_ITEMS'),
    },
    {
      key: 'priced', label: 'Answered — priced or serviceable', value: funnel.priced, tone: 'bg-brand-500',
      href: hrefFor('priced', '1'),
    },
    { key: 'quoted', label: 'Quoted in console', value: funnel.quoted, tone: 'bg-brand-600' },
    { key: 'ordered', label: 'Became an order', value: funnel.ordered, tone: 'bg-success-500' },
    {
      key: 'sourced', label: 'Supply secured', value: funnel.sourced, tone: 'bg-success-600',
      note: funnel.awaiting > 0 ? `${n(funnel.awaiting)} still awaiting supply` : undefined,
    },
  ];

  // Headline stats. A divided grid rather than a wrapping row: equal columns
  // stay aligned whatever the numbers do, which the previous flex strip did not.
  const conv = funnel.received ? Math.round((funnel.ordered / funnel.received) * 100) : 0;
  const answered = funnel.answerable ? Math.round((funnel.priced / funnel.answerable) * 100) : 0;
  const stats = [
    { label: `Received · ${windowLabel}`, value: n(funnel.received) },
    { label: 'Answered', value: `${answered}%`, tone: answered >= 80 ? 'text-success-600' : 'text-warn-600' },
    { label: 'Became orders', value: `${conv}%`, tone: conv >= 50 ? 'text-success-600' : 'text-ink-900' },
    { label: 'Need a new lab', value: n(funnel.supply_gap), tone: funnel.supply_gap ? 'text-warn-600' : undefined },
    { label: 'Awaiting supply', value: n(funnel.awaiting), tone: funnel.awaiting ? 'text-warn-600' : undefined },
    { label: 'Unreadable ask', value: n(funnel.no_ask), tone: funnel.no_ask ? 'text-danger-500' : undefined },
  ];

  if (!funnel.received) {
    return (
      <div className="mb-4 rounded-lg border border-ink-200 bg-surface px-4 py-6 text-center">
        <p className="text-sm text-ink-500">Nothing arrived in this window.</p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-ink-200 bg-surface">
      <div className="grid grid-cols-3 sm:grid-cols-6 divide-x divide-ink-100 border-b border-ink-100">
        {stats.map((s) => (
          <div key={s.label} className="px-4 py-3">
            <div className={`text-xl font-semibold num ${s.tone ?? 'text-ink-900'}`}>{s.value}</div>
            <div className="text-[11px] text-ink-500 mt-0.5 leading-snug">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 space-y-1.5">
        {stages.map((s, i) => {
          const prev = i === 0 ? null : stages[i - 1].value;
          const drop = prev != null && prev > 0 ? prev - s.value : 0;
          const share = Math.round((s.value / top) * 100);
          const body = (
            <>
              <div className="w-52 shrink-0 text-xs text-ink-600 truncate" title={s.label}>
                {s.label}
              </div>
              <div className="flex-1 h-5 rounded bg-ink-100/60 overflow-hidden">
                <div className={`h-full rounded ${s.tone}`} style={{ width: `${Math.max(share, 1)}%` }} />
              </div>
              <div className="w-16 shrink-0 text-right num text-xs text-ink-900">{n(s.value)}</div>
              <div className="w-28 shrink-0 text-right text-[11px] text-ink-400">
                {drop > 0 ? <span className="text-warn-600">−{n(drop)} lost here</span> : `${share}%`}
              </div>
            </>
          );
          return s.href ? (
            <Link key={s.key} href={s.href}
                  className="flex items-center gap-3 hover:bg-ink-100/40 rounded -mx-1 px-1">
              {body}
            </Link>
          ) : (
            <div key={s.key} className="flex items-center gap-3">{body}</div>
          );
        })}
        {stages.map((s) => s.note && (
          <p key={s.key + '-note'} className="text-[11px] text-ink-400 pl-52 ml-3">{s.note}</p>
        ))}
      </div>
    </div>
  );
}
