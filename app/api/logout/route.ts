import { NextResponse } from 'next/server';
import { destroySession, audit, getSessionUser } from '@/lib/auth';

export async function POST() {
  const me = await getSessionUser();
  await destroySession();
  if (me) audit(me.id, '/api/logout', 'logout');
  return NextResponse.redirect(new URL('/login', process.env.APP_URL ?? 'http://localhost:3010'), { status: 303 });
}

// GET also works for convenience (e.g. clicking a link).
export async function GET() {
  return POST();
}
