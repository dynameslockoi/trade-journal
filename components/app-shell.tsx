"use client";
import { usePathname } from "next/navigation";
import { QuickAdd } from "@/components/quick-add";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

/** Pages that render on their own, without the workspace chrome. */
const standaloneRoutes = ["/login", "/signup"];

export function AppShell({ email, name, children }: { email: string; name?: string; children: React.ReactNode }) {
  const path = usePathname();
  if (standaloneRoutes.includes(path)) return <>{children}</>;
  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <Topbar email={email} name={name} />
        {children}
        <QuickAdd />
      </main>
    </div>
  );
}
