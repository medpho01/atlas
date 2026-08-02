'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Crosshair } from 'lucide-react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { tileUrlFor, TILE_ATTRIBUTION } from '@/lib/mapTiles';

type Point = {
  pincode: string;
  latitude: number;
  longitude: number;
  network_strength?: number;
  orders_l30d?: number;
  orders_all_time?: number;
  coverage_bucket?: string;
  geo_source?: 'exact' | 'prefix3' | 'prefix2' | 'none';
};

type Props = {
  points: Point[];
  center?: [number, number];
  zoom?: number;
  height?: string;
  colorMode?: 'supply' | 'demand' | 'gap';
  onPincodeClick?: (pincode: string) => void;
  highlightPincode?: string;
};

function colorFor(p: Point, mode: 'supply' | 'demand' | 'gap'): string {
  if (mode === 'supply') {
    const s = p.network_strength ?? 0;
    if (s >= 5) return '#16a34a';
    if (s >= 3) return '#22c55e';
    if (s === 2) return '#f59e0b';
    if (s === 1) return '#dc2626';
    return '#94a3b8';
  }
  if (mode === 'demand') {
    const o = p.orders_all_time ?? 0;
    if (o >= 500) return '#dc2626';
    if (o >= 100) return '#f97316';
    if (o >= 20) return '#f59e0b';
    if (o >= 1) return '#2563eb';
    return '#94a3b8';
  }
  // gap = high demand, low supply
  const o = p.orders_all_time ?? 0;
  const s = p.network_strength ?? 0;
  const gap = o / (s + 1);
  if (gap > 100) return '#dc2626';
  if (gap > 30) return '#f59e0b';
  if (gap > 5) return '#2563eb';
  return '#94a3b8';
}

function boundsOf(points: Point[]) {
  return L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]));
}

const FIT_OPTS = { padding: [40, 40] as [number, number], maxZoom: 11 };

/**
 * Fits to the points and offers a way back.
 *
 * Zooming and panning is easy to get lost in — especially once a lens narrows
 * the map to a few dozen scattered points — and Leaflet gives you no route home
 * but manual panning. The button appears once the view differs from the fitted
 * one, compared on zoom and centre rather than bounds containment: zooming in
 * keeps the centre inside the fitted bounds, so a containment test never fires
 * for the case users actually hit.
 */
function FitAndRecenter({ points }: { points: Point[] }) {
  const map = useMap();
  const [drifted, setDrifted] = useState(false);
  const fitted = useRef<{ zoom: number; center: L.LatLng } | null>(null);
  // Read points through a ref so `fit` is stable and the auto-fit effect below
  // can key off the data rather than the array identity.
  const pointsRef = useRef(points);
  pointsRef.current = points;

  const fit = useCallback(() => {
    const pts = pointsRef.current;
    if (pts.length === 0) return;
    map.fitBounds(boundsOf(pts), FIT_OPTS);
    // Record where fitBounds actually landed, after Leaflet clamps the zoom.
    requestAnimationFrame(() => {
      fitted.current = { zoom: map.getZoom(), center: map.getCenter() };
      setDrifted(false);
    });
  }, [map]);

  // Re-fit only when the point set genuinely changes — e.g. the lens narrows
  // the map. Depending on the array itself re-fits on every render, which
  // clears `drifted` immediately and means the button can never appear.
  const signature = points.length
    ? `${points.length}:${points[0].pincode}:${points[points.length - 1].pincode}`
    : '0';
  useEffect(() => { fit(); }, [fit, signature]);

  useEffect(() => {
    const check = () => {
      const f = fitted.current;
      if (!f) return;
      const zoomed = Math.abs(map.getZoom() - f.zoom) >= 0.75;
      // Panned more than a third of the visible span away from the fitted centre.
      const span = map.getBounds().getNorthEast().distanceTo(map.getBounds().getSouthWest());
      const panned = map.getCenter().distanceTo(f.center) > span / 3;
      setDrifted(zoomed || panned);
    };
    map.on('moveend zoomend', check);
    return () => { map.off('moveend zoomend', check); };
  }, [map]);

  if (points.length === 0 || !drifted) return null;

  return (
    <button
      onClick={fit}
      className="absolute top-2.5 right-2.5 z-[1000] inline-flex items-center gap-1.5 px-2.5 h-8
                 text-xs font-semibold rounded-md bg-surface/95 backdrop-blur border border-ink-200
                 text-ink-800 shadow-sm hover:bg-ink-50 transition"
      title="Fit the map back to the plotted pincodes"
    >
      <Crosshair className="w-3.5 h-3.5" /> Recenter
    </button>
  );
}

export default function PincodeMap({
  points,
  center = [20.5937, 78.9629], // India centroid
  zoom = 5,
  height = '500px',
  colorMode = 'supply',
  onPincodeClick,
  highlightPincode,
}: Props) {
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains('dark'));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);

  const tileUrl = tileUrlFor(isDark);

  return (
    <div style={{ height }} className="relative rounded-lg overflow-hidden border border-ink-150">
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        preferCanvas={true}
      >
        <TileLayer attribution={TILE_ATTRIBUTION} url={tileUrl} />
        {points.map((p) => {
          const isHighlight = highlightPincode === p.pincode;
          const isInferred = p.geo_source === 'prefix3' || p.geo_source === 'prefix2';
          const baseR = isHighlight ? 12 : Math.max(3, Math.min(14, 4 + Math.log2((p.orders_all_time ?? 1) + 1)));
          // Inferred points render smaller + more transparent to signal lower precision
          const r = isInferred ? Math.max(2, baseR * 0.55) : baseR;
          const color = colorFor(p, colorMode);
          const fillOpacity = isHighlight ? 0.9 : isInferred ? 0.25 : 0.5;
          return (
            <CircleMarker
              key={p.pincode}
              center={[p.latitude, p.longitude]}
              radius={r}
              pathOptions={{
                color: isHighlight ? '#1d4ed8' : color,
                fillColor: color,
                fillOpacity,
                weight: isHighlight ? 3 : isInferred ? 0.5 : 1,
                dashArray: isInferred ? '2,2' : undefined,
              }}
              eventHandlers={onPincodeClick ? { click: () => onPincodeClick(p.pincode) } : undefined}
            >
              <Tooltip direction="top" offset={[0, -5]}>
                <div className="text-xs">
                  <div className="font-semibold">{p.pincode}</div>
                  <div>Network: {p.network_strength ?? 0}</div>
                  <div>Orders (all-time): {p.orders_all_time ?? 0}</div>
                  {p.geo_source && p.geo_source !== 'exact' && (
                    <div className="text-amber-600 mt-0.5">
                      Approx. location · {p.geo_source === 'prefix3' ? '~30km accuracy' : '~100km'}
                    </div>
                  )}
                </div>
              </Tooltip>
            </CircleMarker>
          );
        })}
        <FitAndRecenter points={points} />
      </MapContainer>
    </div>
  );
}
