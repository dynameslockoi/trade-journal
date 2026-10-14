/**
 * A session that ended on its own — expired, refreshed-token revoked, or belonging to an account
 * that no longer exists.
 *
 * This is a different thing from the access gate in `lib/access.ts`. That file decides whether an
 * account *may* use the journal and answers "suspended" or "expired" about the account; this one
 * answers "is this browser still signed in at all?" about the session. An account can be perfectly
 * allowed in and still be holding a dead cookie, and the two want different screens: the access gate
 * keeps someone signed in and tells them why the journal is closed, while a dead session has nobody
 * to tell — there is no session to read a profile with — so the honest answer is the sign-in page
 * with a sentence explaining the bounce.
 *
 * Kept here, with no Supabase import, so the middleware (edge), the shell (browser) and
 * `scripts/auth-check.mts` all use one copy of the rule and it can be exercised without either.
 */

/** The sentence a customer reads when their session ended without them asking. */
export const SESSION_ENDED = "Your session has ended. Sign in again to continue.";

/**
 * Does this browser hold a Supabase auth cookie?
 *
 * The reason it matters: a signed-out visitor and someone whose session just died arrive at a
 * protected page identically — no user, same redirect — but only the second one is owed an
 * explanation. The cookie is what tells them apart, because clearing a dead session is not something
 * the client always gets to do: a refresh token revoked from the dashboard, or an account deleted
 * while a tab was open, leaves the cookie sitting there while every request behind it fails.
 *
 * Both shapes are matched, because `@supabase/ssr` splits a large session across numbered chunks:
 * `sb-<ref>-auth-token`, `sb-<ref>-auth-token.0`, `sb-<ref>-auth-token.1`.
 */
export function carriesAuthCookie(names: Iterable<string>): boolean {
  for (const name of names) if (/^sb-.+-auth-token(\.\d+)?$/.test(name)) return true;
  return false;
}

/**
 * Which failures mean the session is gone rather than the data being unavailable.
 *
 * Every one of these is a *fixed* answer: a dead token does not become valid by asking again, so the
 * page has to stop and send the person to sign in. Everything else — a dropped connection, a
 * timeout, a permission the database refused — is left alone, because signing somebody out over a
 * flaky network would lose their unsaved work for no reason.
 *
 * The wordings come from the two services that produce them: PostgREST (`JWT expired`,
 * `PGRST301`) when the access token is stale, and GoTrue (`Invalid Refresh Token`,
 * `Auth session missing!`) when the refresh behind it is gone too.
 */
const STALE_SESSION = [
  "jwt expired",
  "invalid jwt",
  "jwt verification failed",
  "pgrst301",
  "auth session missing",
  "session_not_found",
  "invalid refresh token",
  "refresh token not found",
  "refresh_token_not_found",
  // A token that outlived the account: the signature still checks out, but the subject is gone.
  "sub claim in jwt does not exist",
];

export function isStaleSession(message: string | null | undefined): boolean {
  if (!message) return false;
  const text = message.toLowerCase();
  return STALE_SESSION.some(pattern => text.includes(pattern));
}

/**
 * Where an emailed link is allowed to return to: a path on this site, and nothing else.
 *
 * The destination travels in the link Supabase sends (`/auth/callback?next=/reset-password`), which
 * means it is a query parameter in a URL anybody can write — so it is treated as untrusted input, not
 * as a hint. An absolute URL is refused before it is parsed, and whatever survives has to still
 * resolve to this origin, which is also what rules out the `//evil.example` form that a bare
 * `startsWith("/")` check waves through. Without this the callback is an open redirect, and an open
 * redirect on an auth route is how a phishing mail borrows the domain it is trusted under.
 *
 * The query string is kept, so a destination that carries state (`/reset-password?from=email`) still
 * gets it.
 */
export function safeNextPath(value: string | null | undefined, origin: string): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
