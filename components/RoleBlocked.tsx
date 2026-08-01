import Link from 'next/link';

/**
 * Shown when a signed-in user reaches an area their role can't access — e.g. by
 * following a shared link to a page the nav hides for them.
 */
export function RoleBlocked({ area, detail }: { area: string; detail: string }) {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16 text-center">
      <h1 className="text-xl font-bold text-ink-900 mb-2">Not available for your role</h1>
      <p className="text-sm text-ink-600 mb-6">
        {area} is restricted to {detail}. Ask an admin if you need access.
      </p>
      <Link href="/" className="text-sm text-brand-700 dark:text-brand-400 hover:underline">
        ← Back to overview
      </Link>
    </main>
  );
}
