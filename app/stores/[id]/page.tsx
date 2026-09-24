import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  Store as StoreIcon, Phone, Mail, MapPin, History, AlertTriangle, Download,
} from 'lucide-react';
import { requireView } from '@/lib/guard';
import { canManage } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { ChipButton } from '@/components/ui/Toggle';
import { InfoTip } from '@/components/ui/InfoTip';
import { Pager } from '@/components/ui/Pager';
import {
  STAGES, STAGE_LABEL, STAGE_BLURB, STAGE_TONE, TONE_BAR,
  humanHours, pct, shortDate, isStage, type Stage,
} from '@/lib/stores';
import {
  getStoreDetail, getStoreOrders, countStoreOrders, getStageFacets,
  getStoreTrend, getStoreChangeLog, getOpsOwners,
} from '@/lib/storeOrders';
import { OrdersTable } from './OrdersTable';
import { StoreProfileForm } from './StoreProfileForm';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

type SP = {
  stage?: string; q?: string; from?: string; to?: string;
  delayed?: string; flagged?: string; page?: string; tab?: string;
};

export default async function StorePage({
  params, searchParams,
}: { params: { id: string }; searchParams: SP }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const gate = await requireView('storeOrders', `/stores/${id}`);
  if (gate.blocked) {
    return <RoleBlocked area="Stores & Orders" detail="accounts, network, operations and admin" />;
  }

  const stage: Stage | undefined = isStage(searchParams.stage) ? searchParams.stage : undefined;
  const delayedOnly = searchParams.delayed === '1';
  const flaggedOnly = searchParams.flagged === '1';
  const requestedPage = Math.max(1, Math.floor(Number(searchParams.page)) || 1);
  const showLog = searchParams.tab === 'log';

  const f = {
    q: searchParams.q?.trim() || undefined,
    stage,
    from: searchParams.from || undefined,
    to: searchParams.to || undefined,
    delayedOnly,
    flaggedOnly,
  };

  // The store's own figures are lifetime, not windowed: this page is about one
  // partner and the question here is "what does their whole book look like",
  // not "how do they compare to another". The table below is where a window
  // belongs, and it has one.
  // The count first, so the page number can be clamped to a page that exists.
  // Asking for ?page=9999 used to render an empty table under a pager reading
  // "Page 9999 of 23" — which says the filter found nothing, when what happened
  // is that the URL was stale or somebody typed it. It costs one extra round
  // trip on a query that runs in two milliseconds.
  const matching = await countStoreOrders(id, f);
  const lastPage = Math.max(1, Math.ceil(matching / PAGE_SIZE));
  const page = Math.min(requestedPage, lastPage);

  const [store, rows, facets, trend, log, owners] = await Promise.all([
    getStoreDetail(id),
    getStoreOrders(id, { ...f, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    getStageFacets(id, f),
    getStoreTrend(id, 6),
    showLog ? getStoreChangeLog(id) : Promise.resolve([]),
    getOpsOwners(),
  ]);
  const total = matching;

  if (!store) notFound();

  const canEdit = canManage(gate.user, 'storeOrders');
  const isAdmin = gate.user?.role === 'admin';

  /** Every link drops `page` except the pager — see the note on /stores. */
  const link = (patch: Partial<SP>) => {
    const merged: SP = {
      stage: searchParams.stage, q: searchParams.q,
      from: searchParams.from, to: searchParams.to,
      delayed: delayedOnly ? '1' : undefined,
      flagged: flaggedOnly ? '1' : undefined,
      tab: searchParams.tab,
      ...patch,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
    const q = p.toString();
    return `/stores/${id}${q ? `?${q}` : ''}`;
  };

  const hrefForPage = (n: number) => {
    const base = link({});
    const sep = base.includes('?') ? '&' : '?';
    return n <= 1 ? base : `${base}${sep}page=${n}`;
  };

  // The export carries the filters, so what downloads is what is on screen.
  const exportParams = new URLSearchParams();
  if (f.q) exportParams.set('q', f.q);
  if (stage) exportParams.set('stage', stage);
  if (f.from) exportParams.set('from', f.from);
  if (f.to) exportParams.set('to', f.to);
  if (delayedOnly) exportParams.set('delayed', '1');
  if (flaggedOnly) exportParams.set('flagged', '1');
  const exportHref = `/api/stores/${id}/export${exportParams.toString() ? `?${exportParams}` : ''}`;

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto">
      <PageHeader
        title={store.name}
        subtitle={[store.legal_name, store.store_type?.toLowerCase()].filter(Boolean).join(' · ')}
        breadcrumbs={[
          { label: 'Fulfilment' },
          { label: 'Stores & Orders', href: '/stores' },
          { label: store.name },
        ]}
        actions={
          <>
            {!store.active && (
              <span className="text-[11px] uppercase tracking-wide rounded border
                               border-ink-200 bg-ink-100 text-ink-500 px-2 py-1">
                Closed in LabStack
              </span>
            )}
            <a
              href={exportHref}
              className="inline-flex items-center gap-1.5 rounded-md border border-ink-200
                         px-2.5 py-1 text-xs font-medium text-ink-700 hover:bg-ink-100"
            >
              <Download className="w-3.5 h-3.5" />
              Export {total.toLocaleString('en-IN')} as CSV
            </a>
          </>
        }
      />

      {/* Who this partner is, and how to reach them. Straight off the console
          record, with the Atlas-side contact beside it where one has been set
          — the console's is often a head-office number nobody answers. */}
      <div className="grid gap-4 lg:grid-cols-3 mt-5">
        <Card className="lg:col-span-2">
          <CardHeader
            title="The account"
            subtitle="From LabStack, with what Atlas knows beside it."
            icon={<StoreIcon className="w-4 h-4" strokeWidth={2.25} />}
          />
          <CardBody className="pt-0">
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 text-[13px]">
              <Field label="Where">
                <span className="inline-flex items-start gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-ink-400 mt-px shrink-0" />
                  <span>
                    {[store.address, store.city, store.state].filter(Boolean).join(', ') || '—'}
                    {store.pincode && <span className="num text-ink-500"> {store.pincode}</span>}
                  </span>
                </span>
              </Field>
              <Field label="Console contact">
                {store.poc_name || store.poc_phone || store.poc_email ? (
                  <span>
                    {store.poc_name ?? '—'}
                    {store.poc_phone && (
                      <a href={`tel:${store.poc_phone}`}
                         className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:underline">
                        <Phone className="w-3 h-3" />{store.poc_phone}
                      </a>
                    )}
                    {store.poc_email && (
                      <a href={`mailto:${store.poc_email}`}
                         className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:underline">
                        <Mail className="w-3 h-3" />{store.poc_email}
                      </a>
                    )}
                  </span>
                ) : <span className="text-ink-400">None on the store record</span>}
              </Field>
              <Field label="Account owner">
                {store.ops_owner_name ?? <span className="text-ink-400">Nobody yet</span>}
              </Field>
              <Field label="Who to ring">
                {store.ops_contact_name || store.ops_contact_phone ? (
                  <span>
                    {store.ops_contact_name ?? '—'}
                    {store.ops_contact_phone && (
                      <a href={`tel:${store.ops_contact_phone}`}
                         className="ml-2 inline-flex items-center gap-1 text-brand-600 hover:underline">
                        <Phone className="w-3 h-3" />{store.ops_contact_phone}
                      </a>
                    )}
                  </span>
                ) : <span className="text-ink-400">Not set</span>}
              </Field>
              <Field label="In the requests queue">
                {store.tracked ? 'Yes' : <span className="text-warn-600">No — its requests are hidden</span>}
              </Field>
              <Field label="On the API">{store.api_enabled ? 'Yes' : 'No'}</Field>
              {store.coverage_note && (
                <div className="sm:col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-ink-400">Note</dt>
                  <dd className="text-ink-700 mt-0.5 whitespace-pre-wrap">{store.coverage_note}</dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Lifetime"
            subtitle="Every order this partner has ever sent."
            info={
              <InfoTip
                title="Store analytics"
                shows="Volume, speed and failure rate across the store's whole book."
                computed={
                  <>
                    Turnaround is from the order being taken to the report being delivered, and
                    only completed orders count — an unfinished one has no turnaround yet, and
                    averaging in its age would report a number that means nothing. The median
                    is beside the mean because one nine-day order moves the mean and not the
                    median. Cancellation rate is over every order, not only finished ones.
                  </>
                }
                drives="A partner whose rate is climbing, or whose turnaround has slipped, is a conversation to have before they start one."
              />
            }
          />
          <CardBody className="pt-0">
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Stat n={store.total.toLocaleString('en-IN')} label="orders" />
              <Stat
                n={pct(store.cancellation_rate)}
                label="cancelled"
                tone={(store.cancellation_rate ?? 0) >= 0.2 ? 'bad' : undefined}
              />
              <Stat n={humanHours(store.avg_turnaround_hours)} label="mean turnaround" />
              <Stat n={humanHours(store.median_turnaround_hours)} label="median turnaround" />
              <Stat
                n={store.delayed.toLocaleString('en-IN')}
                label="past the promise"
                tone={store.delayed > 0 ? 'bad' : undefined}
              />
              <Stat
                n={store.flagged.toLocaleString('en-IN')}
                label="need a new date"
                tone={store.flagged > 0 ? 'warn' : undefined}
              />
            </div>
            <p className="text-[11px] text-ink-500 mt-4 pt-3 border-t border-ink-100">
              First order {shortDate(store.created_at)} · last {shortDate(store.last_order_at)}.
              Delayed means more than {store.delay_alert_hours}h past the appointment and still
              unfinished.
            </p>
            {trend.length > 1 && <Trend rows={trend} />}
          </CardBody>
        </Card>
      </div>

      {/* Stage tabs. The counts ignore the stage filter and respect every
          other one, so choosing a stage does not make the rest read zero. */}
      <div className="flex flex-wrap gap-1 mt-6 border-b border-ink-200">
        <StageTab href={link({ stage: undefined })} active={!stage}
                  label="All" n={facets.all} tone="ink" />
        {STAGES.map((k) => (
          <StageTab
            key={k}
            href={link({ stage: k })}
            active={stage === k}
            label={STAGE_LABEL[k]}
            title={STAGE_BLURB[k]}
            n={facets[k]}
            tone={STAGE_TONE[k]}
          />
        ))}
      </div>

      <div className="my-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg
                      border border-ink-200 bg-surface px-4 py-2.5">
        <form action={`/stores/${id}`} method="get" role="search"
              className="flex items-center gap-1.5">
          {stage && <input type="hidden" name="stage" value={stage} />}
          {f.from && <input type="hidden" name="from" value={f.from} />}
          {f.to && <input type="hidden" name="to" value={f.to} />}
          {delayedOnly && <input type="hidden" name="delayed" value="1" />}
          {flaggedOnly && <input type="hidden" name="flagged" value="1" />}
          <label className="flex items-center gap-1.5 rounded-md border border-ink-200
                            bg-surface px-2 py-1 focus-within:border-brand-500">
            <span className="sr-only">Find an order</span>
            <input
              name="q"
              defaultValue={searchParams.q ?? ''}
              placeholder="Patient, reference, order id, phlebo"
              className="w-[230px] bg-transparent text-[12px] text-ink-900
                         placeholder:text-ink-400 outline-none"
            />
          </label>
          <button type="submit"
                  className="rounded-md border border-ink-200 px-2.5 py-1 text-[12px]
                             font-medium text-ink-700 hover:bg-ink-100">
            Search
          </button>
        </form>

        <span className="w-px h-5 bg-ink-200" />

        {/* Dates as a real date input, because "orders on the 3rd" is the
            commonest question a partner asks and a preset cannot answer it. */}
        <form action={`/stores/${id}`} method="get"
              className="flex items-center gap-1.5 text-[12px]">
          {stage && <input type="hidden" name="stage" value={stage} />}
          {f.q && <input type="hidden" name="q" value={f.q} />}
          {delayedOnly && <input type="hidden" name="delayed" value="1" />}
          {flaggedOnly && <input type="hidden" name="flagged" value="1" />}
          <span className="text-[11px] uppercase tracking-wide text-ink-400">Appointment</span>
          <label className="sr-only" htmlFor="from">From</label>
          <input id="from" type="date" name="from" defaultValue={f.from ?? ''}
                 className="rounded-md border border-ink-200 bg-surface px-1.5 py-1
                            text-[12px] text-ink-900" />
          <span className="text-ink-400">→</span>
          <label className="sr-only" htmlFor="to">To</label>
          <input id="to" type="date" name="to" defaultValue={f.to ?? ''}
                 className="rounded-md border border-ink-200 bg-surface px-1.5 py-1
                            text-[12px] text-ink-900" />
          <button type="submit"
                  className="rounded-md border border-ink-200 px-2.5 py-1 text-[12px]
                             font-medium text-ink-700 hover:bg-ink-100">
            Apply
          </button>
          {(f.from || f.to) && (
            <Link href={link({ from: undefined, to: undefined })}
                  className="text-[11px] text-ink-500 hover:underline">
              Clear
            </Link>
          )}
        </form>

        <span className="w-px h-5 bg-ink-200" />

        <div className="flex items-center gap-1.5">
          <ChipButton href={link({ delayed: delayedOnly ? undefined : '1' })} active={delayedOnly}>
            Past the promise{store.delayed > 0 ? ` (${store.delayed})` : ''}
          </ChipButton>
          <ChipButton href={link({ flagged: flaggedOnly ? undefined : '1' })} active={flaggedOnly}>
            Needs a new date{store.flagged > 0 ? ` (${store.flagged})` : ''}
          </ChipButton>
        </div>
      </div>

      <Card>
        <CardBody className="pt-4 px-0">
          <OrdersTable
            storeId={id}
            rows={rows}
            canEdit={canEdit}
            pageSize={PAGE_SIZE}
          />
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={total}
            shown={rows.length}
            hrefForPage={hrefForPage}
            unit="orders"
          />
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2 mt-6">
        <StoreProfileForm
          storeId={id}
          canEdit={canEdit}
          isAdmin={isAdmin}
          owners={owners}
          initial={{
            ops_owner_id: store.ops_owner_id,
            ops_contact_name: store.ops_contact_name ?? '',
            ops_contact_phone: store.ops_contact_phone ?? '',
            ops_contact_email: store.ops_contact_email ?? '',
            coverage_note: store.coverage_note ?? '',
            delay_alert_hours: store.delay_alert_hours,
            pending_alert_count: store.pending_alert_count,
          }}
          tracked={store.tracked}
          updatedAt={store.profile_updated_at}
          updatedBy={store.profile_updated_by}
        />

        <Card>
          <CardHeader
            title="What changed"
            subtitle="Every Atlas-side change to this store, newest first."
            icon={<History className="w-4 h-4" strokeWidth={2.25} />}
            actions={
              showLog
                ? <Link href={link({ tab: undefined })}
                        className="text-[12px] text-ink-500 hover:underline">Hide</Link>
                : <Link href={link({ tab: 'log' })}
                        className="text-[12px] text-brand-600 hover:underline">Show the log</Link>
            }
          />
          <CardBody className="pt-0">
            {!showLog ? (
              <p className="text-[12px] text-ink-500">
                Loaded on request — it is a query nobody needs on every visit.
              </p>
            ) : log.length === 0 ? (
              <p className="text-[12px] text-ink-500">
                Nothing has been changed about this store from Atlas.
              </p>
            ) : (
              <ol className="space-y-2.5">
                {log.map((e) => (
                  <li key={e.id} className="text-[12px] border-l-2 border-ink-200 pl-3">
                    <p className="text-ink-900">{e.summary}</p>
                    <p className="text-[11px] text-ink-500 mt-0.5">
                      {e.actor_name ?? 'A deleted user'} ·{' '}
                      {new Date(e.ts).toLocaleString('en-IN', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: false,
                      })}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>

      <p className="text-[11px] text-ink-400 mt-4 flex items-start gap-1.5 max-w-3xl">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
        <span>
          The store record above and every order below belong to LabStack. Atlas reads them and
          never writes them, so changing an address, closing a partner or moving an appointment
          happens in the console. What is editable here is the account overlay, the reschedule
          flags and the requests-queue switch.
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="text-ink-700 mt-0.5">{children}</dd>
    </div>
  );
}

function Stat({ n, label, tone }: { n: string; label: string; tone?: 'bad' | 'warn' }) {
  const colour = tone === 'bad' ? 'text-danger-500' : tone === 'warn' ? 'text-warn-600' : 'text-ink-900';
  return (
    <div>
      <div className={`text-xl font-bold num ${colour}`}>{n}</div>
      <div className="text-[11px] text-ink-500 mt-0.5">{label}</div>
    </div>
  );
}

function StageTab({
  href, active, label, n, tone, title,
}: {
  href: string; active: boolean; label: string; n: number;
  tone: 'ink' | 'brand' | 'warn' | 'good' | 'bad'; title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={`flex items-center gap-2 px-3.5 py-2 -mb-px border-b-[3px] transition-colors
                  ${active ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-500 hover:text-ink-800'}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? TONE_BAR[tone] : 'bg-ink-300'}`} />
      <span className={`text-[13px] ${active ? 'font-bold' : 'font-medium'}`}>{label}</span>
      <span className={`text-[11px] font-bold rounded-full px-1.5 py-0.5 num
                        ${active ? 'bg-ink-900 text-white' : 'bg-ink-100 text-ink-500'}`}>
        {n}
      </span>
    </Link>
  );
}

/**
 * Six months of volume as bars.
 *
 * Not a chart library for six numbers. What it has to show is whether the
 * partner is growing, flat or going quiet, and a row of bars does that at the
 * size it is given.
 */
function Trend({
  rows,
}: { rows: { month: string; total: number; cancelled: number }[] }) {
  const peak = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="mt-4 pt-3 border-t border-ink-100">
      <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-2">Last 6 months</p>
      <div className="flex items-end gap-1.5 h-16">
        {rows.map((r) => (
          <div key={r.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div
              className="w-full bg-brand-500 rounded-t-sm relative"
              style={{ height: `${Math.max((r.total / peak) * 100, 3)}%` }}
              title={`${r.month}: ${r.total} orders, ${r.cancelled} cancelled`}
            >
              {r.cancelled > 0 && (
                <div
                  className="absolute bottom-0 left-0 right-0 bg-danger-500 rounded-b-sm"
                  style={{ height: `${(r.cancelled / r.total) * 100}%` }}
                />
              )}
            </div>
            <span className="text-[9px] text-ink-400 truncate w-full text-center">
              {r.month.slice(5)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
