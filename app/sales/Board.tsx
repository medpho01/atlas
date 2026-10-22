'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { AlertTriangle } from 'lucide-react';
import { moveDeal } from './actions';
import type { Deal, Stage } from '@/lib/salesCrm';

const inr = (v: string | null) => {
  if (v == null) return '—';
  const n = Number(v);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${n.toLocaleString('en-IN')}`;
};

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/**
 * The board.
 *
 * Moving a deal is a select, not a drag. Drag-and-drop on a board this wide
 * means horizontal auto-scroll while holding a card, which is miserable on a
 * laptop trackpad and impossible on a phone — and winning a deal has to ask a
 * question anyway, which a drop cannot.
 */
export function Board({
  stages, deals, canEdit,
}: {
  stages: Stage[];
  deals: Deal[];
  canEdit: boolean;
}) {
  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-3 min-w-[1100px]">
        {stages.map((st) => {
          const inStage = deals.filter((d) => d.stage_key === st.key);
          const total = inStage.reduce((a, d) => a + Number(d.value_inr ?? 0), 0);
          const bar = st.outcome === 'won' ? 'border-success-600'
            : st.outcome === 'lost' ? 'border-danger-500' : 'border-brand-600';
          return (
            <div key={st.key} className="flex-1 min-w-[218px]">
              <div className={`flex items-center gap-2 pb-2 border-b-2 ${bar}`}>
                <span className="text-[12px] font-bold text-ink-900">{st.label}</span>
                <span className="text-[11px] font-semibold text-ink-500">{inStage.length}</span>
                <span className="ml-auto text-[11px] text-ink-500 num">
                  {inr(String(total))}
                </span>
              </div>
              <div className="flex flex-col gap-2 mt-2.5">
                {inStage.map((d) => (
                  <Card key={d.deal_id} deal={d} stages={stages} canEdit={canEdit} />
                ))}
                {inStage.length === 0 && (
                  <p className="text-[11px] text-ink-400 px-1 py-3">Nothing here.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ deal, stages, canEdit }: { deal: Deal; stages: Stage[]; canEdit: boolean }) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const move = (key: string) => {
    const to = stages.find((s) => s.key === key);
    if (!to) return;
    // Winning asks which store it became, and lost asks why. Neither question
    // fits on a card, so both send you to the deal where the answer lives.
    if (to.outcome !== 'open') { window.location.href = `/sales/${deal.deal_id}?close=${key}`; return; }
    setErr(null);
    start(async () => {
      const r = await moveDeal({ dealId: deal.deal_id, stageKey: key });
      if (!r.ok) setErr(r.error ?? 'Could not move it');
    });
  };

  const border = deal.is_stuck ? 'border-warn-500' : 'border-ink-200';

  return (
    <div className={`rounded-lg border ${border} bg-surface p-3 ${pending ? 'opacity-60' : ''}`}>
      <Link href={`/sales/${deal.deal_id}`} className="block">
        <div className="text-[13px] font-bold text-ink-900">{deal.company}</div>
        <div className="text-[11px] text-ink-500 mt-0.5">
          {[deal.city, deal.source].filter(Boolean).join(' · ') || 'No location yet'}
        </div>

        {(deal.tags.length > 0 || deal.value_inr) && (
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            {deal.tags.slice(0, 2).map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-px rounded-full bg-brand-50 text-brand-700 border border-brand-100">
                {t}
              </span>
            ))}
            <span className="ml-auto text-[12px] font-bold text-ink-900 num">{inr(deal.value_inr)}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 mt-2.5 pt-2.5 border-t border-ink-100">
          <span className="w-5 h-5 rounded-full bg-brand-50 text-brand-700 text-[9px] font-bold flex items-center justify-center shrink-0">
            {deal.owner_name ? initials(deal.owner_name) : '—'}
          </span>
          {deal.next_task ? (
            <span className={`text-[11px] truncate ${deal.next_task_late ? 'text-danger-500 font-semibold' : 'text-ink-600'}`}>
              {deal.next_task}
            </span>
          ) : (
            <span className="text-[11px] text-ink-400">No next step</span>
          )}
          {deal.is_stuck && (
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-warn-600 font-semibold shrink-0"
                  title={`Nothing logged for ${deal.days_quiet} days`}>
              <AlertTriangle className="w-3 h-3" /> {deal.days_quiet}d
            </span>
          )}
        </div>

        {deal.store_name && (
          <div className="mt-2 pt-2 border-t border-ink-100 text-[11px] text-success-600">
            Live as {deal.store_name}
          </div>
        )}
      </Link>

      {canEdit && (
        <select
          aria-label={`Move ${deal.company} to another stage`}
          value={deal.stage_key}
          disabled={pending}
          onChange={(e) => move(e.target.value)}
          className="mt-2.5 w-full text-[11px] rounded-md border border-ink-200 bg-surface px-2 py-1 text-ink-600"
        >
          {stages.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      )}
      {err && <p className="text-[10px] text-danger-500 mt-1 leading-tight">{err}</p>}
    </div>
  );
}
