"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CalendarDays, FileText, Plus, Target, TriangleAlert } from "lucide-react";
import { KEYS, loadAccounts, loadFlows, loadTrades } from "@/lib/data";
import { useCachedQuery } from "@/lib/query-cache";
import { applyFilters, emptyFilters, type Filters } from "@/components/filter-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { StatsSkeleton, CardSkeleton } from "@/components/skeletons";
import { LoadError } from "@/components/load-error";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { SparkBars, Sparkline } from "@/components/sparkline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { today, toISODate, parseISODate } from "@/lib/dates";
import {
  calculateStats, capitalBehind, capitalByAccount, dailySummaries, formatMoney, formatPercent, formatPrice,
  formatR, metricSeries, numberOrNull, percentOf, qualityBucket, shortDate, type CashFlow, type Trade,
} from "@/lib/trading";

/**
 * The chart library is the largest thing the dashboard loads — a few hundred kilobytes for one area
 * chart. Imported statically it has to arrive before the first paint, so the metrics wait on it. As a
 * dynamic import it becomes its own chunk: the cards and the recent trades render immediately and the
 * curve fades in when its code lands.
 */
const EquityChart = dynamic(() => import("@/components/equity-chart").then(m => m.EquityChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[288px] w-full" />,
});

type Account = { id: string; name: string; currency: string };

/**
 * The windows the whole page reports over — the header control and the equity curve's tabs are the
 * same selection, so they always agree. Their labels are the header's; `short` is what fits a tab.
 */
const PERIODS = [
  { id: "7d", label: "Last 7 days", short: "7D", days: 6 },
  { id: "30d", label: "Last 30 days", short: "30D", days: 29 },
  { id: "90d", label: "Last 90 days", short: "90D", days: 89 },
  { id: "ytd", label: "Year to date", short: "YTD", days: null },
  { id: "all", label: "All time", short: "All", days: null },
] as const;
type PeriodId = (typeof PERIODS)[number]["id"];

