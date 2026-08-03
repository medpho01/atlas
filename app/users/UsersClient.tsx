'use client';

import { useState, useTransition } from 'react';
import { Plus, CheckCircle2, AlertCircle, KeyRound, Trash2, UserX, UserCheck, Upload, Download } from 'lucide-react';
import { createUser, updateUser, deleteUser, bulkCreateUsers, type UserRow, type BulkResult } from './actions';

// The four profiles. editor/viewer still exist on old accounts and stay
// selectable only for users already on them — see the legacy option below.
const ROLE_OPTIONS = [
  { value: 'admin',      label: 'Admin',      hint: 'Everything, plus provisioning people and roles' },
  { value: 'network',    label: 'Network',    hint: 'Grows supply — edits the directory, rates and onboarding' },
  { value: 'accounts',   label: 'Accounts',   hint: 'Grows demand — owns account health, reads the network side' },
  { value: 'operations', label: 'Operations', hint: 'Fulfils orders — reads coverage and the directory' },
] as const;

const LEGACY_LABEL: Record<string, string> = {
  editor: 'Editor (legacy)',
  viewer: 'Viewer (legacy)',
};

const ROLE_BADGE: Record<string, string> = {
  admin:      'bg-brand-50 text-brand-700 dark:text-brand-400 border-brand-100',
  network:    'bg-success-50 text-success-600 border-success-100',
  accounts:   'bg-violet-50 text-violet-600 dark:text-violet-400 border-violet-100 dark:border-violet-500/30',
  operations: 'bg-warn-50 text-warn-600 border-warn-100',
  editor:     'bg-ink-100 text-ink-700 border-ink-200',
  viewer:     'bg-ink-100 text-ink-700 border-ink-200',
};

