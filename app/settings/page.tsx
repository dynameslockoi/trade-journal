"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";

type Notice = { kind: "error" | "success"; text: string };

export default function Settings() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const s = createClient();
      const { data: { user } } = await s.auth.getUser();
      if (user) {
        setUserId(user.id);
        setEmail(user.email ?? "");
        // The profile row holds the name the app greets you with; auth metadata is the fallback.
        const { data: profile } = await s.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
        setName(profile?.display_name ?? user.user_metadata?.display_name ?? "");
      }
      setLoading(false);
    })();
  }, []);

  const flash = (notice: Notice) => {
    setNotice(notice);
    setTimeout(() => setNotice(null), 6000);
  };

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const trimmed = name.trim();
    if (!trimmed) return flash({ kind: "error", text: "Enter a name." });
    if (trimmed.length > 60) return flash({ kind: "error", text: "Keep the name under 60 characters." });
    setBusy(true);
    const s = createClient();
    // Upsert covers a missing profile row; the RLS policy allows only your own id.
    const { error } = await s.from("profiles").upsert({ id: userId, display_name: trimmed }, { onConflict: "id" });
    if (!error) await s.auth.updateUser({ data: { display_name: trimmed } });
    setBusy(false);
    flash(error ? { kind: "error", text: error.message } : { kind: "success", text: "Name updated." });
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    const next = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) return flash({ kind: "error", text: "Enter a valid email address." });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ email: next });
    setBusy(false);
    flash(error
      ? { kind: "error", text: error.message }
      : { kind: "success", text: `Confirmation link sent to ${next}. Your current address keeps working until you confirm it.` });
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return flash({ kind: "error", text: "Use at least 8 characters." });
    if (password !== confirm) return flash({ kind: "error", text: "The two passwords do not match." });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (!error) { setPassword(""); setConfirm(""); }
    flash(error ? { kind: "error", text: error.message } : { kind: "success", text: "Password changed." });
  }

  return <div className="content" style={{ maxWidth: 820 }}>
    <PageHeader title="Settings" subtitle="Your account, sign-in details and where the journal's numbers come from." />

    {notice && <div className={notice.kind === "error" ? "error" : "success"}>{notice.text}</div>}

    {loading ? <div className="card card-pad">Loading your account…</div> : <>
      <form className="card card-pad settings-card" onSubmit={saveName}>
        <h3>Profile</h3>
        <div className="grid two">
          <label className="field">Display name
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={60} />
          </label>
          <label className="field">Email
            <input className="input" value={email} readOnly disabled />
          </label>
        </div>
        <div className="settings-foot">
          <span className="muted">Shown as the avatar tooltip, and to you alone.</span>
          <button className="btn btn-primary" disabled={busy}>Save name</button>
        </div>
      </form>

      <form className="card card-pad settings-card" onSubmit={saveEmail}>
        <h3>Email address</h3>
        <label className="field">Sign-in email
          <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <div className="settings-foot">
          <span className="muted">We send a confirmation link to the new address before it takes over.</span>
          <button className="btn btn-primary" disabled={busy}>Update email</button>
        </div>
      </form>

      <form className="card card-pad settings-card" onSubmit={savePassword}>
        <h3>Password</h3>
        <div className="grid two">
          <label className="field">New password
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
          </label>
          <label className="field">Confirm password
            <input className="input" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
          </label>
        </div>
        <div className="settings-foot">
          <span className="muted">You stay signed in on this device after changing it.</span>
          <button className="btn btn-primary" disabled={busy}>Change password</button>
        </div>
      </form>

      <div className="card card-pad settings-card">
        <h3>Journal</h3>
        <p className="muted" style={{ margin: 0 }}>
          Starting capital, currency, broker and risk limits belong to each trading account — set them on the{" "}
          <Link className="link" href="/accounts">Accounts page</Link>. Money is shown in the account's currency
          (MYR reads as RM) with thousands grouped, and the calendar's return on capital is measured against
          those starting balances.
        </p>
      </div>
    </>}
  </div>;
}
