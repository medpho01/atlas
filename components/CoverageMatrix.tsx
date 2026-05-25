'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Grid3x3 } from 'lucide-react';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { InfoTip } from '@/components/ui/InfoTip';
import { CAPABILITY_MATRIX, KIND_LABEL, MODALITY_LABEL, PROVIDER_KINDS, MODALITIES, type ProviderKind, type Modality } from '@/lib/coverage';

type Cell = {
  kind: ProviderKind;
  modality: Modality;
  in_pincode: number;
  within_radius: number;
  verified_within_radius: number;
  nearest_km: number | null;
};

type Props = { cells: Cell[]; radiusKm: number };

const RADIUS_PRESETS = [1, 3, 5, 8, 10, 15, 20, 30];

export function CoverageMatrix({ cells, radiusKm }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [localRadius, setLocalRadius] = useState(radiusKm);

  const updateRadius = (r: number) => {
    setLocalRadius(r);
    const params = new URLSearchParams(searchParams.toString());
    params.set('radius', String(r));
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  const cellMap = new Map<string, Cell>();
  cells.forEach((c) => cellMap.set(`${c.kind}|${c.modality}`, c));

  return (
    <Card>
      <CardHeader
        title="Coverage Matrix"
        subtitle="Providers covering this pincode — by kind × modality. Counts include in-pincode, within radius, and via lab-declared service area."
        icon={<Grid3x3 className="w-4 h-4" strokeWidth={2.25} />}
        info={
          <InfoTip
            title="Coverage Matrix"
            shows="A grid of provider count for every (kind × modality) combo that's relevant to this pincode. Each cell colours by verified supply strength — green ≥ 3, amber 1–2, red 0."
            computed={
              <>
                <strong>Big number</strong> = verified providers (excludes labs that claim &gt;500 pincodes — those are usually mass-claim, not actually serving). <strong>/N</strong> after = total claimed (only shown when claimed exceeds verified).<br/>
                Includes providers physically <em>in</em> this pincode, providers within the <em>radius</em> slider (Haversine distance), and labs that <em>declare</em> service here via <code className="font-mono text-[10px]">pincodesServiced</code>.
              </>
            }
            drives="Change the radius (1–30km) to model different catchment assumptions. Hover any cell to see the in-pincode vs nearest-km breakdown. Cells in red are direct onboarding targets."
            notes="Pharmacy column is structurally 0 right now — only one Pharmacy exists in the database and it has no pincode set."
          />}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">Radius</span>
            <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-0.5">
              {RADIUS_PRESETS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => updateRadius(r)}
                  className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-all ${
                    localRadius === r ? 'bg-surface text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
                  }`}
                >
                  {r}km
                </button>
              ))}
            </div>
            {pending && <span className="text-xs text-ink-400">…</span>}
          </div>
        }
      />
      <CardBody className="pt-0">
        <div className="overflow-x-auto -mx-2">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="text-left px-2 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-ink-500"></th>
                {MODALITIES.map((m) => (
                  <th key={m} className="text-center px-2 py-2.5 text-[10px] uppercase tracking-wider font-semibold text-ink-500">
                    {MODALITY_LABEL[m]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PROVIDER_KINDS.map((kind) => (
                <tr key={kind}>
                  <td className="px-2 py-2 text-[13px] font-medium text-ink-700 whitespace-nowrap">{KIND_LABEL[kind]}</td>
                  {MODALITIES.map((modality) => {
                    const valid = CAPABILITY_MATRIX[kind].includes(modality);
                    if (!valid) {
                      return (
                        <td key={modality} className="p-1.5 text-center">
                          <div className="rounded-lg border border-dashed border-ink-150 h-[58px] flex items-center justify-center text-ink-300 text-xs">—</div>
                        </td>
                      );
                    }
                    const cell = cellMap.get(`${kind}|${modality}`);
                    const claimed = cell?.within_radius ?? 0;
                    const verified = cell?.verified_within_radius ?? 0;
                    const inPin = cell?.in_pincode ?? 0;
                    const nearestKm = cell?.nearest_km;
                    const inflated = claimed > verified;
                    // Tone based on VERIFIED count — the more conservative reality
                    const tone: 'good' | 'warn' | 'bad' = verified >= 3 ? 'good' : verified >= 1 ? 'warn' : 'bad';
                    const toneCls = {
                      good: 'bg-success-50 border-success-100',
                      warn: 'bg-warn-50 border-warn-100',
                      bad: 'bg-danger-50 border-danger-100',
                    }[tone];
                    return (
                      <td key={modality} className="p-1.5">
                        <div className={`rounded-lg border ${toneCls} h-[58px] px-2 py-1.5 flex flex-col items-center justify-center transition-shadow hover:shadow-card`} title={inflated ? `${claimed} claimed (${claimed - verified} from mass-claim labs); ${verified} verified` : `${verified} providers`}>
                          <div className="flex items-baseline gap-1 leading-none">
                            <span className="text-[22px] font-bold tabular-nums text-ink-900">{verified}</span>
                            {inflated && <span className="text-[11px] tabular-nums text-ink-400 font-medium">/{claimed}</span>}
                          </div>
                          <div className="text-[10px] leading-tight text-ink-500 mt-0.5 text-center">
                            {inPin > 0 ? `${inPin} in pin` : nearestKm != null ? `${Number(nearestKm).toFixed(1)}km` : ''}
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-4 text-[11px] text-ink-500 flex-wrap">
          <Legend dot="bg-success-500" label="≥3 verified" />
          <Legend dot="bg-warn-500" label="1–2 verified" />
          <Legend dot="bg-danger-500" label="None" />
          <span className="text-ink-300">·</span>
          <span><strong className="text-ink-700">Big number</strong> = verified (excludes labs claiming &gt;500 pincodes); <strong className="text-ink-700">/N</strong> = total claimed.</span>
        </div>
      </CardBody>
    </Card>
  );
}

function Legend({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-medium">
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
