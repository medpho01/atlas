'use client';

import { useMemo, useState, ReactNode } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

export type SortDir = 'asc' | 'desc';

export type SortableColumn<T> = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean; // default true
  sortValue?: (row: T) => string | number | null | undefined; // for derived sorts
  className?: string;
  title?: string;
};

type Props<T> = {
  rows: T[];
  columns: SortableColumn<T>[];
  initialSortKey?: string;
  initialSortDir?: SortDir;
  /** Row renderer — receives the row + index, returns a single <tr>. */
  children: (row: T, idx: number) => ReactNode;
  /** Unique key extractor for each row. */
  rowKey: (row: T, idx: number) => string | number;
  emptyMessage?: string;
};

export function SortableTable<T>({
  rows,
  columns,
  initialSortKey,
  initialSortDir = 'desc',
  children,
  rowKey,
  emptyMessage = 'No data.',
}: Props<T>) {
  const [sortKey, setSortKey] = useState<string | null>(initialSortKey ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(initialSortDir);

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const valueOf =
      col.sortValue ?? ((r: any) => (r ? r[sortKey] : undefined));
    const arr = [...rows];
    arr.sort((a, b) => {
      const va = valueOf(a);
      const vb = valueOf(b);
      // Nulls always go to the bottom regardless of sort direction
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va;
      }
      const sa = String(va).toLowerCase();
      const sb = String(vb).toLowerCase();
      if (sa < sb) return sortDir === 'asc' ? -1 : 1;
      if (sa > sb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [rows, sortKey, sortDir, columns]);

  const toggle = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  return (
    <table className="lk">
      <thead>
        <tr>
          {columns.map((c) => {
            const isSorted = sortKey === c.key;
            const sortable = c.sortable !== false;
            const alignCls = c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : '';
            const inner = (
              <span className={`inline-flex items-center gap-1 ${c.align === 'right' ? 'flex-row-reverse' : ''}`}>
                <span>{c.label}</span>
                {sortable && (
                  isSorted ? (
                    sortDir === 'asc' ? (
                      <ChevronUp className="w-3 h-3 text-brand-500" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-brand-500" />
                    )
                  ) : (
                    <ChevronsUpDown className="w-2.5 h-2.5 text-ink-300 opacity-60" />
                  )
                )}
              </span>
            );
            return (
              <th key={c.key} className={`${alignCls} ${c.className ?? ''}`} title={c.title}>
                {sortable ? (
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    className="hover:text-ink-900 transition-colors"
                  >
                    {inner}
                  </button>
                ) : (
                  inner
                )}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {sortedRows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className="text-center text-ink-400 text-sm py-6">
              {emptyMessage}
            </td>
          </tr>
        ) : (
          sortedRows.map((row, i) => (
            <RowWrapper key={rowKey(row, i)}>{children(row, i)}</RowWrapper>
          ))
        )}
      </tbody>
    </table>
  );
}

/** Trivial fragment-style wrapper so we don't add an extra DOM node. */
function RowWrapper({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
