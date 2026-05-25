'use client';

import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';

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

function FitBounds({ points }: { points: Point[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
  }, [points, map]);
  return null;
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

  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  const tileAttribution = isDark
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

  return (
    <div style={{ height }} className="rounded-lg overflow-hidden border border-ink-150">
      <MapContainer
        center={center}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
        preferCanvas={true}
      >
        <TileLayer attribution={tileAttribution} url={tileUrl} />
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
        <FitBounds points={points} />
      </MapContainer>
    </div>
  );
}
