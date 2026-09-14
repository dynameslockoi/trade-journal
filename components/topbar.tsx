"use client";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { NAV_ITEMS } from "@/components/sidebar";

/** Title of the deepest nav section the current path belongs to. */
function sectionFor(path: string) {
  const matches = NAV_ITEMS.filter(([href]) => href !== "/" && (path === href || path.startsWith(`${href}/`)));
  if (matches.length) return matches.reduce((a, b) => (b[0].length > a[0].length ? b : a))[1];
  return "Dashboard";
}

export function Topbar({ email, name }: { email: string; name?: string }) {
  const path = usePathname();
  const section = sectionFor(path);
  return (
    <div className="topbar">
      <div className="topbar-title">
        <span className="muted">Workspace</span>
        <span className="crumb-sep">/</span>
        <b>{section}</b>
      </div>
      <div className="topbar-actions">
        <ThemeToggle />
        <UserMenu email={email} name={name} />
      </div>
    </div>
  );
}
