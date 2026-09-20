import Link from 'next/link';

export type Funnel = {
  received: number; answerable: number; priced: number;
  quoted: number; ordered: number; sourced: number;
  no_ask: number; no_pincode: number; supply_gap: number; awaiting: number;
};

const n = (v: number) => v.toLocaleString('en-IN');

/**
 * Headline counts for the selected arrival window.
 *
 * Counts only. The stage-by-stage chart that used to sit under these was a
 * report rather than a queue, and it stood between the filters and the rows
 * they filter.
 */
export function RequestFunnel({
  funnel, windowLabel, hrefFor,
}: {
  funnel: Funnel;
  windowLabel: string;
  hrefFor: (key: string, value?: string) => string;
}) {
  const conv     = funnel.received  ? Math.round((funnel.ordered / funnel.received) * 100) : 0;
  const answered = funnel.answerable ? Math.round((funnel.priced / funnel.answerable) * 100) : 0;

  const stats: {
    label: string; value: string; sub?: string; tone?: string; href?: string;
  }[] = [
    { label: 'Requests received', value: n(funnel.received), sub: windowLabel },
    { label: 'Priced or serviceable', value: `${answered}%`, sub: `${n(funnel.priced)} of ${n(funnel.answerable)} identified`,
      tone: answered >= 80 ? 'text-success-600' : 'text-warn-600' },
    { label: 'Converted to orders', value: `${conv}%`, sub: `${n(funnel.ordered)} orders`,
      tone: conv >= 50 ? 'text-success-600' : 'text-ink-900' },
    { label: 'Supply gap', value: n(funnel.supply_gap), sub: 'no lab carries the request',
      tone: funnel.supply_gap ? 'text-warn-600' : undefined,
      href: hrefFor('state', 'SUPPLY_GAP_KNOWN') },
    { label: 'Awaiting supply', value: n(funnel.awaiting), sub: 'ordered, lab not assigned',
      tone: funnel.awaiting ? 'text-warn-600' : undefined },
    { label: 'Unidentified items', value: n(funnel.no_ask), sub: `${n(funnel.no_pincode)} without a pincode`,
      tone: funnel.no_ask ? 'text-danger-500' : undefined,
      href: hrefFor('state', 'NO_ITEMS') },
  ];

  if (!funnel.received) {
    return (
      <div className="mb-4 rounded-lg border border-ink-200 bg-surface px-4 py-6 text-center">
        <p className="text-sm text-ink-500">No requests in this window.</p>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg border border-ink-200 bg-surface
                    grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6
                    divide-x divide-y lg:divide-y-0 divide-ink-100">
      {stats.map((s) => {
        const body = (
          <>
            <div className={`text-xl font-semibold num ${s.tone ?? 'text-ink-900'}`}>{s.value}</div>
            <div className="text-[11px] font-medium text-ink-700 mt-1">{s.label}</div>
            {s.sub && <div className="text-[11px] text-ink-400 mt-0.5 leading-snug">{s.sub}</div>}
          </>
        );
        return s.href ? (
          <Link key={s.label} href={s.href} className="px-4 py-3 hover:bg-ink-100/40 transition-colors">
            {body}
          </Link>
        ) : (
          <div key={s.label} className="px-4 py-3">{body}</div>
        );
      })}
    </div>
  );
}
