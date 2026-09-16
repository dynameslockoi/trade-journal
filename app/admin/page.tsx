"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Ban, CheckCircle2, Copy, RefreshCw, Ticket } from "lucide-react";
import { KEYS } from "@/lib/data";
import { invalidate, useCachedQuery } from "@/lib/query-cache";
import {
  SCHEMA_HINT,
  adminCreateInvite,
  adminSetInvite,
  adminSetUser,
  isMissingSchema,
  loadAdminOverview,
  loadMe,
  type AdminInvite,
  type AdminOverview,
  type AdminUser,
  type Me,
} from "@/lib/admin";
import { accessState, daysLeft, inviteState, suggestInviteCode } from "@/lib/access";
import { dateLabel, toISODate, today as todayInMalaysia } from "@/lib/dates";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { LoadError } from "@/components/load-error";
import { ConfirmButton } from "@/components/confirm-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Who is using the journal, and who may still get in.
 *
 * An install sold to other people needs one page that answers "is this account alive, and should it
 * still be?" — signups, last activity, and a switch per account. It is deliberately not a window into
 * anybody's trading: the numbers here are counts and dates, because monitoring whether a customer is
 * active does not require reading their P&L, and a page that could would be a liability rather than a
 * feature. `admin_overview()` in `supabase/admin.sql` is what enforces that: it returns no trade rows
 * at all, only tallies.
 *
 * Access is a switch plus an optional end date rather than a subscription. That covers both ways this
 * is sold — open-ended, or a fixed term — without a plan table, a billing webhook or a renewal job,
 * and a date in the past locks the account out on its own, so nothing has to run on schedule for an
 * expiry to take effect.
 */

const TONE: Record<string, string> = { ok: "badge-ok", warn: "badge-warn", danger: "badge-danger" };

