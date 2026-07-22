import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { UploadClient } from './UploadClient';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function PhleboUploadPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/phlebos/upload');
  if (user.role !== 'admin') {
    // Non-admin viewers get a friendly rejection instead of a 404
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold text-ink-900 mb-2">Admin only</h1>
        <p className="text-sm text-ink-600 mb-6">
          Uploading phlebos requires an admin account. Contact your Atlas admin if you need access.
        </p>
        <Link href="/phlebos" className="text-sm text-brand-700 hover:underline">
          ← Back to the phlebo repository
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href="/phlebos"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900 transition mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to phlebos
      </Link>

      <h1 className="text-2xl font-bold text-ink-900 mb-1">Upload phlebos</h1>
      <p className="text-sm text-ink-600 mb-6 max-w-2xl">
        Add phlebos from an Excel or CSV file. Existing entries are matched by phone number (digits only) and updated — new entries are added.
      </p>

      <UploadClient uploadedBy={user.name || user.email} />

      <div className="mt-8 p-4 rounded-xl border border-ink-200 bg-slate-50 text-sm text-ink-700">
        <h3 className="font-semibold text-ink-900 mb-2">Expected columns</h3>
        <p className="text-xs text-ink-600 mb-3">
          The first row of your file should be a header. Column names are matched case-insensitively.
          Only <code className="bg-white px-1 rounded border border-ink-200 text-[11px]">phone</code> and{' '}
          <code className="bg-white px-1 rounded border border-ink-200 text-[11px]">name</code> are required.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {[
            ['phone', 'required'],
            ['name', 'required'],
            ['city', 'optional'],
            ['state', 'optional'],
            ['pincode', 'optional'],
            ['email', 'optional'],
            ['notes', 'optional'],
          ].map(([col, tag]) => (
            <div key={col} className="flex items-center justify-between px-2 py-1 rounded bg-white border border-ink-200">
              <code className="text-[11px] font-semibold text-ink-900">{col}</code>
              <span className={`text-[10px] font-medium ${tag === 'required' ? 'text-red-600' : 'text-ink-500'}`}>{tag}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
