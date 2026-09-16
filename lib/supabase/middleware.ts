import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";

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
    return NextResponse.redirect(url);
  }
  if (user && (request.nextUrl.pathname === "/login" || request.nextUrl.pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}
