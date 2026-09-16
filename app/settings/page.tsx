"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { KEYS } from "@/lib/data";
import { loadMe, type Me } from "@/lib/admin";
import { expiryNotice } from "@/lib/access";
import { useCachedQuery } from "@/lib/query-cache";
import { dateLabel, toISODate, today as todayInMalaysia } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Settings() {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  /**
   * When this account's access runs out.
   *
   * Read through the cache key the shell already fills on the way in, so opening Settings costs no
   * request for it. The date belongs here rather than only in the countdown band, because the band
   * deliberately stays quiet until a fortnight out — this is where a customer can always look it up.
   */
  const me = useCachedQuery<Me | null>(KEYS.me, loadMe, { enabled: true });
  const notice = expiryNotice(me.data, toISODate(todayInMalaysia()), { formatDate: dateLabel });
  /**
   * The line under the card. A read that failed is said out loud rather than dressed up as
   * "open-ended" — an empty date field and an unknown one look identical otherwise, and the customer
   * is the one asking because they want to know.
   */
  const accessNote = !me.data
    ? "Your access details could not be read just now — reload the page to try again."
    : me.data.is_admin
      ? "This is the account that runs the journal, so it has no end date of its own."
      : !notice
        ? "No end date. The journal stays open until we say otherwise."
        : notice.days < 0
          ? `This account's access ended on ${dateLabel(notice.until)}. Renewing it is a one-line change on our side.`
          : notice.days === 0
            ? `Today is the last day of access — after ${dateLabel(notice.until)} the journal stops opening until it is renewed.`
            : `${dateLabel(notice.until)} is the last day of access, which is ${notice.days} day${notice.days === 1 ? "" : "s"} from now.`;

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

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!userId) return;
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Enter a name."); return; }
    if (trimmed.length > 60) { toast.error("Keep the name under 60 characters."); return; }
    setBusy(true);
    const s = createClient();
    // Upsert covers a missing profile row; the RLS policy allows only your own id.
    const { error } = await s.from("profiles").upsert({ id: userId, display_name: trimmed }, { onConflict: "id" });
    if (!error) await s.auth.updateUser({ data: { display_name: trimmed } });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Name updated.");
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    const next = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(next)) { toast.error("Enter a valid email address."); return; }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ email: next });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(`Confirmation link sent to ${next}.`, { description: "Your current address keeps working until you confirm it." });
  }

  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) { toast.error("Use at least 8 characters."); return; }
    if (password !== confirm) { toast.error("The two passwords do not match."); return; }
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (!error) { setPassword(""); setConfirm(""); }
    if (error) toast.error(error.message);
    else toast.success("Password changed.");
  }

  return <div className="content max-w-[820px]">
    <PageHeader title="Settings" subtitle="Your account, sign-in details and where the journal's numbers come from." />

    {loading ? <Card><CardContent>Loading your account…</CardContent></Card> : <>
      <Card className="settings-card">
        <form onSubmit={saveName}>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent>
            <div className="grid two">
              <div className="form-field">
                <Label htmlFor="set-name">Display name</Label>
                <Input id="set-name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={60} />
              </div>
              <div className="form-field">
                <Label htmlFor="set-email-readonly">Email</Label>
                <Input id="set-email-readonly" value={email} readOnly disabled />
              </div>
            </div>
          </CardContent>
          <CardFooter className="settings-foot">
            <span className="muted">Shown as the avatar tooltip, and to you alone.</span>
            <Button disabled={busy}>Save name</Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="settings-card">
        <CardHeader><CardTitle>Access</CardTitle></CardHeader>
        <CardContent>
          <div className="grid two">
            <div className="form-field">
              <Label htmlFor="set-access-until">Access ends</Label>
              <Input id="set-access-until" value={notice ? dateLabel(notice.until) : "No end date"} readOnly disabled />
            </div>
            <div className="form-field">
              <Label htmlFor="set-access-left">Time left</Label>
              <Input
                id="set-access-left"
                readOnly
                disabled
                value={
                  !notice
                    ? "Open-ended"
                    : notice.days < 0
                      ? "Ended"
                      : notice.days === 0
                        ? "Last day"
                        : `${notice.days} day${notice.days === 1 ? "" : "s"}`
                }
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="settings-foot">
          {/* Two weeks out, the shell also shows this above every page — this card is the quiet
              version, so it says the date rather than repeating the warning. */}
          <span className="muted">{accessNote}</span>
        </CardFooter>
      </Card>

      <Card className="settings-card">
        <form onSubmit={saveEmail}>
          <CardHeader><CardTitle>Email address</CardTitle></CardHeader>
          <CardContent>
            <div className="form-field">
              <Label htmlFor="set-email">Sign-in email</Label>
              <Input id="set-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" />
            </div>
          </CardContent>
          <CardFooter className="settings-foot">
            <span className="muted">We send a confirmation link to the new address before it takes over.</span>
            <Button disabled={busy}>Update email</Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="settings-card">
        <form onSubmit={savePassword}>
          <CardHeader><CardTitle>Password</CardTitle></CardHeader>
          <CardContent>
            <div className="grid two">
              <div className="form-field">
                <Label htmlFor="set-password">New password</Label>
                <Input id="set-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" />
              </div>
              <div className="form-field">
                <Label htmlFor="set-confirm">Confirm password</Label>
                <Input id="set-confirm" type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
              </div>
            </div>
          </CardContent>
          <CardFooter className="settings-foot">
            <span className="muted">You stay signed in on this device after changing it.</span>
            <Button disabled={busy}>Change password</Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="settings-card">
        <CardHeader><CardTitle>Journal</CardTitle></CardHeader>
        <CardContent>
          <p className="muted m-0">
            Starting capital, currency, broker and risk limits belong to each trading account — set them on the{" "}
            <Link className="link" href="/accounts">Accounts page</Link>. Money is shown in the account's currency
            (MYR reads as RM) with thousands grouped, and the calendar's return on capital is measured against
            those starting balances.
          </p>
        </CardContent>
      </Card>
    </>}
  </div>;
}
