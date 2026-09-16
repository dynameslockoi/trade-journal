"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { KEYS, loadTrades, loadZakat } from "@/lib/data";
import { invalidate, useCachedQuery } from "@/lib/query-cache";
import { PageHeader } from "@/components/page-header";
import { LoadError } from "@/components/load-error";
import { CardSkeleton, StatsSkeleton } from "@/components/skeletons";
import { StatCard } from "@/components/stat-card";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  dayKey, formatMoney, roundMoney, tradeYear, tradeYears, zakatForYear, ZAKAT_BASES,
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

// Today in Malaysia, so a payment recorded before 08:00 is not filed under yesterday.
const today = () => dayKey(new Date());

export default function ZakatPage() {
  // Trades come from the shared cache — the zakat page needs only their dates and P&L, which every
  // other page has already fetched.
  const tradesQ = useCachedQuery<Trade[]>(KEYS.trades, loadTrades);
  const zakatQ = useCachedQuery<{ years: any[]; payments: any[]; needsSchema: boolean }>(KEYS.zakat, loadZakat);
  const trades = tradesQ.data ?? [];
  const yearRows = (zakatQ.data?.years ?? []) as YearRow[];
  const payments = (zakatQ.data?.payments ?? []) as Payment[];
  const [year, setYear] = useState(new Date().getFullYear());
  // A missing zakat table is its own message (needsSchema); it also shows up the moment a write fails.
  const [schemaMissing, setSchemaMissing] = useState(false);
  const needsSchema = schemaMissing || Boolean(zakatQ.data?.needsSchema);
  const loading = tradesQ.loading || zakatQ.loading;
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const loadError = tradesQ.error;

  // The editable copy of the selected year's settings; saved to zakat_years on demand.
  const [draft, setDraft] = useState({ rate: String(ZAKAT_RATE_DEFAULT), basis: "net" as ZakatBasis, other: "", manual: "", nisab: "" });
  const [pay, setPay] = useState({ paid_on: today(), amount: "", method: "Zakat fitrah/income", note: "" });


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
  const yearPayments = useMemo(() => payments.filter(p => Number(p.year) === year), [payments, year]);
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
    if (error) { setSchemaMissing(true); setErr(error.message); return; }
    invalidate(KEYS.zakat);
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
    if (error) { setSchemaMissing(true); setErr(error.message); return; }
    invalidate(KEYS.zakat);
    setPay({ paid_on: today(), amount: "", method: pay.method, note: "" });
    setMsg("Payment recorded.");
    setTimeout(() => setMsg(""), 2500);
  }

  async function removePayment(id: string) {
    const s = createClient();
    const { error } = await s.from("zakat_payments").delete().eq("id", id);
    if (error) { setErr(error.message); return; }
    invalidate(KEYS.zakat);
  }

  const basisHint = ZAKAT_BASES.find(b => b.id === draft.basis)?.hint;

  return (
    <div className="content">
      <PageHeader
        title="Zakat"
        subtitle="A journal estimate — 2.5% of the year's net trading profit, less what you have already paid. Confirm the basis and rate with your zakat authority."
        actions={
          <div className="form-field" style={{ minWidth: 150 }}>
            <Label htmlFor="zk-year">Year</Label>
            <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
              <SelectTrigger id="zk-year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      />
      <LoadError message={loadError} what="your zakat figures" />

      {needsSchema && (
        <Card>
          <CardContent>
            <b>One step left</b>
            <p className="muted mt-1.5 text-[12px]">
              The figures below are computed from your journal, but saving the rate, the base or a payment needs
              the Phase 9 tables. Run the Zakat block in <code>supabase/schema.sql</code> in the Supabase SQL editor
              (<code>zakat_years</code>, <code>zakat_payments</code> and <code>trades.is_ipo</code>).
            </p>
          </CardContent>
        </Card>
      )}

      {loadError ? null : loading ? <><StatsSkeleton count={3} /><CardSkeleton lines={6} /></> : <>
        {(msg || err) && <Alert variant={err ? "error" : "success"}>{err || msg}</Alert>}

        <div className="grid four">
          <StatCard label={`${year} Net P&L`} value={formatMoney(result.net, currency, true)} sub={`${result.trades} trade${result.trades === 1 ? "" : "s"} closed`} positive={result.net >= 0} />
          {/* A year that lost money has a negative base: it reads as the loss it is, in the same red
              as the net card beside it rather than as a neutral figure. */}
          <StatCard label="Zakatable Base" value={formatMoney(result.base, currency)} sub={basisHint} positive={result.base >= 0} />
          <StatCard label={`Zakat at ${result.rate}%`} value={formatMoney(result.due, currency)} sub={result.belowNisab ? `below nisab ${formatMoney(result.nisab, currency)} — nothing due` : `${result.rate}% of the base`} />
          <StatCard label="Already Paid" value={formatMoney(paid, currency)} sub={balance > 0 ? `${formatMoney(balance, currency)} still to pay` : balance < 0 ? `${formatMoney(-balance, currency)} paid over` : "settled"} positive={balance <= 0 ? true : undefined} />
        </div>

        <div className="grid two pair-grid">
          <Card className="pair-card">
            <CardContent>
              <div className="card-head">
                <div>
                  <b>{year} settings</b>
                  <div className="muted card-hint">Kept per year, so an old year's rate is never rewritten by today's.</div>
                </div>
                <Badge>{result.rate}% · {ZAKAT_BASES.find(b => b.id === draft.basis)?.label}</Badge>
              </div>
              <div className="grid two field-grid">
                <div className="form-field">
                  <Label htmlFor="zk-rate">Rate %</Label>
                  <Input id="zk-rate" type="number" step="0.1" min="0" value={draft.rate} onChange={e => setDraft({ ...draft, rate: e.target.value })} />
                  <span className="ctl-hint">2.5% is the usual rate on zakatable wealth in Malaysia.</span>
                </div>
                <div className="form-field">
                  <Label htmlFor="zk-basis">Base</Label>
                  <Select value={draft.basis} onValueChange={v => setDraft({ ...draft, basis: v as ZakatBasis })}>
                    <SelectTrigger id="zk-basis"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ZAKAT_BASES.map(b => <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <span className="ctl-hint">{basisHint}</span>
                </div>
                <div className="form-field">
                  <Label htmlFor="zk-other">Other income / assets</Label>
                  <Input id="zk-other" type="number" step="any" value={draft.other} onChange={e => setDraft({ ...draft, other: e.target.value })} placeholder="optional" />
                  <span className="ctl-hint">Dividends, cash or anything else zakatable — added to the base.</span>
                </div>
                <div className="form-field">
                  <Label htmlFor="zk-nisab">Nisab (optional)</Label>
                  <Input id="zk-nisab" type="number" step="any" value={draft.nisab} onChange={e => setDraft({ ...draft, nisab: e.target.value })} placeholder="e.g. 24000" />
                  <span className="ctl-hint">Wealth below the nisab pays nothing. Blank means no threshold.</span>
                </div>
                {draft.basis === "manual" && (
                  <div className="form-field field-wide">
                    <Label htmlFor="zk-manual">Manual base</Label>
                    <Input id="zk-manual" type="number" step="any" value={draft.manual} onChange={e => setDraft({ ...draft, manual: e.target.value })} />
                    <span className="ctl-hint">The amount the rate is applied to, instead of the year's P&L.</span>
                  </div>
                )}
              </div>
              {/* Pinned to the bottom edge so the pair reads as two equal cards, whatever the
                  heights of their contents. */}
              <div className="pair-foot">
                <div className="settings-total">
                  <span className="muted">{formatMoney(result.base, currency)} × {result.rate}%</span>
                  <b className={result.due > 0 ? "" : "muted"}>{formatMoney(result.due, currency)}</b>
                </div>
                <div className="settings-actions">
                  <Button onClick={saveSettings}>Save {year} settings</Button>
                  <Button variant="secondary" type="button" onClick={() => setDraft({ rate: String(ZAKAT_RATE_DEFAULT), basis: "net", other: "", manual: "", nisab: "" })}>Reset to 2.5%</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="pair-card">
            <CardContent>
              <div className="card-head">
                <div>
                  <b>Payments in {year}</b>
                  <div className="muted card-hint">Zakat is normally paid after the year closes, so record each payment against the year it belongs to.</div>
                </div>
                <Badge>{formatMoney(paid, currency)} paid</Badge>
              </div>
              <form onSubmit={addPayment} className="grid two field-grid">
                <div className="form-field">
                  <Label htmlFor="zk-paid-on">Date paid</Label>
                  <DatePicker id="zk-paid-on" value={pay.paid_on} onChange={v => setPay({ ...pay, paid_on: v })} placeholder="Pick a date" />
                </div>
                <div className="form-field">
                  <Label htmlFor="zk-amount">Amount</Label>
                  <Input id="zk-amount" type="number" step="any" value={pay.amount} onChange={e => setPay({ ...pay, amount: e.target.value })} placeholder="0.00" />
                </div>
                <div className="form-field">
                  <Label htmlFor="zk-channel">Channel</Label>
                  <Input id="zk-channel" value={pay.method} onChange={e => setPay({ ...pay, method: e.target.value })} placeholder="e.g. Pusat Zakat Selangor" />
                </div>
                <div className="form-field">
                  <Label htmlFor="zk-note">Note</Label>
                  <Input id="zk-note" value={pay.note} onChange={e => setPay({ ...pay, note: e.target.value })} placeholder="optional" />
                </div>
                <Button className="field-wide">Record payment</Button>
              </form>
              {/* The empty state replaces the table rather than sitting inside it: a header row over
                  nothing reads as a table that failed to load. */}
              {yearPayments.length ? (
                <div className="pair-list mt-4">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Date</TableHead><TableHead>Channel</TableHead><TableHead>Note</TableHead><TableHead>Amount</TableHead><TableHead /></TableRow>
                  </TableHeader>
                  <TableBody>
                    {yearPayments.map(p => (
                      <TableRow key={p.id}>
                        <TableCell>{p.paid_on}</TableCell>
                        <TableCell>{p.method || "—"}</TableCell>
                        <TableCell>{p.note || "—"}</TableCell>
                        <TableCell className="positive">{formatMoney(p.amount, currency)}</TableCell>
                        <TableCell>
                          <ConfirmButton
                            size="sm"
                            title="Delete this payment record?"
                            description="The zakat calculation will go back up by this amount."
                            onConfirm={() => removePayment(p.id)}
                          >
                            Delete
                          </ConfirmButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              ) : (
                <div className="empty empty-inline">
                  Nothing paid for {year} yet.<br />
                  Record the first payment above.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent>
            <b>Year by year</b>
            <div className="muted text-[11px] mt-0.5">
              Each year is measured Jan–Dec on the day a trade was opened, at that year's own rate and base.
            </div>
            <div className="mt-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead><TableHead>Trades</TableHead><TableHead>Net P&amp;L</TableHead>
                    <TableHead>Base</TableHead><TableHead>Rate</TableHead><TableHead>Zakat</TableHead>
                    <TableHead>Paid</TableHead><TableHead>Balance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {yearly.map(r => (
                    <TableRow key={r.year} className={r.year === year ? "section-total" : undefined} onClick={() => setYear(r.year)} style={{ cursor: "pointer" }}>
                      <TableCell><b>{r.year}</b></TableCell>
                      <TableCell>{r.trades}</TableCell>
                      <TableCell className={r.net >= 0 ? "positive" : "negative"}>{formatMoney(r.net, currency, true)}</TableCell>
                      <TableCell>{formatMoney(r.base, currency)}</TableCell>
                      <TableCell>{r.rate}%</TableCell>
                      <TableCell>{formatMoney(r.due, currency)}</TableCell>
                      <TableCell className="positive">{r.paid ? formatMoney(r.paid, currency) : "—"}</TableCell>
                      <TableCell className={r.balance > 0 ? "negative" : "muted"}>{r.balance === 0 ? "settled" : formatMoney(r.balance, currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="muted text-[11px] mt-2.5">
              This is a record of how you calculate zakat on your share trading, not a fatwa. Nisab and the
              treatment of unsold holdings differ by state — check with your own zakat body before paying.
            </div>
          </CardContent>
        </Card>
      </>}
    </div>
  );
}
