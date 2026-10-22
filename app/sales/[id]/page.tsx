import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import {
  getDeal, getNotes, getTasks, getPipeline, getAssignableUsers, getUnlinkedStores,
} from '@/lib/salesCrm';
import { Composer, Tasks, Tags, Owner, CloseDeal, DealFields, Activity } from './DealClient';

export const dynamic = 'force-dynamic';

const inr = (v: string | null) =>
  v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`;

export default async function DealPage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { close?: string };
}) {
  const gate = await requireView('salesCrm', `/sales/${params.id}`);
  if (gate.blocked) return <RoleBlocked area="Sales CRM" detail="sales, accounts and admin" />;

  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const deal = await getDeal(id);
  if (!deal) notFound();

  const canEdit = canManage(gate.user, 'salesCrm');
  const [notes, tasks, pipeline, people, stores] = await Promise.all([
    getNotes(id), getTasks(id), getPipeline(), getAssignableUsers(),
    canEdit ? getUnlinkedStores('') : Promise.resolve([]),
  ]);

  const stages = pipeline?.stages ?? [];
  const idx = stages.findIndex((s) => s.key === deal.stage_key);

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1500px] mx-auto">
      <div className="text-[13px] text-ink-500">
        <Link href="/sales" className="hover:text-ink-900">Sales CRM</Link>
        <span className="text-ink-300"> / </span>
        <span className="font-semibold text-ink-900">{deal.company}</span>
      </div>

      <div className="flex flex-wrap gap-5 mt-5 items-start">
        {/* main */}
        <div className="flex-[999_1_600px] min-w-0 flex flex-col gap-4">
          <div className="rounded-xl border border-ink-200 bg-surface p-5">
            <div className="flex flex-wrap items-start gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-[22px] font-extrabold tracking-tight text-ink-900">{deal.company}</h1>
                  {deal.store_id ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success-50 text-success-600 border border-success-100">
                      Live as {deal.store_name ?? `store ${deal.store_id}`}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100">
                      Prospective store
                    </span>
                  )}
                  {deal.is_stuck && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-warn-50 text-warn-600 border border-warn-100">
                      Nothing logged for {deal.days_quiet} days
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-ink-500 mt-1">
                  {[deal.city, deal.website, deal.source && `via ${deal.source}`].filter(Boolean).join(' · ') || 'No details yet'}
                </p>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[10px] uppercase tracking-wide text-ink-400">Deal value</div>
                <div className="text-[24px] font-extrabold num text-ink-900">{inr(deal.value_inr)}</div>
                <div className="text-[11px] text-ink-500">
                  {deal.expected_close ? `expected close ${deal.expected_close}` : 'no close date'}
                </div>
              </div>
            </div>

            <div className="flex gap-1 mt-5">
              {stages.map((s, i) => (
                <div key={s.key}
                     className={`flex-1 h-[5px] rounded-full ${
                       i <= idx && idx >= 0
                         ? (deal.stage_outcome === 'lost' ? 'bg-danger-500'
                            : deal.stage_outcome === 'won' ? 'bg-success-600' : 'bg-brand-600')
                         : 'bg-ink-150'}`} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <span className="text-[11px] text-ink-500">Stage</span>
              <span className="text-[12px] font-semibold px-3 py-1 rounded-md bg-brand-600 text-white">
                {deal.stage_label ?? deal.stage_key}
              </span>
              <span className="text-[11px] text-ink-500">
                {deal.days_in_stage} days in stage · {deal.stage_probability ?? 0}% probability
              </span>
              {deal.lost_reason && (
                <span className="text-[11px] text-danger-500 font-medium">Lost: {deal.lost_reason}</span>
              )}
            </div>
          </div>

          <Composer dealId={deal.deal_id} canEdit={canEdit} />
          <Activity notes={notes} />
        </div>

        {/* side */}
        <div className="flex-[1_1_320px] min-w-[300px] flex flex-col gap-3.5">
          <Owner dealId={deal.deal_id} ownerId={deal.owner_id} ownerName={deal.owner_name}
                 people={people} canEdit={canEdit} />
          <Tasks dealId={deal.deal_id} tasks={tasks} people={people} meId={gate.user.id} canEdit={canEdit} />
          <Tags dealId={deal.deal_id} tags={deal.tags} canEdit={canEdit} />
          <CloseDeal deal={deal} stages={stages} stores={stores}
                     preselect={searchParams.close ?? null} canEdit={canEdit} />
          <DealFields deal={deal} canEdit={canEdit} />

          {deal.store_id ? (
            <div className="rounded-xl border border-success-100 bg-success-50 p-4">
              <div className="text-[10px] uppercase tracking-wide text-success-600">Signed</div>
              <p className="text-[12px] text-ink-700 leading-relaxed mt-2">
                What this account actually sends is in Stores &amp; Orders now, not retyped here.
              </p>
              <Link href={`/stores/${deal.store_id}`} className="text-[12px] text-brand-600 font-medium mt-2 inline-block">
                Open {deal.store_name ?? 'the store'} →
              </Link>
            </div>
          ) : (
            <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
              <div className="text-[10px] uppercase tracking-wide text-brand-700">If this is won</div>
              <p className="text-[12px] text-ink-700 leading-relaxed mt-2">
                Closing it links the deal to the LabStack store it became. From then on the
                account&rsquo;s real behaviour — requests, orders, turnaround — is read from
                Stores &amp; Orders rather than kept here.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
