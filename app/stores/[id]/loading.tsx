import { Skeleton } from '@/components/ui/Skeleton';

/** The account card and the analytics, then the stage tabs and the orders. */
export default function Loading() {
  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-2.5 w-64" />
      <Skeleton className="h-6 w-56 mt-3" />
      <Skeleton className="h-3 w-40 mt-2" />

      <div className="grid gap-4 lg:grid-cols-3 mt-5">
        <div className="lg:col-span-2 rounded-xl border border-ink-150 bg-surface p-5 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="grid sm:grid-cols-2 gap-6">
              <div><Skeleton className="h-2.5 w-20" /><Skeleton className="h-3 w-48 mt-1.5" /></div>
              <div><Skeleton className="h-2.5 w-24" /><Skeleton className="h-3 w-40 mt-1.5" /></div>
            </div>
          ))}
        </div>
        <div className="rounded-xl border border-ink-150 bg-surface p-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}><Skeleton className="h-6 w-16" /><Skeleton className="h-2.5 w-20 mt-1.5" /></div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-6 pb-3 border-b border-ink-200">
        {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-6 w-28" />)}
      </div>

      <div className="rounded-xl border border-ink-150 bg-surface mt-5 p-4 space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-3 w-3" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
