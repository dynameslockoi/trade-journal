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

/**
 * Every navigation link here carries `unstable_dynamicOnHover`, which needs `experimental.dynamicOnHover`
 * in `next.config.ts` to have any effect.
 *
 * These links are the app's only way between sections, and a plain `<Link>` prefetch on a dynamic route
 * stops at the nearest `loading.tsx` — so what arrived early was the skeleton, while the route's own
 * JavaScript (70–95 KB, measured) started downloading after the click. With this prop the hover itself
 * starts the full prefetch, so a click lands on a page that is already in memory. It is on the phone nav
 * and the sheet as well, where the same prop is what a `touchstart` upgrades in the same way.
 *
 * Deliberately *not* `prefetch={true}`: every one of these links is in the viewport at load, so a full
 * prefetch of each would pull the whole app (~600 KB) down before the first number is read. The default
 * prefetch stays, which is the cheap one, and the full fetch waits for a pointer that actually goes
 * somewhere near the link.
 */
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
          <Link key={href} href={href} unstable_dynamicOnHover className={cn("nav-item", isActive(path, href) && "active")}>
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
        <Link href={homeHref} unstable_dynamicOnHover className={cn("nav-item", isActive(path, homeHref) && "active")}>
          <HomeIcon size={18} />
          <span className="nav-text">{homeLabel}</span>
        </Link>
        {primary.map(([href, label, Icon]) => (
          <Link key={href} href={href} unstable_dynamicOnHover className={cn("nav-item", isActive(path, href) && "active")}>
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
                unstable_dynamicOnHover
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
