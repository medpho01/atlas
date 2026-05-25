'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MapPin,
  Map,
  BookOpenText,
  Crosshair,
  Activity,
  TrendingUp,
  Scale,
  Building2,
  Briefcase,
  type LucideIcon,
} from 'lucide-react';

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that should also activate this tab (e.g. /pincode/[code] activates /pincodes) */
  alsoActiveOn?: string[];
};

const navLinks: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/momentum', label: 'Momentum', icon: TrendingUp },
  { href: '/imbalance', label: 'Imbalance', icon: Scale },
  { href: '/gaps', label: 'Gaps', icon: Crosshair },
  { href: '/accounts', label: 'Accounts', icon: Briefcase },
  { href: '/pincodes', label: 'Pincodes', icon: MapPin, alsoActiveOn: ['/pincode'] },
  { href: '/heatmap', label: 'Heatmap', icon: Map },
  { href: '/directory', label: 'Directory', icon: BookOpenText, alsoActiveOn: ['/chain'] },
  { href: '/quality', label: 'Quality', icon: Activity },
];

function isActive(pathname: string, link: NavItem): boolean {
  if (link.href === '/') return pathname === '/';
  if (pathname === link.href || pathname.startsWith(`${link.href}/`)) return true;
  if (link.alsoActiveOn?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return true;
  return false;
}

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-0.5">
      {navLinks.map((l) => {
        const Icon = l.icon;
        const active = isActive(pathname, l);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? 'page' : undefined}
            className={`group relative flex items-center gap-1.5 px-2.5 h-8 text-[13px] rounded-md transition-all duration-150 ${
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
  );
}
