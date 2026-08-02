import { IndianRupee } from 'lucide-react';
import { redirect } from 'next/navigation';
import { PricingClient } from './PricingClient';
import { queryOne } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { canAccess } from '@/lib/access';
import { RoleBlocked } from '@/components/RoleBlocked';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const me = await getSessionUser();
  if (!me) redirect('/login?next=/pricing');
  if (!canAccess(me, 'catalogue')) {
    return <RoleBlocked area="Pricing Intelligence" detail="the network and admin teams" />;
  }

  const stats = await queryOne<{ tests: number; labs: number; rates: number }>(`
    SELECT
      (SELECT COUNT(*) FROM analytics.mv_test_catalog)::int                AS tests,
      (SELECT COUNT(DISTINCT lab_id) FROM analytics.mv_test_rates)::int    AS labs,
      (SELECT COUNT(*) FROM analytics.mv_test_rates)::int                  AS rates
  `);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <IndianRupee className="w-5 h-5 text-brand-600" />
          <h1 className="text-2xl font-bold text-ink-900">Pricing Intelligence</h1>
        </div>
        <p className="text-sm text-ink-600 max-w-3xl">
          Build a test basket from the DOS, compare MRP and B2B rates across every lab that can fulfil it,
          and model quote discounts live. Rates refresh nightly from the operational catalog —{' '}
          {stats?.tests.toLocaleString('en-IN')} tests · {stats?.labs.toLocaleString('en-IN')} labs ·{' '}
          {stats?.rates.toLocaleString('en-IN')} rate points.
        </p>
      </div>

      <PricingClient />
    </main>
  );
}
