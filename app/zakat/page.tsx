"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Select } from "@/components/select";
import {
  formatMoney, normalizeTrade, roundMoney, tradeYear, tradeYears, zakatForYear, ZAKAT_BASES,
  ZAKAT_RATE_DEFAULT, type Trade, type ZakatBasis,
} from "@/lib/trading";

type YearRow = {
  year: number;
  rate: number | string | null;
  basis: ZakatBasis | null;
  other_income: number | string | null;
  manual_base: number | string | null;
  nisab: number | string | null;
};
type Payment = {
  id: string;
  year: number;
  paid_on: string;
  amount: number | string | null;
  method: string | null;
  note: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

export default function ZakatPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [yearRows, setYearRows] = useState<YearRow[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [needsSchema, setNeedsSchema] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  // The editable copy of the selected year's settings; saved to zakat_years on demand.
  const [draft, setDraft] = useState({ rate: String(ZAKAT_RATE_DEFAULT), basis: "net" as ZakatBasis, other: "", manual: "", nisab: "" });
  const [pay, setPay] = useState({ paid_on: today(), amount: "", method: "Zakat fitrah/income", note: "" });

  useEffect(() => { (async () => {
    const s = createClient();
    const [t, y, p] = await Promise.all([
      s.from("trades").select("id,symbol,direction,entry_at,exit_at,net_pnl").order("entry_at"),
      s.from("zakat_years").select("*"),
      s.from("zakat_payments").select("*").order("paid_on", { ascending: false }),
    ]);
    setTrades(((t.data ?? []) as any[]).map(normalizeTrade));
    if (y.error || p.error) setNeedsSchema(true);
    else {
      setYearRows((y.data ?? []) as YearRow[]);
      setPayments((p.data ?? []) as Payment[]);
    }
    setLoading(false);
  })(); }, []);

  const years = useMemo(() => tradeYears(trades), [trades]);
  const yearTrades = useMemo(() => trades.filter(t => tradeYear(t.entry_at) === year), [trades, year]);

  const settingsFor = (y: number): YearRow =>
    yearRows.find(r => Number(r.year) === y) ??
    { year: y, rate: ZAKAT_RATE_DEFAULT, basis: "net", other_income: 0, manual_base: null, nisab: null };

  // Reload the draft whenever the selected year changes or the saved rows arrive.
  const saved = settingsFor(year);
  useEffect(() => {
    setDraft({
      rate: saved.rate === null || saved.rate === undefined ? String(ZAKAT_RATE_DEFAULT) : String(Number(saved.rate)),
      basis: (saved.basis ?? "net") as ZakatBasis,
      other: saved.other_income ? String(Number(saved.other_income)) : "",
      manual: saved.manual_base === null || saved.manual_base === undefined ? "" : String(Number(saved.manual_base)),
      nisab: saved.nisab === null || saved.nisab === undefined ? "" : String(Number(saved.nisab)),
    });
  }, [year, yearRows]);

  const input = {
    basis: draft.basis,
    rate: draft.rate,
    otherIncome: draft.other,
    manualBase: draft.manual,
    nisab: draft.nisab,
  };

  const result = useMemo(() => zakatForYear(yearTrades, input), [yearTrades, draft]);
  const paidFor = (y: number) => roundMoney(payments.filter(p => Number(p.year) === y).reduce((sum, p) => sum + Number(p.amount || 0), 0));
  const paid = paidFor(year);
  const balance = roundMoney(result.due - paid);
  const currency = "MYR";

  const yearly = useMemo(
    () => years.map(y => {
      const rows = trades.filter(t => tradeYear(t.entry_at) === y);
      const savedRow = settingsFor(y);
      const r = zakatForYear(rows, {
        basis: (savedRow.basis ?? "net") as ZakatBasis,
        rate: savedRow.rate,
        otherIncome: savedRow.other_income,
        manualBase: savedRow.manual_base,
        nisab: savedRow.nisab,
      });
      const done = paidFor(y);
      return { year: y, ...r, paid: done, balance: roundMoney(r.due - done) };
    }),
    [years, trades, yearRows, payments]
  );

  async function saveSettings() {
    setMsg(""); setErr("");
    const s = createClient();
    const { data: { user } } = await s.auth.getUser();
    if (!user) { setErr("You are not signed in."); return; }
    const payload = {
      user_id: user.id,
      year,
      rate: Number(draft.rate) || 0,
      basis: draft.basis,
      other_income: Number(draft.other) || 0,
      manual_base: draft.manual === "" ? null : Number(draft.manual),
      nisab: draft.nisab === "" ? null : Number(draft.nisab),
    };
    const { error } = await s.from("zakat_years").upsert(payload, { onConflict: "user_id,year" });
    if (error) { setNeedsSchema(true); setErr(error.message); return; }
    const { data } = await s.from("zakat_years").select("*");
    setYearRows((data ?? []) as YearRow[]);
    setMsg(`${year} settings saved.`);
    setTimeout(() => setMsg(""), 2500);
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    setMsg(""); setErr("");
    const s = createClient();
    const { data: { user } } = await s.auth.getUser();
    if (!user) { setErr("You are not signed in."); return; }
    if (!pay.amount || Number(pay.amount) <= 0) { setErr("Enter the amount you paid."); return; }
    const { error } = await s.from("zakat_payments").insert({
      user_id: user.id,
      year,
      paid_on: pay.paid_on,
      amount: Number(pay.amount),
      method: pay.method || null,
      note: pay.note || null,
    });
    if (error) { setNeedsSchema(true); setErr(error.message); return; }
    const { data } = await s.from("zakat_payments").select("*").order("paid_on", { ascending: false });
    setPayments((data ?? []) as Payment[]);
    setPay({ paid_on: today(), amount: "", method: pay.method, note: "" });
    setMsg("Payment recorded.");
    setTimeout(() => setMsg(""), 2500);
  }

  async function removePayment(id: string) {
    if (!confirm("Delete this payment record?")) return;
    const s = createClient();
    const { error } = await s.from("zakat_payments").delete().eq("id", id);
    if (error) { setErr(error.message); return; }
    setPayments(prev => prev.filter(p => p.id !== id));
  }

  const basisHint = ZAKAT_BASES.find(b => b.id === draft.basis)?.hint;

  return (
    <div className="content">
      <PageHeader
        title="Zakat"
        subtitle="2.5% of the year's net trading profit, less whatever you have already paid."
        actions={
          <div className="field" style={{ minWidth: 150 }}>
            <span>Year</span>
            <Select aria-label="Year" value={String(year)} onChange={v => setYear(Number(v))}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
        }
      />

      {needsSchema && (
        <div className="card card-pad">
          <b>One step left</b>
          <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
            The figures below are computed from your journal, but saving the rate, the base or a payment needs
            the Phase 9 tables. Run the Zakat block in <code>supabase/schema.sql</code> in the Supabase SQL editor
            (<code>zakat_years</code>, <code>zakat_payments</code> and <code>trades.is_ipo</code>).
          </p>
        </div>
      )}

      {loading ? <div className="card card-pad">Loading…</div> : <>
        {(msg || err) && <div className={err ? "error" : "success"}>{err || msg}</div>}

        <div className="grid four">
          <StatCard label={`${year} Net P&L`} value={formatMoney(result.net, currency, true)} sub={`${result.trades} trade${result.trades === 1 ? "" : "s"} closed`} positive={result.net >= 0} />
          <StatCard label="Zakatable Base" value={formatMoney(result.base, currency)} sub={basisHint} />
          <StatCard label={`Zakat at ${result.rate}%`} value={formatMoney(result.due, currency)} sub={result.belowNisab ? `below nisab ${formatMoney(result.nisab, currency)} — nothing due` : `${result.rate}% of the base`} />
          <StatCard label="Already Paid" value={formatMoney(paid, currency)} sub={balance > 0 ? `${formatMoney(balance, currency)} still to pay` : balance < 0 ? `${formatMoney(-balance, currency)} paid over` : "settled"} positive={balance <= 0 ? true : undefined} />
        </div>

        <div className="grid two pair-grid">
          <div className="card card-pad">
            <div className="card-head">
              <div>
                <b>{year} settings</b>
                <div className="muted card-hint">Kept per year, so an old year's rate is never rewritten by today's.</div>
              </div>
              <span className="badge">{result.rate}% · {ZAKAT_BASES.find(b => b.id === draft.basis)?.label}</span>
            </div>
            <div className="grid two field-grid">
              <label className="field">
                Rate %
                <input className="input" type="number" step="0.1" min="0" value={draft.rate} onChange={e => setDraft({ ...draft, rate: e.target.value })} />
                <span className="field-hint">2.5% is the usual rate on zakatable wealth in Malaysia.</span>
              </label>
              <div className="field">
                <span>Base</span>
                <Select aria-label="Base" value={draft.basis} onChange={v => setDraft({ ...draft, basis: v as ZakatBasis })}>
                  {ZAKAT_BASES.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
                </Select>
                <span className="field-hint">{basisHint}</span>
              </div>
              <label className="field">
                Other income / assets
                <input className="input" type="number" step="any" value={draft.other} onChange={e => setDraft({ ...draft, other: e.target.value })} placeholder="optional" />
                <span className="field-hint">Dividends, cash or anything else zakatable — added to the base.</span>
              </label>
              <label className="field">
                Nisab (optional)
                <input className="input" type="number" step="any" value={draft.nisab} onChange={e => setDraft({ ...draft, nisab: e.target.value })} placeholder="e.g. 24000" />
                <span className="field-hint">Wealth below the nisab pays nothing. Blank means no threshold.</span>
              </label>
              {draft.basis === "manual" && (
                <label className="field field-wide">
                  Manual base
                  <input className="input" type="number" step="any" value={draft.manual} onChange={e => setDraft({ ...draft, manual: e.target.value })} />
                  <span className="field-hint">The amount the rate is applied to, instead of the year's P&L.</span>
                </label>
              )}
            </div>
            <div className="settings-total">
              <span className="muted">{formatMoney(result.base, currency)} × {result.rate}%</span>
              <b className={result.due > 0 ? "" : "muted"}>{formatMoney(result.due, currency)}</b>
            </div>
            <div className="settings-actions">
              <button className="btn btn-primary" onClick={saveSettings}>Save {year} settings</button>
              <button className="btn" type="button" onClick={() => setDraft({ rate: String(ZAKAT_RATE_DEFAULT), basis: "net", other: "", manual: "", nisab: "" })}>Reset to 2.5%</button>
            </div>
          </div>

          <div className="card card-pad">
            <div className="card-head">
              <div>
                <b>Payments in {year}</b>
                <div className="muted card-hint">Zakat is normally paid after the year closes, so record each payment against the year it belongs to.</div>
              </div>
              <span className="badge">{formatMoney(paid, currency)} paid</span>
            </div>
            <form onSubmit={addPayment} className="grid two field-grid">
              <label className="field">Date paid<input className="input" type="date" value={pay.paid_on} onChange={e => setPay({ ...pay, paid_on: e.target.value })} /></label>
              <label className="field">Amount<input className="input" type="number" step="any" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} placeholder="0.00" /></label>
              <label className="field">Channel<input className="input" value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })} placeholder="e.g. Pusat Zakat Selangor" /></label>
              <label className="field">Note<input className="input" value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} placeholder="optional" /></label>
              <button className="btn btn-primary field-wide">Record payment</button>
            </form>
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table>
                <thead><tr><th>Date</th><th>Channel</th><th>Note</th><th>Amount</th><th /></tr></thead>
                <tbody>
                  {payments.filter(p => Number(p.year) === year).map(p => (
                    <tr key={p.id}>
                      <td>{p.paid_on}</td>
                      <td>{p.method || "—"}</td>
                      <td>{p.note || "—"}</td>
                      <td className="positive">{formatMoney(p.amount, currency)}</td>
                      <td><button className="btn danger-btn" type="button" onClick={() => removePayment(p.id)}>Delete</button></td>
                    </tr>
                  ))}
                  {!payments.some(p => Number(p.year) === year) && <tr><td colSpan={5}><div className="empty">Nothing paid for {year} yet.</div></td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card card-pad">
          <b>Year by year</b>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
            Each year is measured Jan–Dec on the day a trade was opened, at that year's own rate and base.
          </div>
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Year</th><th>Trades</th><th>Net P&amp;L</th><th>Base</th><th>Rate</th><th>Zakat</th><th>Paid</th><th>Balance</th></tr></thead>
              <tbody>
                {yearly.map(r => (
                  <tr key={r.year} className={r.year === year ? "section-total" : undefined} style={{ cursor: "pointer" }} onClick={() => setYear(r.year)}>
                    <td><b>{r.year}</b></td>
                    <td>{r.trades}</td>
                    <td className={r.net >= 0 ? "positive" : "negative"}>{formatMoney(r.net, currency, true)}</td>
                    <td>{formatMoney(r.base, currency)}</td>
                    <td>{r.rate}%</td>
                    <td>{formatMoney(r.due, currency)}</td>
                    <td className="positive">{r.paid ? formatMoney(r.paid, currency) : "—"}</td>
                    <td className={r.balance > 0 ? "negative" : "muted"}>{r.balance === 0 ? "settled" : formatMoney(r.balance, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            This is a record of how you calculate zakat on your share trading, not a fatwa. Nisab and the
            treatment of unsold holdings differ by state — check with your own zakat body before paying.
          </div>
        </div>
      </>}
    </div>
  );
}
