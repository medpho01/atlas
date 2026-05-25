import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { ThemeToggle } from '@/components/ThemeToggle';
import { LensChip } from '@/components/LensChip';
import { UserChip } from '@/components/UserChip';
import { getSessionUser } from '@/lib/auth';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'Atlas · LabStack',
    template: '%s · Atlas',
  },
  description: 'Map every pincode, find every gap. Network intelligence for the LabStack healthcare network.',
};

// Default to dark — applied before paint to avoid light-flash. Reads localStorage too.
const themeBootScript = `
  try {
    var t = localStorage.getItem('labstack-theme');
    if (t === 'light') document.documentElement.classList.remove('dark');
    else document.documentElement.classList.add('dark');
  } catch (e) { document.documentElement.classList.add('dark'); }
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Hide the chrome on /login (unauthenticated users have no session, so this
  // also naturally hides it on any auth-protected route loaded without a session).
  const me = await getSessionUser();
  return (
    <html lang="en" className={`${inter.variable} dark`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen bg-ink-50 text-ink-900 antialiased">
        {me && (
          <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-ink-150">
            <div className="px-6 h-14 flex items-center justify-between gap-6">
              <div className="flex items-center gap-1">
                <Link href="/" className="flex items-center gap-2 mr-4 group" title="Atlas — map every pincode, find every gap">
                  <span className="inline-flex w-7 h-7 bg-brand-600 rounded-md items-center justify-center shadow-sm transition-shadow group-hover:shadow-md">
                    <svg viewBox="0 0 32 32" className="w-4 h-4" fill="none" aria-hidden>
                      <path d="M 10.5 10.5 L 21.5 10.5 L 16 22 Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <circle cx="10.5" cy="10.5" r="2.6" fill="white" />
                      <circle cx="21.5" cy="10.5" r="2.6" fill="white" />
                      <circle cx="16" cy="22" r="2.6" fill="white" />
                    </svg>
                  </span>
                  <span className="font-semibold text-ink-900 text-[15px] tracking-tight">Atlas</span>
                  <span className="text-ink-300 text-sm font-medium">·</span>
                  <span className="text-ink-500 text-sm font-medium">LabStack</span>
                </Link>
                <Nav />
              </div>
              <div className="flex items-center gap-3 text-sm">
                <LensChip />
                <ThemeToggle />
                <UserChip user={me} />
              </div>
            </div>
          </header>
        )}
        <main className="animate-fade-in">{children}</main>
      </body>
    </html>
  );
}
