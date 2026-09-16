"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { BURSA_BOARD_LOT, SESSIONS, calculateGrossPnl, calculateRisk, formatMoney, formatR, localDatetimeToIso, numberOrNull, roundMoney, sessionForTime, sessionLabel, stripUnknownColumn } from "@/lib/trading";
import { PageHeader } from "@/components/page-header";
import { LoadError, firstError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SELECT_NONE } from "@/components/ui/select";
import { BROKER_PRESETS, DEFAULT_BROKER_ID, SHARES, brokerPreset, describeLeg, roundTripFees, type FeeBreakdown } from "@/lib/fees";

type Account = { id: string; name: string; broker?: string | null };
type Strategy = { id: string; name: string };
type Tag = { id: string; name: string; category: string | null };

/** Columns that arrive as strings from the number inputs. */
const NUMERIC_FIELDS = ["entry_price","exit_price","position_size","stop_loss","take_profit","gross_pnl","commission","swap","fees","risk_percent","setup_quality","execution_quality","discipline","mae","mfe"];

const EMOTIONS = ["Calm", "Confident", "Uncertain", "Fearful", "FOMO", "Greedy", "Revenge"];
const MISTAKES = ["No mistake", "FOMO", "Early entry", "Late exit", "Oversized", "Moved SL", "Overtrading", "Ignored plan"];

const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// `entry_at` and `session` are filled in on mount instead of here: a clock read at module scope runs
// once on the server and again in the browser, and the two differ by the time the page took to
// arrive — which React reports as a hydration mismatch (the rendered "2:28 pm" against "2:32 pm").
const init = {
  symbol: "", account_id: "", strategy_id: "", asset_class: "shares",
  entry_at: "", exit_at: "",
  entry_price: "", exit_price: "", position_size: "", stop_loss: "", take_profit: "",
  gross_pnl: "0", commission: "0", swap: "0", fees: "0", risk_amount: "", risk_percent: "",
  emotion: "Calm", mistake: "No mistake", is_ipo: false,
  setup_quality: "8", execution_quality: "8", discipline: "8", mae: "", mfe: "", notes: "",
};

const money = (v: number | null) => formatMoney(v);

