import Link from 'next/link';

/**
 * The catalogue has two entry points, because a conversation starts from one of
 * two places: a buyer ("what have we got for nutrition") or a named test ("do
 * we do HbA1c, and where"). Rate lookup and quote modelling are a separate
 * feature — this is browse, not quote — so the link out is a hand-off, not a
 * third tab.
 */
const TABS = [
  { href: '/catalogue', label: 'Packages' },
  { href: '/catalogue/tests', label: 'Tests' },
] as const;

export function CatalogueTabs({ active }: { active: '/catalogue' | '/catalogue/tests' }) {
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
      <Link href="/pricing" className="ml-auto px-3 py-2 text-xs text-ink-500 hover:text-ink-900">
        Build a quote →
      </Link>
    </div>
  );
}
