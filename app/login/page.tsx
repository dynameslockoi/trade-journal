"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { loadMe } from "@/lib/admin";
import { accessState } from "@/lib/access";
import { toISODate, today } from "@/lib/dates";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accentTitle } from "@/components/page-header";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // `/auth/callback` sends a failed sign-in link here with its reason, so a dead link reads as one
  // instead of a silent bounce to a login form with no explanation.
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("error");
    if (reason) setError(reason);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    // A suspended or expired account is refused here too, not only by the app shell: signing in and
    // then being bounced by the first page reads as a bug rather than as a decision, and the session
    // would otherwise be left live behind it. The sign-out is a courtesy to the *database* as much as
    // the person — nothing is trusted to it.
    try {
      const state = accessState(await loadMe(), toISODate(today()));
      if (!state.ok) {
        await supabase.auth.signOut();
        setError(state.detail);
        setLoading(false);
        return;
      }
    } catch {
      // `supabase/admin.sql` has not been run, so there is no access state to enforce.
    }
    window.location.href = "/";
  }

  return <main className="auth-page">
    <Card className="auth-card">
      <CardContent>
        <div className="auth-logo">T</div>
        <h1>{accentTitle("Welcome back")}</h1>
        <p className="auth-sub muted">Sign in to your private trading journal.</p>
        <form onSubmit={submit} className="grid gap-3 mt-5">
          <div className="form-field">
            <Label htmlFor="login-email">Email</Label>
            <Input id="login-email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div className="form-field">
            <Label htmlFor="login-password">Password</Label>
            <Input id="login-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          {error && <Alert variant="error">{error}</Alert>}
          <Button disabled={loading}>{loading ? "Signing in…" : "Sign in"}</Button>
        </form>
        <p className="muted center mt-4">No account? <Link href="/signup" className="link">Create one</Link></p>
      </CardContent>
    </Card>
  </main>;
}
