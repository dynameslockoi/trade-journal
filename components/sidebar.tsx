"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Brain,
  CalendarDays,
  HandCoins,
  LayoutDashboard,
  MoreHorizontal,
  Settings,
  ShieldCheck,
  Target,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import {
  Sheet,
  SheetCloseButton,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type NavItem = readonly [string, string, LucideIcon];

export const NAV_ITEMS: readonly NavItem[] = [
  ["/", "Dashboard", LayoutDashboard],
  ["/journal", "Journal", BookOpen],
  ["/analytics", "Analytics", BarChart3],
  ["/calendar", "Calendar", CalendarDays],
  ["/accounts", "Accounts", WalletCards],
  // Tags share this page as a second tab — two small label lists did not need two destinations.
  ["/strategies", "Strategies & Tags", Target],
  ["/reviews", "Reviews", Brain],
  ["/zakat", "Zakat", HandCoins],
  ["/settings", "Settings", Settings],
];

/**
 * Shown only to an admin. It is a separate list because `NAV_ITEMS` is what every visitor navigates by:
 * a customer should not see a link to a page about other customers, even one that would refuse them.
 */
export const ADMIN_ITEM: NavItem = ["/admin", "Admin", ShieldCheck];

/** Every section a page title or an active highlight can name — the sidebar, plus admin. */
export const SECTION_ITEMS: readonly NavItem[] = [...NAV_ITEMS, ADMIN_ITEM];

/** Nested routes (/journal/new, /journal/<id>) keep their section highlighted. */
export const isActive = (path: string, href: string) =>
  href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);

export function Sidebar({ isAdmin }: { isAdmin?: boolean }) {
  const path = usePathname();
  const items = isAdmin ? SECTION_ITEMS : NAV_ITEMS;
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">T</div>
        <span className="brand-text">Trading Journal</span>
      </div>
      <div className="section-label">Workspace</div>
      <nav>
        {items.map(([href, label, Icon]) => (
          <Link key={href} href={href} className={cn("nav-item", isActive(path, href) && "active")}>
            <Icon size={17} />
            <span className="nav-text">{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}

/** The four destinations a phone needs a permanent slot for; everything else lives behind More. */
const PRIMARY_HREFS: readonly string[] = ["/journal", "/analytics", "/calendar"];

/**
 * Phone navigation: a fixed bottom bar for the daily destinations plus a **More** button that opens
 * the entire section list in a sheet — which beats scrolling ten icons sideways along the bottom.
 */
export function MobileNav({ isAdmin }: { isAdmin?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const items = isAdmin ? SECTION_ITEMS : NAV_ITEMS;

  const [homeHref, homeLabel, HomeIcon] = NAV_ITEMS[0];
  const primary = items.filter(([href]) => PRIMARY_HREFS.includes(href));
  const rest = items.filter(([href]) => href !== "/" && !PRIMARY_HREFS.includes(href));
  const moreActive = rest.some(([href]) => isActive(path, href));

  return (
    <>
      <nav className="mobile-nav" aria-label="Sections">
        <Link href={homeHref} className={cn("nav-item", isActive(path, homeHref) && "active")}>
          <HomeIcon size={18} />
          <span className="nav-text">{homeLabel}</span>
        </Link>
        {primary.map(([href, label, Icon]) => (
          <Link key={href} href={href} className={cn("nav-item", isActive(path, href) && "active")}>
            <Icon size={18} />
            <span className="nav-text">{label}</span>
          </Link>
        ))}
        <button
          type="button"
          className={cn("nav-item", moreActive && "active")}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <MoreHorizontal size={18} />
          <span className="nav-text">More</span>
        </button>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent aria-label="All sections">
          <SheetHeader>
            <span className="brand brand-flat">
              <span className="brand-logo">T</span>
              <SheetTitle>Trading Journal</SheetTitle>
            </span>
            <SheetCloseButton />
          </SheetHeader>
          <div className="section-label">Workspace</div>
          <nav className="nav-sheet">
            {items.map(([href, label, Icon]) => (
              <Link
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={cn("nav-item", isActive(path, href) && "active")}
              >
                <Icon size={17} />
                <span className="nav-text">{label}</span>
              </Link>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}
