import Link from 'next/link';

type Option = { label: string; href: string; active: boolean };

export function SegmentedControl({ options, size = 'md' }: { options: Option[]; size?: 'sm' | 'md' }) {
  const py = size === 'sm' ? 'py-1' : 'py-1.5';
  const text = size === 'sm' ? 'text-xs' : 'text-[13px]';
  return (
    <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5">
      {options.map((o) => (
        <Link
          key={o.href}
          href={o.href}
          className={`px-3 ${py} ${text} font-medium rounded-md transition-all duration-150 ${
            o.active
              ? 'bg-surface text-ink-900 shadow-sm'
              : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          {o.label}
        </Link>
      ))}
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral'; children: React.ReactNode }) {
  const styles = {
    good: 'bg-success-50 text-success-700 border-success-100',
    warn: 'bg-warn-50 text-warn-600 border-warn-100',
    bad: 'bg-danger-50 text-danger-600 border-danger-100',
    info: 'bg-brand-50 text-brand-400 border-brand-100',
    neutral: 'bg-ink-100 text-ink-700 border-ink-200',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${styles}`}>
      {children}
    </span>
  );
}

export function ChipButton({ children, active, href }: { children: React.ReactNode; active?: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
        active ? 'bg-brand-600 text-white border border-brand-600' : 'bg-surface border border-ink-200 text-ink-700 hover:bg-ink-100'
      }`}
    >
      {children}
    </Link>
  );
}
