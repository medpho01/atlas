import { requireView } from '@/lib/guard';
import { RoleBlocked } from '@/components/RoleBlocked';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { ROLE_BLURB, ROLE_LABEL } from '@/lib/access';
import { getRoleMatrix, MATRIX_ROLES } from '@/lib/roleAccess';
import { RoleMatrix } from './RoleMatrix';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const gate = await requireView('admin', '/settings/roles');
  if (gate.blocked) return <RoleBlocked area="Roles & screens" detail="admin" />;

  const rows = await getRoleMatrix();

  return (
    <div className="px-6 lg:px-8 py-6 max-w-[1400px] mx-auto">
      <PageHeader
        title="Roles & screens"
        subtitle="Which screens each role can open, and whether they can change anything there."
      />

      <p className="text-[13px] text-ink-600 max-w-3xl mt-4">
        Click a cell to cycle it: <b>none</b> → <b>view</b> → <b>manage</b>. Saved immediately,
        and every change is logged with who made it. The grid shows the effective answer, so a
        screen promoted by a dependency reads as <b>view</b> here rather than claiming to be off.
      </p>

      <Card className="mt-5">
        <CardBody className="pt-2">
          <RoleMatrix rows={rows} roles={MATRIX_ROLES} />
        </CardBody>
      </Card>

      <div className="grid md:grid-cols-2 gap-3 mt-5">
        {MATRIX_ROLES.map((r) => (
          <div key={r} className="rounded-lg border border-ink-200 bg-surface px-4 py-3">
            <div className="text-[13px] font-semibold text-ink-900">{ROLE_LABEL[r]}</div>
            <p className="text-[12px] text-ink-500 mt-1 leading-snug">{ROLE_BLURB[r]}</p>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-ink-400 mt-5 max-w-3xl">
        Admin keeps Admin: that cell cannot be changed, because taking it away would lock every
        administrator out of the screen that undoes it. A change reaches running pages within
        thirty seconds — tell the person whose access you changed rather than waiting for them
        to notice.
      </p>
    </div>
  );
}
