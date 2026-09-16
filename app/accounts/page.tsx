"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { capitalByAccount, dayKey, formatMoney, type CashFlow } from "@/lib/trading";
import { dateLabel } from "@/lib/dates";
import { BROKER_PRESETS, DEFAULT_BROKER_ID, brokerPreset } from "@/lib/fees";
import { PageHeader } from "@/components/page-header";
import { ConfirmButton } from "@/components/confirm-button";
import { LoadError, firstError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Account = { id: string; name: string; account_type: string; currency: string; max_daily_loss: number | null; max_drawdown: number | null; broker: string | null };
type Trade = { account_id: string | null; net_pnl: number };
type Movement = CashFlow & { id: string };
type Kind = "deposit" | "withdrawal";

const initial = { name: "", account_type: "personal", currency: "MYR", broker: DEFAULT_BROKER_ID, opening: "", max_daily_loss: "", max_drawdown: "" };
const emptyEntry = { amount: "", occurred_on: "", note: "" };

export default function Accounts() {
  const [items, setItems] = useState<Account[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  // Null means the ledger could not be read: supabase/cashflow.sql has not been run yet.
  const [flows, setFlows] = useState<CashFlow[] | null>(null);
  const [open, setOpen] = useState(false);
  // The id being edited, or null when the form is creating a new account.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  // Separate from the form's own error: a failed list load is a page-level problem, not a field one.
  const [loadError, setLoadError] = useState<string | null>(null);
  // The account a deposit/withdrawal is being recorded against.
  const [moving, setMoving] = useState<{ account: Account; kind: Kind } | null>(null);
  const [entry, setEntry] = useState(emptyEntry);
  const [savingMove, setSavingMove] = useState(false);

  async function load() {
    const s = createClient();
    const [a, t, f] = await Promise.all([
      s.from("trading_accounts").select("*").order("created_at", { ascending: false }),
      s.from("trades").select("account_id,net_pnl"),
      s.from("account_cash_flows").select("id,account_id,kind,amount,occurred_on,note").order("occurred_on", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    // A missing ledger table is an expected state, not a page failure, so it is not folded into
    // `loadError` — the page falls back to opening balances and says what to run.
    setLoadError(firstError(a, t));
    setItems((a.data ?? []) as Account[]);
    setTrades((t.data ?? []) as Trade[]);
    setFlows(f.error ? null : ((f.data ?? []) as CashFlow[]));
  }
  useEffect(() => { load(); }, []);

  const pnlBy = useMemo(
    () => trades.reduce<Record<string, number>>((m, t) => { if (t.account_id) m[t.account_id] = (m[t.account_id] || 0) + Number(t.net_pnl || 0); return m; }, {}),
    [trades]
  );
  const capital = useMemo(() => capitalByAccount(items, flows), [items, flows]);
  const totals = (id: string) => capital[id] ?? { deposited: 0, withdrawn: 0, net: 0 };
  const movementsBy = useMemo(
    () => (flows ?? []).reduce<Record<string, Movement[]>>((m, f) => { (m[f.account_id] ??= []).push(f as Movement); return m; }, {}),
    [flows]
  );

  const set = (k: string, v: string) => setForm(x => ({ ...x, [k]: v }));
  const close = () => { setOpen(false); setEditing(null); setForm(initial); setError(""); };
  const startEdit = (a: Account) => {
    setError("");
    setEditing(a.id);
    setForm({
      name: a.name,
      account_type: a.account_type,
      currency: a.currency,
      broker: a.broker ?? DEFAULT_BROKER_ID,
      opening: "",
      max_daily_loss: a.max_daily_loss === null ? "" : String(a.max_daily_loss),
      max_drawdown: a.max_drawdown === null ? "" : String(a.max_drawdown),
    });
    setOpen(true);
  };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const s = createClient();
    const { data: { user } } = await s.auth.getUser();
    if (!user) { setError("Please sign in again."); return; }
    const opening = form.opening.trim() === "" ? 0 : Number(form.opening);
    if (!form.name.trim()) { setError("Enter an account name."); return; }
    if (!Number.isFinite(opening) || opening < 0) { setError("The opening deposit must be a non-negative amount."); return; }
    const payload: any = {
      user_id: user.id,
      name: form.name.trim(),
      account_type: form.account_type,
      currency: form.currency.trim().toUpperCase() || "MYR",
      broker: form.broker,
      max_daily_loss: form.max_daily_loss ? Number(form.max_daily_loss) : null,
      max_drawdown: form.max_drawdown ? Number(form.max_drawdown) : null,
    };
    // The legacy column is kept in step so an account still has capital if the ledger has not been
    // created yet; nothing reads it for maths once `account_cash_flows` exists.
    if (!editing) payload.starting_balance = opening;
    // The broker column may not exist on a database the Phase 7 migration has not reached, so a
    // failure that names it retries without it.
    const send = async (row: any) => editing
      ? s.from("trading_accounts").update(row).eq("id", editing)
      : s.from("trading_accounts").insert(row).select("id").single();
    const withoutUserId = ({ user_id, ...rest }: any) => rest;
    const row = editing ? withoutUserId(payload) : payload;
    let { data: created, error: writeError } = await send(row);
    if (writeError && (writeError.code === "PGRST204" || /broker/.test(writeError.message ?? ""))) {
      const { broker, ...rest } = row;
      ({ data: created, error: writeError } = await send(rest));
    }
    if (writeError) { setError(writeError.message); return; }

    // The opening amount is the account's first movement, so capital has one source.
    const newId = editing ?? (created as any)?.id;
    if (!editing && opening > 0 && newId) {
      const { error: flowError } = await s.from("account_cash_flows").insert({
        user_id: user.id, account_id: newId, kind: "deposit", amount: opening, note: "Opening balance",
      });
      // A missing ledger (or any refusal) must not lose the account that was just created.
      if (flowError) setError(`Account saved, but the opening deposit was not recorded: ${flowError.message}`);
    }
    close();
    load();
  }

  async function remove(id: string) {
    const { error } = await createClient().from("trading_accounts").delete().eq("id", id);
    if (error) setError(error.message);
    else load();
  }

  async function saveMovement(e: React.FormEvent) {
    e.preventDefault();
    if (!moving) return;
    const amount = Number(entry.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError("Enter an amount greater than zero."); return; }
    setSavingMove(true); setError("");
    const s = createClient();
    const { data: { user } } = await s.auth.getUser();
    if (!user) { setError("Please sign in again."); setSavingMove(false); return; }
    const { error: writeError } = await s.from("account_cash_flows").insert({
      user_id: user.id,
      account_id: moving.account.id,
      kind: moving.kind,
      amount,
      occurred_on: entry.occurred_on || dayKey(new Date()),
      note: entry.note.trim() || null,
    });
    setSavingMove(false);
    if (writeError) { setError(writeError.message); return; }
    setMoving(null);
    setEntry(emptyEntry);
    load();
  }

  async function removeMovement(id: string) {
    const { error } = await createClient().from("account_cash_flows").delete().eq("id", id);
    if (error) setError(error.message);
    else load();
  }

  const openMovement = (account: Account, kind: Kind) => {
    setError("");
    setEntry({ ...emptyEntry, occurred_on: dayKey(new Date()) });
    setMoving({ account, kind });
  };

  return (
    <div className="content">
      <PageHeader
        title="Accounts"
        subtitle="Money in and out, live journal equity, broker fees and risk limits."
        actions={
          <Button onClick={() => { setError(""); setEditing(null); setForm(initial); setOpen(true); }}>+ Add Account</Button>
        }
      />
      <LoadError message={loadError} what="your accounts" />
      {error && <Alert variant="error">{error}</Alert>}
      {!loadError && !flows && (
        <Alert>
          Capital is coming from each account&apos;s opening balance because the cash-flow ledger is
          not in your database yet. Run <code>supabase/cashflow.sql</code> once, then this page tracks
          every deposit and withdrawal instead.
        </Alert>
      )}

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? "Edit Account" : "New Account"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="grid three">
              <div className="form-field">
                <Label htmlFor="acct-name">Name</Label>
                <Input id="acct-name" required value={form.name} onChange={e => set("name", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="acct-broker">Broker</Label>
                <Select value={form.broker} onValueChange={v => set("broker", v)}>
                  <SelectTrigger id="acct-broker"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BROKER_PRESETS.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="form-field">
                <Label htmlFor="acct-type">Type</Label>
                <Select value={form.account_type} onValueChange={v => set("account_type", v)}>
                  <SelectTrigger id="acct-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="personal">personal</SelectItem>
                    <SelectItem value="funded">funded</SelectItem>
                    <SelectItem value="demo">demo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="form-field">
                <Label htmlFor="acct-currency">Currency</Label>
                <Input id="acct-currency" maxLength={6} value={form.currency} onChange={e => set("currency", e.target.value.toUpperCase())} />
              </div>
              {!editing && (
                <div className="form-field">
                  <Label htmlFor="acct-opening">Opening deposit</Label>
                  <Input id="acct-opening" type="number" min="0" step="any" placeholder="0.00" value={form.opening} onChange={e => set("opening", e.target.value)} />
                </div>
              )}
              <div className="form-field">
                <Label htmlFor="acct-daily">Daily Loss Limit</Label>
                <Input id="acct-daily" type="number" min="0" step="any" value={form.max_daily_loss} onChange={e => set("max_daily_loss", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="acct-drawdown">Max Drawdown</Label>
                <Input id="acct-drawdown" type="number" min="0" step="any" value={form.max_drawdown} onChange={e => set("max_drawdown", e.target.value)} />
              </div>
              <div className="muted text-[10px] col-span-full">
                {editing
                  ? "Capital comes from the account's deposits and withdrawals — record those on the card below."
                  : "This is the account's first deposit; every later top-up or payout is recorded on its card."}
                {" "}{brokerPreset(form.broker).note}
              </div>
              <div className="col-span-full flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
                <Button>{editing ? "Save Changes" : "Save Account"}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid three">
        {items.map(a => {
          const pnl = pnlBy[a.id] || 0;
          const t = totals(a.id);
          const equity = t.net + pnl;
          const movements = movementsBy[a.id] ?? [];
          return (
            <Card key={a.id}>
              <CardContent className="flex h-full flex-col">
                <div className="flex items-start justify-between gap-2.5">
                  <div>
                    <b>{a.name}</b>
                    <div className="muted text-[10.5px] mt-1">{a.account_type} · {a.currency}</div>
                    <div className="muted text-[10.5px] mt-[3px]">{brokerPreset(a.broker).name}</div>
                  </div>
                  {/* `flex-start` keeps the buttons their natural height beside a multi-line title. */}
                  <div className="flex flex-none gap-2 self-start">
                    <Button variant="secondary" size="sm" onClick={() => startEdit(a)}>Edit</Button>
                    <ConfirmButton
                      size="sm"
                      title={`Delete ${a.name}?`}
                      description="Existing trades will remain in the journal, unassigned. Its deposits and withdrawals are removed with it."
                      onConfirm={() => remove(a.id)}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </div>

                <div className="mt-5 text-[18px] font-extrabold tabular-nums">{formatMoney(equity, a.currency)}</div>
                <div className="muted text-[11px] mt-1">
                  Equity · net capital {formatMoney(t.net, a.currency)}
                </div>
                <div className={`text-[11.5px] mt-1 ${pnl >= 0 ? "positive" : "negative"}`}>Journal P&L {formatMoney(pnl, a.currency, true)}</div>
                {a.max_daily_loss !== null && <div className="muted text-[10px] mt-1">Daily loss limit {formatMoney(a.max_daily_loss, a.currency)}</div>}

                {/* The ledger grows to fill the card, so two cards side by side end level. */}
                <div className="cashflow">
                  <div className="cashflow-head">
                    <span>Money in / out</span>
                    <span className="tabular-nums">
                      <b className="positive">+{formatMoney(t.deposited, a.currency)}</b>
                      <b className="negative ml-2">−{formatMoney(t.withdrawn, a.currency)}</b>
                    </span>
                  </div>
                  {flows ? (
                    <div className="cashflow-list">
                      {movements.map(m => (
                        <div className="cashflow-row" key={m.id}>
                          <span className="cashflow-main">
                            <span className="cashflow-note" title={m.note ?? undefined}>
                              {m.note || (m.kind === "deposit" ? "Deposit" : "Withdrawal")}
                            </span>
                            <span className="muted cashflow-when">
                              {m.kind === "deposit" ? "Deposit" : "Withdrawal"} · {dateLabel(m.occurred_on)}
                            </span>
                          </span>
                          <b className={`tabular-nums ${m.kind === "deposit" ? "positive" : "negative"}`}>
                            {m.kind === "deposit" ? "+" : "−"}{formatMoney(Number(m.amount), a.currency)}
                          </b>
                          <ConfirmButton
                            size="icon"
                            variant="ghost"
                            className="cashflow-remove"
                            title="Remove this movement?"
                            description={`${m.kind === "deposit" ? "Deposit" : "Withdrawal"} of ${formatMoney(Number(m.amount), a.currency)} will be removed from the money in/out totals.`}
                            confirmLabel="Remove"
                            onConfirm={() => removeMovement(m.id)}
                          >
                            ✕
                          </ConfirmButton>
                        </div>
                      ))}
                      {!movements.length && <div className="muted text-[11px]">No deposits or withdrawals yet.</div>}
                    </div>
                  ) : (
                    <div className="muted text-[11px]">Opening balance {formatMoney(t.deposited, a.currency)} — no ledger yet.</div>
                  )}
                  {flows && (
                    <div className="mt-3 flex gap-2">
                      <Button type="button" size="sm" variant="secondary" onClick={() => openMovement(a, "deposit")}>+ Deposit</Button>
                      <Button type="button" size="sm" variant="secondary" onClick={() => openMovement(a, "withdrawal")}>− Withdraw</Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {!items.length && <Card><CardContent className="empty">No accounts yet. Add your first trading account.</CardContent></Card>}

      {moving && (
        <Dialog open onOpenChange={next => { if (!next) { setMoving(null); setEntry(emptyEntry); } }}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>
              {moving.kind === "deposit" ? "Deposit into" : "Withdraw from"} {moving.account.name}
            </DialogTitle>
            <form onSubmit={saveMovement} className="grid gap-3 mt-2">
              <div className="form-field">
                <Label htmlFor="mv-amount">Amount ({moving.account.currency})</Label>
                <Input
                  id="mv-amount"
                  type="number"
                  min="0"
                  step="any"
                  required
                  autoFocus
                  value={entry.amount}
                  onChange={e => setEntry(x => ({ ...x, amount: e.target.value }))}
                />
              </div>
              <div className="form-field">
                <Label htmlFor="mv-date">Date</Label>
                <DatePicker id="mv-date" value={entry.occurred_on} onChange={v => setEntry(x => ({ ...x, occurred_on: v }))} />
              </div>
              <div className="form-field">
                <Label htmlFor="mv-note">Note (optional)</Label>
                <Textarea
                  id="mv-note"
                  rows={2}
                  placeholder={moving.kind === "deposit" ? "Top-up, bonus, transfer in…" : "Profit taken, capital out, fees…"}
                  value={entry.note}
                  onChange={e => setEntry(x => ({ ...x, note: e.target.value }))}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => { setMoving(null); setEntry(emptyEntry); }}>Cancel</Button>
                <Button disabled={savingMove}>{savingMove ? "Saving…" : moving.kind === "deposit" ? "Record deposit" : "Record withdrawal"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
