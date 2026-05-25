'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { X, Filter } from 'lucide-react';
import { LENS_OPTIONS } from '@/lib/coverage';

function LensChipInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Lens param can be `lens` (new shared name) or `lb_lens` (legacy from home leaderboard).
  const lensKey = searchParams.get('lens') ?? searchParams.get('lb_lens') ?? 'ANY';
  if (lensKey === 'ANY' || !lensKey) return null;

  const opt = LENS_OPTIONS.find((o) => o.key === lensKey);
  if (!opt) return null;

  // Build "clear" URL — keep all other params, drop only the lens keys.
  const params = new URLSearchParams(searchParams.toString());
  params.delete('lens');
  params.delete('lb_lens');
  const qs = params.toString();
  const clearHref = qs ? `${pathname}?${qs}` : pathname;

  return (
    <span className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full bg-brand-50 border border-brand-100 text-[11px] font-medium text-brand-500 transition hover:bg-brand-100">
      <Filter className="w-3 h-3" strokeWidth={2.5} />
      <span className="max-w-[180px] truncate" title={`Active lens: ${opt.label}`}>{opt.label}</span>
      <Link
        href={clearHref}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full text-brand-500 hover:bg-brand-200/40 transition"
        title="Clear lens"
        aria-label="Clear lens"
      >
        <X className="w-3 h-3" strokeWidth={2.5} />
      </Link>
    </span>
  );
}

export function LensChip() {
  // Wrap in Suspense so useSearchParams doesn't bail static render at build time.
  return (
    <Suspense fallback={null}>
      <LensChipInner />
    </Suspense>
  );
}
