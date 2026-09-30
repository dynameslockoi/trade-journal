"use client";

import { SeedContext } from "@/lib/query-cache";

/**
 * Hands the rows the server read for this page load (see `lib/seed.ts`) to everything under it.
 *
 * It exists as a component because a context can only be *provided* from the client side of the
 * boundary: the root layout is a server component and holds the rows, and this is the smallest piece
 * of the client that can put them where the hooks read them.
 *
 * It sits above `AppShell`, not inside it, because the shell reads the cache too — its own access
 * check is the `me` read — and a component cannot consume the context it provides.
 */
export function CacheSeed({ seed, children }: { seed: Record<string, unknown>; children: React.ReactNode }) {
  return <SeedContext.Provider value={seed}>{children}</SeedContext.Provider>;
}
