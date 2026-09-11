import { Skeleton } from '@/components/ui/Skeleton';

/** The requests queue is a long table, and reads as one while it loads. */
export default function Loading() {
  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-3 w-96 mt-2.5" />
      <div className="flex flex-wrap gap-1.5 mt-5">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 w-24" />)}
      </div>
      <div className="rounded-xl border border-ink-150 bg-surface mt-5 p-4 space-y-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}
