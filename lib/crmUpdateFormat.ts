/**
 * The update's shape and its text, in a module with no server-only import.
 *
 * The daily-update page renders the text client-side as the free-text sections
 * are typed, so it needs the formatter — and lib/crmUpdate.ts opens a database
 * connection. Keeping one formatter shared means the copy button and the
 * server-rendered draft can never disagree.
 */

export type UpdateStage = {
  key: string;
  label: string;
  /** Providers moved into this stage on the day. */
  count: number;
  /** Providers sitting in this stage that the person wrote a note on. */
  touched: number;
};
export type UpdateThread = {
  thread_id: number;
  name: string;
  stages: UpdateStage[];
  total: number;
  touched: number;
};

export type DailyUpdate = {
  name: string;
  date: string;
  threads: UpdateThread[];
  requests_progressed: number;
};

/** The text people paste into the group. Kept here so it is the same everywhere. */
export function formatUpdate(
  u: DailyUpdate,
  extras: { misc?: string; blockers?: string; tomorrow?: string } = {},
): string {
  const date = new Date(`${u.date}T00:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  const lines: string[] = [`Name: ${u.name}`, `Date: ${date}`, '', "✅ Today's Accomplishments:", ''];

  u.threads.forEach((t, i) => {
    lines.push(`${i + 1}. Thread - ${t.name}`);
    t.stages.forEach((st, j) => {
      // The chasing, in brackets after the count. A day of follow-ups with
      // nothing moved is still a day's work, and printing it only where it
      // happened keeps the line short everywhere else.
      const chased = st.touched > 0
        ? ` (Touched ${st.touched} provider${st.touched === 1 ? '' : 's'})`
        : '';
      lines.push(`   ${j + 1}. ${st.label}: ${st.count}${chased}`);
    });
    if (u.requests_progressed > 0 && /request|nsa/i.test(t.name)) {
      lines.push(`   ${t.stages.length + 1}. Requests closed / progressed / moved to orders: ${u.requests_progressed}`);
    }
  });

  if (extras.misc?.trim()) {
    lines.push('', '[Miscellaneous]', extras.misc.trim());
  }
  lines.push('', "🎯 Tomorrow's Plan:", '');
  lines.push(extras.tomorrow?.trim() || '1. ');
  // Last, and always present, defaulting to Nil: a blockers section that only
  // appears when someone is blocked makes silence ambiguous — nobody can tell
  // whether the day was clear or the section was forgotten.
  lines.push('', '⚠️ Help Needed / Blockers', extras.blockers?.trim() || 'Nil');
  return lines.join('\n');
}
