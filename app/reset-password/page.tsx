import { ResetPasswordCard } from "@/components/auth-card";

/**
 * Where a recovery link lands.
 *
 * `supabase.auth.resetPasswordForEmail` is pointed at `/auth/callback?next=/reset-password` (see
 * `sendRecoveryLink` in components/auth-card.tsx), so the callback swaps the code for a session on the
 * server and forwards here — which is the only shape that works, because the session cookie has to be
 * written by a response and the PKCE verifier has to be read from the same browser that asked.
 *
 * Nothing here is trusted: the page asks Supabase for the session before it draws a password form, and
 * an expired, already-used or foreign-browser link gets the explanation and a fresh link instead.
 */
export default function ResetPassword() {
  return <ResetPasswordCard />;
}