/** A Malaysian calendar day moved by whole days. Anchored at midday, so no clock can shift it. */
function shiftISO(iso: string, days: number) {
  const d = parseISODate(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

/** The `from`/`to` filter a period stands for; "All time" leaves both open. */
function presetRange(id: PeriodId, todayISO: string): { from: string; to: string } {
  if (id === "all") return { from: "", to: "" };
  if (id === "ytd") return { from: `${todayISO.slice(0, 4)}-01-01`, to: todayISO };
  const days = PERIODS.find(p => p.id === id)!.days ?? 0;
  return { from: shiftISO(todayISO, -days), to: todayISO };
}

/** Which period a pair of dates is, or null for a hand-picked range. */
function periodOf(from: string, to: string, todayISO: string): PeriodId | null {
  for (const p of PERIODS) {
    const range = presetRange(p.id, todayISO);
    if (range.from === from && range.to === to) return p.id;
  }
  return null;
}

/**
 * The equal window immediately before this one, so a figure can be reported against the stretch that
 * preceded it. Null for an open-ended range — "All time" has nothing before it to compare with.
 */
function previousRange(from: string, to: string) {
  const start = parseISODate(from);
  const end = parseISODate(to);
  if (!start || !end) return null;
  const span = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  if (span <= 0) return null;
  const prevTo = shiftISO(from, -1);
  return { from: shiftISO(prevTo, -(span - 1)), to: prevTo };
}

/** "12.4%" — the size of a change, with the direction carried by an arrow beside it. */
const pct = (value: number) => `${Math.abs(value).toFixed(1)}%`;

export default function Dashboard() {
  const router = useRouter();
  // Every row set comes from the shared cache, so returning to the dashboard is instant and only the
  // first visit of the session waits on a query.
  // Three reads, not six: the strategies, tags and trade-tag sets existed only to feed the page's
  // own filter card. The date window is the one filter left here, and it needs none of them.
  const tradesQ = useCachedQuery<Trade[]>(KEYS.trades, loadTrades);
  const accountsQ = useCachedQuery<any[]>(KEYS.accounts, loadAccounts);
  const flowsQ = useCachedQuery<any[]>(KEYS.flows, loadFlows);
  const all = tradesQ.data ?? [];
  const accounts = (accountsQ.data ?? []) as Account[];
  // A missing ledger is an expected state, not a page failure — `capitalByAccount` then falls back to
  // the accounts' opening balances.
  const flows = (flowsQ.error ? null : flowsQ.data) as CashFlow[] | null;

  const todayISO = useMemo(() => toISODate(today()), []);
  // The page opens on the last thirty days, matching the header control's own label.
  const [filters, setFilters] = useState<Filters>(() => ({ ...emptyFilters, ...presetRange("30d", toISODate(today())) }));
  // Held until every dataset the cards read has settled, so equity cannot paint from opening balances
  // and then jump to the ledger's figure.
  const loading = tradesQ.loading || accountsQ.loading || flowsQ.loading;
  const loadError = tradesQ.error ?? accountsQ.error;

  const activePeriod = periodOf(filters.from, filters.to, todayISO);
  const periodLabel = PERIODS.find(p => p.id === activePeriod)?.label ?? "Custom range";
  const applyPeriod = (id: PeriodId) => setFilters(prev => ({ ...prev, ...presetRange(id, todayISO) }));

  const trades = useMemo(() => applyFilters(all, filters) as Trade[], [all, filters]);
  const stats = useMemo(() => calculateStats(trades), [trades]);
  const series = useMemo(() => metricSeries(trades), [trades]);
  const days = useMemo(() => dailySummaries(trades), [trades]);

  // The same filters over the window before this one, for the two "vs previous" figures. Null when
  // the range is open-ended, so a card reports a change only when there is one to report.
  const prevTrades = useMemo(() => {
    const range = filters.from && filters.to ? previousRange(filters.from, filters.to) : null;
    if (!range) return null;
    return applyFilters(all, { ...filters, from: range.from, to: range.to }) as Trade[];
  }, [all, filters]);
  const prevPnl = useMemo(() => (prevTrades ? calculateStats(prevTrades).pnl : null), [prevTrades]);
  const pnlDelta = prevPnl ? (stats.pnl - prevPnl) / Math.abs(prevPnl) * 100 : null;
  const closed = useMemo(() => trades.filter(t => t.exit_at).length, [trades]);
  const prevClosed = prevTrades ? prevTrades.filter(t => t.exit_at).length : null;
  const closedDelta = prevClosed === null ? null : closed - prevClosed;

  // Cumulative profit factor per trade — gross profit over gross loss so far, zero until the first
  // loser. (`metricSeries.profitFactor` tracks the profit side before a loss exists, which would
  // dwarf every other bar.)
  const pfSeries = useMemo(
    () => series.grossProfit.map((gp, i) => { const gl = Math.abs(series.grossLoss[i] ?? 0); return gl > 0 ? gp / gl : 0; }),
    [series]
  );
  const dayCounts = useMemo(() => days.map(d => d.count), [days]);

  // Money on this page follows the journal's own currency: the one every account shares, or the
  // ringgit default when the accounts disagree. Choosing by account belongs to the pages that still
  // carry the account filter.
  const currency = useMemo(() => {
    const codes = [...new Set(accounts.map(a => a.currency).filter(Boolean))];
    return codes.length === 1 ? codes[0] : undefined;
  }, [accounts]);
  // Capital is what was deposited into the accounts, less what was taken out — not a typed-in number.
  const capitalMap = useMemo(() => capitalByAccount(accounts, flows), [accounts, flows]);
  // Current equity is a balance, so it is measured over every trade. Adding the period's filtered P&L
  // to the capital would report "equity" with the filtered-out trades removed from it.
  const equity = useMemo(() => {
    if (!accounts.length && !all.length) return null;
    return accounts.reduce((sum, a) => sum + (capitalMap[a.id]?.net ?? 0), 0) + all.reduce((sum, t) => sum + Number(t.net_pnl || 0), 0);
  }, [capitalMap, accounts, all]);
  const capital = capitalBehind(accounts, capitalMap);
  // A drawdown against a small early peak can read as thousands of percent, which says nothing. When
  // the capital behind the account is known, that is the base worth quoting instead.
  const ddOnCapital = percentOf(stats.maxDrawdown, capital);
  const ddPct = ddOnCapital === null ? stats.maxDrawdownPct : Math.abs(ddOnCapital);
  const totalReturn = percentOf(stats.pnl, capital);

  const bestDay = days.length ? days.reduce((best, d) => (d.pnl > best.pnl ? d : best)) : null;
  const worstDay = days.length ? days.reduce((worst, d) => (d.pnl < worst.pnl ? d : worst)) : null;

  // The three discipline checks, each read off a field the shared trades cache already carries — the
  // 1–10 review scores (`qualityBucket`, the same banding analytics uses) and the realised R multiple.
  // Notes and the mistake column are deliberately not in that row set (see TRADE_LIST_COLUMNS).
  const discipline = useMemo(() => {
    let scored = 0, followed = 0, violations = 0, incomplete = 0;
    for (const t of trades) {
      const band = qualityBucket(t);
      if (band === "Not scored") incomplete += 1;
      else {
        scored += 1;
        if (band === "7–8 / 10" || band === "9–10 / 10") followed += 1;
      }
      // A loss past -1R means more was risked than the stop the trade was planned around.
      const r = numberOrNull(t.r_multiple);
      if (r !== null && r < -1) violations += 1;
    }
    return { adherence: scored ? followed / scored * 100 : null, violations, incomplete };
  }, [trades]);

  // Top three setups by activity, with everything else folded into one row — a four-row answer is
  // what fits the card beside the discipline list. Grouped by id rather than name, because each row
  // links to Analytics filtered to it: two strategies that happen to share a name are still two.
  const strategyRows = useMemo(() => {
    const map = new Map<string, { id: string; name: string; trades: number; wins: number; pnl: number }>();
    for (const t of trades) {
      const id = t.strategy_id ?? "";
      const row = map.get(id || "__unassigned__") ?? { id, name: t.strategies?.name || "Unassigned", trades: 0, wins: 0, pnl: 0 };
      row.trades += 1;
      row.pnl += Number(t.net_pnl || 0);
      if (Number(t.net_pnl) > 0) row.wins += 1;
      map.set(id || "__unassigned__", row);
    }
    const rows = [...map.values()].sort((a, b) => b.trades - a.trades || b.pnl - a.pnl);
    const top = rows.slice(0, 3);
    const rest = rows.slice(3);
    if (rest.length) {
      const sum = rest.reduce((acc, r) => ({ trades: acc.trades + r.trades, wins: acc.wins + r.wins, pnl: acc.pnl + r.pnl }), { trades: 0, wins: 0, pnl: 0 });
      // No single id to link to: "Others" is several strategies folded into one row.
      top.push({ id: "", name: `Others (${rest.length})`, ...sum });
    }
    return top.map(r => ({ ...r, winRate: r.trades ? (r.wins / r.trades) * 100 : 0, pnl: Number(r.pnl.toFixed(2)) }));
  }, [trades]);

  const recent = useMemo(() => [...trades].sort((a, b) => b.entry_at.localeCompare(a.entry_at)).slice(0, 6), [trades]);

  return <div className="content">
    <PageHeader
      title="Dashboard"
      subtitle="Your trading performance at a glance."
      actions={<>
        <Select value={activePeriod ?? "custom"} onValueChange={v => { if (v !== "custom") applyPeriod(v as PeriodId); }}>
          <SelectTrigger className="select-pill" aria-label="Date range">
            <CalendarDays size={14} className="select-pill-icon" aria-hidden />
            <span>{periodLabel}</span>
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            {activePeriod === null && <SelectItem value="custom" disabled>Custom range</SelectItem>}
          </SelectContent>
        </Select>
        <Button asChild>
          <Link href="/journal/new"><Plus size={15} aria-hidden /> Log Trade</Link>
        </Button>
      </>}
    />
    <LoadError message={loadError} />
    {/* With a failed load there is nothing real to show: zeroed metrics would read as a flat month. */}
    {loadError ? null : loading ? <><StatsSkeleton /><CardSkeleton lines={6} /></> : <>
      <div className="grid four dash-stats">
        <StatCard
          label="Net P&L"
          value={formatMoney(stats.pnl, currency, true)}
          positive={stats.pnl >= 0}
          delta={
            <div className={`stat-delta ${pnlDelta === null ? "flat" : pnlDelta >= 0 ? "up" : "down"}`}>
              {pnlDelta === null ? <span>{trades.length} trade{trades.length === 1 ? "" : "s"}</span>
                : <>{pnlDelta >= 0 ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}{pct(pnlDelta)} vs previous</>}
            </div>
          }
          chart={<Sparkline values={series.equity} tone={stats.pnl >= 0 ? "positive" : "negative"} height={44} />}
        />
        <StatCard
          label="Win Rate"
          value={`${stats.winRate.toFixed(1)}%`}
          delta={<div className="stat-delta flat">{trades.length ? `${stats.wins}W - ${stats.losses}L` : "No trades"}</div>}
          chart={<Sparkline values={series.winRate} tone="accent" height={44} />}
        />
        <StatCard
          label="Profit Factor"
          hint="Gross profit divided by gross loss. Above 1.00 means the winners pay for the losers."
          value={stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2)}
          delta={<div className="stat-delta flat"><span className="delta-hide-sm">Gross </span>profit / loss</div>}
          chart={<SparkBars values={pfSeries} tone="muted" height={44} />}
        />
        <StatCard
          label="Closed Trades"
          value={String(closed)}
          delta={
            <div className={`stat-delta ${closedDelta === null || closedDelta === 0 ? "flat" : closedDelta > 0 ? "up" : "down"}`}>
              {closedDelta === null ? <span>{trades.length} logged</span>
                : closedDelta === 0 ? <span>no change</span>
                : <>{closedDelta > 0 ? <ArrowUpRight size={13} aria-hidden /> : <ArrowDownRight size={13} aria-hidden />}{closedDelta > 0 ? "+" : ""}{closedDelta} vs previous</>}
            </div>
          }
          chart={<SparkBars values={dayCounts} tone="accent" height={44} bucket="sum" />}
        />
      </div>

      <Card>
        <CardContent>
          <div className="card-head">
            <div>
              <CardTitle>Equity Curve</CardTitle>
              <div className="muted card-hint">
                Cumulative P&L for the active filter set{equity !== null ? ` · balance ${formatMoney(equity, currency)}` : ""}.
              </div>
            </div>
            <div className="equity-tabs" role="tablist" aria-label="Equity curve range">
              {PERIODS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={activePeriod === p.id}
                  className={`equity-tab${activePeriod === p.id ? " active" : ""}`}
                  onClick={() => applyPeriod(p.id)}
                >
                  {p.short}
                </button>
              ))}
            </div>
          </div>
          <div className="equity-grid">
            <div className="equity-chart-col">
              <EquityChart data={stats.equity.map(x => ({ d: x.date, v: x.pnl }))} height={288} />
            </div>
            <div className="equity-metrics">
              <EquityMetric label="Total Return" value={totalReturn === null ? "—" : formatPercent(totalReturn, 1)} tone={totalReturn === null ? undefined : totalReturn >= 0 ? "up" : "down"} />
              <EquityMetric label="Best Day" value={bestDay ? formatMoney(bestDay.pnl, currency, true) : "—"} tone={bestDay ? (bestDay.pnl >= 0 ? "up" : "down") : undefined} />
              <EquityMetric label="Worst Day" value={worstDay ? formatMoney(worstDay.pnl, currency, true) : "—"} tone={worstDay ? (worstDay.pnl >= 0 ? "up" : "down") : undefined} />
              <EquityMetric label="Max Drawdown" value={days.length ? formatPercent(-ddPct, 1) : "—"} tone={days.length ? "down" : undefined} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid two dash-pair">
        <Card>
          <CardContent>
            <div className="card-head">
              <div>
                <CardTitle>Trading Discipline</CardTitle>
                <div className="muted card-hint">How closely your record follows your own rules.</div>
              </div>
            </div>
            <div className="disc-list">
              <DisciplineRow
                icon={<Target size={15} aria-hidden />} tone="positive" title="Plan adherence"
                desc="Trades that follow your trading plan."
                value={discipline.adherence === null ? "—" : `${discipline.adherence.toFixed(0)}%`}
                bar={discipline.adherence ?? 0}
              />
              <DisciplineRow
                icon={<TriangleAlert size={15} aria-hidden />} tone="negative" title="Risk rule violations"
                desc="Trades that lost more than the 1R they planned for."
                value={String(discipline.violations)}
                bar={trades.length ? discipline.violations / trades.length * 100 : 0}
              />
              <DisciplineRow
                icon={<FileText size={15} aria-hidden />} tone="warning" title="Incomplete journal entries"
                desc="Trades missing their setup, execution or discipline scores."
                value={String(discipline.incomplete)}
                bar={trades.length ? discipline.incomplete / trades.length * 100 : 0}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="card-head">
              <div>
                <CardTitle>Performance by Strategy</CardTitle>
                <div className="muted card-hint">Which setups actually pay.</div>
              </div>
              <Link href="/analytics" className="view-all">View all <ArrowRight size={13} aria-hidden /></Link>
            </div>
            <Table wrapClassName="mt-2.5">
              <TableHeader>
                <TableRow><TableHead>Strategy</TableHead><TableHead>Trades</TableHead><TableHead>Win Rate</TableHead><TableHead>Net P&L</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {strategyRows.map(r => {
                  // A row whose strategy has an id opens Analytics already filtered to it. "Others" and
                  // "Unassigned" have none, so they stay inert rather than linking somewhere wrong.
                  const href = r.id ? `/analytics?strategy=${encodeURIComponent(r.id)}` : null;
                  return (
                    <TableRow
                      key={r.id || r.name}
                      className={href ? "row-link" : undefined}
                      onClick={href ? () => router.push(href) : undefined}
                      onMouseEnter={href ? () => router.prefetch(href) : undefined}
                    >
                      <TableCell>
                        {/* The whole row is the mouse target; the name is the keyboard one, so the
                            affordance exists without making an unreachable <tr> the only control. */}
                        {href
                          ? <Link href={href} className="row-link-name" onClick={e => e.stopPropagation()}>{r.name}</Link>
                          : <b>{r.name}</b>}
                      </TableCell>
                      <TableCell>{r.trades}</TableCell>
                      <TableCell>{r.winRate.toFixed(1)}%</TableCell>
                      <TableCell className={r.pnl >= 0 ? "positive" : "negative"}>{formatMoney(r.pnl, currency, true)}</TableCell>
                    </TableRow>
                  );
                })}
                {!strategyRows.length && <TableRow><TableCell colSpan={4}><div className="empty">No trades match these filters.</div></TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent>
          <div className="card-head">
            <div>
              <CardTitle>Recent Trades</CardTitle>
              <div className="muted card-hint">Latest trades matching your filters.</div>
            </div>
            <Link href="/journal" className="view-all">View all <ArrowRight size={13} aria-hidden /></Link>
          </div>
          <Table wrapClassName="mt-2.5">
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead className="col-optional">Strategy</TableHead>
                <TableHead className="col-optional">Direction</TableHead>
                <TableHead className="col-optional">Entry</TableHead>
                <TableHead>Exit</TableHead>
                <TableHead>P&L</TableHead>
                <TableHead className="col-optional">R</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map(t => (
                <TableRow key={t.id} onClick={() => router.push(`/journal/${t.id}`)} onMouseEnter={() => router.prefetch(`/journal/${t.id}`)} style={{ cursor: "pointer" }}>
                  <TableCell>{shortDate(t.entry_at)}</TableCell>
                  <TableCell><b>{t.symbol}</b></TableCell>
                  <TableCell className="col-optional">{t.strategies?.name || "—"}</TableCell>
                  <TableCell className={`col-optional ${t.direction === "short" ? "negative" : "positive"}`}>{t.direction === "short" ? "Short" : "Long"}</TableCell>
                  <TableCell className="col-optional">{formatPrice(t.entry_price, currency)}</TableCell>
                  <TableCell>{t.exit_at ? formatPrice(t.exit_price, currency) : "—"}</TableCell>
                  <TableCell className={Number(t.net_pnl) >= 0 ? "positive" : "negative"}>{formatMoney(t.net_pnl, currency, true)}</TableCell>
                  <TableCell className="col-optional">{formatR(t.r_multiple)}</TableCell>
                  <TableCell>{t.exit_at ? <Badge className="badge-ok">Closed</Badge> : <Badge className="badge-warn">Open</Badge>}</TableCell>
                </TableRow>
              ))}
              {!recent.length && <TableRow><TableCell colSpan={9}><div className="empty">No trades match these filters.</div></TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>}
  </div>;
}

/** One figure in the equity curve's side column. */
function EquityMetric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  return (
    <div className="equity-metric">
      <div className="equity-metric-label">{label}</div>
      <div className={`equity-metric-value${tone === "up" ? " positive" : tone === "down" ? " negative" : ""}`}>{value}</div>
    </div>
  );
}

/** One rule on the discipline card: an icon, what it measures, the figure, and a share bar. */
function DisciplineRow({ icon, tone, title, desc, value, bar }: { icon: React.ReactNode; tone: "positive" | "negative" | "warning"; title: string; desc: string; value: string; bar: number }) {
  return (
    <div className="disc-row">
      <span className={`disc-icon ${tone}`}>{icon}</span>
      <div className="disc-body">
        <div className="disc-top">
          <span className="disc-title">{title}</span>
          <span className={`disc-value${tone === "positive" ? " positive" : tone === "negative" ? " negative" : ""}`}>{value}</span>
        </div>
        <div className="disc-desc muted">{desc}</div>
        <div className="disc-bar"><div className={`disc-fill ${tone}`} style={{ width: `${Math.min(100, Math.max(0, bar))}%` }} /></div>
      </div>
    </div>
  );
}
