'use client';

import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import { TILE_ATTRIBUTION, TILE_URL_LIGHT } from '@/lib/mapTiles';
import L from 'leaflet';

export type NetworkPoint = {
  pincode: string;
  latitude: number;
  longitude: number;
  cv: number;
  hs: number;
};

export type Mode = 'both' | 'cv' | 'hs';

// India bounding box — used to lock the viewport so customers don't accidentally
// pan to China / Pakistan / Sri Lanka (where OSM tiles render in local scripts).
const INDIA_BOUNDS: L.LatLngBoundsExpression = [
  [6.5, 68.0],   // SW: Lakshadweep / Gujarat corner
  [36.0, 97.5],  // NE: Kashmir / Arunachal corner
];
const INDIA_CENTER: [number, number] = [22.5, 80.0];

// Tuned for the light Positron basemap — needs to read at zoom 5 (whole India)
// and at zoom 12 (zoomed to one pincode). These colors are more saturated than
// the earlier set so they pop against the near-white tile palette.
const COLOR = {
  both:   '#059669', // emerald-600 — both services
  cvOnly: '#2563eb', // blue-600
  hsOnly: '#7c3aed', // violet-600
  focus:  '#e11d48', // rose-600 — searched pincode
} as const;

/** Fits the map either to the full India bbox or to a focused pincode. */
function FitController({
  points,
  focus,
}: {
  points: NetworkPoint[];
  focus: { latitude: number; longitude: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (focus) {
      // Zoom to the searched pincode at street/locality level.
      map.flyTo([focus.latitude, focus.longitude], 12, { duration: 0.8 });
      return;
    }
    // No focus → fit to India bbox.
    map.fitBounds(INDIA_BOUNDS, { padding: [20, 20], maxZoom: 5 });
  }, [focus?.latitude, focus?.longitude, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function PublicNetworkMap({
  points,
  mode,
  onPincodeSelect,
  focusPincode,
}: {
  points: NetworkPoint[];
  mode: Mode;
  onPincodeSelect?: (pincode: string) => void;
  focusPincode?: { pincode: string; latitude: number; longitude: number } | null;
}) {
  const visible = useMemo(() => {
    if (mode === 'cv') return points.filter((p) => p.cv > 0);
    if (mode === 'hs') return points.filter((p) => p.hs > 0);
    return points;
  }, [mode, points]);

  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-lg bg-slate-50" style={{ height: 600 }}>
      <MapContainer
        center={INDIA_CENTER}
        zoom={5}
        minZoom={4}
        maxZoom={14}
        maxBounds={INDIA_BOUNDS}
        maxBoundsViscosity={1.0}     // stops drag past the India bbox
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        preferCanvas
        worldCopyJump={false}
        zoomControl={false}          // we render our own positioned bottom-right
      >
        {/* CartoDB Positron — the cleanest light basemap, used by Airbnb / GitHub /
            Vercel marketing pages. Labels in Latin script; muted tones let the
            data markers be the focus. */}
        <TileLayer
          attribution={TILE_ATTRIBUTION}
          url={TILE_URL_LIGHT}
          subdomains="abcd"
        />
        {visible.map((p) => {
          const isFocus = focusPincode?.pincode === p.pincode;
          const hasBoth = p.cv > 0 && p.hs > 0;
          // In a single-service mode, colour every matching dot in that mode's
          // colour. Without this, ~95% of pincodes have both services and stay
          // green in every mode — switching modes looks like it does nothing.
          const baseColor =
            mode === 'cv' ? COLOR.cvOnly :
            mode === 'hs' ? COLOR.hsOnly :
            hasBoth ? COLOR.both : p.cv > 0 ? COLOR.cvOnly : COLOR.hsOnly;
          const color = isFocus ? COLOR.focus : baseColor;
          // Size by the count relevant to the selected mode.
          const magnitude = mode === 'cv' ? p.cv : mode === 'hs' ? p.hs : p.cv + p.hs;
          const baseR = Math.max(3, Math.min(10, 3 + Math.log2(Math.max(1, magnitude))));
          const r = isFocus ? 14 : baseR;
          return (
            <CircleMarker
              key={p.pincode}
              center={[p.latitude, p.longitude]}
              radius={r}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: isFocus ? 0.9 : 0.55,
                weight: isFocus ? 3 : 1,
              }}
              eventHandlers={onPincodeSelect ? { click: () => onPincodeSelect(p.pincode) } : undefined}
            >
              <Tooltip direction="top" offset={[0, -5]}>
                <div className="text-xs">
                  <div className="font-semibold">Pincode {p.pincode}</div>
                  {p.cv > 0 && <div>{p.cv} center{p.cv > 1 ? 's' : ''} for visit</div>}
                  {p.hs > 0 && <div>{p.hs} lab{p.hs > 1 ? 's' : ''} for home sample</div>}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
        {/* Render the focused pincode as a pin even if it's not in the points array
            (e.g. when it has zero coverage but we still want to show it on the map). */}
        {focusPincode && !visible.some((p) => p.pincode === focusPincode.pincode) && (
          <CircleMarker
            center={[focusPincode.latitude, focusPincode.longitude]}
            radius={12}
            pathOptions={{ color: COLOR.focus, fillColor: COLOR.focus, fillOpacity: 0.85, weight: 3 }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              <div className="text-xs font-semibold">Pincode {focusPincode.pincode}</div>
            </Tooltip>
          </CircleMarker>
        )}
        <FitController points={visible} focus={focusPincode ?? null} />
        <ZoomControl position="bottomright" />
      </MapContainer>
    </div>
  );
}

/** Filter pills + legend in one strip — designed to sit ABOVE the map.
 *  Light-themed (slate palette) so it works inside the new presentation-style page. */
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
        <PillButton active={mode === 'cv'}   onClick={() => onChange('cv')}>Center visit</PillButton>
        <PillButton active={mode === 'hs'}   onClick={() => onChange('hs')}>Home sample</PillButton>
      </div>
      <div className="flex items-center gap-4 text-[12px] text-slate-600">
        {/* Legend follows the selected mode — single-mode views use one colour */}
        {mode === 'both' && (
          <>
            <LegendDot color={COLOR.both}   label="Both services" />
            <LegendDot color={COLOR.cvOnly} label="Center visit only" />
            <LegendDot color={COLOR.hsOnly} label="Home sample only" />
          </>
        )}
        {mode === 'cv' && <LegendDot color={COLOR.cvOnly} label="Pincodes with center visit — dot size = number of centres" />}
        {mode === 'hs' && <LegendDot color={COLOR.hsOnly} label="Pincodes with home sample — dot size = number of labs" />}
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