export default function NewTrade() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [form, setForm] = useState(init);
  const [broker, setBroker] = useState(DEFAULT_BROKER_ID);
  const [intraday, setIntraday] = useState(false);
  const [autoCalc, setAutoCalc] = useState(true);
  const [sstOverride, setSstOverride] = useState("");
  const [lots, setLots] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Until the user picks a session themselves, it follows the entry time — derived rather than
  // stored, because an empty session cannot be handed to the Select (Radix rejects "" as a value,
  // and reports the value it was given as a change while it matches no option).
  const [sessionPicked, setSessionPicked] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const s = createClient();
      const [a, st, t] = await Promise.all([
        s.from("trading_accounts").select("*").order("name"),
        s.from("strategies").select("id,name").order("name"),
        s.from("tags").select("id,name,category").order("name"),
      ]);
      // A failed list would leave the form with empty pickers and no explanation.
      setLoadError(firstError(a, st, t));
      setAccounts((a.data ?? []) as Account[]);
      setStrategies((st.data ?? []) as Strategy[]);
      setTags((t.data ?? []) as Tag[]);
    })();
  }, []);

  // A new trade defaults to "now", which only the browser knows — so it is set once after mount.
  useEffect(() => {
    const now = localNow();
    setForm(x => ({ ...x, entry_at: now }));
  }, []);

  const set = (k: string, v: string | boolean) => setForm(x => ({ ...x, [k]: v }));

  function changeEntryAt(value: string) {
    setForm(x => ({ ...x, entry_at: value }));
  }

  // Always a real session, so the picker's value always matches an option. Until the entry time is
  // known (blank on the server) this reads as the morning session, which the mount effect then
  // corrects from the actual entry time.
  // `||`, not `??`: the Select reports an empty string as a change while its value matches no
  // option, and only a real session should stop the field following the entry time.
  const session = sessionPicked || sessionForTime(form.entry_at);
  const preset = brokerPreset(broker);
  const assetClass = SHARES;
  const parsedSst = sstOverride.trim() === "" ? null : Number(sstOverride) / 100;
  const sstRate = parsedSst !== null && Number.isFinite(parsedSst) ? parsedSst : null;

  const fees: FeeBreakdown = useMemo(
    () => roundTripFees(preset, form.entry_price, form.exit_price, form.position_size, {
      assetClass,
      intraday: intraday && preset.market === "bursa",
      sstRate,
    }),
    [preset, form.entry_price, form.exit_price, form.position_size, assetClass, intraday, sstRate]
  );

  // Bursa Malaysia is long-only here, so the contract always profits when the price rises.
  const autoGross = useMemo(
    () => calculateGrossPnl(form.entry_price, form.exit_price, form.position_size, "long"),
    [form.entry_price, form.exit_price, form.position_size]
  );

  const grossPnl = autoCalc ? autoGross ?? 0 : Number(form.gross_pnl || 0);
  const commission = autoCalc ? fees.brokerCharges : Number(form.commission || 0);
  const exchangeFees = autoCalc ? fees.marketCharges : Number(form.fees || 0);
  const swap = Number(form.swap || 0);
  const netPnl = roundMoney(grossPnl - commission - exchangeFees - swap);

  const quantity = numberOrNull(form.position_size);
  const entryValue = quantity && quantity > 0 ? roundMoney(quantity * (numberOrNull(form.entry_price) ?? 0)) : 0;
  const exitValue = quantity && quantity > 0 ? roundMoney(quantity * (numberOrNull(form.exit_price) ?? 0)) : 0;

  const risk = useMemo(
    () => calculateRisk(form.entry_price, form.stop_loss, form.position_size, form.risk_amount),
    [form.entry_price, form.stop_loss, form.position_size, form.risk_amount]
  );
  const rGross = risk && risk > 0 ? grossPnl / risk : null;
  const rNet = risk && risk > 0 ? netPnl / risk : null;

  function pickAccount(id: string) {
    set("account_id", id);
    const account = accounts.find(a => a.id === id);
    if (account?.broker) setBroker(account.broker);
  }

  function updateLots(value: string) {
    setLots(value);
    const n = Number(value);
    if (value.trim() !== "" && Number.isFinite(n) && n > 0) set("position_size", String(n * BURSA_BOARD_LOT));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    const s = createClient();
    const { data: { user } } = await s.auth.getUser();
    if (!user) { router.push("/login"); return; }
    if (!form.symbol.trim() || !form.entry_at) { setError("Symbol and entry date/time are required."); setSaving(false); return; }
    if (form.exit_at && new Date(form.exit_at) < new Date(form.entry_at)) { setError("Exit time cannot be before entry time."); setSaving(false); return; }
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) { setError(`File ${file.name} is larger than 10 MB.`); setSaving(false); return; }
      if (!file.type.startsWith("image/")) { setError(`File ${file.name} is not an image.`); setSaving(false); return; }
    }

    const payload: any = {
      user_id: user.id,
      ...form,
      symbol: form.symbol.trim().toUpperCase(),
      direction: "long",
      asset_class: assetClass,
      session,
      entry_at: localDatetimeToIso(form.entry_at),
      exit_at: localDatetimeToIso(form.exit_at),
      gross_pnl: grossPnl,
      commission,
      swap,
      fees: exchangeFees,
      risk_amount: risk,
      r_multiple: rNet,
      fee_breakdown: { ...fees, broker: preset.id, brokerName: preset.name },
    };
    for (const key of NUMERIC_FIELDS) payload[key] = payload[key] === "" ? null : Number(payload[key]);
    payload.gross_pnl = grossPnl;
    payload.commission = commission;
    payload.swap = swap;
    payload.fees = exchangeFees;
    payload.exit_at = payload.exit_at || null;
    payload.account_id = payload.account_id || null;
    payload.strategy_id = payload.strategy_id || null;

    let { data: trade, error: insertError } = await s.from("trades").insert(payload).select("id").single();
    if (insertError && (insertError.code === "PGRST204" || /fee_breakdown/.test(insertError.message ?? ""))) {
      // The phase 7 columns were not added to the database yet — save without them.
      ({ data: trade, error: insertError } = await s.from("trades").insert(stripUnknownColumn(payload, insertError.message)).select("id").single());
    }
    if (insertError || !trade) { setError(insertError?.message ?? "Could not save the trade."); setSaving(false); return; }

    if (selected.length) {
      const { error: tagError } = await s.from("trade_tags").insert(selected.map(tag_id => ({ trade_id: trade.id, tag_id })));
      if (tagError) { setError(tagError.message); setSaving(false); return; }
    }

    for (const file of files) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `${user.id}/${trade.id}/${crypto.randomUUID()}-${safe}`;
      const up = await s.storage.from("trade-screenshots").upload(path, file, { upsert: false, contentType: file.type });
      if (up.error) { await s.from("trades").delete().eq("id", trade.id); setError(`Screenshot upload failed: ${up.error.message}`); setSaving(false); return; }
      const ins = await s.from("trade_screenshots").insert({ trade_id: trade.id, user_id: user.id, storage_path: path, kind: "after", caption: "" });
      if (ins.error) {
        await s.storage.from("trade-screenshots").remove([path]);
        await s.from("trades").delete().eq("id", trade.id);
        setError(`Screenshot record failed: ${ins.error.message}`);
        setSaving(false);
        return;
      }
    }

    router.push(`/journal/${trade.id}`);
    setSaving(false);
  }

  const profitClass = (v: number) => (v >= 0 ? "positive" : "negative");

  return (
    <div className="content max-w-[1100px]">
      <PageHeader eyebrow="Journal / New Trade" title="Add Trade" subtitle="Charges and gross P&L are calculated from the Bursa lot size and your broker preset." />
      <LoadError message={loadError} what="your accounts, strategies and tags" />
      <form onSubmit={save} className="grid">
        <Card>
          <CardHeader><CardTitle>Trade Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid three">
              {([["symbol", "Symbol"], ["entry_price", "Entry Price"], ["exit_price", "Exit Price"], ["position_size", "Position Size (shares)"], ["stop_loss", "Stop Loss"], ["take_profit", "Take Profit"]] as const).map(([k, l]) => (
                <div className="form-field" key={k}>
                  <Label htmlFor={`nt-${k}`}>{l}</Label>
                  <Input id={`nt-${k}`} required={k === "symbol"} type={k === "symbol" ? "text" : "number"} step="any" value={(form as any)[k]} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
              <div className="form-field">
                <Label htmlFor="nt-lots">Board Lots ×{BURSA_BOARD_LOT}</Label>
                <Input id="nt-lots" type="number" step="any" min="0" value={lots} onChange={e => updateLots(e.target.value)} placeholder="optional helper" />
              </div>
              <div className="form-field">
                <Label htmlFor="nt-entry">Entry Date/Time</Label>
                <DateTimePicker id="nt-entry" value={form.entry_at} onChange={changeEntryAt} />
              </div>
              <div className="form-field">
                <Label htmlFor="nt-exit">Exit Date/Time</Label>
                <DateTimePicker id="nt-exit" value={form.exit_at} onChange={v => set("exit_at", v)} placeholder="Still open" />
              </div>
              <div className="form-field">
                <Label htmlFor="nt-account">Account</Label>
                <Select value={form.account_id || SELECT_NONE} onValueChange={v => pickAccount(v === SELECT_NONE ? "" : v)}>
                  <SelectTrigger id="nt-account"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>No account</SelectItem>
                    {accounts.map(x => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="form-field">
                <Label htmlFor="nt-strategy">Strategy</Label>
                <Select value={form.strategy_id || SELECT_NONE} onValueChange={v => set("strategy_id", v === SELECT_NONE ? "" : v)}>
                  <SelectTrigger id="nt-strategy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>No strategy</SelectItem>
                    {strategies.map(x => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="review-label mt-3">
              <Checkbox id="nt-ipo" checked={!!form.is_ipo} onCheckedChange={v => set("is_ipo", !!v)} />
              <Label htmlFor="nt-ipo">IPO allocation <span className="muted">— bought through an IPO allotment, not the open market</span></Label>
            </div>
            <div className="calc-strip">
              <span className="muted">Contract {money(entryValue)} → {money(exitValue)} · Bursa board lot is {BURSA_BOARD_LOT} shares</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fees &amp; Charges</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="form-field flex-[1_1_240px]">
                <Label htmlFor="nt-broker">Broker preset</Label>
                <Select value={broker} onValueChange={setBroker}>
                  <SelectTrigger id="nt-broker"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BROKER_PRESETS.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="form-field flex-[0_1_110px]">
                <Label htmlFor="nt-sst">SST %</Label>
                <Input id="nt-sst" type="number" step="0.1" min="0" placeholder="auto" value={sstOverride} onChange={e => setSstOverride(e.target.value)} />
              </div>
              {preset.brokerage.intradayRate !== null && (
                <div className="review-label">
                  <Checkbox id="nt-intraday" checked={intraday} onCheckedChange={v => setIntraday(!!v)} />
                  <Label htmlFor="nt-intraday">Intraday</Label>
                </div>
              )}
              <div className="review-label">
                <Checkbox id="nt-auto" checked={autoCalc} onCheckedChange={v => setAutoCalc(!!v)} />
                <Label htmlFor="nt-auto">Auto-calculate</Label>
              </div>
            </div>
            <div className="muted text-[10px] mt-2">
              {preset.note}. Bursa shares — stamp duty is RM1 per RM1,000, capped at RM1,000.
            </div>

            <div className="fee-panel">
              <div className="fee-row"><span className="muted">Opening contract {money(entryValue)}</span><span>{describeLeg(fees.open, formatMoney)}</span></div>
              <div className="fee-row"><span className="muted">Closing contract {money(exitValue)}</span><span>{describeLeg(fees.close, formatMoney)}</span></div>
              <div className="fee-row fee-total"><span>Total charges</span><span>{money(fees.total)}</span></div>
            </div>

            <div className="grid three gap-3 mt-3.5">
              <div className="form-field">
                <Label htmlFor="nt-gross">Gross P&amp;L</Label>
                <Input id="nt-gross" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(grossPnl) : form.gross_pnl} onChange={e => set("gross_pnl", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="nt-commission">Commission (brokerage + platform + SST)</Label>
                <Input id="nt-commission" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(commission) : form.commission} onChange={e => set("commission", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="nt-fees">Exchange fees (clearing + stamp duty)</Label>
                <Input id="nt-fees" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(exchangeFees) : form.fees} onChange={e => set("fees", e.target.value)} />
              </div>
            </div>
            <div className="grid three gap-3">
              <div className="form-field">
                <Label htmlFor="nt-risk">Explicit Risk Amount</Label>
                <Input id="nt-risk" type="number" step="any" value={form.risk_amount} onChange={e => set("risk_amount", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="nt-riskpct">Risk %</Label>
                <Input id="nt-riskpct" type="number" step="any" value={form.risk_percent} onChange={e => set("risk_percent", e.target.value)} />
              </div>
            </div>
            <div className="calc-strip">
              <span>Risk: <b>{formatMoney(risk)}</b></span>
              <span>Gross: <b className={profitClass(grossPnl)}>{formatMoney(grossPnl, null, true)}</b></span>
              <span>Net after charges: <b className={profitClass(netPnl)}>{formatMoney(netPnl, null, true)}</b></span>
              <span>R (net): <b className={rNet === null ? "" : profitClass(rNet)}>{rNet === null ? "—" : formatR(rNet)}</b></span>
              <span>R (gross): <b className={rGross === null ? "" : profitClass(rGross)}>{rGross === null ? "—" : formatR(rGross)}</b></span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Psychology &amp; Execution</CardTitle></CardHeader>
          <CardContent>
            <div className="grid three">
              <div className="form-field">
                <Label htmlFor="nt-session">Session</Label>
                <Select value={session} onValueChange={v => v && setSessionPicked(v)}>
                  <SelectTrigger id="nt-session"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SESSIONS.map(x => <SelectItem key={x} value={x}>{sessionLabel(x)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="form-field">
                <Label htmlFor="nt-emotion">Emotion</Label>
                <Select value={form.emotion} onValueChange={v => set("emotion", v)}>
                  <SelectTrigger id="nt-emotion"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EMOTIONS.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="form-field">
                <Label htmlFor="nt-mistake">Mistake</Label>
                <Select value={form.mistake} onValueChange={v => set("mistake", v)}>
                  <SelectTrigger id="nt-mistake"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {MISTAKES.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid three mt-3.5">
              {(["setup_quality", "execution_quality", "discipline"] as const).map(k => (
                <div className="form-field" key={k}>
                  <Label htmlFor={`nt-${k}`}>{k.replaceAll("_", " ")}</Label>
                  <Input id={`nt-${k}`} type="number" min="1" max="10" value={(form as any)[k]} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
              <div className="form-field">
                <Label htmlFor="nt-mae">MAE</Label>
                <Input id="nt-mae" type="number" step="any" value={form.mae} onChange={e => set("mae", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="nt-mfe">MFE</Label>
                <Input id="nt-mfe" type="number" step="any" value={form.mfe} onChange={e => set("mfe", e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Tags</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {tags.map(t => (
                <Button
                  type="button"
                  key={t.id}
                  size="sm"
                  variant={selected.includes(t.id) ? "default" : "secondary"}
                  onClick={() => setSelected(x => x.includes(t.id) ? x.filter(y => y !== t.id) : [...x, t.id])}
                >
                  {t.name}
                </Button>
              ))}
              {!tags.length && <span className="muted">Create tags in the Tags page below.</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Notes &amp; Screenshots</CardTitle></CardHeader>
          <CardContent>
            <Textarea rows={7} placeholder="Why did you enter? What happened? What did you learn?" value={form.notes} onChange={e => set("notes", e.target.value)} />
            <label className="upload-box block cursor-pointer">
              📸 Add screenshots
              <input type="file" accept="image/*" multiple hidden onChange={e => setFiles(Array.from(e.target.files ?? []))} />
              <div className="muted text-[11px] mt-1.5">{files.length ? `${files.length} file(s) selected` : "PNG, JPG, WEBP"}</div>
            </label>
          </CardContent>
        </Card>

        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
          <Button disabled={saving}>{saving ? "Saving trade…" : "Save Trade"}</Button>
        </div>
      </form>
    </div>
  );
}
