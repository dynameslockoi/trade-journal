"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { KEYS } from "@/lib/data";
import { loadMe, type Me } from "@/lib/admin";
import { accessState, expiryNotice } from "@/lib/access";
import { isStaleSession, SESSION_ENDED } from "@/lib/session";
import { browserClient } from "@/lib/supabase/browser";
import { clear, useCachedQuery } from "@/lib/query-cache";
import { dateLabel, toISODate, today as todayInMalaysia } from "@/lib/dates";
import { AccessDenied } from "@/components/access-denied";
import { AccessExpiry } from "@/components/access-expiry";
import { QuickAdd } from "@/components/quick-add";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Pages that render on their own, without the workspace chrome. */
const standaloneRoutes = ["/login", "/signup", "/reset-password"];

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
   * A session that died while the page was already open.
   *
   * The middleware catches the common case — a cookie whose token no longer verifies at all — because
   * it runs before the page does. This catches the one it cannot see: a token that still verifies but
   * no longer has an account behind it, which arrives here as a refusal from the database rather than
   * as a redirect. Left alone that reads as an empty journal or a page of error cards, which is a
   * worse answer than asking somebody to sign in again.
   *
   * The sign-out is not a courtesy here, it is the fix: the cookie is what the middleware believes,
   * so a dead one left in place would keep bouncing a fresh sign-in straight back to the dashboard.
   */
  useEffect(() => {
    if (!me.error || !isStaleSession(me.error)) return;
    void (async () => {
      try {
        await (await browserClient()).auth.signOut();
      } catch {
        // It was already gone; clearing the cache and leaving is all that is left to do.
      }
      clear();
      window.location.href = `/login?error=${encodeURIComponent(SESSION_ENDED)}`;
    })();
  }, [me.error]);

  // The pages behind the links used to be fetched in the background from here, on an idle callback.
  // Nothing needs warming now: the server reads every shared row set before it sends the page and
  // hands them down through `CacheSeed` (see lib/seed.ts), so the cache is already full before the
  // first link is clicked — and the browser never has to ask for those rows at all.

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