export function UsersClient({ initialUsers, myId }: { initialUsers: UserRow[]; myId: number }) {
  const [users, setUsers] = useState(initialUsers);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'network' as UserRow['role'] });
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [pwFor, setPwFor] = useState<number | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRows, setBulkRows] = useState<{ email: string; name: string; role: string }[]>([]);
  const [bulkResults, setBulkResults] = useState<BulkResult[] | null>(null);

  const removeUser = (id: number) => {
    startTransition(async () => {
      const res = await deleteUser({ id });
      if (res.ok) { setUsers((prev) => prev.filter((u) => u.id !== id)); setMsg({ kind: 'ok', text: 'User deleted' }); }
      else setMsg({ kind: 'err', text: res.error ?? 'Could not delete' });
      setConfirmDelete(null);
    });
  };

  // Parsed in the browser so a mistyped file is caught before anything is
  // created. Only the parsed rows are sent; the file itself never leaves.
  const readFile = async (file: File) => {
    setBulkResults(null);
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    const pick = (r: Record<string, unknown>, keys: string[]) => {
      for (const k of Object.keys(r)) {
        if (keys.includes(k.trim().toLowerCase())) return String(r[k] ?? '').trim();
      }
      return '';
    };
    const rows = raw
      .map((r) => ({
        email: pick(r, ['email', 'email address', 'e-mail']),
        name: pick(r, ['name', 'full name']),
        role: (pick(r, ['role', 'profile']) || 'operations').toLowerCase(),
      }))
      .filter((r) => r.email || r.name);
    setBulkRows(rows);
    if (!rows.length) setMsg({ kind: 'err', text: 'No rows found — the sheet needs Email, Name and Role columns' });
  };

  const submitBulk = () => {
    startTransition(async () => {
      const res = await bulkCreateUsers(bulkRows as never);
      if (!res.ok) { setMsg({ kind: 'err', text: res.error ?? 'Bulk create failed' }); return; }
      setBulkResults(res.results ?? []);
      setBulkRows([]);
    });
  };

  // The only moment these passwords are readable. Once this page is closed
  // they can't be recovered, only reset.
  const downloadCredentials = () => {
    const made = (bulkResults ?? []).filter((r) => r.status === 'created');
    const csv = ['Name,Email,Role,Password', ...made.map((r) => `"${r.name}","${r.email}",${r.role},${r.password}`)].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'atlas-new-users.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => {
    const csv = 'Name,Email,Role\nAsha Rao,asha@labstack.in,operations\nRohit Nair,rohit@labstack.in,network\n';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'atlas-user-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const refresh = async () => {
    // Server actions revalidate; simplest client refresh is a reload of data via location
    window.location.reload();
  };

  const submitCreate = () => {
    startTransition(async () => {
      const res = await createUser(form);
      if (!res.ok) { setMsg({ kind: 'err', text: res.error ?? 'Failed' }); return; }
      setMsg({ kind: 'ok', text: `${form.email} onboarded as ${form.role}` });
      setShowCreate(false);
      setForm({ email: '', name: '', password: '', role: 'network' });
      refresh();
    });
  };

  const setRole = (id: number, role: UserRow['role']) => {
    startTransition(async () => {
      const res = await updateUser({ id, role });
      if (!res.ok) { setMsg({ kind: 'err', text: res.error ?? 'Failed' }); return; }
      setUsers((u) => u.map((x) => (x.id === id ? { ...x, role } : x)));
    });
  };

  const setActive = (id: number, active: boolean) => {
    startTransition(async () => {
      const res = await updateUser({ id, active });
      if (!res.ok) { setMsg({ kind: 'err', text: res.error ?? 'Failed' }); return; }
      setUsers((u) => u.map((x) => (x.id === id ? { ...x, active } : x)));
    });
  };

  const submitPassword = (id: number) => {
    startTransition(async () => {
      const res = await updateUser({ id, newPassword: pwValue });
      if (!res.ok) { setMsg({ kind: 'err', text: res.error ?? 'Failed' }); return; }
      setMsg({ kind: 'ok', text: 'Password reset' });
      setPwFor(null);
      setPwValue('');
    });
  };

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`px-4 py-2.5 rounded-lg border text-sm flex items-center gap-2 ${
          msg.kind === 'ok' ? 'bg-success-50 border-success-100 text-success-600'
                            : 'bg-danger-50 border-danger-100 text-danger-500'
        }`}>
          {msg.kind === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}

      {/* Create */}
      <div className="rounded-2xl border border-ink-200 bg-surface p-4">
        {!showCreate ? (
          <span className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 transition"
          >
            <Plus className="w-4 h-4" /> Onboard user
          </button>
          <button
            onClick={() => { setBulkOpen((v) => !v); setBulkResults(null); setBulkRows([]); }}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-semibold rounded-md border border-ink-200 text-ink-800 hover:bg-ink-50 dark:hover:bg-ink-900/40 transition"
          >
            <Upload className="w-4 h-4" /> Bulk upload
          </button>
          </span>
        ) : (
          <div className="space-y-3">
            <div className="grid sm:grid-cols-2 gap-2">
              <input
                type="text" placeholder="Full name" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface"
              />
              <input
                type="email" placeholder="email@labstack.in" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface"
              />
              <input
                type="text" placeholder="Temporary password (8+ chars)" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="h-9 px-3 text-sm rounded-md border border-ink-200 bg-surface font-mono"
              />
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as UserRow['role'] })}
                className="h-9 px-2 text-sm rounded-md border border-ink-200 bg-surface font-medium"
              >
                {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.hint}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                onClick={submitCreate} disabled={pending}
                className="px-4 h-9 text-sm font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700 transition disabled:opacity-40"
              >
                {pending ? 'Creating…' : 'Create user'}
              </button>
              <button onClick={() => setShowCreate(false)} className="px-3 h-9 text-sm rounded-md border border-ink-200 text-ink-700 hover:bg-ink-50">
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-ink-500">
              Share the temporary password over a secure channel and ask them to change it after first login.
            </p>
          </div>
        )}
      </div>

      {bulkOpen && (
        <div className="mb-4 rounded-xl border border-ink-200 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">Bulk onboard from a sheet</h2>
              <p className="text-xs text-ink-600 mt-0.5 max-w-2xl">
                Upload an .xlsx or .csv with <span className="font-medium">Name</span>,{' '}
                <span className="font-medium">Email</span> and <span className="font-medium">Role</span> columns.
                Atlas generates a password for each person &mdash; you&rsquo;ll see them once, here, and they
                are never stored in readable form.
              </p>
            </div>
            <button onClick={downloadTemplate}
              className="shrink-0 inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900">
              <Download className="w-3 h-3" /> Template
            </button>
          </div>

          {!bulkResults && (
            <>
              <input
                type="file" accept=".xlsx,.xls,.csv"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); }}
                className="block text-xs text-ink-700 file:mr-3 file:px-3 file:h-8 file:rounded-md file:border-0 file:bg-ink-900 file:text-ink-50 file:text-xs file:font-semibold hover:file:bg-ink-800"
              />
              {bulkRows.length > 0 && (
                <div className="space-y-2">
                  <div className="max-h-52 overflow-y-auto rounded-md border border-ink-200">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-surface">
                        <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
                          <th className="px-3 py-1.5 font-semibold">Name</th>
                          <th className="px-3 py-1.5 font-semibold">Email</th>
                          <th className="px-3 py-1.5 font-semibold">Role</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkRows.map((r, i) => (
                          <tr key={i} className="border-b border-ink-100 last:border-0">
                            <td className="px-3 py-1 text-ink-900">{r.name || <span className="text-danger-500">missing</span>}</td>
                            <td className="px-3 py-1 text-ink-700">{r.email || <span className="text-danger-500">missing</span>}</td>
                            <td className="px-3 py-1 text-ink-600">{r.role}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={submitBulk} disabled={pending}
                      className="px-3 h-8 text-xs font-semibold rounded-md bg-ink-900 text-ink-50 hover:bg-ink-800 disabled:opacity-50">
                      {pending ? 'Creating…' : `Create ${bulkRows.length} user${bulkRows.length === 1 ? '' : 's'}`}
                    </button>
                    <button onClick={() => setBulkRows([])} className="text-xs text-ink-500 hover:text-ink-900">Clear</button>
                  </div>
                </div>
              )}
            </>
          )}

          {bulkResults && (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-ink-700">
                  <span className="font-semibold text-success-600">
                    {bulkResults.filter((r) => r.status === 'created').length} created
                  </span>
                  {bulkResults.some((r) => r.status !== 'created') && (
                    <> · {bulkResults.filter((r) => r.status !== 'created').length} not created</>
                  )}
                </p>
                {bulkResults.some((r) => r.status === 'created') && (
                  <button onClick={downloadCredentials}
                    className="inline-flex items-center gap-1 px-2.5 h-7 text-[11px] font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700">
                    <Download className="w-3 h-3" /> Download credentials
                  </button>
                )}
              </div>
              <p className="text-[11px] text-warn-600">
                Copy these now &mdash; passwords can&rsquo;t be shown again, only reset.
              </p>
              <div className="max-h-60 overflow-y-auto rounded-md border border-ink-200">
                <table className="w-full text-[12px]">
                  <tbody>
                    {bulkResults.map((r, i) => (
                      <tr key={i} className="border-b border-ink-100 last:border-0">
                        <td className="px-3 py-1 text-ink-900">{r.name}</td>
                        <td className="px-3 py-1 text-ink-600">{r.email}</td>
                        <td className="px-3 py-1 font-mono text-[11px] text-ink-900">
                          {r.password ?? <span className="font-sans text-ink-500">{r.reason}</span>}
                        </td>
                        <td className="px-3 py-1 text-right">
                          <span className={`text-[10px] font-semibold ${
                            r.status === 'created' ? 'text-success-600'
                            : r.status === 'skipped' ? 'text-ink-500' : 'text-danger-500'}`}>
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button onClick={() => { setBulkResults(null); refresh(); }}
                className="text-xs font-semibold text-brand-700 dark:text-brand-400 hover:underline">
                Done — refresh the list
              </button>
            </div>
          )}
        </div>
      )}

      {/* List */}
      <div className="rounded-2xl border border-ink-200 bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-ink-500 border-b border-ink-200">
              <th className="px-4 py-2 font-semibold">User</th>
              <th className="px-2 py-2 font-semibold">Role</th>
              <th className="px-2 py-2 font-semibold">Last login</th>
              <th className="px-2 py-2 font-semibold text-center">Status</th>
              <th className="px-4 py-2 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-b border-ink-100 ${!u.active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-ink-900 text-[13px]">
                    {u.name} {u.id === myId && <span className="text-[10px] text-ink-500">(you)</span>}
                  </div>
                  <div className="text-[11px] text-ink-500">{u.email}</div>
                </td>
                <td className="px-2 py-2.5">
                  <select
                    value={u.role}
                    disabled={u.id === myId}
                    onChange={(e) => setRole(u.id, e.target.value as UserRow['role'])}
                    className={`text-[11px] font-semibold px-1.5 py-1 rounded-md border ${ROLE_BADGE[u.role] ?? ROLE_BADGE.viewer} disabled:cursor-not-allowed`}
                  >
                    {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    {/* Keep a legacy role selectable only while someone is on it,
                        so the dropdown doesn't silently reassign them on save. */}
                    {LEGACY_LABEL[u.role] && <option value={u.role}>{LEGACY_LABEL[u.role]}</option>}
                  </select>
                </td>
                <td className="px-2 py-2.5 text-[12px] text-ink-600 tabular-nums">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'never'}
                </td>
                <td className="px-2 py-2.5 text-center">
                  <button
                    onClick={() => setActive(u.id, !u.active)}
                    disabled={u.id === myId}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition ${
                      u.active
                        ? 'bg-success-50 text-success-600 border-success-100 hover:bg-danger-50 hover:text-danger-500 hover:border-danger-100'
                        : 'bg-ink-100 text-ink-500 border-ink-200 hover:bg-success-50 hover:text-success-600'
                    } disabled:cursor-not-allowed`}
                    title={u.active ? 'Click to deactivate' : 'Click to reactivate'}
                  >
                    {u.active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {pwFor === u.id ? (
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="text" placeholder="New password" value={pwValue} autoFocus
                        onChange={(e) => setPwValue(e.target.value)}
                        className="h-7 px-2 text-[12px] rounded-md border border-ink-200 bg-surface font-mono w-36"
                      />
                      <button onClick={() => submitPassword(u.id)} disabled={pending} className="text-[11px] font-semibold text-brand-700 dark:text-brand-400 px-1">Set</button>
                      <button onClick={() => { setPwFor(null); setPwValue(''); }} className="text-[11px] text-ink-500 px-1">✕</button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-3">
                      <button
                        onClick={() => setPwFor(u.id)}
                        className="inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900 transition"
                      >
                        <KeyRound className="w-3 h-3" /> Reset
                      </button>
                      {/* The status pill toggles this too, but a pill doesn't
                          read as a control — this is the discoverable path. */}
                      <button
                        onClick={() => setActive(u.id, !u.active)}
                        disabled={u.id === myId || pending}
                        title={u.id === myId ? "You can't deactivate your own account" : undefined}
                        className="inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {u.active
                          ? <><UserX className="w-3 h-3" /> Deactivate</>
                          : <><UserCheck className="w-3 h-3" /> Reactivate</>}
                      </button>
                      {confirmDelete === u.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[11px] text-ink-600">Delete permanently?</span>
                          <button onClick={() => removeUser(u.id)} disabled={pending}
                            className="text-[11px] font-semibold text-danger-500 hover:underline">Yes</button>
                          <button onClick={() => setConfirmDelete(null)}
                            className="text-[11px] text-ink-500">Cancel</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(u.id)}
                          disabled={u.id === myId || pending}
                          title={u.id === myId ? "You can't delete your own account" : 'Permanently remove this account'}
                          className="inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-danger-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="w-3 h-3" /> Delete
                        </button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
