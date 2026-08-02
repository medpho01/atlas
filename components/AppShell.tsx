'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import type { Role } from '@/lib/access';
import { locate } from '@/lib/navigation';
import { Sidebar } from './Sidebar';
import { ThemeToggle } from './ThemeToggle';
import { LensChip } from './LensChip';
import { UserChip } from './UserChip';

type User = { id: number; email: string; name: string; role: Role };

/**
 * Signed-in chrome: sidebar for navigation, top bar for context and identity.
 *
 * The breadcrumb is derived from lib/navigation rather than hand-written per
 * page, so a route can't show up in the sidebar under one group and read as
 * another in the header.
 */
export function AppShell({ user, children }: { user: User; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const here = locate(pathname);

  return (
    <div className="flex min-h-screen">
      <Sidebar role={user.role} mobileOpen={mobileOpen} onCloseMobile={() => setMobileOpen(false)} />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 shrink-0 bg-surface/90 backdrop-blur-md border-b border-ink-150">
          <div className="h-full px-4 sm:px-6 flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="md:hidden p-1.5 -ml-1 rounded-md text-ink-600 hover:text-ink-900 hover:bg-ink-100"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="text-[13px] min-w-0 truncate">
              {here ? (
                <>
                  {here.group && <span className="text-ink-500">{here.group} <span className="text-ink-300">/</span> </span>}
                  <span className="font-semibold text-ink-900">{here.item}</span>
                </>
              ) : (
                <span className="font-semibold text-ink-900">Atlas</span>
              )}
            </div>

            <div className="ml-auto flex items-center gap-3 text-sm shrink-0">
              <LensChip />
              <ThemeToggle />
              <UserChip user={user} />
            </div>
          </div>
        </header>

        <main className="flex-1 animate-fade-in">{children}</main>
      </div>
    </div>
  );
}
