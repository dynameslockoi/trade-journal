import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";
import { SESSION_ENDED, carriesAuthCookie } from "@/lib/session";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // Without credentials there is no session to refresh: let the layout show its setup screen.
  if (!isSupabaseConfigured) return response;
  const supabase = createServerClient(
    supabaseUrl!,
    supabaseAnonKey!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );
  // `getClaims` reads the session from the cookie and verifies its JWT against the project's signing
  // keys, which are cached in memory — so the check costs no round trip. `getUser` asks the auth
  // server every time, and this runs on every request, including every client-side navigation.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ? { id: data.claims.sub } : null;
  const path = request.nextUrl.pathname;
  const protectedPath = path === "/" ||
    ["/journal","/analytics","/calendar","/accounts","/strategies","/tags","/reviews","/zakat","/settings","/admin"]
      .some(p => path === p || path.startsWith(`${p}/`));
  if (!user && protectedPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Whatever query the page was reached with is not the sign-in page's business; the one below is.
    url.search = "";
    // A session that expired or was revoked leaves its cookie behind, so the browser arrives here
    // looking exactly like a first-time visitor while every request behind the cookie keeps failing.
    // Saying so is the difference between "I was signed out and do not know why" and knowing to sign
    // in again. A browser with no auth cookie at all is simply not signed in, and is told nothing.
    if (carriesAuthCookie(request.cookies.getAll().map(cookie => cookie.name))) {
      url.searchParams.set("error", SESSION_ENDED);
    }
    return NextResponse.redirect(url);
  }
  // `/reset-password` is deliberately not in this pair: the session that arrives from a recovery
  // link *is* a signed-in one, so bouncing it to the dashboard would swallow the password form.
  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}
