import { Skeleton } from '@/components/ui/Skeleton';

/** Tabs, a line about the queue, then the rows. The shape arrives first. */
export default function Loading() {
  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-6 w-44" />
      <Skeleton className="h-3 w-[30rem] mt-2.5" />
      <div className="flex gap-3 mt-6 pb-3 border-b border-ink-200">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6 w-40" />)}
      </div>
      <Skeleton className="h-3 w-[36rem] mt-5" />
      <div className="rounded-xl border border-ink-150 bg-surface mt-5 p-4 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
