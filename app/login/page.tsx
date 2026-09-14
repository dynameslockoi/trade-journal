"use client";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function Login() {
  const [email,setEmail]=useState(""); const [password,setPassword]=useState("");
  const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setLoading(true);setError("");
    const supabase=createClient(); const {error}=await supabase.auth.signInWithPassword({email,password});
    if(error) setError(error.message); else window.location.href="/";
    setLoading(false);
  }
  return <main className="auth-page"><div className="auth-card card card-pad">
    <div className="auth-logo">T</div><h1>Welcome back</h1><p className="muted">Sign in to your private trading journal.</p>
    <form onSubmit={submit} className="grid" style={{marginTop:20,gap:12}}>
      <label className="field">Email<input className="input" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label className="field">Password<input className="input" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {error&&<div className="error">{error}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading?"Signing in…":"Sign in"}</button>
    </form>
    <p className="muted center">No account? <Link href="/signup" className="link">Create one</Link></p>
  </div></main>
}
