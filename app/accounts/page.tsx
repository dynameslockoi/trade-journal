"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/trading";
import { BROKER_PRESETS, DEFAULT_BROKER_ID, brokerPreset } from "@/lib/fees";
import { PageHeader } from "@/components/page-header";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Account = { id: string; name: string; account_type: string; starting_balance: number; currency: string; max_daily_loss: number | null; max_drawdown: number | null; broker: string | null };
type Trade = { account_id: string | null; net_pnl: number };

const initial = { name: "", account_type: "personal", starting_balance: "0", currency: "MYR", broker: DEFAULT_BROKER_ID, max_daily_loss: "", max_drawdown: "" };

export default function Accounts() {
  const [items, setItems] = useState<Account[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [open, setOpen] = useState(false);
  // The id being edited, or null when the form is creating a new account.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState("");
  const formCard = useRef<HTMLDivElement>(null);

  const load = async () => {
    const s = createClient();
    const [a, t] = await Promise.all([
      s.from("trading_accounts").select("*").order("created_at", { ascending: false }),
      s.from("trades").select("account_id,net_pnl"),
    ]);
    setItems((a.data ?? []) as Account[]);
    setTrades((t.data ?? []) as Trade[]);
  };
  useEffect(() => { load(); }, []);
  // Opening the form (new or edit) brings it into view, since it sits above the account cards.
  useEffect(() => { if (open) formCard.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [open]);

  const pnlBy = useMemo(
    () => trades.reduce<Record<string, number>>((m, t) => { if (t.account_id) m[t.account_id] = (m[t.account_id] || 0) + Number(t.net_pnl || 0); return m; }, {}),
    [trades]
  );
  const set = (k: string, v: string) => setForm(x => ({ ...x, [k]: v }));
  const close = () => { setOpen(false); setEditing(null); setForm(initial); setError(""); };
  const startEdit = (a: Account) => {
    setError("");
    setEditing(a.id);
    setForm({
      name: a.name,
      account_type: a.account_type,
      starting_balance: String(a.starting_balance ?? 0),
      currency: a.currency,
      broker: a.broker ?? DEFAULT_BROKER_ID,
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
    const balance = Number(form.starting_balance);
    if (!form.name.trim() || !Number.isFinite(balance) || balance < 0) { setError("Enter a valid account name and non-negative starting balance."); return; }
    const payload: any = {
      user_id: user.id,
      name: form.name.trim(),
      account_type: form.account_type,
      starting_balance: balance,
      current_balance: balance,
      currency: form.currency.trim().toUpperCase() || "MYR",
      broker: form.broker,
      max_daily_loss: form.max_daily_loss ? Number(form.max_daily_loss) : null,
      max_drawdown: form.max_drawdown ? Number(form.max_drawdown) : null,
    };
    // The broker column may not exist on a database the Phase 7 migration has not reached, so a
    // failure that names it retries without it.
    const send = async (row: any) => editing
      ? s.from("trading_accounts").update(row).eq("id", editing)
      : s.from("trading_accounts").insert(row);
    const withoutUserId = ({ user_id, ...rest }: any) => rest;
    const row = editing ? withoutUserId(payload) : payload;
    let { error: writeError } = await send(row);
    if (writeError && (writeError.code === "PGRST204" || /broker/.test(writeError.message ?? ""))) {
      const { broker, ...rest } = row;
      ({ error: writeError } = await send(rest));
    }
    if (writeError) setError(writeError.message);
    else { close(); load(); }
  }

  async function remove(id: string) {
    const { error } = await createClient().from("trading_accounts").delete().eq("id", id);
    if (error) setError(error.message);
    else load();
  }

  return (
    <div className="content">
      <PageHeader
        title="Accounts"
        subtitle="Track starting capital, live journal equity, broker fees and risk limits."
        actions={
          <Button onClick={() => { setError(""); setEditing(null); setForm(initial); setOpen(true); }}>+ Add Account</Button>
        }
      />
      {error && <Alert variant="error">{error}</Alert>}

      {open && (
        <Card ref={formCard}>
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
              <div className="form-field">
                <Label htmlFor="acct-balance">Starting Balance</Label>
                <Input id="acct-balance" type="number" min="0" step="any" value={form.starting_balance} onChange={e => set("starting_balance", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="acct-daily">Daily Loss Limit</Label>
                <Input id="acct-daily" type="number" min="0" step="any" value={form.max_daily_loss} onChange={e => set("max_daily_loss", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="acct-drawdown">Max Drawdown</Label>
                <Input id="acct-drawdown" type="number" min="0" step="any" value={form.max_drawdown} onChange={e => set("max_drawdown", e.target.value)} />
              </div>
              <div className="muted text-[10px] col-span-full">{brokerPreset(form.broker).note}</div>
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
          const equity = Number(a.starting_balance) + pnl;
          return (
            <Card key={a.id}>
              <CardContent>
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
                      description="Existing trades will remain in the journal, unassigned."
                      onConfirm={() => remove(a.id)}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </div>
                <div className="mt-5 text-[18px] font-extrabold tabular-nums">{formatMoney(equity, a.currency)}</div>
                <div className={`text-[11.5px] mt-1 ${pnl >= 0 ? "positive" : "negative"}`}>Journal P&L {formatMoney(pnl, a.currency, true)}</div>
                <div className="muted text-[11px] mt-2">Starting balance {formatMoney(a.starting_balance, a.currency)}</div>
                {a.max_daily_loss !== null && <div className="muted text-[10px] mt-1">Daily loss limit {formatMoney(a.max_daily_loss, a.currency)}</div>}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {!items.length && <Card><CardContent className="empty">No accounts yet. Add your first trading account.</CardContent></Card>}
    </div>
  );
}
