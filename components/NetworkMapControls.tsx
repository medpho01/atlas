'use client';

/**
 * The mode pills and legend that sit above the public network map.
 *
 * Deliberately a separate module from PublicNetworkMap: that one imports
 * leaflet at the top level, which touches `window`. The map is loaded through
 * a `dynamic(..., { ssr: false })` import, but a static import of anything
 * else in the same module drags leaflet into the server render anyway and the
 * page 500s with "window is not defined". Keeping the pure-UI half here means
 * leaflet is only ever evaluated in the browser.
 */

export type Mode = 'both' | 'cv' | 'hs';

export const MODE_COLOR = {
  both:   '#059669', // emerald-600 — both services
  cvOnly: '#2563eb', // blue-600
  hsOnly: '#7c3aed', // violet-600
  focus:  '#e11d48', // rose-600 — searched pincode
} as const;

export function NetworkMapControls({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
      <div className="flex gap-0.5 bg-slate-100 rounded-lg p-1 border border-slate-200">
        <PillButton active={mode === 'both'} onClick={() => onChange('both')}>All services</PillButton>
        <PillButton active={mode === 'cv'}   onClick={() => onChange('cv')}>Centre visit</PillButton>
        <PillButton active={mode === 'hs'}   onClick={() => onChange('hs')}>Home sample</PillButton>
      </div>
      <div className="flex items-center gap-4 text-[12px] text-slate-600">
        {/* Legend follows the selected mode — single-mode views use one colour */}
        {mode === 'both' && (
          <>
            <LegendDot color={MODE_COLOR.both}   label="Both services" />
            <LegendDot color={MODE_COLOR.cvOnly} label="Centre visit only" />
            <LegendDot color={MODE_COLOR.hsOnly} label="Home sample only" />
          </>
        )}
        {mode === 'cv' && <LegendDot color={MODE_COLOR.cvOnly} label="Centre visit — dot size = number of centres" />}
        {mode === 'hs' && <LegendDot color={MODE_COLOR.hsOnly} label="Home sample — dot size = number of labs" />}
      </div>
    </div>
  );
}

function PillButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-1.5 rounded-md font-medium text-[13px] transition ${
        active ? 'bg-white text-slate-900 shadow-sm border border-slate-200' : 'text-slate-600 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full ring-2 ring-white shadow-sm" style={{ background: color }} />
      <span className="font-medium">{label}</span>
    </div>
  );
}
