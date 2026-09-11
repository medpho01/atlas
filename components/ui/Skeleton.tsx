/**
 * The shapes a page makes before it has any content.
 *
 * Deliberately grey blocks rather than a spinner: a spinner says "wait", a
 * skeleton says "a table is coming, this wide" — people start reading the
 * layout before the data lands, and the page stops jumping when it does.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-ink-150/70 ${className}`} />;
}

export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** A row of KPI tiles, the shape every dashboard here opens with. */
export function SkeletonKpis({ n = 6 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-xl border border-ink-150 bg-surface px-4 py-4">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-7 w-16 mt-3" />
          <Skeleton className="h-2.5 w-24 mt-3" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ rows = 5, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`rounded-xl border border-ink-150 bg-surface p-5 ${className}`}>
      <Skeleton className="h-3.5 w-40" />
      <Skeleton className="h-2.5 w-64 mt-2" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
