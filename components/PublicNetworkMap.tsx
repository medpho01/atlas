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

export type { Mode } from './NetworkMapControls';
import type { Mode } from './NetworkMapControls';

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
import { MODE_COLOR as COLOR } from './NetworkMapControls';

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
