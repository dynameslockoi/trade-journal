"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FilterBar, applyFilters, emptyFilters, type Filters } from "@/components/filter-bar";
import { EquityChart } from "@/components/equity-chart";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { calculateStats, formatMoney, formatR, metricSeries, normalizeTrade, shortDate, type Trade } from "@/lib/trading";

type Account={id:string;name:string;starting_balance:number;currency:string};

export default function Dashboard(){
 const router=useRouter();
 const [all,setAll]=useState<Trade[]>([]);
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [strategies,setStrategies]=useState<any[]>([]);
 const [tags,setTags]=useState<any[]>([]);
 const [filters,setFilters]=useState<Filters>({...emptyFilters});
 const [loading,setLoading]=useState(true);

 useEffect(()=>{(async()=>{const s=createClient();const [tr,ac,st,tg]=await Promise.all([s.from("trades").select("id,symbol,direction,entry_at,exit_at,net_pnl,r_multiple,risk_amount,session,account_id,strategy_id,strategies(name),trading_accounts(name,starting_balance,currency),trade_tags(tag_id)").order("entry_at",{ascending:true}),s.from("trading_accounts").select("id,name,starting_balance,currency").order("name"),s.from("strategies").select("id,name").order("name"),s.from("tags").select("id,name").order("name")]);setAll(((tr.data??[]) as any[]).map(normalizeTrade));setAccounts((ac.data??[]) as Account[]);setStrategies(st.data??[]);setTags(tg.data??[]);setLoading(false)})()},[]);

 const trades=useMemo(()=>applyFilters(all,filters) as Trade[],[all,filters]);
 const stats=useMemo(()=>calculateStats(trades),[trades]);
 const series=useMemo(()=>metricSeries(trades),[trades]);
 const selectedAccount=accounts.find(a=>a.id===filters.account);
 const currency=selectedAccount?.currency;
 const equity=selectedAccount?selectedAccount.starting_balance+stats.pnl:null;
 const recent=[...trades].sort((a,b)=>b.entry_at.localeCompare(a.entry_at)).slice(0,8);

 return <div className="content">
  <PageHeader title="Dashboard" subtitle="A clean view of your trading performance and risk." />
  <FilterBar filters={filters} setFilters={setFilters} accounts={accounts} strategies={strategies} tags={tags}/>
  {loading?<div className="card card-pad">Loading your journal…</div>:<>
   <div className="grid four">
    <StatCard label="Net P&L" value={formatMoney(stats.pnl,currency,true)} positive={stats.pnl>=0} trend={series.equity}/>
    <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L / ${stats.breakeven} BE`} trend={series.winRate}/>
    <StatCard label="Profit Factor" value={stats.profitFactor===null?"—":stats.profitFactor.toFixed(2)} trend={series.profitFactor}/>
    <StatCard label="Average R" value={formatR(stats.avgR)} positive={stats.avgR>=0} trend={series.avgR}/>
   </div>
   <div className="grid four">
    <StatCard label="Max Drawdown" value={formatMoney(-stats.maxDrawdown,currency)} sub={`${stats.maxDrawdownPct.toFixed(1)}% of filtered peak`} positive={false} trend={series.drawdown}/>
    <StatCard label="Gross Profit" value={formatMoney(stats.grossProfit,currency,true)} positive trend={series.grossProfit}/>
    <StatCard label="Gross Loss" value={formatMoney(-stats.grossLoss,currency)} positive={false} trend={series.grossLoss}/>
    <StatCard label="Current Equity" value={equity===null?"—":formatMoney(equity,currency)} sub={selectedAccount?"Selected account":"Select one account"} trend={selectedAccount?series.equity:undefined}/>
   </div>
   <div className="card card-pad">
    <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center"}}>
     <div><b>Equity Curve</b><div className="muted" style={{fontSize:11,marginTop:3}}>Cumulative P&L for the active filter set.</div></div>
     <span className="badge">{trades.length} trades</span>
    </div>
    <div style={{height:300,marginTop:12}}><EquityChart data={stats.equity.map(x=>({d:x.date,v:x.pnl}))}/></div>
   </div>
   <div className="card">
    <div className="card-pad" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
     <div><b>Recent Trades</b><div className="muted" style={{fontSize:11,marginTop:3}}>Latest trades matching your filters.</div></div>
     <button className="btn" onClick={()=>router.push("/journal")}>View Journal</button>
    </div>
    <div className="table-wrap"><table>
     <thead><tr><th>Date</th><th>Symbol</th><th>Strategy</th><th>P&L</th><th>R</th></tr></thead>
     <tbody>
      {recent.map(t=><tr key={t.id} onClick={()=>router.push(`/journal/${t.id}`)} style={{cursor:"pointer"}}>
       <td>{shortDate(t.entry_at)}</td>
       <td><b>{t.symbol}</b></td>
       <td>{t.strategies?.name||"—"}</td>
       <td className={Number(t.net_pnl)>=0?"positive":"negative"}>{formatMoney(t.net_pnl,currency,true)}</td>
       <td>{formatR(t.r_multiple)}</td>
      </tr>)}
      {!recent.length&&<tr><td colSpan={5}><div className="empty">No trades match these filters.</div></td></tr>}
     </tbody>
    </table></div>
   </div>
  </>}
 </div>
}
