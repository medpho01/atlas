/**
 * Reading query parameters that came off a URL somebody else wrote.
 *
 * Lives beside the routes rather than inside one because Next only allows a
 * route module to export its handlers and a few known config values —
 * exporting a helper from route.ts is a build error, and sharing it by copy is
 * how two endpoints end up with two different ideas of the maximum page size.
 */

/** A bound that cannot be pushed past its limit by a bigger number in the URL. */
export function clamp(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

/**
 * Dates reach SQL as bind parameters, so a bad one is a Postgres error and a
 * 500 rather than anything dangerous — but a 500 tells the caller nothing, and
 * `from=last week` is a mistake somebody will make on the first afternoon.
 */
export function badDate(v: string | null): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return `Dates must look like 2026-03-14, got "${v}"`;
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? `"${v}" is not a real date` : null;
}

/** A positive integer path segment, or null. */
export function idParam(v: string | undefined): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}
