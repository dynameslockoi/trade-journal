import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // A code can be expired, already used, or from another browser. Sending that back to the
    // dashboard would land on a protected page with no session and bounce to /login for no
    // stated reason, so the login page is told what happened instead.
    if (error) {
      return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url.origin));
    }
  }
  return NextResponse.redirect(new URL("/", url.origin));
}
