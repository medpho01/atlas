import { LINES, LINE_LABEL, STATUS_LABEL, type AccountLine, type LineStatus } from '@/lib/accountHealth';

/** Status colours. Lightness differs as well as hue, so they survive a greyscale print. */
export const STATUS_DOT: Record<LineStatus, string> = {
  active: 'bg-success-600',
  growing: 'bg-success-600',
  declining: 'bg-danger-500',
  stopped: 'bg-warn-500',
  never: 'bg-ink-300',
};

export const STATUS_CHIP: Record<LineStatus, string> = {
  active: 'bg-success-50 text-success-600 border-success-100',
  growing: 'bg-success-50 text-success-600 border-success-100',
  declining: 'bg-danger-50 text-danger-500 border-danger-100',
  stopped: 'bg-warn-50 text-warn-600 border-warn-100',
  never: 'bg-ink-100 text-ink-500 border-ink-200',
};

/**
 * Three dots: which lines are lit, in a fixed order so the shape is readable
 * down a column without reading the labels.
 */
export function LineDots({ lines }: { lines: AccountLine[] }) {
  const by = new Map(lines.map((l) => [l.stream, l]));
  const lit = lines.filter((l) => l.status !== 'never').length;
  const worry = lines.find((l) => l.status === 'stopped' || l.status === 'declining');

  return (
    <div className="flex items-center gap-1.5">
      {LINES.map((s) => {
        const l = by.get(s);
        const st = (l?.status ?? 'never') as LineStatus;
        return (
          <span
            key={s}
            title={`${LINE_LABEL[s]} — ${STATUS_LABEL[st]}${l && st !== 'never' ? ` · ${l.this_month} this month` : ''}`}
            className={`w-[7px] h-[7px] rounded-full ${STATUS_DOT[st]}`}
          />
        );
      })}
      <span className={`text-[11px] ml-1 ${worry ? 'text-warn-600 font-semibold' : 'text-ink-500'}`}>
        {worry
          ? `${LINE_LABEL[worry.stream]?.toLowerCase()} ${worry.status}`
          : `${lit} of 3 lines`}
      </span>
    </div>
  );
}
