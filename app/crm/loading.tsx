import { Skeleton } from '@/components/ui/Skeleton';

/** The CRM opens on a board, not a dashboard — so its wait looks like one. */
export default function Loading() {
  return (
    <main className="mx-auto max-w-7xl px-6 py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-7 w-48" />
      <div className="flex gap-4 mt-5 mb-6">
        {['My queue', 'Threads', 'Daily update', 'Score'].map((t) => (
          <Skeleton key={t} className="h-4 w-20" />
        ))}
      </div>
      <div className="flex gap-1.5 mb-5">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6 w-24" />)}
      </div>
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 5 }).map((_, col) => (
          <div key={col} className="w-[260px] shrink-0">
            <Skeleton className="h-9 rounded-t-md" />
            <div className="border border-t-0 border-ink-200 rounded-b-md p-2 space-y-2">
              {Array.from({ length: 3 - (col % 2) }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-md" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
