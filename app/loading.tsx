import { Skeleton, SkeletonKpis, SkeletonCard } from '@/components/ui/Skeleton';

/**
 * What every page shows while its data is being fetched.
 *
 * One file, at the root, so every route gets it — Next uses the nearest
 * loading.tsx above the segment being opened. Before this existed, clicking a
 * slow page left the previous one on screen with nothing moving until the
 * server finished, which is indistinguishable from a frozen app.
 *
 * The shape is the shape most pages here have: a title, a row of figures, and
 * two panels. Routes whose layout is genuinely different declare their own.
 */
export default function Loading() {
  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1600px] mx-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="mb-6">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-3 w-80 mt-2.5" />
      </div>

      <div className="mb-6">
        <SkeletonKpis />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SkeletonCard className="lg:col-span-2" rows={8} />
        <SkeletonCard rows={6} />
      </div>
    </div>
  );
}
