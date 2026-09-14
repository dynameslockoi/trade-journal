"use client";
import Link from "next/link";
import { LogOut, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/**
 * The account controls in the topbar: the avatar opens Settings and the sign-out is an icon
 * button. The email/display name is only the avatar's tooltip, so the bar stays quiet.
 */
export function UserMenu({ email, name }: { email: string; name?: string }) {
  async function signout() {
    await createClient().auth.signOut();
    window.location.href = "/login";
  }
  return (
    <div className="user-menu">
      <Link className="avatar" href="/settings" aria-label="Account settings" title={name?.trim() || email || "Account settings"}>
        <UserRound size={16} />
      </Link>
      <button className="icon-btn" type="button" onClick={signout} aria-label="Sign out" title="Sign out">
        <LogOut size={16} />
      </button>
    </div>
  );
}
