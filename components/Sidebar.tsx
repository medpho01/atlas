'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, MapPin, Crosshair, Scale, TrendingUp, Map, FileSearch,
  BookOpenText, Users, HeartPulse, Activity, Briefcase, IndianRupee,
  KanbanSquare, UserCog, PanelLeftClose, PanelLeft, X, type LucideIcon,
} from 'lucide-react';
import type { Role } from '@/lib/access';
import { navFor, isActive } from '@/lib/navigation';

const ICONS: Record<string, LucideIcon> = {
  '/': LayoutDashboard,
  '/pincodes': MapPin,
  '/gaps': Crosshair,
  '/imbalance': Scale,
  '/momentum': TrendingUp,
  '/heatmap': Map,
  '/coverage': FileSearch,
  '/directory': BookOpenText,
  '/phlebos': Users,
  '/nurses': HeartPulse,
  '/quality': Activity,
  '/accounts': Briefcase,
  '/pricing': IndianRupee,
  '/crm': KanbanSquare,
  '/users': UserCog,
};

const STORAGE_KEY = 'atlas-sidebar-collapsed';

export function Sidebar({
  role,
  mobileOpen,
  onCloseMobile,
}: {
  role: Role;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Read the stored preference after mount — server and client must agree on
  // the first paint or React complains about the mismatch.
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(STORAGE_KEY) === '1'); } catch { /* private mode */ }
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(STORAGE_KEY, c ? '0' : '1'); } catch { /* private mode */ }
      return !c;
    });
  };

  // Navigating on mobile should dismiss the drawer.
  useEffect(() => { onCloseMobile(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pathname]);

  const groups = navFor(role);

  return (
    <>
      {/* Scrim — mobile only */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink-900/50 backdrop-blur-sm md:hidden"
          onClick={onCloseMobile}
          aria-hidden
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col bg-surface border-r border-ink-200
          transition-[width,transform] duration-200 ease-out
          ${collapsed ? 'w-[60px]' : 'w-[232px]'}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
      >
        {/* Brand */}
        <div className={`h-14 flex items-center border-b border-ink-150 shrink-0 ${collapsed ? 'justify-center px-0' : 'px-3'}`}>
          <Link href="/" className="flex items-center gap-2 min-w-0 group" title="Atlas — map every pincode, find every gap">
            <span className="inline-flex w-7 h-7 bg-brand-600 rounded-md items-center justify-center shadow-sm shrink-0 transition-shadow group-hover:shadow-md">
              <svg viewBox="0 0 32 32" className="w-4 h-4" fill="none" aria-hidden>
                <path d="M 10.5 10.5 L 21.5 10.5 L 16 22 Z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="10.5" cy="10.5" r="2.6" fill="white" />
                <circle cx="21.5" cy="10.5" r="2.6" fill="white" />
                <circle cx="16" cy="22" r="2.6" fill="white" />
              </svg>
            </span>
            {!collapsed && (
              <span className="flex items-baseline gap-1.5 min-w-0">
                <span className="font-semibold text-ink-900 text-[15px] tracking-tight">Atlas</span>
                <span className="text-ink-500 text-xs font-medium truncate">· LabStack</span>
              </span>
            )}
          </Link>
          <button
            onClick={onCloseMobile}
            className="ml-auto md:hidden p-1.5 rounded-md text-ink-500 hover:text-ink-900 hover:bg-ink-100"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Groups */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
          {groups.map((g) => (
            <div key={g.label ?? 'root'} className="mb-1.5 last:mb-0">
              {g.label && !collapsed && (
                <div className="flex items-baseline gap-1.5 px-2 pt-2.5 pb-1">
                  <span className="text-[10px] uppercase tracking-[0.11em] text-ink-500 font-bold">{g.label}</span>
                  {g.noun && <span className="text-[10px] text-ink-400 truncate">{g.noun}</span>}
                </div>
              )}
              {/* Collapsed: a rule stands in for the group heading */}
              {g.label && collapsed && <div className="mx-2 my-2 border-t border-ink-150" />}

              {g.items.map((item) => {
                const Icon = ICONS[item.href] ?? LayoutDashboard;
                const active = isActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={`group flex items-center gap-2.5 rounded-md mb-0.5 text-[13px] transition-colors
                      ${collapsed ? 'justify-center py-2' : 'px-2.5 py-1.5'}
                      ${active
                        ? 'bg-brand-50 dark:bg-brand-500/15 text-brand-700 dark:text-brand-300 font-semibold'
                        : 'text-ink-600 hover:text-ink-900 hover:bg-ink-100 font-medium'}`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${active ? 'text-brand-600 dark:text-brand-400' : 'text-ink-400 group-hover:text-ink-700'}`}
                      strokeWidth={active ? 2.4 : 2}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Collapse toggle — desktop only */}
        <button
          onClick={toggle}
          className={`hidden md:flex items-center gap-2 h-10 shrink-0 border-t border-ink-150 text-[12px]
            text-ink-500 hover:text-ink-900 hover:bg-ink-100 transition-colors
            ${collapsed ? 'justify-center' : 'px-3'}`}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft className="w-4 h-4" /> : <><PanelLeftClose className="w-4 h-4" /> Collapse</>}
        </button>
      </aside>

      {/* Spacer so main content clears the fixed sidebar */}
      <div className={`hidden md:block shrink-0 transition-[width] duration-200 ${collapsed ? 'w-[60px]' : 'w-[232px]'}`} />
    </>
  );
}
