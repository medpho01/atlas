import { AlertTriangle } from 'lucide-react';

/**
 * What to show when this feature's SQL has not been applied.
 *
 * `sql/init/` runs once, on a database's first boot, so a host that already
 * exists does not get these files from a deploy — somebody has to apply them.
 * Forget that and every query here fails with `relation "…" does not exist`,
 * which Next renders as a **completely blank page**: HTTP 200, no heading, no
 * text, nothing in the console. Measured, not guessed.
 *
 * A blank page after a deploy is the most expensive failure a feature can
 * have, because it gives the person looking at it nothing at all to go on.
 * This turns it into one sentence and a command.
 */
export function MissingSchema({ relation }: { relation: string | null }) {
  return (
    <div className="px-6 lg:px-8 py-10 max-w-[760px] mx-auto">
      <div className="rounded-xl border border-warn-100 bg-warn-50 px-5 py-4">
        <h1 className="flex items-center gap-2 text-[15px] font-semibold text-ink-900">
          <AlertTriangle className="w-4 h-4 text-warn-600" />
          Stores &amp; Orders has not been installed on this database
        </h1>

        <p className="text-[13px] text-ink-700 mt-2">
          {relation
            ? <>The database has no <code className="font-mono text-[12px]">{relation}</code>.</>
            : <>A table or view this page reads is missing.</>}
          {' '}
          <code className="font-mono text-[12px]">sql/init/</code> runs once, when a database
          is first created, so an existing host does not pick these up from a deploy.
        </p>

        <p className="text-[13px] text-ink-700 mt-3">Run this on the host, then reload:</p>

        <pre className="mt-2 rounded-lg bg-ink-900 text-ink-100 text-[12px] leading-relaxed
                        px-4 py-3 overflow-x-auto font-mono">
{`cd ~/atlas && git pull
for f in 28_store_orders 29_store_registry 30_store_groups; do
  docker exec -i atlas-db psql -U atlas -d atlas -v ON_ERROR_STOP=1 -f - \\
    < "sql/init/$f.sql"
done`}
        </pre>

        <p className="text-[12px] text-ink-500 mt-3">
          All three are idempotent, so running them twice is safe. Check it worked with{' '}
          <code className="font-mono text-[11px]">scripts/check-stores-feature.sql</code> —
          every row should read PASS. Nothing else in Atlas is affected: Requests and Order
          tracking do not read any of this.
        </p>
      </div>
    </div>
  );
}

/**
 * Postgres says 42P01 for a table or view that is not there.
 *
 * Checked on the code rather than by matching the message, because the message
 * is localised and the code is not. The relation name is pulled out of the
 * message only to make the panel specific — if that fails the panel still
 * renders, just less precisely.
 */
export function missingRelation(err: unknown): string | null {
  const e = err as { code?: string; message?: string };
  if (e?.code !== '42P01') return null;
  const m = e.message?.match(/relation "([^"]+)" does not exist/);
  return m?.[1] ?? 'one of this feature’s views';
}
