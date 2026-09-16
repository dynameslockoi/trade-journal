"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { checkInviteCode, isMissingSchema } from "@/lib/admin";
import { normalizeInviteCode } from "@/lib/access";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accentTitle } from "@/components/page-header";

/**
 * Sign-up is by invitation. The code is checked before the account is created so a refusal arrives as
 * a sentence — the database refuses an uninvited signup too (see `handle_new_user` in
 * `supabase/admin.sql`), and that refusal only ever reaches the browser as "Database error saving new
 * user", which tells the person nothing they can act on.
 *
 * Codes are normalised before they are sent, so one read off a screenshot works whether it was typed
 * with the dashes, the spaces or the case it was written in.
 */
export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); setLoading(false); return; }
    const code = normalizeInviteCode(invite);
    if (!code) { setError("Enter the invitation code you were given."); setLoading(false); return; }
    const supabase = createClient();
    try {
      const check = await checkInviteCode(code);
      if (!check.ok) {
        setError(check.reason ?? "That invitation code cannot be used.");
        setLoading(false);
        return;
      }
    } catch (err) {
      // `supabase/admin.sql` has not been run on this project, so there are no codes and no gate.
      // Anything else is a real failure and blocking the signup would be the wrong answer to it.
      const message = err instanceof Error ? err.message : String(err);
      if (!isMissingSchema(message)) { setError(message); setLoading(false); return; }
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: name, invite_code: code } },
    });
    if (error) setError(/database error/i.test(error.message) ? "That invitation code could not be accepted. Check it, or ask for a fresh one." : error.message);
    else if (data.session) window.location.href = "/";
    else setMessage("Account created. Check your email to confirm your address, then sign in.");
    setLoading(false);
  }

  return <main className="auth-page">
    <Card className="auth-card">
      <CardContent>
        <div className="auth-logo">T</div>
        <h1>{accentTitle("Create your journal")}</h1>
        <p className="auth-sub muted">Invitation only. Your trading data stays in your Supabase project.</p>
        <form onSubmit={submit} className="grid gap-3 mt-5">
          <div className="form-field">
            <Label htmlFor="signup-invite">Invitation code</Label>
            <Input
              id="signup-invite"
              required
              autoComplete="off"
              value={invite}
              onChange={e => setInvite(e.target.value)}
              placeholder="e.g. BURSA2026"
            />
            <div className="muted text-[10.5px] mt-1">
              Dashes, spaces and capitals do not matter. Ask for a new code if yours is refused.
            </div>
          </div>
          <div className="form-field">
            <Label htmlFor="signup-name">Display name</Label>
            <Input id="signup-name" value={name} onChange={e => setName(e.target.value)} placeholder="Trader" />
          </div>
          <div className="form-field">
            <Label htmlFor="signup-email">Email</Label>
            <Input id="signup-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="form-field">
            <Label htmlFor="signup-password">Password</Label>
            <Input id="signup-password" type="password" minLength={8} required value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <Alert variant="error">{error}</Alert>}
          {message && <Alert variant="success">{message}</Alert>}
          <Button disabled={loading}>{loading ? "Creating…" : "Create account"}</Button>
        </form>
        <p className="muted center mt-4">Already registered? <Link href="/login" className="link">Sign in</Link></p>
      </CardContent>
    </Card>
  </main>;
}
