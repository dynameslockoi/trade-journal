import { AuthCard } from "@/components/auth-card";

/**
 * The same page as `/login`, opened on the sign-up panel. Sign-up is by invitation: the code is
 * checked before the account is created so a refusal arrives as a sentence — the database refuses an
 * uninvited signup too (see `handle_new_user` in `supabase/admin.sql`), and that refusal only ever
 * reaches the browser as "Database error saving new user", which tells the person nothing they can
 * act on. Codes are normalised before they are sent, so one read off a screenshot works whether it
 * was typed with the dashes, the spaces or the case it was written in.
 */
export default function Signup() {
  return <AuthCard initialMode="signup" />;
}
