import Link from 'next/link';
import { BookOpenText, AlertTriangle } from 'lucide-react';
import { listLabs, listProviders, getDataQualityNudges } from '@/lib/queries';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl, ChipButton } from '@/components/ui/Toggle';
import { FilterBar, FilterInput, FilterSelect } from '@/components/ui/FilterBar';
import { InfoTip } from '@/components/ui/InfoTip';
import { LabsDirTable, ProvidersDirTable } from './DirectoryTables';

export const dynamic = 'force-dynamic';

type Search = { tab?: string; sub?: string; q?: string; city?: string; type?: string };

const LAB_SUB_TABS: { key: string; label: string; centerType?: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'diagnostic', label: 'Diagnostic Center', centerType: 'DIAGNOSTIC_CENTER' },
  { key: 'collection', label: 'Collection Center', centerType: 'COLLECTION_CENTER' },
  { key: 'hospital', label: 'Hospital', centerType: 'HOSPITAL' },
];

export default async function DirectoryPage({ searchParams }: { searchParams: Search }) {
  const tab = searchParams.tab ?? 'labs';
  const sub = searchParams.sub ?? 'all';
  const nudges = await getDataQualityNudges();

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto">
      <PageHeader
        title="Network Directory"
        subtitle="All labs, providers and pharmacies on the platform."
        actions={
          <div className="flex items-center gap-2">
            <InfoTip
              title="Network Directory"
              shows="The raw entity index: every Lab, Provider (Doctor/Phlebo/Nurse) and Pharmacy on the platform. The six tiles at the top are data-quality nudges — operational hygiene issues worth fixing."
              computed={
                <>
                  <strong>Labs</strong> are split by centerType (Diagnostic / Collection / Hospital) — same legal entity in Lab table, different operating mode.<br/>
                  <strong>Mass-claim labs</strong>: any lab claiming &gt;500 serviced pincodes. Likely unverified — capped in coverage rollups.<br/>
                  <strong>Bad-format pincodes</strong>: not a 6-digit numeric string. Excluded from all geo joins.
                </>
              }
              drives="Use the Quality Watchtower for performance ranking; use this page for entity lookup, fixing missing service areas, and resolving data hygiene issues flagged in the nudge tiles."
            />
            <SegmentedControl
              options={[
                { label: 'Labs', href: '/directory?tab=labs', active: tab === 'labs' },
                { label: 'Providers', href: '/directory?tab=providers', active: tab === 'providers' },
                { label: 'Pharmacy', href: '/directory?tab=pharmacy', active: tab === 'pharmacy' },
              ]}
            />
          </div>
        }
      />

      {nudges && (
        <div className="mb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          <NudgeCard label="Labs missing service area" value={nudges.labs_missing_service_area} hint="active labs with empty pincodesServiced" tone={nudges.labs_missing_service_area > 100 ? 'warn' : 'neutral'} />
          <NudgeCard label="Mass-claim labs" value={nudges.labs_mass_claim} hint="claiming >500 pincodes" tone={nudges.labs_mass_claim > 0 ? 'warn' : 'neutral'} />
          <NudgeCard label="Providers missing pincode" value={nudges.providers_missing_pincode} hint="of 290 providers" tone={nudges.providers_missing_pincode > 0 ? 'warn' : 'neutral'} />
          <NudgeCard label="Bad-format pincodes" value={nudges.bad_format_pincodes} hint="across Lab/Profile/Request" tone={nudges.bad_format_pincodes > 0 ? 'warn' : 'neutral'} />
          <NudgeCard label="Inactive labs" value={nudges.labs_inactive_but_referenced} hint="hidden from coverage" tone="neutral" />
          <NudgeCard label="Pharmacy missing pincode" value={nudges.pharmacies_missing_pincode} hint="of 1 pharmacy" tone={nudges.pharmacies_missing_pincode > 0 ? 'bad' : 'neutral'} />
        </div>
      )}

      {tab === 'labs' && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {LAB_SUB_TABS.map((s) => (
            <ChipButton key={s.key} href={`/directory?tab=labs&sub=${s.key}`} active={sub === s.key}>
              {s.label}
            </ChipButton>
          ))}
        </div>
      )}

      <div className="mb-4">
        <FilterBar
          searchName="q"
          searchPlaceholder={tab === 'providers' ? 'Search by name, pincode, city…' : 'Search labs by name, pincode, city…'}
          searchDefault={searchParams.q}
          hidden={tab === 'labs' ? { tab, sub } : { tab }}
        >
          <FilterInput name="city" defaultValue={searchParams.city} placeholder="City filter" />
          {tab === 'providers' && (
            <FilterSelect name="type" defaultValue={searchParams.type}>
              <option value="">All types</option>
              <option>Doctor</option>
              <option>Phlebotomist</option>
              <option>Nurse</option>
            </FilterSelect>
          )}
        </FilterBar>
      </div>

      <Card>
        <CardHeader
          title={tab === 'labs' ? `Labs` : tab === 'providers' ? 'Providers' : 'Pharmacy'}
          subtitle={tab === 'labs' ? 'Diagnostic centers, collection centers, hospitals' : tab === 'providers' ? 'Doctors, phlebotomists, nurses' : 'Pharmacies'}
          icon={<BookOpenText className="w-4 h-4" strokeWidth={2.25} />}
        />
        <CardBody className="pt-0">
          {tab === 'labs' && <LabsTable q={searchParams.q} city={searchParams.city} centerType={LAB_SUB_TABS.find((x) => x.key === sub)?.centerType} />}
          {tab === 'providers' && <ProvidersTable q={searchParams.q} city={searchParams.city} type={searchParams.type} />}
          {tab === 'pharmacy' && <PharmacyEmpty />}
        </CardBody>
      </Card>
    </div>
  );
}

