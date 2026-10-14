import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/session";

/**
 * Where every emailed link lands: an address confirmation, a recovery link, an invitation.
 *
 * `next` is what lets one route serve all of them. A confirmation goes on to the dashboard, a
 * recovery link to the page that sets a new password — and the destination travels in the link Supabase
 * sends, the shape its own Next.js guide uses (`?next=/reset-password`), because a recovery link that
 * landed on the dashboard would consume the one-time code and then show the reader a journal they
 * cannot open.
 *
 * It is a query parameter in a URL anybody can write, so it is treated as input rather than as a hint:
 * only a path on this site survives `safeNextPath`. An unchecked version turns this route into an open
 * redirect — a phishing mail that borrows the domain it is trusted under.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), url.origin);

  /**
   * Send the reader on with the reason attached. A dead link lands on the page that can act on it —
   * the reset page offers a fresh one — and anything else falls back to the sign-in form, which is
   * where a failed confirmation belongs.
   */
  const fail = (reason: string) => {
    const to = new URL(next ?? "/login", url.origin);
    to.searchParams.set("error", reason);
    return NextResponse.redirect(to);
  };

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // A code can be expired, already used, or from another browser. Sending that back to the
    // dashboard would land on a protected page with no session and bounce to /login for no
    // stated reason, so the destination is told what happened instead.
    if (error) return fail(error.message);
    return NextResponse.redirect(new URL(next ?? "/", url.origin));
  }

  // Supabase's own half of the flow: its verify endpoint answers a link it will not accept with
  // `error` / `error_description` on this URL, and no code at all. Without this the reader was
  // silently dropped on the dashboard and bounced, with nothing said about why.
  const refused = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (refused) return fail(refused);

  return NextResponse.redirect(new URL(next ?? "/", url.origin));
}
