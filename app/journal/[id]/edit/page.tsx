"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BURSA_BOARD_LOT, SESSIONS, calculateGrossPnl, calculateRisk, formatMoney, formatR, localDatetimeToIso, numberOrNull, roundMoney, sessionBucket, sessionLabel, stripUnknownColumn, toLocalDatetimeInput } from "@/lib/trading";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";
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
    if (!confirm("Remove this screenshot?")) return;
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

  if (error && !form) return <div className="content"><div className="card card-pad error">{error}</div></div>;
  if (!form) return <div className="content"><div className="muted">Loading trade…</div></div>;

  const profitClass = (v: number) => (v >= 0 ? "positive" : "negative");

  return (
    <div className="content" style={{ maxWidth: 1100 }}>
      <PageHeader eyebrow="Journal / Edit Trade" title={`Edit ${form.symbol}`} subtitle="Charges and gross P&L recalculate as you change the figures." />
      <form onSubmit={save} className="grid">
        <div className="card card-pad">
          <h3>Trade Details</h3>
          <div className="grid three">
            <label className="field">Symbol<input className="input" required value={form.symbol || ""} onChange={e => set("symbol", e.target.value.toUpperCase())} /></label>
            {[["entry_price", "Entry Price"], ["exit_price", "Exit Price"], ["position_size", "Position Size (shares)"], ["stop_loss", "Stop Loss"], ["take_profit", "Take Profit"]].map(([k, l]) => (
              <label className="field" key={k}>{l}<input className="input" type="number" step="any" value={form[k] ?? ""} onChange={e => set(k, e.target.value)} /></label>
            ))}
            <label className="field">Board Lots ×{BURSA_BOARD_LOT}<input className="input" type="number" step="any" min="0" value={lots} onChange={e => updateLots(e.target.value)} placeholder="optional helper" /></label>
            <label className="field">Entry Date/Time<input className="input" type="datetime-local" required value={form.entry_at || ""} onChange={e => set("entry_at", e.target.value)} /></label>
            <label className="field">Exit Date/Time<input className="input" type="datetime-local" value={form.exit_at || ""} onChange={e => set("exit_at", e.target.value)} /></label>
            <div className="field">
              <span>Account</span>
              <Select aria-label="Account" value={form.account_id || ""} onChange={pickAccount}>
                <option value="">No account</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
            <div className="field">
              <span>Strategy</span>
              <Select aria-label="Strategy" value={form.strategy_id || ""} onChange={v => set("strategy_id", v)}>
                <option value="">No strategy</option>
                {strategies.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </div>
          </div>
          <label className="field review-label" style={{ marginTop: 12 }}>
            <input type="checkbox" checked={!!form.is_ipo} onChange={e => set("is_ipo", e.target.checked)} />
            IPO allocation <span className="muted">— bought through an IPO allotment, not the open market</span>
          </label>
          <div className="calc-strip">
            <span className="muted">Contract {money(entryValue)} → {money(exitValue)} · Bursa board lot is {BURSA_BOARD_LOT} shares</span>
          </div>
        </div>

        <div className="card card-pad">
          <h3>Fees &amp; Charges</h3>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div className="field" style={{ flex: "1 1 240px" }}>
              <span>Broker preset</span>
              <Select aria-label="Broker preset" value={broker} onChange={setBroker}>
                {BROKER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </div>
            <label className="field" style={{ flex: "0 1 110px" }}>
              SST %
              <input className="input" type="number" step="0.1" min="0" placeholder="auto" value={sstOverride} onChange={e => setSstOverride(e.target.value)} />
            </label>
            {preset.brokerage.intradayRate !== null && (
              <label className="field review-label" style={{ flex: "0 0 auto" }}>
                <input type="checkbox" checked={intraday} onChange={e => setIntraday(e.target.checked)} /> Intraday
              </label>
            )}
            <label className="field review-label" style={{ flex: "0 0 auto" }}>
              <input type="checkbox" checked={autoCalc} onChange={e => setAutoCalc(e.target.checked)} /> Auto-calculate
            </label>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
            {preset.note}. Bursa shares — stamp duty is RM1 per RM1,000, capped at RM1,000.
          </div>

          <div className="fee-panel">
            <div className="fee-row"><span className="muted">Opening contract {money(entryValue)}</span><span>{describeLeg(fees.open, formatMoney)}</span></div>
            <div className="fee-row"><span className="muted">Closing contract {money(exitValue)}</span><span>{describeLeg(fees.close, formatMoney)}</span></div>
            <div className="fee-row fee-total"><span>Total charges</span><span>{money(fees.total)}</span></div>
          </div>

          <div className="grid three" style={{ gap: 12, marginTop: 14 }}>
            <label className="field">
              Gross P&amp;L
              <input className="input" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(grossPnl) : form.gross_pnl ?? ""} onChange={e => set("gross_pnl", e.target.value)} />
            </label>
            <label className="field">
              Commission (brokerage + platform + SST)
              <input className="input" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(commission) : form.commission ?? ""} onChange={e => set("commission", e.target.value)} />
            </label>
            <label className="field">
              Exchange fees (clearing + stamp duty)
              <input className="input" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(exchangeFees) : form.fees ?? ""} onChange={e => set("fees", e.target.value)} />
            </label>
          </div>
          <div className="grid three" style={{ gap: 12 }}>
            {Number(form.swap || 0) !== 0 && <label className="field">Swap / overnight<input className="input" type="number" step="any" value={form.swap ?? ""} onChange={e => set("swap", e.target.value)} /></label>}
            <label className="field">Risk Amount<input className="input" type="number" step="any" value={form.risk_amount ?? ""} onChange={e => set("risk_amount", e.target.value)} /></label>
            <label className="field">Risk %<input className="input" type="number" step="any" value={form.risk_percent ?? ""} onChange={e => set("risk_percent", e.target.value)} /></label>
          </div>
          <div className="calc-strip">
            <span>Risk: <b>{formatMoney(risk)}</b></span>
            <span>Gross: <b className={profitClass(grossPnl)}>{formatMoney(grossPnl, null, true)}</b></span>
            <span>Net after charges: <b className={profitClass(netPnl)}>{formatMoney(netPnl, null, true)}</b></span>
            <span>R (net): <b className={rNet === null ? "" : profitClass(rNet)}>{rNet === null ? "—" : formatR(rNet)}</b></span>
            <span>R (gross): <b className={rGross === null ? "" : profitClass(rGross)}>{rGross === null ? "—" : formatR(rGross)}</b></span>
          </div>
        </div>

        <div className="card card-pad">
          <h3>Psychology &amp; Execution</h3>
          <div className="grid three">
            {Object.entries(psychology).map(([key, opts]) => (
              <div className="field" key={key}>
                <span>{key.replaceAll("_", " ")}</span>
                <Select aria-label={key.replaceAll("_", " ")} value={form[key] || ""} onChange={v => set(key, v)}>
                  <option value="">Not set</option>
                  {(key === "session" ? SESSIONS : opts).map(x => <option key={x} value={x}>{sessionLabel(x)}</option>)}
                </Select>
              </div>
            ))}
            {["setup_quality", "execution_quality", "discipline"].map(k => (
              <label className="field" key={k}>{k.replaceAll("_", " ")}<input className="input" type="number" min="1" max="10" value={form[k] ?? ""} onChange={e => set(k, e.target.value)} /></label>
            ))}
            <label className="field">MAE<input className="input" type="number" step="any" value={form.mae ?? ""} onChange={e => set("mae", e.target.value)} /></label>
            <label className="field">MFE<input className="input" type="number" step="any" value={form.mfe ?? ""} onChange={e => set("mfe", e.target.value)} /></label>
          </div>
          <label className="field">Notes<textarea className="input" rows={7} value={form.notes || ""} onChange={e => set("notes", e.target.value)} /></label>
        </div>

        <div className="card card-pad">
          <h3>Tags</h3>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {tags.map(t => (
              <button type="button" key={t.id} className={`btn ${selectedTags.includes(t.id) ? "btn-primary" : ""}`} onClick={() => setSelectedTags(x => x.includes(t.id) ? x.filter(y => y !== t.id) : [...x, t.id])}>{t.name}</button>
            ))}
            {!tags.length && <span className="muted">No tags created yet.</span>}
          </div>
        </div>

        <div className="card card-pad">
          <h3>Screenshots</h3>
          {shots.length ? <div className="shot-grid">{shots.map(shot => <ScreenshotItem key={shot.id} shot={shot} onDelete={removeScreenshot} />)}</div> : <div className="muted">No screenshots attached.</div>}
          <label className="upload-box" style={{ display: "block", cursor: "pointer" }}>
            Add screenshots
            <input hidden type="file" accept="image/*" multiple onChange={e => setFiles(Array.from(e.target.files ?? []))} />
            {files.length > 0 && <div style={{ marginTop: 8, color: "var(--text)" }}>{files.length} new image(s) selected · max 10 MB each</div>}
          </label>
        </div>

        {error && <div className="error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
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
      {uri ? <img src={uri} alt={shot.caption || "Trade screenshot"} style={{ width: "100%", borderRadius: 10, border: "1px solid var(--border)" }} /> : <div className="muted">Loading image…</div>}
      <button type="button" className="btn screenshot-delete danger-btn" onClick={() => onDelete(shot)}>Remove</button>
    </div>
  );
}
