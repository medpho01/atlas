import { redirect } from 'next/navigation';
import Link from 'next/link';
import { authenticate, createSession, getSessionUser, audit } from '@/lib/auth';

export const dynamic = 'force-dynamic';

async function loginAction(formData: FormData) {
  'use server';
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');
  if (!email || !password) {
    redirect(`/login?error=missing&next=${encodeURIComponent(next)}`);
  }
  const user = await authenticate(email, password);
  if (!user) {
    audit(null, '/login', 'login_failed');
    redirect(`/login?error=bad&next=${encodeURIComponent(next)}`);
  }
  await createSession(user.id);
  audit(user.id, '/login', 'login');
  redirect(next.startsWith('/') ? next : '/');
}

export default async function LoginPage({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  // If already signed in, bounce to next/home.
  const me = await getSessionUser();
  if (me) redirect(searchParams.next || '/');

  const errMsg =
    searchParams.error === 'bad'     ? 'Invalid email or password.' :
    searchParams.error === 'missing' ? 'Email and password are required.' :
    null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <div className="w-7 h-7 bg-brand-500 rounded-md flex items-center justify-center text-white font-bold">A</div>
          <span className="text-xl font-semibold text-ink-900">Atlas</span>
          <span className="text-ink-400">·</span>
          <span className="text-sm text-ink-500">LabStack</span>
        </div>
        <div className="rounded-2xl border border-ink-150 bg-surface shadow-card p-6">
          <h1 className="text-lg font-semibold text-ink-900 mb-1">Sign in</h1>
          <p className="text-sm text-ink-500 mb-5">Use your Atlas account to continue.</p>
          {errMsg && (
            <div className="mb-4 rounded-lg border border-danger-100 bg-danger-50/50 px-3 py-2 text-sm text-danger-500">
              {errMsg}
            </div>
          )}
          <form action={loginAction} className="space-y-3">
            <input type="hidden" name="next" value={searchParams.next ?? '/'} />
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">Email</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                className="mt-1 w-full h-10 px-3 rounded-lg border border-ink-200 bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition"
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wider text-ink-500 font-semibold">Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-1 w-full h-10 px-3 rounded-lg border border-ink-200 bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-500 transition"
              />
            </label>
            <button
              type="submit"
              className="w-full h-10 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 transition mt-2"
            >
              Sign in
            </button>
          </form>
        </div>
        <p className="text-[11px] text-ink-400 text-center mt-4">
          Internal tool. Accounts are provisioned by the admin.
        </p>
      </div>
    </div>
  );
}
