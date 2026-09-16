"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/**
 * A query that failed is not the same thing as a journal with nothing in it. Without this, a dropped
 * connection or a revoked session renders as "No trades match these filters." over an empty page —
 * which reads as data loss. Pages collect the first error the loader saw and hand it here.
 */
export function LoadError({ message, what = "your journal" }: { message?: string | null; what?: string }) {
  if (!message) return null;
  return (
    <Alert variant="error" className="load-error">
      <AlertTitle>Could not load {what}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/**
 * The `data` of a Supabase response, or null when the request carried an error — so a caller never
 * has to read `?? []` and quietly treat a failure as an empty result.
 */
export function firstError(...results: { error: { message: string } | null }[]) {
  return results.find(r => r?.error)?.error?.message ?? null;
}
