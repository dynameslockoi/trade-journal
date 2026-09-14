"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, CalendarDays, HandCoins, LayoutDashboard, Settings, WalletCards, Target, Brain } from "lucide-react";

export const NAV_ITEMS = [
  ["/", "Dashboard", LayoutDashboard],
  ["/journal", "Journal", BookOpen],
  ["/analytics", "Analytics", BarChart3],
  ["/calendar", "Calendar", CalendarDays],
  ["/accounts", "Accounts", WalletCards],
  ["/strategies", "Strategies", Target],
  ["/tags", "Tags", Target],
  ["/reviews", "Reviews", Brain],
  ["/zakat", "Zakat", HandCoins],
  ["/settings", "Settings", Settings]
] as const;

export function Sidebar() {
  const path = usePathname();
  // Nested routes (/journal/new, /journal/<id>) keep their section highlighted.
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">T</div>
        <span className="brand-text">Trading Journal</span>
      </div>
      <div className="section-label">Workspace</div>
      <nav>
        {NAV_ITEMS.map(([href, label, Icon]) => (
          <Link key={href} href={href} className={`nav-item ${isActive(href) ? "active" : ""}`}>
            <Icon size={17}/><span className="nav-text">{label}</span>
          </Link>
        ))}
      </nav>
    </aside>
  );
}
