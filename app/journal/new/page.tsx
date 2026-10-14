"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { KEYS, loadAccounts, loadStrategies, loadTags } from "@/lib/data";
import { invalidate, useCachedQuery } from "@/lib/query-cache";
import { fetchLatestClassification } from "@/lib/queries";
import { BURSA_SECTORS, SESSIONS, calculateGrossPnl, calculateRisk, formatLots, formatMoney, formatR, isSubSectorOf, localDatetimeToIso, lotsToShares, numberOrNull, roundMoney, sessionForTime, sessionLabel, sharesToLots, stripUnknownColumn, subSectorsFor } from "@/lib/trading";
import { PageHeader } from "@/components/page-header";
import { ScreenshotInput } from "@/components/screenshot-input";
import { LoadError } from "@/components/load-error";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SELECT_NONE } from "@/components/ui/select";
import { BROKER_PRESETS, DEFAULT_BROKER_ID, SHARES, brokerPreset, describeIpo, describeLeg, ipoChannelForBroker, ipoTitle, roundTripFees, type FeeBreakdown } from "@/lib/fees";
import { IpoSubscription, defaultIpoState, ipoInputs, type IpoState } from "@/components/ipo-subscription";


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
  symbol: "", sector: "", sub_sector: "", account_id: "", strategy_id: "", asset_class: "shares",
  entry_at: "", exit_at: "",
  entry_price: "", exit_price: "", position_size: "", stop_loss: "", take_profit: "",
  gross_pnl: "0", commission: "0", swap: "0", fees: "0", risk_amount: "", risk_percent: "",
  emotion: "Calm", mistake: "No mistake", is_ipo: false,
  setup_quality: "8", execution_quality: "8", discipline: "8", mae: "", mfe: "", notes: "",
};

const money = (v: number | null) => formatMoney(v);

