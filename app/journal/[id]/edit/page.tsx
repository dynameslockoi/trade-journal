"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { KEYS } from "@/lib/data";
import { invalidate } from "@/lib/query-cache";
import { BURSA_SECTORS, SESSIONS, calculateGrossPnl, calculateRisk, formatLots, formatMoney, formatR, localDatetimeToIso, lotsToShares, numberOrNull, roundMoney, sessionBucket, sessionLabel, sharesToLots, stripUnknownColumn, toLocalDatetimeInput } from "@/lib/trading";
import { PageHeader } from "@/components/page-header";
import { ScreenshotInput } from "@/components/screenshot-input";
import { ScreenshotGallery } from "@/components/screenshot-gallery";
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
import { BROKER_PRESETS, DEFAULT_BROKER_ID, SHARES, brokerPreset, describeIpo, describeLeg, ipoChannelForBroker, ipoTitle, roundTripFees, type AssetClass, type FeeBreakdown } from "@/lib/fees";
import { IpoSubscription, defaultIpoState, ipoInputs, ipoStateFromStored, type IpoState } from "@/components/ipo-subscription";

type Account = { id: string; name: string; broker?: string | null };
type Tag = { id: string; name: string; category: string | null };

const psychology = { session: SESSIONS, emotion: ["Calm", "Confident", "Uncertain", "Fearful", "FOMO", "Greedy", "Revenge"], mistake: ["No mistake", "FOMO", "Early entry", "Late exit", "Oversized", "Moved SL", "Overtrading", "Ignored plan"] };
const numericFields = ["entry_price", "exit_price", "position_size", "stop_loss", "take_profit", "gross_pnl", "commission", "swap", "fees", "risk_percent", "setup_quality", "execution_quality", "discipline", "mae", "mfe"];

/**
 * The figures a trade's money is derived from — nothing else on this form can change what it earned.
 *
 * Gross P&L and charges are recomputed from the prices as you edit, which quietly replaced figures
 * that came from a spreadsheet the first time a trade was opened and saved, even when the save was
 * only made to attach a screenshot: a price kept to two decimals re-multiplied by the share count
 * answers a slightly different sum than the one the diary recorded. So the stored figures are kept
 * until one of these actually moves.
 */
const MONEY_FIELDS = ["entry_price", "exit_price", "position_size", "stop_loss", "take_profit", "commission", "fees", "swap"] as const;
/** What gross P&L is worked out from. */
const GROSS_FIELDS = ["entry_price", "exit_price", "position_size"] as const;
/** What risk and R are worked out from — the stop, rather than the exit. Clearing the risk amount is
 * how a trade asks for it to be derived from the stop, so that counts as a change too. */
const RISK_FIELDS = ["entry_price", "stop_loss", "position_size", "risk_amount"] as const;

/** The subscription terms as one comparable string — what a save compares to decide the charges. */
const ipoKey = (state: IpoState) => [state.channel, state.method, state.multiple, state.financed, state.days].join("|");

const money = (v: number | null) => formatMoney(v);

