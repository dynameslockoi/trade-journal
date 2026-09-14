"use client";
import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

export default function Signup() {
  const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [name,setName]=useState("");
  const [error,setError]=useState(""); const [message,setMessage]=useState(""); const [loading,setLoading]=useState(false);
  async function submit(e:FormEvent){e.preventDefault();setLoading(true);setError("");setMessage("");
    if(password.length<8){setError("Password must be at least 8 characters.");setLoading(false);return;}
    const supabase=createClient();
    const {data,error}=await supabase.auth.signUp({email,password,options:{data:{display_name:name}}});
    if(error) setError(error.message);
    else if(data.session) window.location.href="/";
    else setMessage("Account created. Check your email to confirm your address, then sign in.");
    setLoading(false);
  }
  return <main className="auth-page"><div className="auth-card card card-pad">
    <div className="auth-logo">T</div><h1>Create your journal</h1><p className="muted">Your trading data stays in your Supabase project.</p>
    <form onSubmit={submit} className="grid" style={{marginTop:20,gap:12}}>
      <label className="field">Display name<input className="input" value={name} onChange={e=>setName(e.target.value)} placeholder="Trader"/></label>
      <label className="field">Email<input className="input" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/></label>
      <label className="field">Password<input className="input" type="password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {error&&<div className="error">{error}</div>}{message&&<div className="success">{message}</div>}
      <button className="btn btn-primary" disabled={loading}>{loading?"Creating…":"Create account"}</button>
    </form>
    <p className="muted center">Already registered? <Link href="/login" className="link">Sign in</Link></p>
  </div></main>
}
