"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { BURSA_BOARD_LOT, SESSIONS, calculateGrossPnl, calculateRisk, formatMoney, formatR, localDatetimeToIso, numberOrNull, roundMoney, sessionForTime, sessionLabel, stripUnknownColumn } from "@/lib/trading";
import { PageHeader } from "@/components/page-header";
import { Select } from "@/components/select";
import { BROKER_PRESETS, DEFAULT_BROKER_ID, SHARES, brokerPreset, describeLeg, roundTripFees, type FeeBreakdown } from "@/lib/fees";

type Account = { id: string; name: string; broker?: string | null };
type Strategy = { id: string; name: string };
type Tag = { id: string; name: string; category: string | null };

/** Columns that arrive as strings from the number inputs. */
const NUMERIC_FIELDS = ["entry_price","exit_price","position_size","stop_loss","take_profit","gross_pnl","commission","swap","fees","risk_percent","setup_quality","execution_quality","discipline","mae","mfe"];

const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const init = {
  symbol: "", account_id: "", strategy_id: "", asset_class: "shares",
  entry_at: localNow(), exit_at: "",
  entry_price: "", exit_price: "", position_size: "", stop_loss: "", take_profit: "",
  gross_pnl: "0", commission: "0", swap: "0", fees: "0", risk_amount: "", risk_percent: "",
  session: sessionForTime(localNow()), emotion: "Calm", mistake: "No mistake", is_ipo: false,
  setup_quality: "8", execution_quality: "8", discipline: "8", mae: "", mfe: "", notes: "",
};

const money = (v: number | null) => formatMoney(v);

