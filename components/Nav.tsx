'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LayoutDashboard,
  MapPin,
  Map,
  BookOpenText,
  Crosshair,
  Activity,
  TrendingUp,
  Scale,
  Briefcase,
  Users,
  HeartPulse,
  IndianRupee,
  KanbanSquare,
  FileSearch,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import { canAccess, type Area, type Role } from '@/lib/access';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that should also activate this tab (e.g. /pincode/[code] activates /pincodes) */
  alsoActiveOn?: string[];
  /** Restricted area — hidden unless the role is allowed. The route enforces it too. */
  area?: Area;
};

const navLinks: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/momentum', label: 'Momentum', icon: TrendingUp },
  { href: '/imbalance', label: 'Imbalance', icon: Scale },
  { href: '/gaps', label: 'Gaps', icon: Crosshair },
  { href: '/accounts', label: 'Accounts', icon: Briefcase, area: 'accounts' },
  { href: '/pincodes', label: 'Pincodes', icon: MapPin, alsoActiveOn: ['/pincode'] },
  { href: '/heatmap', label: 'Heatmap', icon: Map },
  { href: '/directory', label: 'Directory', icon: BookOpenText, alsoActiveOn: ['/chain'] },
  { href: '/phlebos', label: 'Phlebos', icon: Users },
  { href: '/nurses', label: 'Nurses', icon: HeartPulse },
  { href: '/pricing', label: 'Pricing', icon: IndianRupee, area: 'pricing' },
  { href: '/crm', label: 'CRM', icon: KanbanSquare, area: 'crm' },
  { href: '/coverage', label: 'Coverage', icon: FileSearch },
  { href: '/users', label: 'Users', icon: UserCog },
  { href: '/quality', label: 'Quality', icon: Activity },
];

function isActive(pathname: string, link: NavItem): boolean {
  if (link.href === '/') return pathname === '/';
  if (pathname === link.href || pathname.startsWith(`${link.href}/`)) return true;
  if (link.alsoActiveOn?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  return false;
}

export function Nav({ role }: { role?: Role }) {
  const pathname = usePathname();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const links = navLinks.filter((l) => !l.area || canAccess(role ? { role } : null, l.area));

  // Track what's scrolled out of view so we can fade the appropriate edge.
  const syncEdges = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
  }, []);

  useEffect(() => {
    syncEdges();
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncEdges);
    ro.observe(el);
    window.addEventListener('resize', syncEdges);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', syncEdges);
    };
  }, [syncEdges, links.length]);

  // Keep the active tab visible when landing on a route that's scrolled off.
  useEffect(() => {
    scrollerRef.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  return (
    // min-w-0 lets this shrink below its content width. Without it the flex parent
    // grows to fit all tabs and drags the whole page into horizontal scroll.
    <div className="relative min-w-0 flex-1">
      <div
        ref={scrollerRef}
        onScroll={syncEdges}
        // -my-2.5/py-2.5 reserves room for the active underline (7px below each
        // link), which overflow-x would otherwise clip, without changing height.
        className="no-scrollbar overflow-x-auto overscroll-x-contain -my-2.5 py-2.5"
      >
        <nav className="flex items-center gap-0.5 w-max">
          {links.map((l) => {
            const Icon = l.icon;
            const active = isActive(pathname, l);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex shrink-0 items-center gap-1.5 px-2.5 h-8 text-[13px] rounded-md whitespace-nowrap transition-all duration-150 ${
                  active
                    ? 'bg-ink-100 text-ink-900 font-semibold'
                    : 'text-ink-600 hover:text-ink-900 hover:bg-ink-100/60 font-medium'
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 transition-colors ${
                    active ? 'text-brand-600' : 'text-ink-400 group-hover:text-ink-700'
                  }`}
                  strokeWidth={active ? 2.5 : 2}
                />
                {l.label}
                {active && (
                  <span
                    className="absolute -bottom-[7px] left-1/2 -translate-x-1/2 h-0.5 w-6 bg-brand-600 rounded-full"
                    aria-hidden
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Fade cues so it reads as scrollable rather than truncated */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface to-transparent transition-opacity duration-150 ${
          edges.left ? 'opacity-100' : 'opacity-0'
        }`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent transition-opacity duration-150 ${
          edges.right ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
}
