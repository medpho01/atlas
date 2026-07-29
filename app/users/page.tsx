import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { query } from '@/lib/db';
import { UsersClient } from './UsersClient';
import { UserCog } from 'lucide-react';
import type { UserRow } from './actions';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const me = await getSessionUser();
  if (!me) redirect('/login?next=/users');
  if (me.role !== 'admin') {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold text-ink-900 mb-2">Admin only</h1>
        <p className="text-sm text-ink-600 mb-6">User management requires an admin account.</p>
        <Link href="/" className="text-sm text-brand-700 dark:text-brand-400 hover:underline">← Back to overview</Link>
      </main>
    );
  }

  const users = await query<UserRow>(
    `SELECT id, email, name, role, active, created_at, last_login_at
     FROM atlas.users ORDER BY active DESC, role, name`,
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <UserCog className="w-5 h-5 text-brand-600" />
        <h1 className="text-2xl font-bold text-ink-900">Users</h1>
      </div>
      <p className="text-sm text-ink-600 mb-6 max-w-2xl">
        Onboard teammates and control what they can do. Operations and Network are the working roles;
        Admin manages users, threads, and funnels.
      </p>
      <UsersClient initialUsers={users} myId={me.id} />
    </main>
  );
}
