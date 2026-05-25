import { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

type Crumb = { label: string; href?: string };

export function PageHeader({
  title,
  subtitle,
  breadcrumbs,
  actions,
}: {
  title: string;
  subtitle?: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav className="flex items-center gap-1 text-xs text-ink-500 mb-2">
          {breadcrumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {c.href ? (
                <Link href={c.href} className="hover:text-ink-800 font-medium">
                  {c.label}
                </Link>
              ) : (
                <span className="text-ink-700 font-medium">{c.label}</span>
              )}
              {i < breadcrumbs.length - 1 && <ChevronRight className="w-3 h-3 text-ink-300" />}
            </span>
          ))}
        </nav>
      )}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink-900 leading-tight">{title}</h1>
          {subtitle && <p className="text-sm text-ink-500 mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
    </div>
  );
}
