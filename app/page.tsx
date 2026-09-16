"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { KEYS, loadAccounts, loadFlows, loadStrategies, loadTags, loadTrades } from "@/lib/data";
import { useCachedQuery } from "@/lib/query-cache";
import { FilterBar, applyFilters, emptyFilters, type Filters } from "@/components/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { calculateStats, capitalBehind, capitalByAccount, formatMoney, formatR, metricSeries, percentOf, shortDate, type CashFlow, type Trade } from "@/lib/trading";

/**
 * The chart library is the largest thing the dashboard loads — a few hundred kilobytes for one area
 * chart. Imported statically it has to arrive before the first paint, so the metrics wait on it. As a
 * dynamic import it becomes its own chunk: the cards and the recent trades render immediately and the
 * curve fades in when its code lands.
 */
const EquityChart = dynamic(() => import("@/components/equity-chart").then(m => m.EquityChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[310px] w-full" />,
});

type Account={id:string;name:string;currency:string};

export default function Dashboard(){
 const router=useRouter();
 // Every row set comes from the shared cache, so returning to the dashboard is instant and only the
 // first visit of the session waits on a query.
 const tradesQ=useCachedQuery<Trade[]>(KEYS.trades,loadTrades);
 const accountsQ=useCachedQuery<any[]>(KEYS.accounts,loadAccounts);
 const strategiesQ=useCachedQuery<any[]>(KEYS.strategies,loadStrategies);
 const tagsQ=useCachedQuery<any[]>(KEYS.tags,loadTags);
 const flowsQ=useCachedQuery<any[]>(KEYS.flows,loadFlows);
 const all=tradesQ.data??[];
 const accounts=(accountsQ.data??[]) as Account[];
 const strategies=strategiesQ.data??[];
 const tags=tagsQ.data??[];
 // A missing ledger is an expected state, not a page failure — `capitalByAccount` then falls back to
 // the accounts' opening balances.
 const flows=(flowsQ.error?null:flowsQ.data) as CashFlow[]|null;
 const [filters,setFilters]=useState<Filters>({...emptyFilters});
 // Held until every dataset the cards read has settled, so equity cannot paint from opening balances
 // and then jump to the ledger's figure.
 const loading=tradesQ.loading||accountsQ.loading||flowsQ.loading;
 const loadError=tradesQ.error??accountsQ.error??strategiesQ.error??tagsQ.error;

 const trades=useMemo(()=>applyFilters(all,filters) as Trade[],[all,filters]);
 const stats=useMemo(()=>calculateStats(trades),[trades]);
 const series=useMemo(()=>metricSeries(trades),[trades]);
 const selectedAccount=accounts.find(a=>a.id===filters.account);
 const currency=selectedAccount?.currency;
 // Current equity is a balance, so it is measured over every trade in the account. Adding a filtered
 // P&L to the capital would report "equity" with the filtered-out trades removed from it.
 const accountTrades=useMemo(()=>selectedAccount?all.filter(t=>t.account_id===selectedAccount.id):[],[all,selectedAccount]);
 const accountSeries=useMemo(()=>metricSeries(accountTrades),[accountTrades]);
 const accountPnl=useMemo(()=>accountTrades.reduce((sum,t)=>sum+Number(t.net_pnl||0),0),[accountTrades]);
 // Capital is what was deposited into the account, less what was taken out — not a typed-in number.
 const capitalMap=useMemo(()=>capitalByAccount(accounts,flows),[accounts,flows]);
 const equity=selectedAccount?(capitalMap[selectedAccount.id]?.net??0)+accountPnl:null;
 // A drawdown against a small early peak can read as thousands of percent, which says nothing. When
 // the capital behind the account is known, that is the base worth quoting instead.
 const capital=capitalBehind(accounts,capitalMap,filters.account);
 const ddOnCapital=percentOf(stats.maxDrawdown,capital);
 const ddSub=ddOnCapital===null?`${stats.maxDrawdownPct.toFixed(1)}% of the P&L peak`:`${Math.abs(ddOnCapital).toFixed(1)}% of ${formatMoney(capital,currency)} capital`;
 const recent=[...trades].sort((a,b)=>b.entry_at.localeCompare(a.entry_at)).slice(0,8);

 return <div className="content">
  <PageHeader title="Dashboard" subtitle="A clean view of your trading performance and risk." />
  <LoadError message={loadError} />
  <FilterBar filters={filters} setFilters={setFilters} accounts={accounts} strategies={strategies} tags={tags}/>
  {/* With a failed load there is nothing real to show: zeroed metrics would read as a flat month. */}
  {loadError?null:loading?<Card><CardContent>Loading your journal…</CardContent></Card>:<>
   <div className="grid four">
    <StatCard label="Net P&L" value={formatMoney(stats.pnl,currency,true)} positive={stats.pnl>=0} trend={series.equity}/>
    <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} sub={`${stats.wins}W / ${stats.losses}L / ${stats.breakeven} BE`} trend={series.winRate}/>
    <StatCard label="Profit Factor" value={stats.profitFactor===null?"—":stats.profitFactor.toFixed(2)} trend={series.profitFactor}/>
    <StatCard label="Average R" value={formatR(stats.avgR)} sub={trades.length?`stop recorded on ${stats.rCount} of ${trades.length}`:undefined} positive={(stats.avgR??0)>=0} trend={series.avgR}/>
   </div>
   <div className="grid four">
    <StatCard label="Max Drawdown" value={formatMoney(-stats.maxDrawdown,currency)} sub={ddSub} positive={false} trend={series.drawdown}/>
    <StatCard label="Gross Profit" value={formatMoney(stats.grossProfit,currency,true)} positive trend={series.grossProfit}/>
    <StatCard label="Gross Loss" value={formatMoney(-stats.grossLoss,currency)} positive={false} trend={series.grossLoss}/>
    <StatCard label="Current Equity" value={equity===null?"—":formatMoney(equity,currency)} sub={selectedAccount?`Start + all ${accountTrades.length} trades in this account`:"Select one account"} trend={selectedAccount?accountSeries.equity:undefined}/>
   </div>
   <Card>
    <CardHeader className="flex flex-row items-center justify-between gap-3">
     <div>
      <CardTitle>Equity Curve</CardTitle>
      <div className="muted text-[10px] mt-[3px]">Cumulative P&L for the active filter set.</div>
     </div>
     <Badge>{trades.length} trades</Badge>
    </CardHeader>
    <CardContent className="pt-3">
     <div style={{height:300}}><EquityChart data={stats.equity.map(x=>({d:x.date,v:x.pnl}))}/></div>
    </CardContent>
   </Card>
   <Card>
    <CardHeader className="flex flex-row items-center justify-between gap-3">
     <div>
      <CardTitle>Recent Trades</CardTitle>
      <div className="muted text-[10px] mt-[3px]">Latest trades matching your filters.</div>
     </div>
     <Button variant="secondary" onClick={()=>router.push("/journal")}>View Journal</Button>
    </CardHeader>
    <CardContent className="pt-0">
     <Table>
      <TableHeader>
       <TableRow><TableHead>Date</TableHead><TableHead>Symbol</TableHead><TableHead>Strategy</TableHead><TableHead>P&L</TableHead><TableHead>R</TableHead></TableRow>
      </TableHeader>
      <TableBody>
       {recent.map(t=><TableRow key={t.id} onClick={()=>router.push(`/journal/${t.id}`)} style={{cursor:"pointer"}}>
        <TableCell>{shortDate(t.entry_at)}</TableCell>
        <TableCell><b>{t.symbol}</b></TableCell>
        <TableCell>{t.strategies?.name||"—"}</TableCell>
        <TableCell className={Number(t.net_pnl)>=0?"positive":"negative"}>{formatMoney(t.net_pnl,currency,true)}</TableCell>
        <TableCell>{formatR(t.r_multiple)}</TableCell>
       </TableRow>)}
       {!recent.length&&<TableRow><TableCell colSpan={5}><div className="empty">No trades match these filters.</div></TableCell></TableRow>}
      </TableBody>
     </Table>
    </CardContent>
   </Card>
  </>}
 </div>
}