export default function NewTrade() {
  const router = useRouter();
  // The shell's warm-up (see AppShell) has usually already fetched these by the time someone
  // reaches "Add Trade" from the journal or dashboard, so this page opens with the pickers
  // already populated instead of running its own accounts/strategies/tags query from cold.
  const accountsQ = useCachedQuery<Account[]>(KEYS.accounts, loadAccounts);
  const strategiesQ = useCachedQuery<Strategy[]>(KEYS.strategies, loadStrategies);
  const tagsQ = useCachedQuery<Tag[]>(KEYS.tags, loadTags);
  const accounts = accountsQ.data ?? [];
  const strategies = strategiesQ.data ?? [];
  const tags = tagsQ.data ?? [];
  const loadError = accountsQ.error ?? strategiesQ.error ?? tagsQ.error;
  const [selected, setSelected] = useState<string[]>([]);
  const [form, setForm] = useState(init);
  const [broker, setBroker] = useState(DEFAULT_BROKER_ID);
  const [intraday, setIntraday] = useState(false);
  const [autoCalc, setAutoCalc] = useState(true);
  const [sstOverride, setSstOverride] = useState("");
  const [lots, setLots] = useState("");
  // Only used on a trade flagged as an IPO allocation; idle otherwise.
  const [ipo, setIpo] = useState<IpoState>(() => defaultIpoState(DEFAULT_BROKER_ID));
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Until the user picks a session themselves, it follows the entry time — derived rather than
  // stored, because an empty session cannot be handed to the Select (Radix rejects "" as a value,
  // and reports the value it was given as a change while it matches no option).
  const [sessionPicked, setSessionPicked] = useState<string | null>(null);
  // Where the sector and sub-sector came from, so the fields can say so rather than looking chosen.
  const [sectorFrom, setSectorFrom] = useState("");
  const [subSectorFrom, setSubSectorFrom] = useState("");

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

  const quantity = numberOrNull(form.position_size);
  const entryValue = quantity && quantity > 0 ? roundMoney(quantity * (numberOrNull(form.entry_price) ?? 0)) : 0;
  // What the allocation is applied for, which is what a financing tier borrows a share of.
  const ipoTerms = useMemo(() => ipoInputs(ipo, entryValue), [ipo, entryValue]);

  const fees: FeeBreakdown = useMemo(
    () => roundTripFees(preset, form.entry_price, form.exit_price, form.position_size, {
      assetClass,
      intraday: intraday && preset.market === "bursa",
      sstRate,
      // A subscription replaces the opening leg outright, so this is only priced on an IPO trade.
      ipo: form.is_ipo ? ipoTerms : null,
    }),
    [preset, form.entry_price, form.exit_price, form.position_size, assetClass, intraday, sstRate, form.is_ipo, ipoTerms]
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

  // The form asks for lots and stores shares. The field keeps its own string so a half-typed
  // "12." is not parsed, echoed back as 12 and lost mid-keystroke.
  /**
   * A sector — and the sub-sector under it — belongs to the stock, not to the trade, so once a symbol
   * has been classified it is carried to the next trade of that symbol instead of being picked again.
   * The fields stay empty for a symbol never traded before.
   *
   * Both halves come from one row, so the symbol is asked about once; where `subsectors.sql` has not
   * been run the sector still arrives on its own (see `fetchLatestClassification`).
   */
  async function fillClassificationFromHistory() {
    const sym = form.symbol.trim().toUpperCase();
    if (!sym) return;
    const known = await fetchLatestClassification(createClient(), sym);
    if (!known) return;
    // Answered against the symbol that was asked about: typing on must not strand the old answer.
    // The sub-sector only follows when it belongs to the sector that ends up in the field, so a
    // sector already picked by hand cannot collect a sub-sector from a different one.
    setForm(x => {
      if (x.symbol.trim().toUpperCase() !== sym) return x;
      const sector = x.sector || known.sector;
      const subSector = x.sub_sector
        || (sector === known.sector && isSubSectorOf(sector, known.subSector) ? known.subSector ?? "" : "");
      return { ...x, sector, sub_sector: subSector };
    });
    if (!form.sector) setSectorFrom(sym);
    if (!form.sub_sector && known.subSector && (form.sector || known.sector) === known.sector && isSubSectorOf(known.sector, known.subSector)) {
      setSubSectorFrom(sym);
    }
  }

  /** Choosing a sector also decides whether the sub-sector beside it survives. */
  function changeSector(value: string) {
    const sector = value === SELECT_NONE ? "" : value;
    setForm(x => ({ ...x, sector, sub_sector: isSubSectorOf(sector, x.sub_sector) ? x.sub_sector : "" }));
    setSectorFrom("");
    setSubSectorFrom("");
  }

  function updateLots(value: string) {
    setLots(value);
    const shares = lotsToShares(value);
    set("position_size", shares === null ? "" : String(shares));
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
    payload.sector = payload.sector || null;
    payload.sub_sector = payload.sub_sector || null;

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

    // The journal's cached rows no longer match the database.
    invalidate(KEYS.trades);
    router.push(`/journal/${trade.id}`);
    setSaving(false);
  }

  const profitClass = (v: number) => (v >= 0 ? "positive" : "negative");

  return (
    <div className="content max-w-[1100px]">
      <PageHeader eyebrow="Journal / New Trade" title="Add Trade" subtitle="Enter the position in lots; charges and gross P&L follow from the shares and your broker preset." />
      <LoadError message={loadError} what="your accounts, strategies and tags" />
      <form onSubmit={save} className="grid">
        <Card>
          <CardHeader><CardTitle>Trade Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid three">
              <div className="form-field">
                <Label htmlFor="nt-symbol">Symbol</Label>
                <Input id="nt-symbol" required value={form.symbol} onChange={e => set("symbol", e.target.value.toUpperCase())} onBlur={fillClassificationFromHistory} />
              </div>
              <div className="form-field">
                <Label htmlFor="nt-sector">Sector</Label>
                <Select value={form.sector || SELECT_NONE} onValueChange={changeSector}>
                  <SelectTrigger id="nt-sector"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>Not set</SelectItem>
                    {BURSA_SECTORS.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
                {sectorFrom && <span className="muted text-[10px]">from your last {sectorFrom} trade</span>}
              </div>
              <div className="form-field">
                <Label htmlFor="nt-sub-sector">Sub-sector</Label>
                <Select
                  value={form.sub_sector || SELECT_NONE}
                  onValueChange={v => { set("sub_sector", v === SELECT_NONE ? "" : v); setSubSectorFrom(""); }}
                  disabled={!subSectorsFor(form.sector).length}
                >
                  <SelectTrigger id="nt-sub-sector"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>Not set</SelectItem>
                    {subSectorsFor(form.sector).map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
                {subSectorFrom
                  ? <span className="muted text-[10px]">from your last {subSectorFrom} trade</span>
                  : !form.sector && <span className="muted text-[10px]">Follows the sector you pick.</span>}
              </div>
              {([["entry_price", "Entry Price"], ["exit_price", "Exit Price"]] as const).map(([k, l]) => (
                <div className="form-field" key={k}>
                  <Label htmlFor={`nt-${k}`}>{l}</Label>
                  <Input id={`nt-${k}`} type="number" step="any" value={(form as any)[k]} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
              <div className="form-field">
                <Label htmlFor="nt-lots">Position Lot</Label>
                <Input id="nt-lots" type="number" step="any" min="0" value={lots} onChange={e => updateLots(e.target.value)} placeholder="e.g. 50" />
              </div>
              {([["stop_loss", "Stop Loss"], ["take_profit", "Take Profit"]] as const).map(([k, l]) => (
                <div className="form-field" key={k}>
                  <Label htmlFor={`nt-${k}`}>{l}</Label>
                  <Input id={`nt-${k}`} type="number" step="any" value={(form as any)[k]} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
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
              <Checkbox id="nt-ipo" checked={!!form.is_ipo} onCheckedChange={v => {
                set("is_ipo", !!v);
                // The channel defaults from the broker in use, because subscribing through M+ Global
                // or Moomoo means the journal already knows where the application went.
                if (v) setIpo(x => ({ ...x, channel: ipoChannelForBroker(broker) }));
              }} />
              <Label htmlFor="nt-ipo">IPO allocation <span className="muted">— an allotment rather than a market buy, so its subscription is priced in Fees &amp; Charges below instead of the opening contract</span></Label>
            </div>
            <div className="calc-strip">
              <span className="muted">Contract {money(entryValue)} → {money(exitValue)} · {formatLots(form.position_size)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Fees &amp; Charges</CardTitle></CardHeader>
          <CardContent>
            {form.is_ipo && fees.ipo ? (
              <IpoSubscription
                idPrefix="nt"
                state={ipo}
                onChange={setIpo}
                charge={fees.ipo}
                contractValue={entryValue}
              />
            ) : null}
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
              {fees.ipo ? (
                <div className="fee-row"><span className="muted">Subscription · {ipoTitle(fees.ipo)}</span><span>{describeIpo(fees.ipo, formatMoney)}</span></div>
              ) : (
                <div className="fee-row"><span className="muted">Opening contract {money(entryValue)}</span><span>{describeLeg(fees.open, formatMoney)}</span></div>
              )}
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
            <ScreenshotInput files={files} onChange={setFiles} />
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
