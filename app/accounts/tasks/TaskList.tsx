'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { toggleTask } from '../actions';
import type { AccountTask } from '@/lib/accountHealth';

const REPEAT_LABEL: Record<string, string> = { monthly: 'monthly', quarterly: 'quarterly' };

export function TaskRow({ t, canEdit }: { t: AccountTask; canEdit: boolean }) {
  const [pending, start] = useTransition();
  return (
    <div className={`flex items-start gap-3 px-4 py-3 border-b border-ink-100 last:border-0
                     ${pending ? 'opacity-60' : ''}`}>
      <input
        type="checkbox"
        checked={!!t.done_at}
        disabled={!canEdit || pending}
        aria-label={t.done_at ? `Reopen ${t.title}` : `Complete ${t.title}`}
        onChange={(e) => start(async () => {
          await toggleTask({ taskId: t.id, done: e.target.checked });
        })}
        className="mt-0.5 w-[15px] h-[15px] accent-brand-600 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className={`text-[13px] ${t.done_at ? 'text-ink-400 line-through' : 'font-medium text-ink-900'}`}>
          {t.title}
        </div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          <Link href={`/accounts/${t.store_id}`} className="hover:text-brand-600">
            {t.store_name ?? `Store ${t.store_id}`}
          </Link>
          {t.assignee_name ? ` · ${t.assignee_name}` : ''}
          {t.due_on ? ` · due ${t.due_on}` : ''}
        </div>
        {t.detail && <p className="text-[12px] text-ink-600 mt-1 whitespace-pre-line">{t.detail}</p>}
      </div>
      {t.repeat_every !== 'none' && (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-brand-100
                         bg-brand-50 text-brand-700 shrink-0">
          {REPEAT_LABEL[t.repeat_every]}
        </span>
      )}
      {t.late && !t.done_at && (
        <span className="text-[11px] font-bold text-danger-500 shrink-0">late</span>
      )}
    </div>
  );
}
