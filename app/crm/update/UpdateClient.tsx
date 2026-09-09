'use client';

import { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { formatUpdate, type DailyUpdate } from '@/lib/crmUpdateFormat';

/**
 * The numbers are read-only — they come from the board and editing them here
 * would make the update disagree with it. The prose is not: a day has things in
 * it no funnel records, and an update that cannot say so gets written by hand
 * instead, which is the thing this replaces.
 */
export function UpdateClient({ update }: { update: DailyUpdate }) {
  const [misc, setMisc] = useState('');
  const [blockers, setBlockers] = useState('');
  const [tomorrow, setTomorrow] = useState('');
  const [copied, setCopied] = useState(false);

  // Rebuilt from the same formatter the server used, rather than patched with
  // string replacement — the sections have to come out in a fixed order and
  // splicing them in by hand got that wrong as soon as one was empty.
  const text = useMemo(
    () => formatUpdate(update, { misc, blockers, tomorrow }),
    [update, misc, blockers, tomorrow],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked in some browsers over plain http; the textarea
      // below is selectable, so this is a convenience rather than the only way.
      setCopied(false);
    }
  };

  const nothing = update.threads.every((t) => t.total === 0);

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="space-y-4">
        {nothing && (
          <p className="text-xs text-warn-600 bg-warn-500/10 border border-warn-500/30 rounded-md px-3 py-2">
            No stage changes recorded on this day. The counts below are all zero — pick another
            date, or write what you did in Miscellaneous.
          </p>
        )}

        {update.threads.map((t) => (
          <div key={t.thread_id} className="rounded-lg border border-ink-200 bg-surface">
            <div className="px-4 py-2.5 border-b border-ink-100 flex items-baseline justify-between">
              <span className="text-sm font-semibold text-ink-900">{t.name}</span>
              <span className="text-[11px] num text-ink-500">{t.total} moved</span>
            </div>
            <div className="px-4 py-2.5 space-y-1">
              {t.stages.map((st) => (
                <div key={st.key} className="flex items-center justify-between text-[13px]">
                  <span className="text-ink-600">{st.label}</span>
                  <span className={`num font-medium ${st.count ? 'text-ink-900' : 'text-ink-400'}`}>
                    {st.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        {!update.threads.length && (
          <p className="text-sm text-ink-500">
            You are not on any thread yet. Ask an admin to add you on the Threads tab — the update
            is built from the threads you work.
          </p>
        )}

        <div>
          <label className="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">
            Miscellaneous
          </label>
          <textarea
            value={misc}
            onChange={(e) => setMisc(e.target.value)}
            rows={3}
            placeholder="Other network tasks — calls, escalations, anything the funnel does not record"
            className="mt-1 w-full rounded-md border border-ink-200 bg-surface p-2 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">
            Tomorrow&rsquo;s plan
          </label>
          <textarea
            value={tomorrow}
            onChange={(e) => setTomorrow(e.target.value)}
            rows={3}
            placeholder={'1. Close pricing with 3 hospitals in Pune'}
            className="mt-1 w-full rounded-md border border-ink-200 bg-surface p-2 text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">
            Help needed / blockers
          </label>
          <textarea
            value={blockers}
            onChange={(e) => setBlockers(e.target.value)}
            rows={2}
            placeholder="Nil"
            className="mt-1 w-full rounded-md border border-ink-200 bg-surface p-2 text-sm"
          />
        </div>
      </div>

      <div className="lg:sticky lg:top-4 self-start w-full">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-wide text-ink-400 font-semibold">
            Ready to paste
          </span>
          <button
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-700"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <textarea
          readOnly
          value={text}
          rows={26}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-lg border border-ink-200 bg-ink-50 p-3 text-[13px] font-mono leading-relaxed text-ink-800"
        />
      </div>
    </div>
  );
}
