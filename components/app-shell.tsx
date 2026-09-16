"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { KEYS, warmData } from "@/lib/data";
import { loadMe, type Me } from "@/lib/admin";
import { accessState, expiryNotice } from "@/lib/access";
import { useCachedQuery } from "@/lib/query-cache";
import { dateLabel, toISODate, today as todayInMalaysia } from "@/lib/dates";
import { AccessDenied } from "@/components/access-denied";
import { AccessExpiry } from "@/components/access-expiry";
import { QuickAdd } from "@/components/quick-add";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Pages that render on their own, without the workspace chrome. */
const standaloneRoutes = ["/login", "/signup"];

export function AppShell({ email, name, children }: { email: string; name?: string; children: React.ReactNode }) {
  const path = usePathname();
  const standalone = standaloneRoutes.includes(path);

  /**
   * Whether this account may use the journal, and whether it may see the Admin page.
   *
   * One read per session, through the same cache every page uses, so it costs nothing on a
   * navigation. `enabled` keeps it off the sign-in screens, where there is no session to ask about.
   * A failure is deliberately *not* a block: if the read errors — the access functions not deployed
   * yet, say — `accessState(null)` allows the page through, because locking the owner out of their own
   * journal over a missing migration would be worse than letting a suspended account reload once.
   */
  const me = useCachedQuery<Me | null>(KEYS.me, loadMe, { enabled: !standalone && Boolean(email) });
  const today = toISODate(todayInMalaysia());
  const access = accessState(me.data, today);
  /**
   * The countdown a customer sees before their access ends. `scheduled` — anything more than a
   * fortnight away — renders nothing, so a year-long account carries no banner; the settings page is
   * where that date lives. It reaches the customer through the same cached `me` read as the gate, so
   * it costs no request of its own.
   */
  const notice = expiryNotice(me.data, today, { formatDate: dateLabel });
  const isAdmin = Boolean(me.data?.is_admin);

  /**
   * Read the pages behind the links before they are clicked.
   *
   * A cached page opens instantly, but the first walk through the app is still a series of cold
   * queries. Fetching the shared datasets once, while the browser is idle and after the page on
   * screen has settled, means the click that follows has nothing left to wait for. The hook order
   * matters: this sits above the standalone-route return so login pages skip it, mounted as a
   * sibling so it never renders anything.
   */
  useEffect(() => {
    if (standalone) return;
    // `requestIdleCallback` keeps the warm-up behind whatever the user is actually reading; the
    // timeout is the ceiling for a busy page, and a browser without it falls back to a short delay.
    const idle = (window as typeof window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
    if (idle) {
      const id = idle(() => warmData(), { timeout: 2500 });
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const timer = setTimeout(warmData, 600);
    return () => clearTimeout(timer);
  }, [standalone]);

  if (standalone) return <>{children}</>;
  if (!access.ok) return <AccessDenied state={access} notice={notice} email={email} />;
  return (
    <TooltipProvider delayDuration={300}>
      <div className="shell">
        <Sidebar isAdmin={isAdmin} />
        <main className="main">
          <Topbar email={email} name={name} />
          <AccessExpiry notice={notice} />
          {children}
          <QuickAdd />
        </main>
        <MobileNav isAdmin={isAdmin} />
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
