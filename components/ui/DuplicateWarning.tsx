'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { checkDuplicate } from '@/app/accounts/lifecycleActions';

type Match = {
  account_id: number; name: string; city: string | null;
  lifecycle: string; owner: string | null; deal_id: number | null;
};

const STAGE_WORD: Record<string, string> = {
  sales: 'in the sales funnel', onboarding: 'onboarding', managed: 'a live account',
  churned: 'churned', lost: 'a lost deal',
};

/**
 * What is already on the book under this name.
 *
 * Shown while the name is being typed rather than refused on submit: the
 * person typing is the only one who knows whether "Alliance Insurance" and
 * "Alliance Insurance Pvt Ltd" are the same company, so this hands them the
 * existing row and lets them decide.
 */
export function DuplicateWarning({ name }: { name: string }) {
  const [matches, setMatches] = useState<Match[]>([]);

  useEffect(() => {
    const q = name.trim();
    if (q.length < 3) { setMatches([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const rows = await checkDuplicate(q);
        if (live) setMatches(rows as Match[]);
      } catch { /* a failed lookup must never block typing */ }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [name]);

  if (matches.length === 0) return null;

  return (
    <div className="rounded-lg border border-warn-100 bg-warn-50 px-3 py-2.5">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-warn-600">
        Already on the book
      </div>
      <div className="mt-1.5 space-y-1.5">
        {matches.map((m) => (
          <div key={m.account_id} className="text-[12px] text-ink-700">
            <Link href={`/accounts/${m.account_id}`}
                  className="font-semibold text-ink-900 hover:text-brand-400">
              {m.name}
            </Link>
            <span className="text-ink-500">
              {' — '}{STAGE_WORD[m.lifecycle] ?? m.lifecycle}
              {m.city && `, ${m.city}`}
              {m.owner && `, ${m.owner}`}
            </span>
            {m.deal_id && (
              <Link href={`/sales/${m.deal_id}`} className="ml-2 text-brand-400 hover:underline">
                open the deal
              </Link>
            )}
          </div>
        ))}
      </div>
      <p className="text-[10px] text-ink-500 mt-1.5">
        Carry on if this is a different company — nothing is blocked.
      </p>
    </div>
  );
}