async function LabsTable({ q, city, centerType }: { q?: string; city?: string; centerType?: string }) {
  const rows: any[] = await listLabs({ search: q, city, centerType, limit: 200 });
  return (
    <div className="-mx-5 overflow-x-auto">
      <LabsDirTable rows={rows} />
    </div>
  );
}

async function ProvidersTable({ q, city, type }: { q?: string; city?: string; type?: string }) {
  const rows: any[] = await listProviders({ search: q, city, type, limit: 200 });
  return (
    <div className="-mx-5 overflow-x-auto">
      <ProvidersDirTable rows={rows} />
    </div>
  );
}

function PharmacyEmpty() {
  return (
    <div className="px-5 py-12 text-center">
      <div className="inline-flex w-12 h-12 rounded-full bg-warn-50 text-warn-500 items-center justify-center mb-3">
        <BookOpenText className="w-5 h-5" />
      </div>
      <p className="text-ink-800 font-medium mb-1">Pharmacy network is just getting started</p>
      <p className="text-sm text-ink-500 max-w-md mx-auto">Only 1 pharmacy onboarded today (no pincode set). Use the Gap Queue to identify priority pincodes for pharmacy onboarding.</p>
    </div>
  );
}

function labelForCenterType(t?: string) {
  if (t === 'DIAGNOSTIC_CENTER') return 'Diagnostic';
  if (t === 'COLLECTION_CENTER') return 'Collection';
  if (t === 'HOSPITAL') return 'Hospital';
  return '—';
}

function NudgeCard({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: 'warn' | 'bad' | 'neutral' }) {
  const toneCls = {
    warn: 'border-warn-100 bg-warn-50/40',
    bad: 'border-danger-100 bg-danger-50/40',
    neutral: 'border-ink-150 bg-surface',
  }[tone];
  const accentCls = {
    warn: 'text-warn-500',
    bad: 'text-danger-500',
    neutral: 'text-ink-500',
  }[tone];
  return (
    <div className={`rounded-lg border ${toneCls} px-3 py-2.5`}>
      <div className="flex items-center gap-1.5">
        {(tone === 'warn' || tone === 'bad') && <AlertTriangle className={`w-3 h-3 ${accentCls}`} strokeWidth={2.5} />}
        <span className="text-[10px] uppercase tracking-wider text-ink-500 font-semibold">{label}</span>
      </div>
      <div className="text-xl font-semibold tabular-nums text-ink-900 mt-0.5 leading-none">{value.toLocaleString()}</div>
      <div className="text-[10px] text-ink-500 mt-1">{hint}</div>
    </div>
  );
}
