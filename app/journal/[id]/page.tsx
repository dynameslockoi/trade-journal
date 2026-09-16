"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { ConfirmButton } from "@/components/confirm-button";
import { LoadError } from "@/components/load-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describeLeg } from "@/lib/fees";
import { embedAccount, embedStrategy, formatDuration, formatMoney, formatNumber, formatPrice, formatR, normalizeTrade, shortDateTime } from "@/lib/trading";

export default function Detail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [t, setT] = useState<any>(null);
  const [shots, setShots] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => { (async () => {
    const s = createClient();
    const [a, b, c] = await Promise.all([
      s.from("trades").select(`*,${embedStrategy()},${embedAccount("name,currency")}`).eq("id", id).single(),
      s.from("trade_screenshots").select("*").eq("trade_id", id).order("created_at"),
      s.from("trade_tags").select("tags(name,category)").eq("trade_id", id),
    ]);
    // "Trade not found" must mean the row is gone, not that the request failed.
    setLoadError(a.error && a.error.code !== "PGRST116" ? a.error.message : null);
    setT(a.data ? normalizeTrade(a.data) : null);
    setShots(b.data ?? []);
    setTags(c.data ?? []);
    setLoading(false);
  })(); }, [id]);

  async function remove() {
    const s = createClient();
    const { data: files } = await s.from("trade_screenshots").select("storage_path").eq("trade_id", id);
    if (files?.length) await s.storage.from("trade-screenshots").remove(files.map((x: any) => x.storage_path));
    const { error } = await s.from("trades").delete().eq("id", id);
    if (error) toast.error(error.message);
    else router.push("/journal");
  }

  if (loading) return <div className="content"><div className="muted">Loading…</div></div>;
  if (loadError) return <div className="content"><LoadError what="this trade" message={loadError} /></div>;
  if (!t) return <div className="content"><Card><CardContent>Trade not found.</CardContent></Card></div>;

  const currency = t.trading_accounts?.currency;
  const gross = Number(t.gross_pnl || 0);
  const net = Number(t.net_pnl || 0);
  const totalCharges = Number(t.commission || 0) + Number(t.swap || 0) + Number(t.fees || 0);
  const qty = formatNumber(t.position_size, 0);
  const entryValue = Number(t.position_size || 0) * Number(t.entry_price || 0);
  const exitValue = Number(t.position_size || 0) * Number(t.exit_price || 0);

  return <div className="content max-w-[1100px]">
    <PageHeader
      eyebrow="Journal / Trade"
      title={<>{t.symbol}{t.is_ipo && <Badge variant="ipo" className="ml-2">IPO</Badge>}</>}
      subtitle={shortDateTime(t.entry_at)}
      actions={<>
        <Button variant="secondary" onClick={() => router.push("/journal")}>Back</Button>
        <Button variant="secondary" onClick={() => router.push(`/journal/${id}/edit`)}>Edit</Button>
        <ConfirmButton
          title="Delete this trade permanently?"
          description="Screenshots attached to it are removed from storage as well."
          onConfirm={remove}
        >
          Delete
        </ConfirmButton>
      </>}
    />

    <div className="grid four">
      <Tile label="Gross P&L" value={formatMoney(gross, currency, true)} tone={gross >= 0 ? "positive" : "negative"} />
      <Tile label="Charges" value={formatMoney(-totalCharges, currency)} tone="negative" />
      <Tile label="Net P&L" value={formatMoney(net, currency, true)} tone={net >= 0 ? "positive" : "negative"} />
      <Tile label="R Multiple (net)" value={t.r_multiple == null ? "—" : formatR(t.r_multiple)} tone={Number(t.r_multiple) >= 0 ? "positive" : "negative"} />
    </div>

    <div className="grid three">
      <Tile label="Risk" value={t.risk_amount == null ? "—" : formatMoney(t.risk_amount, currency)} />
      <Tile label={`Contract Value · ${qty} shares`} value={`${formatMoney(entryValue, currency)} → ${formatMoney(exitValue, currency)}`} />
      <Tile label="Holding Time" value={t.exit_at ? formatDuration(t.entry_at, t.exit_at) : "Open"} />
    </div>

    <div className="grid two">
      <Card>
        <CardHeader><CardTitle>Trade Details</CardTitle></CardHeader>
        <CardContent>
          <div className="detail-grid">
            <Field label="Account" value={t.trading_accounts?.name} />
            <Field label="Strategy" value={t.strategies?.name} />
            <Field label="Asset class" value={t.asset_class} />
            <Field label="Broker" value={t.fee_breakdown?.brokerName} />
            <Field label="Entry" value={formatPrice(t.entry_price, currency)} />
            <Field label="Exit" value={formatPrice(t.exit_price, currency)} />
            <Field label="Position" value={`${qty} shares`} />
            <Field label="Stop Loss" value={formatPrice(t.stop_loss, currency)} />
            <Field label="Take Profit" value={formatPrice(t.take_profit, currency)} />
            <Field label="Session" value={t.session} />
            <Field label="Risk %" value={t.risk_percent} />
            <Field label="MAE" value={t.mae} />
            <Field label="MFE" value={t.mfe} />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Psychology</CardTitle></CardHeader>
        <CardContent>
          <div className="detail-grid">
            <Field label="Emotion" value={t.emotion} />
            <Field label="Mistake" value={t.mistake} />
            <Field label="Setup Quality" value={t.setup_quality} />
            <Field label="Execution Quality" value={t.execution_quality} />
            <Field label="Discipline" value={t.discipline} />
          </div>
          <CardTitle className="mt-5 mb-2">Tags</CardTitle>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((x: any) => <Badge key={x.tags.name}>{x.tags.name}</Badge>)}
            {!tags.length && <span className="muted text-[11.5px]">No tags.</span>}
          </div>
        </CardContent>
      </Card>
    </div>

    <Card>
      <CardHeader><CardTitle>Charges</CardTitle></CardHeader>
      <CardContent>
        <div className="fee-breakdown">
          <div className="fee-row"><span className="muted">Opening contract {formatMoney(entryValue, currency)}</span><span>{legText(t.fee_breakdown?.open, currency)}</span></div>
          <div className="fee-row"><span className="muted">Closing contract {formatMoney(exitValue, currency)}</span><span>{legText(t.fee_breakdown?.close, currency)}</span></div>
          <div className="fee-row"><span className="muted">Commission (brokerage + platform + SST)</span><span>{formatMoney(t.commission, currency)}</span></div>
          <div className="fee-row"><span className="muted">Exchange fees (clearing + stamp duty)</span><span>{formatMoney(t.fees, currency)}</span></div>
          <div className="fee-row"><span className="muted">Swap / overnight</span><span>{formatMoney(t.swap, currency)}</span></div>
          <div className="fee-row fee-total"><span>Total charges</span><span>{formatMoney(totalCharges, currency)}</span></div>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
      <CardContent>
        <p className="whitespace-pre-wrap leading-[1.7] m-0">{t.notes || "No notes recorded."}</p>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle>Screenshots</CardTitle></CardHeader>
      <CardContent>
        {shots.length ? <div className="shot-grid">{shots.map((x: any) => <Screenshot key={x.id} path={x.storage_path} />)}</div> : <div className="empty">No screenshots.</div>}
      </CardContent>
    </Card>
  </div>;
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "positive" | "negative" }) {
  return <Card className="card-pad"><div className="metric-label">{label}</div><div className={`metric-value ${tone ?? ""}`}>{value}</div></Card>;
}

function Field({ label, value }: { label: string; value: unknown }) {
  return <div><div className="metric-label">{label}</div><b>{value === null || value === undefined || value === "" ? "—" : String(value)}</b></div>;
}

function legText(leg: any, currency?: string | null) {
  if (!leg) return "—";
  return describeLeg(leg, value => formatMoney(value, currency));
}

function Screenshot({ path }: { path: string }) {
  const [uri, setUri] = useState("");
  useEffect(() => { createClient().storage.from("trade-screenshots").createSignedUrl(path, 3600).then(({ data }) => setUri(data?.signedUrl ?? "")) }, [path]);
  return uri ? <img src={uri} alt="Trade screenshot" className="w-full rounded-xl border border-[var(--border)]" /> : <div className="muted">Loading image…</div>;
}
