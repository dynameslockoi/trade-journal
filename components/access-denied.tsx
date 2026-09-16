"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clear } from "@/lib/query-cache";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { accentTitle } from "@/components/page-header";
import type { AccessNotice, AccessState } from "@/lib/access";

/**
 * The screen a suspended or expired account gets instead of the journal.
 *
 * It is a full stop, not a warning band: the rows are not rendered behind it, so nothing about the
 * journal is left on screen or in memory once access ends. The one action is signing out, which is
 * the only thing that account can usefully do — and it is here rather than in a toast so an expired
 * customer is told what happened and on what date, instead of bouncing between pages that each
 * refuse them.
 *
 * The date comes from the expiry notice when there is one, because that is the version formatted the
 * way the rest of the app writes dates — "16 Sept 2026" rather than the ISO string `accessState`
 * carries, which is fine for a test assertion and wrong for the last thing a customer reads.
 */
export function AccessDenied({ state, notice, email }: { state: AccessState; notice?: AccessNotice | null; email?: string }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function signout() {
    setBusy(true);
    setError("");
    const { error: signOutError } = await createClient().auth.signOut();
    if (signOutError) {
      // Signing out failed, so the session is still live: say so rather than appearing to do nothing.
      setError(signOutError.message);
      setBusy(false);
      return;
    }
    clear();
    window.location.href = "/login";
  }

  return (
    <main className="auth-page">
      <Card className="auth-card">
        <CardContent>
          <div className="auth-logo" aria-hidden>
            T
          </div>
          <h1>{accentTitle(state.reason === "expired" ? "Access expired" : "Access paused")}</h1>
          <p className="auth-sub muted">{state.reason === "expired" && notice?.key === "expired" ? notice.detail : state.detail}</p>
          {email && <p className="muted center mt-4 mb-0 text-[11px]">{email}</p>}
          {error && <p className="error mt-4 mb-0">{error}</p>}
          <div className="settings-actions">
            <Button onClick={signout} disabled={busy}>
              <LogOut size={14} />
              {busy ? "Signing out…" : "Sign out"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