export default function EditTrade() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<any>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [shots, setShots] = useState<any[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [broker, setBroker] = useState(DEFAULT_BROKER_ID);
  const [intraday, setIntraday] = useState(false);
  const [autoCalc, setAutoCalc] = useState(true);
  const [sstOverride, setSstOverride] = useState("");
  const [lots, setLots] = useState("");
  const [sectorFrom, setSectorFrom] = useState("");
  // Only used when this trade is flagged as an IPO allocation; idle otherwise.
  const [ipo, setIpo] = useState<IpoState>(() => defaultIpoState(DEFAULT_BROKER_ID));
  const baseline = useRef<{
    fields: Record<string, number | null>;
    broker: string;
    intraday: boolean;
    sst: string;
    autoCalc: boolean;
    /** The subscription terms as stored, so changing one counts as a change to the charges. */
    ipo: string;
    isIpo: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const s = createClient();
      const [t, a, st, tg, tt, sh] = await Promise.all([
        s.from("trades").select("*").eq("id", id).single(),
        s.from("trading_accounts").select("*").order("name"),
        s.from("strategies").select("id,name").order("name"),
        s.from("tags").select("id,name,category").order("name"),
        s.from("trade_tags").select("tag_id").eq("trade_id", id),
        s.from("trade_screenshots").select("id,storage_path,kind,caption").eq("trade_id", id).order("created_at"),
      ]);
      if (!t.data) { setError(t.error?.message || "Trade not found."); return; }
      const row = t.data as any;
      // Sessions are the two Bursa windows, so an older row's free-form value is normalised here.
      setForm({ ...row, entry_at: toLocalDatetimeInput(row.entry_at), exit_at: toLocalDatetimeInput(row.exit_at), session: sessionBucket(row.session, row.entry_at) });
      // The trade itself loaded; a failed list would still leave the pickers empty and unexplained.
      setLoadError(firstError(a, st, tg));
      setAccounts((a.data ?? []) as Account[]);
      setStrategies(st.data ?? []);
      setTags((tg.data ?? []) as Tag[]);
      setSelectedTags((tt.data ?? []).map((x: any) => x.tag_id));
      setShots(sh.data ?? []);
      // The stored size is shares; the field shows the lots it was entered as.
      const storedLots = sharesToLots(row.position_size);
      setLots(storedLots === null ? "" : String(storedLots));
      // Reuse the broker and cost settings the trade was recorded with.
      const stored = row.fee_breakdown ?? null;
      const brokerId = stored?.broker ?? (a.data ?? []).find((x: any) => x.id === row.account_id)?.broker ?? DEFAULT_BROKER_ID;
      const sst = stored?.sstRate === null || stored?.sstRate === undefined ? "" : String(Number(stored.sstRate) * 100);
      // What the trade recorded about its subscription, so the form reopens on the same terms.
      const ipoState = ipoStateFromStored(stored?.ipo, brokerId);
      // The snapshot the save compares against. Set before `setForm`, so the render the form's own
      // update causes already sees it.
      baseline.current = {
        fields: Object.fromEntries(MONEY_FIELDS.map(k => [k, numberOrNull(row[k])])),
        broker: brokerId,
        intraday: Boolean(stored?.intraday),
        sst,
        autoCalc: true,
        ipo: ipoKey(ipoState),
        isIpo: Boolean(row.is_ipo),
      };
      setBroker(brokerId);
      setIntraday(Boolean(stored?.intraday));
      setSstOverride(sst);
      setIpo(ipoState);
    })();
  }, [id]);

  const set = (key: string, value: any) => setForm((x: any) => ({ ...x, [key]: value }));
  const preset = brokerPreset(broker);
  // Shares-only journal; an older row keeps whatever class it was saved with.
  const assetClass = (form?.asset_class || SHARES) as AssetClass;
  const parsedSst = sstOverride.trim() === "" ? null : Number(sstOverride) / 100;
  const sstRate = parsedSst !== null && Number.isFinite(parsedSst) ? parsedSst : null;

  const quantity = numberOrNull(form?.position_size);
  const entryValue = quantity && quantity > 0 ? roundMoney(quantity * (numberOrNull(form?.entry_price) ?? 0)) : 0;
  // What the allocation is applied for, which is what a financing tier borrows a share of.
  const ipoTerms = useMemo(() => ipoInputs(ipo, entryValue), [ipo, entryValue]);

  const fees: FeeBreakdown = useMemo(
    () => roundTripFees(preset, form?.entry_price, form?.exit_price, form?.position_size, {
      assetClass,
      intraday: intraday && preset.market === "bursa",
      sstRate,
      // A subscription replaces the opening leg outright, so this is only priced on an IPO trade.
      ipo: form?.is_ipo ? ipoTerms : null,
    }),
    [preset, form?.entry_price, form?.exit_price, form?.position_size, assetClass, intraday, sstRate, form?.is_ipo, ipoTerms]
  );

  const autoGross = useMemo(
    // A saved row is re-priced with its own stored direction, so old data is never flipped.
    () => calculateGrossPnl(form?.entry_price, form?.exit_price, form?.position_size, (form?.direction || "long") as "long" | "short"),
    [form?.entry_price, form?.exit_price, form?.position_size, form?.direction]
  );

  const grossPnl = autoCalc ? autoGross ?? 0 : Number(form?.gross_pnl || 0);
  const commission = autoCalc ? fees.brokerCharges : Number(form?.commission || 0);
  const exchangeFees = autoCalc ? fees.marketCharges : Number(form?.fees || 0);
  const swap = Number(form?.swap || 0);
  const netPnl = roundMoney(grossPnl - commission - exchangeFees - swap);

  /**
   * Which figures the money is derived from have been edited. Each group is decided on its own inputs,
   * so fixing a stop loss recalculates the risk and the R without also rewriting a gross P&L that the
   * prices did not change — and a note, a tag, a sector or a screenshot moves nothing at all.
   */
  const keep = useMemo(() => {
    const base = baseline.current;
    // No snapshot yet (still loading) — behave as the form always has.
    const none = { gross: false, charges: false, risk: false };
    if (!base || form == null) return none;
    // Turning auto-calculate off or on is itself a request to recalculate.
    if (autoCalc !== base.autoCalc) return none;
    const moved = (keys: readonly string[]) => keys.some(k => numberOrNull(form[k]) !== base.fields[k]);
    // Gross comes from the prices and the size; the charges add the broker and its cost settings,
    // and on an IPO trade the subscription terms stand in for the opening leg entirely.
    const priceMoved = moved(GROSS_FIELDS);
    const chargesMoved = priceMoved
      || broker !== base.broker || intraday !== base.intraday || sstOverride.trim() !== base.sst
      || Boolean(form.is_ipo) !== base.isIpo || ipoKey(ipo) !== base.ipo;
    return { gross: !priceMoved, charges: !chargesMoved, risk: !moved(RISK_FIELDS) };
  }, [form, broker, intraday, sstOverride, autoCalc, ipo]);

  // Everything shown below is what a save writes: the recorded figures while nothing has moved, the
  // recalculated ones once something has.
  const shownGross = keep.gross ? numberOrNull(form?.gross_pnl) ?? 0 : grossPnl;
  const shownCommission = keep.charges ? numberOrNull(form?.commission) ?? 0 : commission;
  const shownExchange = keep.charges ? numberOrNull(form?.fees) ?? 0 : exchangeFees;
  const shownCharges = roundMoney(shownCommission + shownExchange);
  const shownNet = roundMoney(shownGross - shownCharges - swap);
  // The stored breakdown describes the recorded charges; a row saved before that column existed has
  // none, and then the calculated legs are the only description available.
  const recordedBreakdown: FeeBreakdown | null = form?.fee_breakdown ?? null;
  const panelFees = keep.charges && recordedBreakdown ? recordedBreakdown : fees;

  const exitValue = quantity && quantity > 0 ? roundMoney(quantity * (numberOrNull(form?.exit_price) ?? 0)) : 0;
  const risk = useMemo(() => (form ? calculateRisk(form.entry_price, form.stop_loss, form.position_size, form.risk_amount) : null), [form?.entry_price, form?.stop_loss, form?.position_size, form?.risk_amount]);
  const shownRisk = keep.risk ? numberOrNull(form?.risk_amount) : risk;
  // R only has a recorded value to keep where the trade has one: a row saved without it gets the
  // computed figure, because filling a blank is not the same as overwriting a record.
  const keepR = keep.gross && keep.risk && numberOrNull(form?.r_multiple) !== null;
  const rGross = shownRisk && shownRisk > 0 ? shownGross / shownRisk : null;
  const rNet = keepR ? numberOrNull(form?.r_multiple) : (shownRisk && shownRisk > 0 ? shownNet / shownRisk : null);
  // Worth naming when the recorded figures and the recorded prices disagree: that is the difference a
  // save used to write over without being asked.
  const recalcsDifferently = keep.gross && keep.charges
    && (Math.abs(grossPnl - shownGross) > 0.005 || Math.abs(roundMoney(commission + exchangeFees) - shownCharges) > 0.005);

  function pickAccount(nextId: string) {
    set("account_id", nextId);
    const account = accounts.find(a => a.id === nextId);
    if (account?.broker) setBroker(account.broker);
  }

  function updateLots(value: string) {
    setLots(value);
    const shares = lotsToShares(value);
    set("position_size", shares === null ? "" : String(shares));
  }

  /** See the new-trade form: a symbol's sector is carried over rather than picked again. */
  async function fillSectorFromHistory() {
    const sym = String(form?.symbol || "").trim().toUpperCase();
    if (!sym || form?.sector) return;
    const { data } = await createClient()
      .from("trades")
      .select("sector")
      .eq("symbol", sym)
      .not("sector", "is", null)
      .order("entry_at", { ascending: false })
      .limit(1);
    const known = data?.[0]?.sector;
    if (!known) return;
    setForm((x: any) => (String(x.symbol || "").trim().toUpperCase() === sym && !x.sector ? { ...x, sector: known } : x));
    setSectorFrom(sym);
  }

  async function removeScreenshot(shot: any) {
    const s = createClient();
    const [storage, db] = await Promise.all([
      s.storage.from("trade-screenshots").remove([shot.storage_path]),
      s.from("trade_screenshots").delete().eq("id", shot.id),
    ]);
    if (storage.error || db.error) { setError(storage.error?.message || db.error?.message || "Could not remove screenshot."); return; }
    setShots(x => x.filter(y => y.id !== shot.id));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError("");
    const s = createClient();

    const payload: any = {
      symbol: String(form.symbol || "").trim().toUpperCase(),
      sector: form.sector || null,
      account_id: form.account_id || null,
      strategy_id: form.strategy_id || null,
      direction: form.direction || "long",
      asset_class: assetClass,
      entry_at: localDatetimeToIso(form.entry_at),
      exit_at: localDatetimeToIso(form.exit_at),
      session: form.session || null,
      emotion: form.emotion || null,
      mistake: form.mistake || null,
      notes: form.notes || null,
      is_ipo: Boolean(form.is_ipo),
      swap,
      risk_amount: risk,
      // Keeping the recorded fees keeps the record of how they were worked out with them.
      fee_breakdown: keep.charges && recordedBreakdown ? recordedBreakdown : { ...fees, broker: preset.id, brokerName: preset.name },
    };
    for (const key of numericFields) payload[key] = numberOrNull(form[key]);
    // The money is settled here, once, after the numeric coercion — so there is one place that
    // decides it. A kept value is written back exactly as recorded: a null stays null rather than
    // becoming a zero, which would read as "this trade broke even".
    payload.gross_pnl = keep.gross ? numberOrNull(form.gross_pnl) : shownGross;
    payload.commission = keep.charges ? numberOrNull(form.commission) : shownCommission;
    payload.swap = swap;
    payload.fees = keep.charges ? numberOrNull(form.fees) : shownExchange;
    payload.risk_amount = keep.risk ? numberOrNull(form.risk_amount) : shownRisk;
    payload.r_multiple = keepR ? numberOrNull(form.r_multiple) : rNet;

    if (!payload.symbol || !payload.entry_at) { setError("Symbol and entry date/time are required."); setSaving(false); return; }
    if (payload.exit_at && new Date(payload.exit_at) < new Date(payload.entry_at)) { setError("Exit time cannot be before entry time."); setSaving(false); return; }

    let { error: updateError } = await s.from("trades").update(payload).eq("id", id);
    if (updateError && (updateError.code === "PGRST204" || /fee_breakdown/.test(updateError.message ?? ""))) {
      ({ error: updateError } = await s.from("trades").update(stripUnknownColumn(payload, updateError.message)).eq("id", id));
    }
    if (updateError) { setError(updateError.message); setSaving(false); return; }

    const { error: clearTagsError } = await s.from("trade_tags").delete().eq("trade_id", id);
    if (clearTagsError) { setError(clearTagsError.message); setSaving(false); return; }
    if (selectedTags.length) {
      const { error: tagError } = await s.from("trade_tags").insert(selectedTags.map(tag_id => ({ trade_id: id, tag_id })));
      if (tagError) { setError(tagError.message); setSaving(false); return; }
    }

    const { data: { user } } = await s.auth.getUser();
    if (user) {
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024 || !file.type.startsWith("image/")) continue;
        const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${user.id}/${id}/${crypto.randomUUID()}-${safe}`;
        const up = await s.storage.from("trade-screenshots").upload(path, file, { upsert: false, contentType: file.type });
        if (up.error) { setError(`Screenshot upload failed: ${up.error.message}`); setSaving(false); return; }
        const ins = await s.from("trade_screenshots").insert({ trade_id: id, user_id: user.id, storage_path: path, kind: "after", caption: "" });
        if (ins.error) {
          await s.storage.from("trade-screenshots").remove([path]);
          setError(ins.error.message);
          setSaving(false);
          return;
        }
      }
    }
    // The journal, the dashboard and the analytics all hold this trade in the cache.
    invalidate(KEYS.trades);
    router.push(`/journal/${id}`);
  }

  if (error && !form) return <div className="content"><Alert variant="error" className="card">{error}</Alert></div>;
  if (!form) return <div className="content"><div className="muted">Loading trade…</div></div>;

  const profitClass = (v: number) => (v >= 0 ? "positive" : "negative");

  return (
    <div className="content max-w-[1100px]">
      <PageHeader eyebrow="Journal / Edit Trade" title={`Edit ${form.symbol}`} subtitle="Charges and gross P&L recalculate as you change the figures." />
      <LoadError message={loadError} what="your accounts, strategies and tags" />
      <form onSubmit={save} className="grid">
        <Card>
          <CardHeader><CardTitle>Trade Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid three">
              <div className="form-field">
                <Label htmlFor="et-symbol">Symbol</Label>
                <Input id="et-symbol" required value={form.symbol || ""} onChange={e => set("symbol", e.target.value.toUpperCase())} onBlur={fillSectorFromHistory} />
              </div>
              <div className="form-field">
                <Label htmlFor="et-sector">Sector</Label>
                <Select
                  value={form.sector || SELECT_NONE}
                  onValueChange={v => { set("sector", v === SELECT_NONE ? "" : v); setSectorFrom(""); }}
                >
                  <SelectTrigger id="et-sector"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>Not set</SelectItem>
                    {BURSA_SECTORS.map(x => <SelectItem key={x} value={x}>{x}</SelectItem>)}
                  </SelectContent>
                </Select>
                {sectorFrom && <span className="muted text-[10px]">from your last {sectorFrom} trade</span>}
              </div>
              {([["entry_price", "Entry Price"], ["exit_price", "Exit Price"]] as const).map(([k, l]) => (
                <div className="form-field" key={k}>
                  <Label htmlFor={`et-${k}`}>{l}</Label>
                  <Input id={`et-${k}`} type="number" step="any" value={form[k] ?? ""} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
              <div className="form-field">
                <Label htmlFor="et-lots">Position Lot</Label>
                <Input id="et-lots" type="number" step="any" min="0" value={lots} onChange={e => updateLots(e.target.value)} placeholder="e.g. 50" />
              </div>
              {([["stop_loss", "Stop Loss"], ["take_profit", "Take Profit"]] as const).map(([k, l]) => (
                <div className="form-field" key={k}>
                  <Label htmlFor={`et-${k}`}>{l}</Label>
                  <Input id={`et-${k}`} type="number" step="any" value={form[k] ?? ""} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
              <div className="form-field">
                <Label htmlFor="et-entry">Entry Date/Time</Label>
                <DateTimePicker id="et-entry" value={form.entry_at || ""} onChange={v => set("entry_at", v)} />
              </div>
              <div className="form-field">
                <Label htmlFor="et-exit">Exit Date/Time</Label>
                <DateTimePicker id="et-exit" value={form.exit_at || ""} onChange={v => set("exit_at", v)} placeholder="Still open" />
              </div>
              <div className="form-field">
                <Label htmlFor="et-account">Account</Label>
                <Select value={form.account_id || SELECT_NONE} onValueChange={v => pickAccount(v === SELECT_NONE ? "" : v)}>
                  <SelectTrigger id="et-account"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>No account</SelectItem>
                    {accounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="form-field">
                <Label htmlFor="et-strategy">Strategy</Label>
                <Select value={form.strategy_id || SELECT_NONE} onValueChange={v => set("strategy_id", v === SELECT_NONE ? "" : v)}>
                  <SelectTrigger id="et-strategy"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>No strategy</SelectItem>
                    {strategies.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="review-label mt-3">
              <Checkbox id="et-ipo" checked={!!form.is_ipo} onCheckedChange={v => {
                set("is_ipo", !!v);
                // The channel defaults from the broker in use, because subscribing through M+ Global
                // or Moomoo means the journal already knows where the application went.
                if (v) setIpo(x => ({ ...x, channel: ipoChannelForBroker(broker) }));
              }} />
              <Label htmlFor="et-ipo">IPO allocation <span className="muted">— an allotment rather than a market buy, so its subscription is priced in Fees &amp; Charges below instead of the opening contract</span></Label>
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
                idPrefix="et"
                state={ipo}
                onChange={setIpo}
                charge={fees.ipo}
                contractValue={entryValue}
              />
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <div className="form-field flex-[1_1_240px]">
                <Label htmlFor="et-broker">Broker preset</Label>
                <Select value={broker} onValueChange={setBroker}>
                  <SelectTrigger id="et-broker"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BROKER_PRESETS.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="form-field flex-[0_1_110px]">
                <Label htmlFor="et-sst">SST %</Label>
                <Input id="et-sst" type="number" step="0.1" min="0" placeholder="auto" value={sstOverride} onChange={e => setSstOverride(e.target.value)} />
              </div>
              {preset.brokerage.intradayRate !== null && (
                <div className="review-label">
                  <Checkbox id="et-intraday" checked={intraday} onCheckedChange={v => setIntraday(!!v)} />
                  <Label htmlFor="et-intraday">Intraday</Label>
                </div>
              )}
              <div className="review-label">
                <Checkbox id="et-auto" checked={autoCalc} onCheckedChange={v => setAutoCalc(!!v)} />
                <Label htmlFor="et-auto">Auto-calculate</Label>
              </div>
            </div>
            <div className="muted text-[10px] mt-2">
              {preset.note}. Bursa shares — stamp duty is RM1 per RM1,000, capped at RM1,000.
            </div>

            <div className="fee-panel">
              {fees.ipo ? (
                <div className="fee-row"><span className="muted">Subscription · {ipoTitle(fees.ipo)}</span><span>{describeIpo(fees.ipo, formatMoney)}</span></div>
              ) : (
                <div className="fee-row"><span className="muted">Opening contract {money(entryValue)}</span><span>{describeLeg(panelFees.open, formatMoney)}</span></div>
              )}
              <div className="fee-row"><span className="muted">Closing contract {money(exitValue)}</span><span>{describeLeg(panelFees.close, formatMoney)}</span></div>
              <div className="fee-row fee-total"><span>Total charges</span><span>{money(shownCharges)}</span></div>
            </div>

            <div className="grid three gap-3 mt-3.5">
              <div className="form-field">
                <Label htmlFor="et-gross">Gross P&amp;L</Label>
                <Input id="et-gross" type="number" step="any" readOnly={autoCalc || keep.gross} value={autoCalc || keep.gross ? String(shownGross) : form.gross_pnl ?? ""} onChange={e => set("gross_pnl", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="et-commission">Commission (brokerage + platform + SST)</Label>
                <Input id="et-commission" type="number" step="any" readOnly={autoCalc || keep.charges} value={autoCalc || keep.charges ? String(shownCommission) : form.commission ?? ""} onChange={e => set("commission", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="et-fees">Exchange fees (clearing + stamp duty)</Label>
                <Input id="et-fees" type="number" step="any" readOnly={autoCalc || keep.charges} value={autoCalc || keep.charges ? String(shownExchange) : form.fees ?? ""} onChange={e => set("fees", e.target.value)} />
              </div>
            </div>
            <div className="grid three gap-3">
              {Number(form.swap || 0) !== 0 && (
                <div className="form-field">
                  <Label htmlFor="et-swap">Swap / overnight</Label>
                  <Input id="et-swap" type="number" step="any" value={form.swap ?? ""} onChange={e => set("swap", e.target.value)} />
                </div>
              )}
              <div className="form-field">
                <Label htmlFor="et-risk">Risk Amount</Label>
                <Input id="et-risk" type="number" step="any" value={form.risk_amount ?? ""} onChange={e => set("risk_amount", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="et-riskpct">Risk %</Label>
                <Input id="et-riskpct" type="number" step="any" value={form.risk_percent ?? ""} onChange={e => set("risk_percent", e.target.value)} />
              </div>
            </div>
            <div className="calc-strip">
              <span>Risk: <b>{formatMoney(shownRisk)}</b></span>
              <span>Gross: <b className={profitClass(shownGross)}>{formatMoney(shownGross, null, true)}</b></span>
              <span>Net after charges: <b className={profitClass(shownNet)}>{formatMoney(shownNet, null, true)}</b></span>
              <span>R (net): <b className={rNet === null ? "" : profitClass(rNet)}>{rNet === null ? "—" : formatR(rNet)}</b></span>
              <span>R (gross): <b className={rGross === null ? "" : profitClass(rGross)}>{rGross === null ? "—" : formatR(rGross)}</b></span>
            </div>
            {/* The form must say which of the two it is about to write, because a read-only figure
                gives no clue on its own — and when the two differ, it says by how much, since that
                difference is the reason a figure recorded elsewhere would otherwise move. */}
            <div className="muted text-[10px] mt-2">
              {keep.gross && keep.charges ? <>
                Keeping the figures recorded with this trade — <b>{formatMoney(shownGross, null, true)}</b> gross, <b>{formatMoney(shownCharges)}</b> charges. Change a price, the position lot, a fee or the broker to recalculate.
                {recalcsDifferently && <> The prices as stored work out to {formatMoney(grossPnl, null, true)} gross and {formatMoney(roundMoney(commission + exchangeFees))} charges.</>}
              </> : keep.gross ? <>
                Keeping the recorded gross P&amp;L <b>{formatMoney(shownGross, null, true)}</b>; the charges are recalculated from the {preset.name} preset — <b>{formatMoney(shownCharges)}</b>.
              </> : <>
                Recalculated from the prices, the position and the broker preset — <b>{formatMoney(shownGross, null, true)}</b> gross, <b>{formatMoney(shownCharges)}</b> charges.
              </>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Psychology &amp; Execution</CardTitle></CardHeader>
          <CardContent>
            <div className="grid three">
              {Object.entries(psychology).map(([key, opts]) => (
                <div className="form-field" key={key}>
                  <Label htmlFor={`et-${key}`}>{key.replaceAll("_", " ")}</Label>
                  <Select value={form[key] || SELECT_NONE} onValueChange={v => set(key, v === SELECT_NONE ? "" : v)}>
                    <SelectTrigger id={`et-${key}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SELECT_NONE}>Not set</SelectItem>
                      {(key === "session" ? SESSIONS : opts).map(x => <SelectItem key={x} value={x}>{sessionLabel(x)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
              {(["setup_quality", "execution_quality", "discipline"] as const).map(k => (
                <div className="form-field" key={k}>
                  <Label htmlFor={`et-${k}`}>{k.replaceAll("_", " ")}</Label>
                  <Input id={`et-${k}`} type="number" min="1" max="10" value={form[k] ?? ""} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
              <div className="form-field">
                <Label htmlFor="et-mae">MAE</Label>
                <Input id="et-mae" type="number" step="any" value={form.mae ?? ""} onChange={e => set("mae", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="et-mfe">MFE</Label>
                <Input id="et-mfe" type="number" step="any" value={form.mfe ?? ""} onChange={e => set("mfe", e.target.value)} />
              </div>
            </div>
            <div className="form-field mt-3.5">
              <Label htmlFor="et-notes">Notes</Label>
              <Textarea id="et-notes" rows={7} value={form.notes || ""} onChange={e => set("notes", e.target.value)} />
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
                  variant={selectedTags.includes(t.id) ? "default" : "secondary"}
                  onClick={() => setSelectedTags(x => x.includes(t.id) ? x.filter(y => y !== t.id) : [...x, t.id])}
                >
                  {t.name}
                </Button>
              ))}
              {!tags.length && <span className="muted">No tags created yet.</span>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Screenshots</CardTitle></CardHeader>
          <CardContent>
            <ScreenshotGallery shots={shots} onRemove={removeScreenshot} />
            <ScreenshotInput files={files} onChange={setFiles} />
          </CardContent>
        </Card>

        {error && <Alert variant="error">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
          <Button disabled={saving}>{saving ? "Saving…" : "Save Changes"}</Button>
        </div>
      </form>
    </div>
  );
}