export default function NewTrade() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
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
  // Until the user picks a session themselves, it follows the entry time.
  const sessionPicked = useRef(false);

  useEffect(() => {
    (async () => {
      const s = createClient();
      const [a, st, t] = await Promise.all([
        s.from("trading_accounts").select("*").order("name"),
        s.from("strategies").select("id,name").order("name"),
        s.from("tags").select("id,name,category").order("name"),
      ]);
      setAccounts((a.data ?? []) as Account[]);
      setStrategies((st.data ?? []) as Strategy[]);
      setTags((t.data ?? []) as Tag[]);
    })();
  }, []);

  const set = (k: string, v: string | boolean) => setForm(x => ({ ...x, [k]: v }));

  function changeEntryAt(value: string) {
    setForm(x => ({ ...x, entry_at: value, session: sessionPicked.current ? x.session : sessionForTime(value) }));
  }
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
    <div className="content" style={{ maxWidth: 1100 }}>
      <PageHeader eyebrow="Journal / New Trade" title="Add Trade" subtitle="Charges and gross P&L are calculated from the Bursa lot size and your broker preset." />
      <form onSubmit={save} className="grid">
        <div className="card card-pad">
          <h3>Trade Details</h3>
          <div className="grid three">
            {[["symbol", "Symbol"], ["entry_price", "Entry Price"], ["exit_price", "Exit Price"], ["position_size", "Position Size (shares)"], ["stop_loss", "Stop Loss"], ["take_profit", "Take Profit"]].map(([k, l]) => (
              <label className="field" key={k}>
                {l}
                <input className="input" required={k === "symbol"} type={k === "symbol" ? "text" : "number"} step="any" value={(form as any)[k]} onChange={e => set(k, e.target.value)} />
              </label>
            ))}
            <label className="field">
              Board Lots ×{BURSA_BOARD_LOT}
              <input className="input" type="number" step="any" min="0" value={lots} onChange={e => updateLots(e.target.value)} placeholder="optional helper" />
            </label>
            <label className="field">Entry Date/Time<input className="input" type="datetime-local" value={form.entry_at} onChange={e => changeEntryAt(e.target.value)} /></label>
            <label className="field">Exit Date/Time<input className="input" type="datetime-local" value={form.exit_at} onChange={e => set("exit_at", e.target.value)} /></label>
            <div className="field">
              <span>Account</span>
              <Select aria-label="Account" value={form.account_id} onChange={pickAccount}>
                <option value="">No account</option>
                {accounts.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </div>
            <div className="field">
              <span>Strategy</span>
              <Select aria-label="Strategy" value={form.strategy_id} onChange={v => set("strategy_id", v)}>
                <option value="">No strategy</option>
                {strategies.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
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
              <input className="input" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(grossPnl) : form.gross_pnl} onChange={e => set("gross_pnl", e.target.value)} />
            </label>
            <label className="field">
              Commission (brokerage + platform + SST)
              <input className="input" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(commission) : form.commission} onChange={e => set("commission", e.target.value)} />
            </label>
            <label className="field">
              Exchange fees (clearing + stamp duty)
              <input className="input" type="number" step="any" readOnly={autoCalc} value={autoCalc ? String(exchangeFees) : form.fees} onChange={e => set("fees", e.target.value)} />
            </label>
          </div>
          <div className="grid three" style={{ gap: 12 }}>
            <label className="field">Explicit Risk Amount<input className="input" type="number" step="any" value={form.risk_amount} onChange={e => set("risk_amount", e.target.value)} /></label>
            <label className="field">Risk %<input className="input" type="number" step="any" value={form.risk_percent} onChange={e => set("risk_percent", e.target.value)} /></label>
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
            <div className="field">
              <span>Session</span>
              <Select aria-label="Session" value={form.session} onChange={v => { sessionPicked.current = true; set("session", v); }}>
                {SESSIONS.map(x => <option key={x} value={x}>{sessionLabel(x)}</option>)}
              </Select>
            </div>
            <div className="field">
              <span>Emotion</span>
              <Select aria-label="Emotion" value={form.emotion} onChange={v => set("emotion", v)}>
                {["Calm", "Confident", "Uncertain", "Fearful", "FOMO", "Greedy", "Revenge"].map(x => <option key={x}>{x}</option>)}
              </Select>
            </div>
            <div className="field">
              <span>Mistake</span>
              <Select aria-label="Mistake" value={form.mistake} onChange={v => set("mistake", v)}>
                {["No mistake", "FOMO", "Early entry", "Late exit", "Oversized", "Moved SL", "Overtrading", "Ignored plan"].map(x => <option key={x}>{x}</option>)}
              </Select>
            </div>
          </div>
          <div className="grid three" style={{ marginTop: 15 }}>
            {["setup_quality", "execution_quality", "discipline"].map(k => (
              <label className="field" key={k}>
                {k.replaceAll("_", " ")}
                <input className="input" type="number" min="1" max="10" value={(form as any)[k]} onChange={e => set(k, e.target.value)} />
              </label>
            ))}
            <label className="field">MAE<input className="input" type="number" step="any" value={form.mae} onChange={e => set("mae", e.target.value)} /></label>
            <label className="field">MFE<input className="input" type="number" step="any" value={form.mfe} onChange={e => set("mfe", e.target.value)} /></label>
          </div>
        </div>

        <div className="card card-pad">
          <h3>Tags</h3>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {tags.map(t => (
              <button type="button" key={t.id} className={`btn ${selected.includes(t.id) ? "btn-primary" : ""}`} onClick={() => setSelected(x => x.includes(t.id) ? x.filter(y => y !== t.id) : [...x, t.id])}>{t.name}</button>
            ))}
            {!tags.length && <span className="muted">Create tags in the Tags page below.</span>}
          </div>
        </div>

        <div className="card card-pad">
          <h3>Notes &amp; Screenshots</h3>
          <textarea className="input" rows={7} placeholder="Why did you enter? What happened? What did you learn?" value={form.notes} onChange={e => set("notes", e.target.value)} />
          <label className="upload-box" style={{ display: "block", cursor: "pointer" }}>
            📸 Add screenshots
            <input type="file" accept="image/*" multiple hidden onChange={e => setFiles(Array.from(e.target.files ?? []))} />
            <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{files.length ? `${files.length} file(s) selected` : "PNG, JPG, WEBP"}</div>
          </label>
        </div>

        {error && <div className="error">{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="btn" onClick={() => router.back()}>Cancel</button>
          <button className="btn btn-primary" disabled={saving}>{saving ? "Saving trade…" : "Save Trade"}</button>
        </div>
      </form>
    </div>
  );
}
