import Link from 'next/link';

/**
 * The CRM has two organising principles and needs both.
 *
 * Threads are how a campaign is run. My queue and Team are how the work is
 * actually done — by a person, across every thread they're on. Anything
 * assigned in a thread someone doesn't open regularly is invisible to them
 * on the board alone, which is the failure these two views exist to fix.
 */
const TABS = [
  { href: '/crm', label: 'My queue' },
  { href: '/crm/team', label: 'Team' },
  { href: '/crm/threads', label: 'Threads' },
] as const;

export function CrmTabs({ active }: { active: '/crm' | '/crm/team' | '/crm/threads' }) {
  return (
    <div className="flex items-center gap-1 mb-5 border-b border-ink-200">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={
            'px-3 py-2 text-sm -mb-px border-b-2 transition-colors ' +
            (t.href === active
              ? 'border-brand-600 text-ink-900 font-medium'
              : 'border-transparent text-ink-500 hover:text-ink-900')
          }
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
