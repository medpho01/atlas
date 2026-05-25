// Time-window controls for the Momentum dashboard.
// - `window` = lookback size (L7D / L30D / L90D)
// - `asof`   = how far back to slide the anchor from the latest week of data
//
// The data source `mv_service_line_momentum` keeps ~26 weeks of history, and
// each card draws a 12-week sparkline. So the deepest reachable anchor is
// roughly 14 weeks back; the presets stop at "3m back" to keep the sparkline
// honest.

export type WindowKey = 'L7D' | 'L30D' | 'L90D';
export type AsofKey = 'latest' | '1m' | '2m' | '3m';

export const WINDOW_OPTIONS: { key: WindowKey; label: string; days: number }[] = [
  { key: 'L7D', label: 'Last 7 days', days: 7 },
  { key: 'L30D', label: 'Last 30 days', days: 30 },
  { key: 'L90D', label: 'Last 90 days', days: 90 },
];

export const ASOF_OPTIONS: { key: AsofKey; label: string; days: number }[] = [
  { key: 'latest', label: 'As of latest week', days: 0 },
  { key: '1m', label: 'As of ~1 month ago', days: 28 },
  { key: '2m', label: 'As of ~2 months ago', days: 56 },
  { key: '3m', label: 'As of ~3 months ago', days: 84 },
];

export function parseWindow(key?: string): { key: WindowKey; days: number; label: string } {
  const found = WINDOW_OPTIONS.find((o) => o.key === key);
  return found ?? WINDOW_OPTIONS[1]; // default L30D
}

export function parseAsof(key?: string): { key: AsofKey; days: number; label: string } {
  const found = ASOF_OPTIONS.find((o) => o.key === key);
  return found ?? ASOF_OPTIONS[0]; // default latest
}

export function shortWindowLabel(days: number): string {
  if (days === 7) return 'L7D';
  if (days === 30) return 'L30D';
  if (days === 90) return 'L90D';
  return `L${days}D`;
}

export function shortAsofLabel(key: AsofKey): string {
  if (key === 'latest') return 'latest';
  if (key === '1m') return '~1m ago';
  if (key === '2m') return '~2m ago';
  if (key === '3m') return '~3m ago';
  return key;
}
