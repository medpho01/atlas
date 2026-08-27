import Link from 'next/link';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { Store } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { InfoTip } from '@/components/ui/InfoTip';
import { getStoreSettings } from '@/lib/requestQueries';
import { StoreToggle } from './StoreToggle';

export const dynamic = 'force-dynamic';

export default async function StoreSettingsPage() {
  const gate = await requireView('coverage', '/settings/stores');
  if (gate.blocked) return <RoleBlocked area="Settings" detail="every signed-in role" />;

  const stores = await getStoreSettings();
  const tracked = stores.filter((s) => s.tracked);
  const hiddenOpen = stores.filter((s) => !s.tracked).reduce((n, s) => n + s.open_requests, 0);

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1100px] mx-auto">
      <PageHeader
        title="Stores"
        subtitle="Which partners the requests queue is for."
        actions={
          <InfoTip
            title="Tracked stores"
            shows="Every store that has ever sent a request, and whether the queue includes it."
            computed={
              <>
                A store not in this table counts as tracked, so a new partner appears on its own
                rather than needing to be switched on. Turning one off hides its requests and its
                filter chip — nothing is deleted, and the queue always says how many are hidden.
              </>
            }
            drives="Use it to keep the queue to the partners someone is actually working. Everything else stays available behind the count."
          />
        }
      />

      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2 my-4">
        <div>
          <div className="text-2xl font-bold text-ink-900 num">{tracked.length}</div>
          <div className="text-[11px] text-ink-500 mt-0.5">tracked of {stores.length} stores</div>
        </div>
        {hiddenOpen > 0 && (
          <div>
            <div className="text-2xl font-bold num text-warn-600">
              {hiddenOpen.toLocaleString('en-IN')}
            </div>
            <div className="text-[11px] text-ink-500 mt-0.5">
              open requests hidden from the queue
            </div>
          </div>
        )}
      </div>

      <Card>
        <CardHeader
          title={`${stores.length} stores have sent requests`}
          subtitle="Busiest first. Switching one off takes effect on the queue immediately."
          icon={<Store className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          <div className="-mx-5">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-ink-400 border-b border-ink-200">
                  <th className="text-left font-medium px-5 py-2">Store</th>
                  <th className="text-right font-medium px-2 py-2">Requests</th>
                  <th className="text-right font-medium px-2 py-2">Open</th>
                  <th className="text-left font-medium px-2 py-2">Last request</th>
                  <th className="text-right font-medium px-5 py-2 w-24">Tracked</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.store_id}
                      className={`border-b border-ink-100 last:border-0 ${s.tracked ? '' : 'opacity-60'}`}>
                    <td className="px-5 py-2.5 font-medium text-ink-900">
                      {s.name}
                      <span className="block text-[10px] text-ink-400 font-normal">
                        id {s.store_id}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right num text-ink-700">
                      {s.requests.toLocaleString('en-IN')}
                    </td>
                    <td className="px-2 py-2.5 text-right num">
                      <span className={s.open_requests > 0 ? 'text-ink-900' : 'text-ink-400'}>
                        {s.open_requests.toLocaleString('en-IN')}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-xs text-ink-500">
                      {s.last_request
                        ? new Date(s.last_request).toLocaleDateString('en-IN',
                            { day: 'numeric', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <StoreToggle storeId={s.store_id} tracked={s.tracked} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <p className="text-xs text-ink-500 mt-3">
        <Link href="/requests" className="text-brand-600 hover:underline">Back to requests →</Link>
      </p>
    </div>
  );
}
