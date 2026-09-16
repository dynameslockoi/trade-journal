"use client";

import { createClient } from "@/lib/supabase/client";
import { PermanentError } from "@/lib/query-cache";

/**
 * The admin surface: who is using the journal, who may still get in, and which invitation codes are
 * outstanding.
 *
 * Every read and write here is a SECURITY DEFINER function from `supabase/admin.sql` that checks
 * `public.is_admin()` on the database side. The browser never holds a key that can bypass RLS — the
 * admin page can no more read another account's trades than the journal page can, and the only thing
 * it can do to one is flip the access switch it was built to flip.
 *
 * `supabase/admin.sql` may not have been run yet. That is an expected state rather than a crash: the
 * functions are simply missing, so `isMissingSchema` below recognises PostgREST's "no such function"
 * answer and the page turns it into what to run instead of a raw parse error.
 */

export type Me = {
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  status: string;
  access_until: string | null;
};

export type AdminStats = {
  users: number;
  active: number;
  blocked: number;
  admins: number;
  new_this_month: number;
  trades: number;
  codes: number;
  codes_available: number;
};

export type AdminUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  status: string;
  is_admin: boolean;
  access_until: string | null;
  note: string | null;
  invite_code: string | null;
  trades: number;
  accounts: number;
  last_trade_at: string | null;
};

export type AdminInvite = {
  code: string;
  note: string | null;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  disabled: boolean;
  created_at: string;
  used_by: string[];
};

export type AdminOverview = { stats: AdminStats; users: AdminUser[]; invites: AdminInvite[] };

export type AdminResult = { ok: boolean; reason?: string; code?: string };

/**
 * True when the answer is "that function does not exist" rather than a real failure — the marker that
 * `supabase/admin.sql` still has to be run. PostgREST answers PGRST202 and, on a cold schema cache,
 * 404s with the same wording.
 */
export function isMissingSchema(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message.includes("PGRST202") ||
    message.includes("Could not find the function") ||
    message.includes("schema cache")
  );
}

/** What to do about it, shown in place of the page. */
export const SCHEMA_HINT =
  "The access functions are not in the database yet. Run supabase/admin.sql in the Supabase SQL editor, then reload this page.";

/**
 * A missing function is a permanent failure, not a transient one: the answer will not change until
 * somebody runs the SQL, and the shell reads this on every page, so retrying it would be a request
 * loop that only ever gets louder. Marked as such, the app shows the set-up card and stays quiet
 * until the page is reloaded.
 */
function failed(message: string): Error {
  return isMissingSchema(message) ? new PermanentError(message) : new Error(message);
}

/** The signed-in account: admin or not, allowed in or not. Null when there is no profile row. */
export async function loadMe(): Promise<Me | null> {
  const { data, error } = await createClient().rpc("me");
  if (error) throw failed(error.message);
  return (data as Me | null) ?? null;
}

/** One read for the whole admin page: counts, every account, every invitation code. */
export async function loadAdminOverview(): Promise<AdminOverview> {
  const { data, error } = await createClient().rpc("admin_overview");
  if (error) throw failed(error.message);
  const overview = data as AdminOverview | null;
  if (!overview) throw new Error("The admin overview returned nothing.");
  return overview;
}

/** Usable? — asked before an account exists, which is why it needs no session. */
export async function checkInviteCode(code: string): Promise<AdminResult> {
  const { data, error } = await createClient().rpc("check_invite", { code });
  // Not marked permanent: this runs once, from a form, on a screen with no cache behind it.
  if (error) throw new Error(error.message);
  return (data as AdminResult) ?? { ok: false, reason: "That invitation code could not be checked." };
}

/**
 * Set an account's access. All three fields are sent every time and a null clears, because the dialog
 * always knows the state it means to end up with: reactivating an account has to clear the end date
 * it was locked by, not leave it behind.
 */
export async function adminSetUser(input: {
  id: string;
  status: "active" | "suspended";
  accessUntil: string | null;
  note: string | null;
}): Promise<void> {
  const { error } = await createClient().rpc("admin_set_user", {
    target: input.id,
    new_status: input.status,
    new_access_until: input.accessUntil,
    new_note: input.note,
  });
  if (error) throw new Error(error.message);
}

export async function adminCreateInvite(input: {
  code: string;
  note: string;
  maxUses: number;
  expiresAt: string | null;
}): Promise<AdminResult> {
  const { data, error } = await createClient().rpc("admin_create_invite", {
    new_code: input.code || null,
    new_note: input.note || null,
    new_max_uses: input.maxUses,
    new_expires_at: input.expiresAt,
  });
  if (error) throw new Error(error.message);
  return (data as AdminResult) ?? { ok: false, reason: "The code was not created." };
}

export async function adminSetInvite(input: {
  code: string;
  disabled?: boolean;
  expiresAt?: string | null;
  clearExpiry?: boolean;
  note?: string;
}): Promise<void> {
  const { error } = await createClient().rpc("admin_set_invite", {
    target_code: input.code,
    new_disabled: input.disabled ?? null,
    new_expires_at: input.expiresAt ?? null,
    clear_expiry: input.clearExpiry ?? false,
    new_note: input.note ?? null,
  });
  if (error) throw new Error(error.message);
}
