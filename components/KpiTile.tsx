import { ReactNode } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';

type Props = {
  label: string;
  value: string | number;
  sub?: string;
  trend?: { value: string; up?: boolean };
  tone?: 'default' | 'good' | 'warn' | 'bad';
  icon?: ReactNode;
  info?: ReactNode;
};

const toneStyles = {
  default: 'border-ink-150 bg-surface',
  good: 'border-success-100 bg-success-50/40',
  warn: 'border-warn-100 bg-warn-50/40',
  bad: 'border-danger-100 bg-danger-50/40',
};

const accentDot = {
  default: 'bg-ink-300',
  good: 'bg-success-500',
  warn: 'bg-warn-500',
  bad: 'bg-danger-500',
};

export function KpiTile({ label, value, sub, trend, tone = 'default', icon, info }: Props) {
  return (
    <div className={`relative rounded-xl border ${toneStyles[tone]} px-4 py-4 flex flex-col gap-1.5 transition-shadow hover:shadow-card-lg`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${accentDot[tone]}`} />
          <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">{label}</span>
          {info}
        </div>
        {icon && <span className="text-ink-400">{icon}</span>}
      </div>
      <div className="text-[28px] font-semibold text-ink-900 tabular-nums leading-none mt-1">{value}</div>
      <div className="flex items-center justify-between mt-0.5">
        {sub ? <span className="text-xs text-ink-500">{sub}</span> : <span />}
        {trend && (
          <span className={`flex items-center gap-0.5 text-xs font-semibold tabular-nums ${trend.up ? 'text-success-500' : 'text-danger-500'}`}>
            {trend.up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {trend.value}
          </span>
        )}
      </div>
    </div>
  );
}
