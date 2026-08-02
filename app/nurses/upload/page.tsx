import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import { UploadClient } from './UploadClient';
import { ArrowLeft } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function NurseUploadPage() {
  const user = await getSessionUser();
  if (!user) redirect('/login?next=/nurses/upload');
  if (user.role !== 'admin') {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <h1 className="text-xl font-bold text-ink-900 mb-2">Admin only</h1>
        <p className="text-sm text-ink-600 mb-6">
          Uploading nurses requires an admin account. Contact your Atlas admin if you need access.
        </p>
        <Link href="/nurses" className="text-sm text-brand-700 dark:text-brand-400 hover:underline">
          ← Back to the nurse repository
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href="/nurses"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900 transition mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to nurses
      </Link>

      <h1 className="text-2xl font-bold text-ink-900 mb-1">Upload nurses</h1>
      <p className="text-sm text-ink-600 mb-6 max-w-2xl">
        Add nurses from an aggregator or agency list. Existing entries are matched by phone number
        (digits only) and updated — new entries are added.
      </p>

      <UploadClient uploadedBy={user.name || user.email} />

      <div className="mt-8 p-4 rounded-xl border border-ink-200 bg-ink-50 text-sm text-ink-700">
        <h3 className="font-semibold text-ink-900 mb-2">Expected columns</h3>
        <p className="text-xs text-ink-600 mb-3">
          The first row should be a header. Column names are matched case-insensitively. Only{' '}
          <code className="bg-surface px-1 rounded border border-ink-200 text-[11px]">phone</code> and{' '}
          <code className="bg-surface px-1 rounded border border-ink-200 text-[11px]">name</code> are required —
          but without <code className="bg-surface px-1 rounded border border-ink-200 text-[11px]">aggregator</code>{' '}
          a nurse won&apos;t show under any aggregator filter, so set one per file if your sheet lacks the column.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
          {[
            ['phone', 'required'],
            ['name', 'required'],
            ['aggregator', 'recommended'],
            ['city', 'optional'],
            ['state', 'optional'],
            ['pincode', 'optional'],
            ['qualification', 'optional'],
            ['email', 'optional'],
            ['notes', 'optional'],
          ].map(([col, tag]) => (
            <div key={col} className="flex items-center justify-between px-2 py-1 rounded bg-surface border border-ink-200">
              <code className="text-[11px] font-semibold text-ink-900">{col}</code>
              <span className={`text-[10px] font-medium ${
                tag === 'required' ? 'text-danger-500' : tag === 'recommended' ? 'text-warn-600' : 'text-ink-500'
              }`}>{tag}</span>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
