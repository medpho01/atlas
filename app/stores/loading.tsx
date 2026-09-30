import { Skeleton } from '@/components/ui/Skeleton';

/** The strip, the filters, then the stores. The shape arrives first. */
export default function Loading() {
  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-6 w-52" />
      <Skeleton className="h-3 w-[26rem] mt-2.5" />

      <div className="flex flex-wrap gap-8 mt-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-7 w-14" />
            <Skeleton className="h-2.5 w-24 mt-1.5" />
          </div>
        ))}
      </div>

      <Skeleton className="h-10 w-full mt-5 rounded-lg" />

      <div className="rounded-xl border border-ink-150 bg-surface mt-4 p-4 space-y-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-3 w-3" />
            <div className="flex-1">
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-2.5 w-28 mt-1.5" />
            </div>
            <Skeleton className="h-2 w-[260px] rounded-full" />
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
