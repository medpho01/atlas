import { requireView } from '@/lib/guard';
import { getSessionUser } from '@/lib/auth';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { NewStoreForm } from './NewStoreForm';

export const dynamic = 'force-dynamic';

/**
 * Admin only, and gated here as well as in the action.
 *
 * The action is what actually protects the write; this is so a non-admin who
 * follows a link gets a sentence instead of a form that refuses at the end of
 * it. Both, not either — the page guard alone would be theatre, and the action
 * guard alone would waste somebody's typing.
 */
export default async function NewStorePage() {
  const gate = await requireView('storeOrders', '/stores/new');
  if (gate.blocked) {
    return <RoleBlocked area="Stores & Orders" detail="accounts, network, operations and admin" />;
  }

  const me = await getSessionUser();
  if (me?.role !== 'admin') {
    return <RoleBlocked area="Adding a store" detail="admins" />;
  }

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[860px] mx-auto">
      <PageHeader
        title="Add a store"
        subtitle="A partner Atlas should know about."
        breadcrumbs={[
          { label: 'Fulfilment' },
          { label: 'Stores & Orders', href: '/stores' },
          { label: 'Add a store' },
        ]}
      />
      <NewStoreForm />
    </div>
  );
}
