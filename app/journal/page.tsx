"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { FilterBar, emptyFilters, applyFilters, type Filters } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { formatMoney, formatR, normalizeTrade, shortDateTime } from "@/lib/trading";

export default function Journal() {
  const [r, setR] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [strategies, setStrategies] = useState<any[]>([]);
  const [tags, setTags] = useState<any[]>([]);
  const [f, setF] = useState<Filters>(emptyFilters);
  const [q, setQ] = useState("");
  const router = useRouter();

  useEffect(() => { (async () => {
    const s = createClient();
    const COLUMNS = "symbol,direction,entry_at,exit_at,net_pnl,r_multiple,session,account_id,strategy_id,strategies(name),trading_accounts(name),trade_tags(tag_id)";
    const [a0, b, c, d] = await Promise.all([
      s.from("trades").select(`id,is_ipo,${COLUMNS}`).order("entry_at", { ascending: false }),
      s.from("trading_accounts").select("id,name,currency"),
      s.from("strategies").select("id,name"),
      s.from("tags").select("id,name"),
    ]);
    // `is_ipo` arrives with the Phase 9 migration; until then the journal still lists trades.
    const a = a0.error ? await s.from("trades").select(`id,${COLUMNS}`).order("entry_at", { ascending: false }) : a0;
    setR((a.data ?? []).map(normalizeTrade));
    setAccounts(b.data ?? []);
    setStrategies(c.data ?? []);
    setTags(d.data ?? []);
  })(); }, []);

  // The calendar's "View in Journal" links here with a date range, so land pre-filtered on that day.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from") ?? "";
    const to = params.get("to") ?? "";
    if (from || to) setF(prev => ({ ...prev, from, to }));
  }, []);

  const rows = useMemo(
    () => applyFilters(r, f).filter(t => !q || t.symbol.toLowerCase().includes(q.toLowerCase()) || t.strategies?.name?.toLowerCase().includes(q.toLowerCase())),
    [r, f, q]
  );
  const currency = accounts.find(a => a.id === f.account)?.currency;

  return <div className="content">
    <PageHeader
      title="Trade Journal"
      subtitle={`${rows.length} matching trade${rows.length === 1 ? "" : "s"}`}
      actions={<>
        <input className="input search-input" placeholder="Search symbol or strategy…" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn btn-primary" onClick={() => router.push("/journal/new")}>+ Add Trade</button>
      </>}
    />
    <FilterBar filters={f} setFilters={setF} accounts={accounts} strategies={strategies} tags={tags} />
    <div className="card">
      <div className="table-wrap"><table>
        <thead><tr><th>Date</th><th>Symbol</th><th>Strategy</th><th>Session</th><th>P&L</th><th>R</th></tr></thead>
        <tbody>
          {rows.map(t => <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => router.push(`/journal/${t.id}`)}>
            <td>{shortDateTime(t.entry_at)}</td>
            <td><b>{t.symbol}</b>{t.is_ipo && <span className="badge badge-ipo">IPO</span>}</td>
            <td>{t.strategies?.name || "—"}</td>
            <td>{t.session || "—"}</td>
            <td className={Number(t.net_pnl) >= 0 ? "positive" : "negative"}>{formatMoney(t.net_pnl, currency, true)}</td>
            <td>{t.r_multiple == null ? "—" : formatR(t.r_multiple)}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={6}><div className="empty">No trades match these filters.</div></td></tr>}
        </tbody>
      </table></div>
    </div>
  </div>;
}
