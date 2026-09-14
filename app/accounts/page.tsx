"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatMoney } from "@/lib/trading";
import { BROKER_PRESETS, DEFAULT_BROKER_ID, brokerPreset } from "@/lib/fees";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";

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
    if (!confirm("Delete this account? Existing trades will remain unassigned.")) return;
    const { error } = await createClient().from("trading_accounts").delete().eq("id", id);
    if (error) setError(error.message);
    else load();
  }

  return (
    <div className="content">
      <PageHeader
        title="Accounts"
        subtitle="Track starting capital, live journal equity, broker fees and risk limits."
        actions={<button className="btn btn-primary" onClick={() => { setError(""); setEditing(null); setForm(initial); setOpen(true); }}>+ Add Account</button>}
      />
      {error && <div className="error">{error}</div>}

      {open && (
        <div className="card card-pad" ref={formCard}>
          <h3 style={{ marginTop: 0 }}>{editing ? "Edit Account" : "New Account"}</h3>
          <form onSubmit={save} className="grid three">
            <label className="field">Name<input className="input" required value={form.name} onChange={e => set("name", e.target.value)} /></label>
            <div className="field">
              <span>Broker</span>
              <Select aria-label="Broker" value={form.broker} onChange={v => set("broker", v)}>
                {BROKER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            <div className="field">
              <span>Type</span>
              <Select aria-label="Type" value={form.account_type} onChange={v => set("account_type", v)}>
                <option>personal</option><option>funded</option><option>demo</option>
              </Select>
            </div>
            <label className="field">Currency<input className="input" maxLength={6} value={form.currency} onChange={e => set("currency", e.target.value.toUpperCase())} /></label>
            <label className="field">Starting Balance<input className="input" type="number" min="0" step="any" value={form.starting_balance} onChange={e => set("starting_balance", e.target.value)} /></label>
            <label className="field">Daily Loss Limit<input className="input" type="number" min="0" step="any" value={form.max_daily_loss} onChange={e => set("max_daily_loss", e.target.value)} /></label>
            <label className="field">Max Drawdown<input className="input" type="number" min="0" step="any" value={form.max_drawdown} onChange={e => set("max_drawdown", e.target.value)} /></label>
            <div className="muted" style={{ gridColumn: "1/-1", fontSize: 11 }}>{brokerPreset(form.broker).note}</div>
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button type="button" className="btn" onClick={close}>Cancel</button>
              <button className="btn btn-primary">{editing ? "Save Changes" : "Save Account"}</button>
            </div>
          </form>
        </div>
      )}

      <div className="grid three">
        {items.map(a => {
          const pnl = pnlBy[a.id] || 0;
          const equity = Number(a.starting_balance) + pnl;
          return (
            <div className="card card-pad" key={a.id}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <b>{a.name}</b>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{a.account_type} · {a.currency}</div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{brokerPreset(a.broker).name}</div>
                </div>
                {/* `flex-start` keeps the buttons their natural height beside a multi-line title. */}
                <div style={{ display: "flex", gap: 8, flex: "none", alignSelf: "flex-start" }}>
                  <button className="btn" onClick={() => startEdit(a)}>Edit</button>
                  <button className="btn danger-btn" onClick={() => remove(a.id)}>Delete</button>
                </div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 20, fontVariantNumeric: "tabular-nums" }}>{formatMoney(equity, a.currency)}</div>
              <div className={pnl >= 0 ? "positive" : "negative"} style={{ fontSize: 12.5, marginTop: 4 }}>Journal P&L {formatMoney(pnl, a.currency, true)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Starting balance {formatMoney(a.starting_balance, a.currency)}</div>
              {a.max_daily_loss !== null && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>Daily loss limit {formatMoney(a.max_daily_loss, a.currency)}</div>}
            </div>
          );
        })}
      </div>
      {!items.length && <div className="card card-pad empty">No accounts yet. Add your first trading account.</div>}
    </div>
  );
}
