import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/authConstants';

// Routes that don't require a session.
const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/api/login',
  '/api/health',
]);

// Static / framework paths are excluded via the matcher below — middleware
// doesn't even run for them. Here we only handle real page/api routes.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths through.
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  // Has session cookie? Optimistic pass — the real session is verified
  // server-side via getSessionUser() inside pages. Middleware can't talk to
  // Postgres in the edge runtime, so this is the best we can do at this layer.
  const sid = req.cookies.get(SESSION_COOKIE)?.value;
  if (sid) return NextResponse.next();

  // No cookie → redirect to /login with the original path as ?next=
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname + (req.nextUrl.search || ''));
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next internals, static assets, and the favicon.
  matcher: ['/((?!_next/|favicon|icon|apple-icon|robots.txt|sitemap.xml).*)'],
};
