import { query } from '@/lib/db';
import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { UsersClient } from './UsersClient';
import { UserCog } from 'lucide-react';
import type { UserRow } from './actions';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const gate = await requireView('admin', '/users');
  if (gate.blocked) return <RoleBlocked area="User management" detail="admins" />;
  const me = gate.user;

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
