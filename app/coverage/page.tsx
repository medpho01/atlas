import { FileSearch } from 'lucide-react';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { CoverageClient } from './CoverageClient';

export const dynamic = 'force-dynamic';

export default async function CoveragePage() {
  const gate = await requireView('coverage', '/coverage');
  if (gate.blocked) return <RoleBlocked area="Coverage" detail="every signed-in role" />;

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <FileSearch className="w-5 h-5 text-brand-600" />
        <h1 className="text-2xl font-bold text-ink-900">Serviceability check</h1>
      </div>
      <p className="text-sm text-ink-600 mb-6 max-w-3xl">
        Upload an Excel or CSV of pincodes (or paste them) and get the available network at each —
        Center Visit within 10 km and Home Sample Collection — with the nearest labs named.
        Download the result as Excel to share.
      </p>
      <CoverageClient />
    </main>
  );
}
