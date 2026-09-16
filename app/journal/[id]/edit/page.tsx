"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BURSA_BOARD_LOT, SESSIONS, calculateGrossPnl, calculateRisk, formatMoney, formatR, localDatetimeToIso, numberOrNull, roundMoney, sessionBucket, sessionLabel, stripUnknownColumn, toLocalDatetimeInput } from "@/lib/trading";
import { PageHeader } from "@/components/page-header";
import { LoadError, firstError } from "@/components/load-error";
import { ConfirmButton } from "@/components/confirm-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SELECT_NONE } from "@/components/ui/select";
import { BROKER_PRESETS, DEFAULT_BROKER_ID, SHARES, brokerPreset, describeLeg, roundTripFees, type AssetClass, type FeeBreakdown } from "@/lib/fees";

type Account = { id: string; name: string; broker?: string | null };
type Tag = { id: string; name: string; category: string | null };

const psychology = { session: SESSIONS, emotion: ["Calm", "Confident", "Uncertain", "Fearful", "FOMO", "Greedy", "Revenge"], mistake: ["No mistake", "FOMO", "Early entry", "Late exit", "Oversized", "Moved SL", "Overtrading", "Ignored plan"] };
const numericFields = ["entry_price", "exit_price", "position_size", "stop_loss", "take_profit", "gross_pnl", "commission", "swap", "fees", "risk_percent", "setup_quality", "execution_quality", "discipline", "mae", "mfe"];

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
      // Reuse the broker and cost settings the trade was recorded with.
      const stored = row.fee_breakdown ?? null;
      setBroker(stored?.broker ?? (a.data ?? []).find((x: any) => x.id === row.account_id)?.broker ?? DEFAULT_BROKER_ID);
      setIntraday(Boolean(stored?.intraday));
      setSstOverride(stored?.sstRate === null || stored?.sstRate === undefined ? "" : String(Number(stored.sstRate) * 100));
    })();
  }, [id]);

  const set = (key: string, value: any) => setForm((x: any) => ({ ...x, [key]: value }));
  const preset = brokerPreset(broker);
  // Shares-only journal; an older row keeps whatever class it was saved with.
  const assetClass = (form?.asset_class || SHARES) as AssetClass;
  const parsedSst = sstOverride.trim() === "" ? null : Number(sstOverride) / 100;
  const sstRate = parsedSst !== null && Number.isFinite(parsedSst) ? parsedSst : null;

  const fees: FeeBreakdown = useMemo(
    () => roundTripFees(preset, form?.entry_price, form?.exit_price, form?.position_size, {
      assetClass,
      intraday: intraday && preset.market === "bursa",
      sstRate,
    }),
    [preset, form?.entry_price, form?.exit_price, form?.position_size, assetClass, intraday, sstRate]
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

  const quantity = numberOrNull(form?.position_size);
  const entryValue = quantity && quantity > 0 ? roundMoney(quantity * (numberOrNull(form?.entry_price) ?? 0)) : 0;
  const exitValue = quantity && quantity > 0 ? roundMoney(quantity * (numberOrNull(form?.exit_price) ?? 0)) : 0;
  const risk = useMemo(() => (form ? calculateRisk(form.entry_price, form.stop_loss, form.position_size, form.risk_amount) : null), [form?.entry_price, form?.stop_loss, form?.position_size, form?.risk_amount]);
  const rGross = risk && risk > 0 ? grossPnl / risk : null;
  const rNet = risk && risk > 0 ? netPnl / risk : null;

  function pickAccount(nextId: string) {
    set("account_id", nextId);
    const account = accounts.find(a => a.id === nextId);
    if (account?.broker) setBroker(account.broker);
  }

  function updateLots(value: string) {
    setLots(value);
    const n = Number(value);
    if (value.trim() !== "" && Number.isFinite(n) && n > 0) set("position_size", String(n * BURSA_BOARD_LOT));
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
      gross_pnl: grossPnl,
      commission,
      swap,
      fees: exchangeFees,
      risk_amount: risk,
      r_multiple: rNet,
      fee_breakdown: { ...fees, broker: preset.id, brokerName: preset.name },
    };
    for (const key of numericFields) payload[key] = numberOrNull(form[key]);
    payload.gross_pnl = grossPnl;
    payload.commission = commission;
    payload.swap = swap;
    payload.fees = exchangeFees;

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
                <Input id="et-symbol" required value={form.symbol || ""} onChange={e => set("symbol", e.target.value.toUpperCase())} />
              </div>
              {([["entry_price", "Entry Price"], ["exit_price", "Exit Price"], ["position_size", "Position Size (shares)"], ["stop_loss", "Stop Loss"], ["take_profit", "Take Profit"]] as const).map(([k, l]) => (
                <div className="form-field" key={k}>
                  <Label htmlFor={`et-${k}`}>{l}</Label>
                  <Input id={`et-${k}`} type="number" step="any" value={form[k] ?? ""} onChange={e => set(k, e.target.value)} />
                </div>
              ))}
              <div className="form-field">
                <Label htmlFor="et-lots">Board Lots ×{BURSA_BOARD_LOT}</Label>
                <Input id="et-lots" type="number" step="any" min="0" value={lots} onChange={e => updateLots(e.target.value)} placeholder="optional helper" />
              </div>
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
              <Checkbox id="et-ipo" checked={!!form.is_ipo} onCheckedChange={v => set("is_ipo", !!v)} />
              <Label htmlFor="et-ipo">IPO allocation <span className="muted">— bought through an IPO allotment, not the open market</span></Label>
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
              <div className="fee-row"><span className="muted">Opening contract {money(entryValue)}</span><span>{describeLeg(fees.open, formatMoney)}</span></div>
              <div className="fee-row"><span className="muted">Closing contract {money(exitValue)}</span><span>{describeLeg(fees.close, formatMoney)}</span></div>
              <div className="fee-row fee-total"><span>Total charges</span><span>{money(fees.total)}</span></div>
            </div>

            <div className="grid three gap-3 mt-3.5">
              <div className="form-field">
                <Label htmlFor="et-gross">Gross P&amp;L</Label>
                <Input id="et-gross" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(grossPnl) : form.gross_pnl ?? ""} onChange={e => set("gross_pnl", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="et-commission">Commission (brokerage + platform + SST)</Label>
                <Input id="et-commission" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(commission) : form.commission ?? ""} onChange={e => set("commission", e.target.value)} />
              </div>
              <div className="form-field">
                <Label htmlFor="et-fees">Exchange fees (clearing + stamp duty)</Label>
                <Input id="et-fees" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(exchangeFees) : form.fees ?? ""} onChange={e => set("fees", e.target.value)} />
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
            {shots.length ? (
              <div className="shot-grid">{shots.map(shot => <ScreenshotItem key={shot.id} shot={shot} onDelete={removeScreenshot} />)}</div>
            ) : <div className="muted">No screenshots attached.</div>}
            <label className="upload-box block cursor-pointer">
              Add screenshots
              <input hidden type="file" accept="image/*" multiple onChange={e => setFiles(Array.from(e.target.files ?? []))} />
              {files.length > 0 && <div className="mt-2 text-[var(--text)]">{files.length} new image(s) selected · max 10 MB each</div>}
            </label>
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

function ScreenshotItem({ shot, onDelete }: { shot: any; onDelete: (shot: any) => void }) {
  const [uri, setUri] = useState("");
  useEffect(() => { createClient().storage.from("trade-screenshots").createSignedUrl(shot.storage_path, 3600).then(({ data }) => setUri(data?.signedUrl ?? "")); }, [shot.storage_path]);
  return (
    <div className="screenshot-wrap">
      {uri ? <img src={uri} alt={shot.caption || "Trade screenshot"} className="w-full rounded-[10px] border border-[var(--border)]" /> : <div className="muted">Loading image…</div>}
      <ConfirmButton
        size="sm"
        className="screenshot-delete"
        title="Remove this screenshot?"
        description="The image is deleted from storage as well as from this trade."
        confirmLabel="Remove"
        onConfirm={() => onDelete(shot)}
      >
        Remove
      </ConfirmButton>
    </div>
  );
}
