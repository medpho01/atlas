import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AppShell } from '@/components/AppShell';
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
        {/* No session → no chrome. Covers /login and the public /network page. */}
        {me
          ? <AppShell user={me}>{children}</AppShell>
          : <main className="animate-fade-in">{children}</main>}
      </body>
    </html>
  );
}