export default function AdminPage() {
  const today = toISODate(todayInMalaysia());
  // One read per session, shared with the shell, so this page adds no request of its own for it.
  const meQ = useCachedQuery<Me | null>(KEYS.me, loadMe);
  const isAdmin = Boolean(meQ.data?.is_admin);
  const overview = useCachedQuery<AdminOverview>(KEYS.admin, loadAdminOverview, { enabled: isAdmin });

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [busy, setBusy] = useState("");

  const error = meQ.error ?? overview.error;
  const missingSchema = isMissingSchema(meQ.error) || isMissingSchema(overview.error);

  const users = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (overview.data?.users ?? []).filter(u => {
      if (filter === "blocked" && accessState(u, today).ok) return false;
      if (filter === "active" && !accessState(u, today).ok) return false;
      if (filter === "admins" && !u.is_admin) return false;
      if (!q) return true;
      return [u.email, u.display_name, u.invite_code].some(v => (v ?? "").toLowerCase().includes(q));
    });
  }, [overview.data, search, filter, today]);

  /** After a write, re-read the overview — the page you are looking at is the thing that changed. */
  const refresh = () => invalidate(KEYS.admin);

  async function setAccess(user: AdminUser, status: "active" | "suspended", accessUntil: string | null, note: string | null) {
    setBusy(user.id);
    try {
      await adminSetUser({ id: user.id, status, accessUntil, note });
      toast.success(status === "suspended" ? `${user.email} suspended` : `${user.email} reactivated`);
      refresh();
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function toggleInvite(invite: AdminInvite, disabled: boolean) {
    setBusy(invite.code);
    try {
      await adminSetInvite({ code: invite.code, disabled });
      toast.success(disabled ? `${invite.code} switched off` : `${invite.code} switched back on`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  function copy(text: string, what: string) {
    navigator.clipboard?.writeText(text).then(
      () => toast.success(`${what} copied`),
      () => toast.error("The browser refused to copy."),
    );
  }

  if (missingSchema) {
    return (
      <div className="content">
        <PageHeader eyebrow="Operations" title="Admin" subtitle="Set this install up to run for other people." />
        <Card>
          <CardContent>
            <div className="card-head">
              <div>
                <b>One file to run</b>
                <div className="muted card-hint">{SCHEMA_HINT}</div>
              </div>
              <Badge>supabase/admin.sql</Badge>
            </div>
            {/* The promotion is the only statement that needs editing, so it is shown, not described. */}
            <p className="muted text-[11.5px] mt-4 mb-2">
              Then give your own account the admin flag — replace the address, and note the single quotes:
            </p>
            <pre className="input whitespace-pre-wrap text-[11px]">
              {`update public.profiles set is_admin = true\n where id = (select id from auth.users where email = 'you@example.com');`}
            </pre>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (meQ.data && !isAdmin) {
    return (
      <div className="content">
        <PageHeader title="Admin" />
        <Card>
          <CardContent className="empty">
            This page is only available to the account that runs this journal.
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = overview.data?.stats;
  const invites = overview.data?.invites ?? [];

  return (
    <div className="content">
      <PageHeader
        eyebrow="Operations"
        title="Admin"
        subtitle="Every account on this journal, what it is using, and whether it can still get in."
        actions={
          <Button variant="secondary" onClick={refresh} disabled={overview.loading}>
            <RefreshCw size={14} />
            Refresh
          </Button>
        }
      />
      <LoadError message={error} what="the admin overview" />

      {stats ? (
        <div className="grid four">
          <StatCard label="Accounts" value={String(stats.users)} sub={`${stats.active} active · ${stats.blocked} blocked`} />
          <StatCard label="Trades Logged" value={String(stats.trades)} sub={`${stats.new_this_month} joined this month`} />
          <StatCard
            label="Invitation Codes"
            value={String(stats.codes)}
            sub={`${stats.codes_available} still available`}
            positive={stats.codes_available > 0}
          />
          <StatCard label="Admins" value={String(stats.admins)} sub="can see this page" />
        </div>
      ) : overview.loading ? (
        <div className="grid four">
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[104px]" />
          <Skeleton className="h-[104px]" />
        </div>
      ) : null}

      <Card>
        <CardContent>
          <div className="card-head">
            <div>
              <b>Accounts</b>
              <div className="muted card-hint">
                Counts and dates only — this page never reads another account's journal.
              </div>
            </div>
            <div className="admin-toolbar">
              <Input
                className="admin-search"
                placeholder="Search name, email or code"
                value={search}
                onChange={e => setSearch(e.target.value)}
                aria-label="Search accounts"
              />
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="w-[150px]" aria-label="Filter accounts">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  <SelectItem value="active">Can sign in</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="admins">Admins</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="table-wrap mt-4">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Joined</th>
                  <th>Access</th>
                  <th>Usage</th>
                  <th className="text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const state = accessState(u, today);
                  const left = daysLeft(u.access_until, today);
                  const self = Boolean(meQ.data?.email) && meQ.data?.email === u.email;
                  return (
                    <tr key={u.id}>
                      <td className="admin-account">
                        <b>{u.display_name || "No name"}</b>
                        <span className="muted">{u.email ?? "—"}</span>
                        <span className="admin-tags">
                          {u.is_admin && <Badge className="badge-ok">Admin</Badge>}
                          {u.invite_code && <span className="admin-code">{u.invite_code}</span>}
                          {self && <span className="muted">you</span>}
                        </span>
                        {u.note && <span className="admin-note">{u.note}</span>}
                      </td>
                      <td className="muted">{dateLabel(u.created_at)}</td>
                      <td>
                        <Badge className={state.ok ? "badge-ok" : "badge-danger"}>{state.label}</Badge>
                        <div className="admin-note">
                          {u.access_until
                            ? left === null
                              ? ""
                              : left < 0
                                ? `ended ${dateLabel(u.access_until)}`
                                : left === 0
                                  ? "ends today"
                                  : `ends ${dateLabel(u.access_until)} · ${left} day${left === 1 ? "" : "s"} left`
                            : "no end date"}
                        </div>
                      </td>
                      <td>
                        {u.trades} trade{u.trades === 1 ? "" : "s"}
                        <div className="admin-note">
                          {u.last_trade_at ? `last ${dateLabel(u.last_trade_at)}` : "never traded"}
                        </div>
                      </td>
                      <td>
                        <div className="admin-actions">
                          <Button variant="secondary" size="sm" disabled={self} onClick={() => setEditing(u)}>
                            Access
                          </Button>
                          {u.status === "suspended" ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              // Enabled when the account is *blocked* — which, for a row that reads
                              // Suspended, it always is. A stale end date is dropped with it, because
                              // restoring the status while a past date still locks the account would
                              // report "reactivated" over a row that stays Expired.
                              disabled={self || busy === u.id}
                              onClick={() => setAccess(u, "active", left !== null && left < 0 ? null : u.access_until, u.note)}
                            >
                              <CheckCircle2 size={13} />
                              Reactivate
                            </Button>
                          ) : (
                            <ConfirmButton
                              size="sm"
                              // The database refuses a self-targeted change (`admin_set_user` raises
                              // "You cannot change your own access here."), so the button is off
                              // rather than able to raise a rule this page already knows.
                              disabled={self}
                              title={`Suspend ${u.email ?? "this account"}?`}
                              description="They are refused at their next page load and cannot sign back in. Nothing is deleted, and you can reactivate them here."
                              confirmLabel="Suspend"
                              onConfirm={() => setAccess(u, "suspended", u.access_until, u.note)}
                            >
                              <Ban size={13} />
                              Suspend
                            </ConfirmButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!users.length && !overview.loading && (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty">
                        {overview.data?.users.length
                          ? "No account matches that search."
                          : "No accounts yet. Create an invitation code below and send it to your first customer."}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <InvitePanel invites={invites} today={today} busy={busy} onChange={refresh} onToggle={toggleInvite} onCopy={copy} />

      {editing && (
        <AccessDialog
          user={editing}
          busy={busy === editing.id}
          onClose={() => setEditing(null)}
          onSave={(status, accessUntil, note) => setAccess(editing, status, accessUntil, note)}
        />
      )}
    </div>
  );
}

/**
 * One account's access, as a dialog rather than a column of inline controls: the three fields belong
 * together (a suspension with an end date would be a contradiction), and saving sends all three so a
 * reactivated account cannot keep the end date that locked it out.
 */
function AccessDialog({
  user,
  busy,
  onClose,
  onSave,
}: {
  user: AdminUser;
  busy: boolean;
  onClose: () => void;
  onSave: (status: "active" | "suspended", accessUntil: string | null, note: string | null) => void;
}) {
  const [status, setStatus] = useState<"active" | "suspended">(user.status === "suspended" ? "suspended" : "active");
  const [until, setUntil] = useState(user.access_until ?? "");
  const [note, setNote] = useState(user.note ?? "");

  return (
    <Dialog open onOpenChange={next => (next ? undefined : onClose())}>
      <DialogContent className="dialog-wide" aria-describedby={undefined}>
        <DialogTitle>{user.display_name || user.email}</DialogTitle>
        <p className="muted text-[11.5px] mt-1 mb-4">
          {user.email} · joined {dateLabel(user.created_at)}
          {user.invite_code ? ` · came in on ${user.invite_code}` : ""}
        </p>
        <div className="grid gap-3">
          <div className="form-field">
            <Label htmlFor="ad-status">Access</Label>
            <Select value={status} onValueChange={v => setStatus(v as "active" | "suspended")}>
              <SelectTrigger id="ad-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active — can sign in</SelectItem>
                <SelectItem value="suspended">Suspended — refused</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="form-field">
            <Label htmlFor="ad-until">Access ends</Label>
            <DatePicker id="ad-until" value={until} onChange={setUntil} placeholder="No end date" />
            <div className="muted text-[10.5px] mt-1">
              Leave empty for open-ended access. A date in the past locks the account out on its own, so a
              fixed term needs nothing to run when it expires.
            </div>
          </div>
          <div className="form-field">
            <Label htmlFor="ad-note">Note</Label>
            <Input
              id="ad-note"
              value={note}
              placeholder="Why this account is in this state"
              onChange={e => setNote(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSave(status, until || null, note.trim() || null)} disabled={busy}>
            {busy ? "Saving…" : "Save access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The codes themselves: where an account comes from, and how to stop one going further. */
function InvitePanel({
  invites,
  today,
  busy,
  onChange,
  onToggle,
  onCopy,
}: {
  invites: AdminInvite[];
  today: string;
  busy: string;
  onChange: () => void;
  onToggle: (invite: AdminInvite, disabled: boolean) => void;
  onCopy: (text: string, what: string) => void;
}) {
  const [code, setCode] = useState("");
  const [maxUses, setMaxUses] = useState("1");
  const [expires, setExpires] = useState("");
  const [note, setNote] = useState("");
  const [creating, setCreating] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const result = await adminCreateInvite({
        code,
        note,
        maxUses: Math.max(1, Number(maxUses) || 1),
        expiresAt: expires || null,
      });
      if (!result.ok) {
        toast.error(result.reason ?? "The code was not created.");
        return;
      }
      toast.success(`${result.code} created`);
      setCode("");
      setNote("");
      setMaxUses("1");
      setExpires("");
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <Card>
      <CardContent>
        <div className="card-head">
          <div>
            <b>Invitation codes</b>
            <div className="muted card-hint">
              A code is the only way in. Share one per customer, or one code for a group — and switch it
              off here when it has gone far enough.
            </div>
          </div>
          <Badge>
            <Ticket size={11} /> {invites.length} code{invites.length === 1 ? "" : "s"}
          </Badge>
        </div>

        {/* The creator sits above the list it feeds, so one card owns the whole subject. */}
        <form onSubmit={create} className="admin-create">
          <div className="form-field">
            <Label htmlFor="inv-code">Code</Label>
            <div className="flex gap-2">
              <Input
                id="inv-code"
                value={code}
                placeholder="Leave empty to generate"
                onChange={e => setCode(e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCode(suggestInviteCode(crypto.getRandomValues(new Uint8Array(8))))}
              >
                Generate
              </Button>
            </div>
          </div>
          <div className="form-field">
            <Label htmlFor="inv-uses">Uses</Label>
            <Input
              id="inv-uses"
              type="number"
              min={1}
              value={maxUses}
              onChange={e => setMaxUses(e.target.value)}
            />
          </div>
          <div className="form-field">
            <Label htmlFor="inv-expires">Expires</Label>
            <DatePicker id="inv-expires" value={expires} onChange={setExpires} placeholder="Never" />
          </div>
          <div className="form-field">
            <Label htmlFor="inv-note">Note</Label>
            <Input
              id="inv-note"
              value={note}
              placeholder="Who it is for"
              onChange={e => setNote(e.target.value)}
            />
          </div>
          <Button disabled={creating} className="self-end">
            {creating ? "Creating…" : "Create code"}
          </Button>
        </form>

        <div className="table-wrap mt-4">
          <table>
            <thead>
              <tr>
                <th>Code</th>
                <th>Status</th>
                <th>Used</th>
                <th>Expires</th>
                <th className="text-right">Change</th>
              </tr>
            </thead>
            <tbody>
              {invites.map(invite => {
                const state = inviteState(invite, today);
                return (
                  <tr key={invite.code}>
                    <td>
                      <span className="admin-code">{invite.code}</span>
                      <button
                        type="button"
                        className="admin-copy"
                        onClick={() => onCopy(invite.code, "Code")}
                        aria-label={`Copy ${invite.code}`}
                      >
                        <Copy size={12} />
                      </button>
                      {invite.note && <div className="admin-note">{invite.note}</div>}
                    </td>
                    <td>
                      <Badge className={TONE[state.tone]}>{state.label}</Badge>
                    </td>
                    <td>
                      {invite.used_count}/{invite.max_uses}
                      <div className="admin-note" title={invite.used_by.join(", ")}>
                        {invite.used_by.length
                          ? invite.used_by.length === 1
                            ? invite.used_by[0]
                            : `${invite.used_by.length} accounts`
                          : "nobody yet"}
                      </div>
                    </td>
                    <td className="muted">{invite.expires_at ? dateLabel(invite.expires_at) : "never"}</td>
                    <td>
                      <div className="admin-actions">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy === invite.code}
                          onClick={() => onToggle(invite, !invite.disabled)}
                        >
                          {invite.disabled ? "Switch on" : "Switch off"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!invites.length && (
                <tr>
                  <td colSpan={5}>
                    <div className="empty">No codes yet — nobody can create an account until you make one.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
