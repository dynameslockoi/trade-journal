import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // `/auth/callback` and `/auth/signout` manage their own Supabase session inside the route
  // handler (see app/auth/*/route.ts) and don't read or depend on anything this proxy sets, so
  // running the claim check before them is wasted work — excluded here.
  //
  // Everything else stays covered on purpose: unlike a mostly-public app, this journal is
  // protected-by-default (see `protectedPath` in lib/supabase/middleware.ts), and `getClaims()`
  // is also what keeps the Supabase session cookie refreshed as it nears expiry. Narrowing the
  // matcher further would trade that refresh away and risk sessions going stale mid-visit.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/callback|auth/signout|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
