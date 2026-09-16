"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { warmData } from "@/lib/data";
import { QuickAdd } from "@/components/quick-add";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Pages that render on their own, without the workspace chrome. */
const standaloneRoutes = ["/login", "/signup"];

export function AppShell({ email, name, children }: { email: string; name?: string; children: React.ReactNode }) {
  const path = usePathname();

  /**
   * Read the pages behind the links before they are clicked.
   *
   * A cached page opens instantly, but the first walk through the app is still a series of cold
   * queries. Fetching the shared datasets once, while the browser is idle and after the page on
   * screen has settled, means the click that follows has nothing left to wait for. The hook order
   * matters: this sits above the standalone-route return so login pages skip it, mounted as a
   * sibling so it never renders anything.
   */
  const standalone = standaloneRoutes.includes(path);
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
  return (
    <TooltipProvider delayDuration={300}>
      <div className="shell">
        <Sidebar />
        <main className="main">
          <Topbar email={email} name={name} />
          {children}
          <QuickAdd />
        </main>
        <MobileNav />
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
