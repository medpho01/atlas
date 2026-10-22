'use client';

import { useState, useTransition } from 'react';
import { ROLE_LABEL, type Capability, type Role } from '@/lib/access';
import { setRoleCapability } from './actions';
import type { MatrixRow } from '@/lib/roleAccess';

const CAPS: Capability[] = ['none', 'view', 'manage'];

const TONE: Record<Capability, string> = {
  manage: 'bg-success-50 text-success-600 border-success-100',
  view: 'bg-ink-100 text-ink-700 border-ink-200',
  none: 'bg-transparent text-ink-400 border-ink-150',
};

/**
 * One cell, one click: none → view → manage → none.
 *
 * A cycle rather than a dropdown because there are three values and sixty
 * cells, and a select on each is sixty things to open. The current value is
 * the label, so nothing is hidden behind an interaction.
 */
function Cell({ row, role, value }: { row: MatrixRow; role: Role; value: Capability }) {
  const [shown, setShown] = useState<Capability>(value);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const locked = role === 'admin' && row.feature === 'admin';

  const cycle = () => {
    if (locked || pending) return;
    const next = CAPS[(CAPS.indexOf(shown) + 1) % CAPS.length]!;
    const before = shown;
    setShown(next); setErr(null);
    start(async () => {
      const r = await setRoleCapability({ role, feature: row.feature, capability: next });
      if (!r.ok) { setShown(before); setErr(r.error ?? 'Could not save'); }
    });
  };

  return (
    <td className="px-1.5 py-1">
      <button
        type="button"
        onClick={cycle}
        disabled={locked || pending}
        title={locked
          ? 'Admin always keeps Admin — otherwise nobody could undo it'
          : `${ROLE_LABEL[role]} · ${row.label} — click to change`}
        aria-label={`${ROLE_LABEL[role]} on ${row.label}: ${shown}`}
        className={`w-full rounded-md border px-2 py-1 text-[11px] font-semibold transition
                    ${TONE[shown]} ${locked ? 'opacity-60 cursor-not-allowed' : 'hover:brightness-110'}
                    ${pending ? 'animate-pulse' : ''}`}
      >
        {shown}
      </button>
      {err && <span className="block text-[10px] text-danger-500 mt-0.5 leading-tight">{err}</span>}
    </td>
  );
}

export function RoleMatrix({ rows, roles }: { rows: MatrixRow[]; roles: Role[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-sm">
        <thead>
          <tr className="border-b border-ink-200">
            <th scope="col" className="text-left text-[11px] uppercase tracking-wider text-ink-500 font-medium px-2 py-2.5">
              Screen
            </th>
            {roles.map((r) => (
              <th key={r} scope="col" className="text-[11px] font-bold text-ink-700 px-1.5 py-2.5 w-[104px]">
                {ROLE_LABEL[r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.feature} className="border-b border-ink-100 last:border-0">
              <th scope="row" className="text-left text-[13px] font-medium text-ink-900 px-2 py-1">
                {row.label}
              </th>
              {roles.map((r) => (
                <Cell key={r} row={row} role={r} value={row.caps[r]} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
