import { Skeleton } from '@/components/ui/Skeleton';

/** The strip, the tiles, the filters, the table — the shape arrives first. */
export default function Loading() {
  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1700px] mx-auto" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-3 w-[28rem] mt-2.5" />
      <div className="flex flex-wrap gap-1.5 mt-5">
        {Array.from({ length: 11 }).map((_, i) => <Skeleton key={i} className="h-6 w-20" />)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mt-5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
      </div>
      {Array.from({ length: 1 }).map((_, c) => (
        <div key={c} className="rounded-xl border border-ink-150 bg-surface mt-5 p-4 space-y-3">
          <Skeleton className="h-4 w-52" />
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
