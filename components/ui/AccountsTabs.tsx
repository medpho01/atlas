import Link from 'next/link';

/**
 * The four ways to read the book.
 *
 * They were four nav items pretending to be separate features — an account
 * list, a health report, a task list and a cross-sell list, all over the same
 * rows. One nav item, four views: which one you want depends on the question,
 * not on the data.
 */
const TABS = [
  { href: '/accounts', label: 'Accounts', hint: 'every company, any stage' },
  { href: '/accounts/health', label: 'Health', hint: 'volumes by line and month' },
  { href: '/accounts/tasks', label: 'Tasks', hint: 'what is committed to' },
  { href: '/accounts/cross-sell', label: 'Not activated', hint: 'lines never ordered' },
] as const;

export function AccountsTabs({ active }: { active: string }) {
  return (
    <div className="flex items-center gap-1 border-b border-ink-200 mb-5 overflow-x-auto">
      {TABS.map((t) => {
        const on = t.href === active;
        return (
          <Link key={t.href} href={t.href} title={t.hint}
                aria-current={on ? 'page' : undefined}
                className={`px-3 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                  on ? 'border-brand-600 text-ink-900'
                     : 'border-transparent text-ink-500 hover:text-ink-800'}`}>
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
