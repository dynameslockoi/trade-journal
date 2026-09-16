"use client";

import { usePathname } from "next/navigation";
import { QuickAdd } from "@/components/quick-add";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Pages that render on their own, without the workspace chrome. */
const standaloneRoutes = ["/login", "/signup"];

export function AppShell({ email, name, children }: { email: string; name?: string; children: React.ReactNode }) {
  const path = usePathname();
  if (standaloneRoutes.includes(path)) return <>{children}</>;
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
