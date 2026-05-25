type Props = { score: number; size?: 'sm' | 'md' };

export function HealthBadge({ score, size = 'sm' }: Props) {
  const tone = score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad';
  const dot = { good: 'bg-success-500', warn: 'bg-warn-500', bad: 'bg-danger-500' }[tone];
  const text = { good: 'text-success-700', warn: 'text-warn-600', bad: 'text-danger-600' }[tone];
  const cls = size === 'md' ? 'text-sm' : 'text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums ${text} ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {score}
    </span>
  );
}

export function CoverageBadge({ bucket }: { bucket: string }) {
  const map: Record<string, { label: string; cls: string; dot: string }> = {
    '5_plus': { label: '≥5 providers', cls: 'bg-success-50 text-success-700 border-success-100', dot: 'bg-success-500' },
    '3_to_4': { label: '3–4 providers', cls: 'bg-success-50 text-success-700 border-success-100', dot: 'bg-success-500' },
    '2': { label: '2 providers', cls: 'bg-warn-50 text-warn-600 border-warn-100', dot: 'bg-warn-500' },
    '1': { label: '1 provider', cls: 'bg-danger-50 text-danger-600 border-danger-100', dot: 'bg-danger-500' },
    '0': { label: 'No providers', cls: 'bg-ink-100 text-ink-600 border-ink-200', dot: 'bg-ink-400' },
  };
  const v = map[bucket] ?? map['0'];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium ${v.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
      {v.label}
    </span>
  );
}
