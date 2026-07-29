import type { Thread, ThreadStats as Stats } from '@/lib/crm';
import { TrendingUp, Users2, ArrowRightLeft, CheckCircle2 } from 'lucide-react';

/** Stage distribution + rolling velocity for a thread. Server component. */
export function ThreadStats({ thread, stats }: { thread: Thread; stats: Stats }) {
  const counts = new Map(stats.stage_counts.map((s) => [s.stage_key, s.n]));
  const total = stats.stage_counts.reduce((a, s) => a + s.n, 0);
  const successKey = thread.success_stage_key;

  // Colour by role: success green, terminal-negative red, everything else brand.
  const roleOf = (key: string, label: string) => {
    if (key === successKey) return 'success';
    if (/stall|drop|lost|reject|dead/i.test(key + label)) return 'lost';
    return 'active';
  };

  return (
    <div className="space-y-3 mb-4">
      {/* Stage distribution */}
      <div className="rounded-2xl border border-ink-200 bg-surface p-4">
        <div className="flex items-baseline justify-between mb-2.5">
          <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
            Pipeline by stage
          </span>
          <span className="text-[11px] text-ink-500">{total} providers</span>
        </div>

        {/* Proportional bar */}
        {total > 0 && (
          <div className="flex h-2 rounded-full overflow-hidden mb-3 bg-ink-100">
            {thread.stages.map((s) => {
              const n = counts.get(s.key) ?? 0;
              if (!n) return null;
              const role = roleOf(s.key, s.label);
              return (
                <div
                  key={s.key}
                  title={`${s.label}: ${n}`}
                  style={{ width: `${(n / total) * 100}%` }}
                  className={
                    role === 'success' ? 'bg-success-500'
                    : role === 'lost' ? 'bg-danger-500'
                    : 'bg-brand-500'
                  }
                />
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {thread.stages.map((s) => {
            const n = counts.get(s.key) ?? 0;
            const role = roleOf(s.key, s.label);
            return (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-[12px]">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  n === 0 ? 'bg-ink-200'
                  : role === 'success' ? 'bg-success-500'
                  : role === 'lost' ? 'bg-danger-500'
                  : 'bg-brand-500'
                }`} />
                <span className={n === 0 ? 'text-ink-400' : 'text-ink-700'}>{s.label}</span>
                <span className={`tabular-nums font-semibold ${n === 0 ? 'text-ink-300' : 'text-ink-900'}`}>{n}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Velocity */}
      <div className="rounded-2xl border border-ink-200 bg-surface p-4">
        <div className="flex items-center gap-1.5 mb-3">
          <TrendingUp className="w-3.5 h-3.5 text-ink-400" />
          <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">
            Pipeline progress
          </span>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {stats.velocity.map((v) => (
            <div key={v.days} className="rounded-xl bg-ink-50 p-3">
              <div className="text-[11px] font-semibold text-ink-500 mb-1.5">Last {v.days} days</div>
              <div className="space-y-1">
                <Row icon={<Users2 className="w-3 h-3" />} label="added" value={v.added} />
                <Row icon={<ArrowRightLeft className="w-3 h-3" />} label="stage moves" value={v.moves} />
                <Row
                  icon={<CheckCircle2 className="w-3 h-3" />}
                  label="onboarded"
                  value={v.onboarded}
                  highlight={v.onboarded > 0}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, value, highlight }: {
  icon: React.ReactNode; label: string; value: number; highlight?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[12px]">
      <span className={highlight ? 'text-success-600' : 'text-ink-400'}>{icon}</span>
      <span className={`tabular-nums font-bold ${highlight ? 'text-success-600' : 'text-ink-900'}`}>{value}</span>
      <span className="text-ink-500">{label}</span>
    </div>
  );
}
