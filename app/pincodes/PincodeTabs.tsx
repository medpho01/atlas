import Link from 'next/link';
import { BarChart3, ListChecks, Building2 } from 'lucide-react';

const TABS = [
  { key: 'distribution',   href: '/pincodes',                       label: 'Distribution',  icon: BarChart3 },
  { key: 'serviceability', href: '/pincodes?tab=serviceability',    label: 'Serviceability', icon: ListChecks },
  { key: 'panel',          href: '/pincodes?tab=panel',             label: 'Lab panel',      icon: Building2 },
] as const;

export function PincodeTabs({ active }: { active: 'distribution' | 'serviceability' | 'panel' }) {
  return (
    <div className="flex items-center gap-1 mb-4 border-b border-ink-200">
      {TABS.map((t) => {
        const Icon = t.icon;
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-[13px] -mb-px border-b-2 transition ${
              on
                ? 'border-brand-600 text-brand-700 dark:text-brand-400 font-semibold'
                : 'border-transparent text-ink-600 hover:text-ink-900 font-medium'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
