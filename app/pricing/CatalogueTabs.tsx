import Link from 'next/link';

/**
 * Packages & Pricing has two jobs that pull in opposite directions: browsing
 * what we already sell, and looking up what a specific test costs where. Tabs
 * rather than one screen, because a rate lookup starts from a test name and a
 * package conversation starts from a buyer.
 */
const TABS = [
  { href: '/pricing/packages', label: 'Packages' },
  { href: '/pricing/tests', label: 'Tests' },
  { href: '/pricing', label: 'Rate lookup' },
] as const;

export function CatalogueTabs({ active }: { active: '/pricing' | '/pricing/packages' | '/pricing/tests' }) {
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
