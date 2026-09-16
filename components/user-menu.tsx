"use client";

import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { clear } from "@/lib/query-cache";
import { Button } from "@/components/ui/button";

/**
 * The account controls in the topbar: the avatar opens Settings and the sign-out is an icon
 * button. The email/display name is only the avatar's tooltip, so the bar stays quiet.
 */
export function UserMenu({ email, name }: { email: string; name?: string }) {
  async function signout() {
    // A sign-out that failed leaves the session live: sending the browser to the login page anyway
    // would look like it worked while the next request walked straight back in.
    const { error } = await createClient().auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }
    // The cached rows belong to the session that just ended.
    clear();
    window.location.href = "/login";
  }
  const label = name?.trim() || email || "Account settings";
  return (
    <div className="user-menu">
      <Button asChild variant="secondary" size="icon" className="avatar">
        <Link href="/settings" aria-label="Account settings" title={label}>
          <UserRound size={16} />
        </Link>
      </Button>
      <Button
        variant="secondary"
        size="icon"
        className="icon-btn"
        type="button"
        onClick={signout}
        aria-label="Sign out"
        title="Sign out"
      >
        <LogOut size={16} />
      </Button>
    </div>
  );
}
