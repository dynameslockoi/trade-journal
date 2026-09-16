"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { accentTitle } from "@/components/page-header";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); setLoading(false); return; }
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { display_name: name } } });
    if (error) setError(error.message);
    else if (data.session) window.location.href = "/";
    else setMessage("Account created. Check your email to confirm your address, then sign in.");
    setLoading(false);
  }

  return <main className="auth-page">
    <Card className="auth-card">
      <CardContent>
        <div className="auth-logo">T</div>
        <h1>{accentTitle("Create your journal")}</h1>
        <p className="auth-sub muted">Your trading data stays in your Supabase project.</p>
        <form onSubmit={submit} className="grid gap-3 mt-5">
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
