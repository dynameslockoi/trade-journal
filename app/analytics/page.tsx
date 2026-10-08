"use client";
import { Fragment, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { KEYS, loadAccounts, loadFlows, loadStrategies, loadTags, loadTrades, useTradeTagsMap } from "@/lib/data";
import { useCachedQuery } from "@/lib/query-cache";
import { FilterBar, applyFilters, emptyFilters, type Filters } from "@/components/filter-bar";
import { StatCard } from "@/components/stat-card";
import { PageHeader } from "@/components/page-header";
import { LoadError } from "@/components/load-error";
import { CardSkeleton, StatsSkeleton } from "@/components/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectorSentiment } from "@/components/sector-sentiment";
import { OnScreen } from "@/components/on-screen";
import { toast } from "sonner";

/**
 * Ten charts, one library, loaded once — as its own chunk. See the doc comment in
 * `components/analytics-charts.tsx` for why this page in particular needs the split.
 *
 * The split keeps recharts off the page's own bundle, but it is not enough on its own: fetched and
 * rendered together, the ten of them blocked the main thread for 200–700 ms (long tasks of 325 ms and
 * 313 ms, measured on a production build) after a page that paints in 31 ms. So each chart is also
 * wrapped in `OnScreen` below, which mounts it as it comes near the viewport instead.
 */
const PnlBars = dynamic(() => import("@/components/analytics-charts").then(m => m.PnlBars), {
  ssr: false,
  loading: () => <Skeleton className="mt-2.5 h-[280px] w-full" />,
});
const AnalyticsEquityCurve = dynamic(() => import("@/components/analytics-charts").then(m => m.AnalyticsEquityCurve), {
  ssr: false,
  loading: () => <Skeleton className="mt-2.5 h-[300px] w-full" />,
});
const RDistributionChart = dynamic(() => import("@/components/analytics-charts").then(m => m.RDistributionChart), {
  ssr: false,
  loading: () => <Skeleton className="mt-2.5 h-[300px] w-full" />,
});
import {
  bestStreak, calculateStats, capitalBehind, capitalByAccount, formatMoney, holdingBucket, HOLDING_BUCKETS, HOUR_BUCKETS, hourBucket,
  hourSession, LOTS_BUCKETS, lotsBucket, myParts, numberOrNull, QUALITY_BUCKETS,
  percentOf, qualityBucket, SECTOR_UNSET, sectorOf, SESSION_WINDOWS, type CashFlow, type Trade,
} from "@/lib/trading";

type GroupRow = { name: string; trades: number; pnl: number; wins: number; winRate: number; avg: number; order: number };
type GroupKey = "strategy" | "sector" | "session" | "symbol" | "weekday" | "hour" | "holding" | "lots" | "quality" | "ipo";

/** How a trade came to you. The journal flags an allocation rather than its opposite, so the label
 * has to be derived; the order here is the axis order. */
const IPO_ORIGINS = ["Open market", "IPO allocation"] as const;

/**
 * The banded dimensions draw a fixed axis: a band with no trades keeps its slot, so the chart does
 * not reshuffle underneath you when you change the filter. The list order is the chart order.
 */
const BANDS: Partial<Record<GroupKey, readonly string[]>> = {
  hour: HOUR_BUCKETS,
  holding: HOLDING_BUCKETS,
  lots: LOTS_BUCKETS,
  quality: QUALITY_BUCKETS,
  // Two slots, always both drawn: the open market first, then the allocations, so the comparison
  // reads left to right even before the first IPO is recorded.
  ipo: IPO_ORIGINS,
};

/**
 * The Bursa sessions, as a band drawn above the hours each one covers, so an hourly table still
 * answers "am I better in the morning or the evening?" — with a subtotal per band.
 */
function hourSessionLabel(hour: string) {
  const session = hourSession(hour);
  return session ? `${session} · ${SESSION_WINDOWS[session]}` : null;
}

/**
 * The trade's Malaysian calendar day, carried as a UTC midnight so the weekday it reports cannot be
 * dragged onto a neighbouring day by whatever clock is reading it.
 */
function myDay(entryAt: string) {
  const parts = myParts(entryAt);
  return parts ? new Date(Date.UTC(parts.year, parts.month - 1, parts.day)) : new Date(NaN);
}

/** Which band a trade lands in, plus the order the chart places that band at. */
function bandOf(t: Trade, key: GroupKey): { name: string; order: number } {
  const date = myDay(t.entry_at);
  const name =
    key === "strategy" ? t.strategies?.name || "Unassigned"
    : key === "weekday" ? date.toLocaleDateString("en-MY", { weekday: "short", timeZone: "UTC" })
    : key === "hour" ? hourBucket(t.entry_at)
    : key === "holding" ? holdingBucket(t.entry_at, t.exit_at)
    : key === "lots" ? lotsBucket(t.position_size)
    : key === "quality" ? qualityBucket(t)
    : key === "ipo" ? (t.is_ipo ? IPO_ORIGINS[1] : IPO_ORIGINS[0])
    : key === "sector" ? sectorOf(t)
    : String((t as any)[key] ?? "Unassigned");
  // Weekdays sort Monday-first; bands follow their list; the rest keep insertion order.
  const order = key === "weekday" ? (date.getUTCDay() + 6) % 7 : BANDS[key]?.indexOf(name) ?? 0;
  return { name, order: order < 0 ? 0 : order };
}

function grouped(ts: Trade[], key: GroupKey): GroupRow[] {
  const map: Record<string, { trades: number; pnl: number; wins: number; order: number }> = {};
  (BANDS[key] ?? []).forEach((name, order) => { map[name] = { trades: 0, pnl: 0, wins: 0, order }; });
  ts.forEach(t => {
    const { name, order } = bandOf(t, key);
    map[name] ??= { trades: 0, pnl: 0, wins: 0, order };
    map[name].trades++;
    map[name].pnl += Number(t.net_pnl || 0);
    if (Number(t.net_pnl) > 0) map[name].wins++;
  });
  return Object.entries(map)
    .map(([name, v]) => ({
      name,
      trades: v.trades,
      wins: v.wins,
      order: v.order,
      pnl: +v.pnl.toFixed(2),
      winRate: v.trades ? +(v.wins / v.trades * 100).toFixed(1) : 0,
      // Money per trade rather than R: a band is always comparable, even with no stop losses recorded.
      avg: v.trades ? +(v.pnl / v.trades).toFixed(2) : 0,
    }))
    // Sectors are ordered by what they made, because the question is which one pays rather than
    // which comes first in Bursa's list — and only sectors actually traded are drawn, so the chart
    // is not mostly empty slots. Unclassified trades stay at the end where they read as a to-do.
    .sort((a, b) => key === "sector"
      ? (a.name === SECTOR_UNSET ? 1 : b.name === SECTOR_UNSET ? -1 : b.pnl - a.pnl)
      : a.order - b.order);
}

/**
 * What a breakdown card reserves before it is built: a measured 35 px per row, plus its header and
 * padding. It is an estimate — the hourly card draws section bands on top of its rows and so reads a
 * couple of rows short, and every card changes height with the data — which is acceptable here for
 * the same reason the charts' figures are exact: the correction lands while the card is still off
 * screen, and the row below it is the only thing that moves.
 */
function tableHeight(rows: GroupRow[]) {
  return rows.length * 35 + 60;
}

export default function Analytics() {
  // Shared with the dashboard and the journal: the charts and the table read the same rows.
  const tradesQ = useCachedQuery<Trade[]>(KEYS.trades, loadTrades);
  const accountsQ = useCachedQuery<any[]>(KEYS.accounts, loadAccounts);
  const strategiesQ = useCachedQuery<any[]>(KEYS.strategies, loadStrategies);
  const tagsQ = useCachedQuery<any[]>(KEYS.tags, loadTags);
  const flowsQ = useCachedQuery<any[]>(KEYS.flows, loadFlows);
  const tradeTagsQ = useTradeTagsMap();
  const all = tradesQ.data ?? [];
  const accounts = accountsQ.data ?? [];
  const strategies = strategiesQ.data ?? [];
  const tags = tagsQ.data ?? [];
  // An unreadable ledger is not a broken page: the capital line falls back to opening balances.
  const flows = (flowsQ.error ? null : flowsQ.data) as CashFlow[] | null;
  const [filters, setFilters] = useState<Filters>({ ...emptyFilters });
  const loading = tradesQ.loading || accountsQ.loading || flowsQ.loading;
  const loadError = tradesQ.error ?? accountsQ.error ?? strategiesQ.error ?? tagsQ.error ?? tradeTagsQ.error;

  const ts = useMemo(() => applyFilters(all, filters, tradeTagsQ.map) as Trade[], [all, filters, tradeTagsQ.map]);
  // Money follows the filtered account's currency, falling back to the journal default (RM).
  const currency = accounts.find(a => a.id === filters.account)?.currency;
  const stats = useMemo(() => calculateStats(ts), [ts]);
  const strategy = useMemo(() => grouped(ts, "strategy"), [ts]);
  const hour = useMemo(() => grouped(ts, "hour"), [ts]);
  const weekday = useMemo(() => grouped(ts, "weekday"), [ts]);
  const holding = useMemo(() => grouped(ts, "holding"), [ts]);
  const lots = useMemo(() => grouped(ts, "lots"), [ts]);
  const quality = useMemo(() => grouped(ts, "quality"), [ts]);
  const sector = useMemo(() => grouped(ts, "sector"), [ts]);
  const ipo = useMemo(() => grouped(ts, "ipo"), [ts]);

  const rdist = useMemo(
    () => [[-5, -3], [-3, -2], [-2, -1], [-1, -.5], [-.5, 0], [0, .5], [.5, 1], [1, 2], [2, 3], [3, 5], [5, Infinity]].map(([a, b]) => ({
      range: `${a} to ${b === Infinity ? "+" : b}R`,
      count: ts.filter(t => { const r = Number(t.r_multiple); return Number.isFinite(r) && r >= a && r < b; }).length,
    })),
    [ts]
  );

  const eq = stats.equity.map(x => ({ x: x.x, pnl: x.pnl }));
  // Without a stop loss a trade has no R multiple, so the two R cards would read "+0.00R" — a
  // number that looks like a break-even edge but is really an absence. Money per trade stands in.
  // The mean is taken over the trades that carry a stop, never over the blanks counted as zeroes.
  const hasR = stats.rCount > 0;
  const avgR = stats.avgR ?? 0;
  const perTrade = ts.length ? stats.pnl / ts.length : null;
  // Same rule as the dashboard: quote the drawdown against the capital behind it — deposits less
  // withdrawals — rather than against a P&L peak that may be a few hundred ringgit.
  const capital = useMemo(
    () => capitalBehind(accounts, capitalByAccount(accounts, flows), filters.account),
    [accounts, flows, filters.account]
  );
  const ddOnCapital = percentOf(stats.maxDrawdown, capital);
  const ddSub = ddOnCapital === null
    ? `${stats.maxDrawdownPct.toFixed(1)}% of the P&L peak`
    : `${Math.abs(ddOnCapital).toFixed(1)}% of ${formatMoney(capital, currency)} capital`;

  return (
    <div className="content">
      <PageHeader title="Analytics" subtitle="Measure where your edge actually comes from." />
      <LoadError message={loadError} />
      <FilterBar filters={filters} setFilters={setFilters} accounts={accounts} strategies={strategies} tags={tags} />
      {loadError ? null : loading ? <><StatsSkeleton rows={2} /><CardSkeleton lines={6} /></> : <>
        <div className="grid four">
          <StatCard label="Net P&L" value={formatMoney(stats.pnl, currency, true)} positive={stats.pnl >= 0} />
          <StatCard label="Win Rate" value={`${stats.winRate.toFixed(1)}%`} />
          <StatCard label="Profit Factor" value={stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2)} />
          {hasR ? (
            <StatCard label="Expectancy" value={`${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R`} sub={`mean of ${stats.rCount} trade${stats.rCount === 1 ? "" : "s"} with a stop`} positive={avgR >= 0} />
          ) : (
            <StatCard label="Expectancy" value={formatMoney(perTrade, currency, true)} sub="per trade · no stop losses recorded" positive={perTrade === null ? undefined : perTrade >= 0} />
          )}
        </div>
        <div className="grid four">
          {/* Money that came out is red wherever it is shown, the same as the net and gross cards
              above — a drawdown of zero is not a loss, so only a real one takes the tone. */}
          <StatCard label="Max Drawdown" value={formatMoney(-stats.maxDrawdown, currency)} sub={ddSub} positive={stats.maxDrawdown > 0 ? false : undefined} />
          <StatCard label="Avg R" value={hasR ? `${avgR >= 0 ? "+" : ""}${avgR.toFixed(2)}R` : "—"} sub={hasR ? `stop recorded on ${stats.rCount} of ${ts.length}` : "needs a stop loss"} positive={hasR ? avgR >= 0 : undefined} />
          <StatCard label="Best Win Streak" value={String(bestStreak(ts, true))} />
          <StatCard label="Best Loss Streak" value={String(bestStreak(ts, false))} />
        </div>

        {/* Paired by the question they answer — what you trade, when, how long, and how the trade
            came to you — and an even count, so no row ends in half a row of empty space. */}
        <div className="grid two">
          {([
            ["Strategy P&L", strategy, "By the setup each trade was tagged with.", 10],
            ["Sector P&L", sector, "Which Bursa sectors pay you — best first, sector by sector.", 8.5],
            ["Hourly P&L", hour, "Which Bursa hour pays you — the axis skips the 12:30–14:30 break.", 9.5, 0],
            ["Weekday P&L", weekday, "Which days of the week you give money back.", 10],
            ["Holding Period P&L", holding, "Does letting a winner run, or cutting it fast, actually pay?", 9.5],
            ["Position Lot P&L", lots, "Position lot — 100 shares each. The same size, every time?", 9.5],
            ["IPO P&L", ipo, "Whether the allocations you were given pay better than buying on the open market.", 9.5],
            ["Setup Quality P&L", quality, "The average of your 1–10 setup, execution and discipline scores.", 9.5],
          ] as const).map(([title, data, hint, tickFontSize, tickInterval]) => (
            <Card key={title}>
              <CardContent>
                <b>{title}</b>
                <div className="muted text-[11px] mt-0.5">{hint}</div>
                {/* The title and the hint stay, so the page still reads as a page; the chart is the
                    expensive part and most of these cards start below the fold. 290 = the chart's
                    280 plus the 10 px margin above it, so nothing moves when it arrives. */}
                <OnScreen height={290}>
                  <PnlBars data={data} currency={currency} tickFontSize={tickFontSize} tickInterval={tickInterval} />
                </OnScreen>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid two">
          <Card>
            <CardContent>
            <b>Equity Curve</b>
            <OnScreen height={310}><AnalyticsEquityCurve data={eq} /></OnScreen>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
            <b>R Distribution</b>
            <OnScreen height={310}><RDistributionChart data={rdist} /></OnScreen>
            </CardContent>
          </Card>
        </div>

        {/* Full width, because a month per column needs the room the two-up grid cannot give it. */}
        {/* 320 px is the strip's height as measured in the browser at the default 24-month window
            (317 px, four sectors). It is an estimate because the rows are the sectors you have, so a
            heavier journal reserves a little less than it needs — and the correction happens while
            the strip is still at least 400 px below the fold, where nobody sees it move. */}
        <OnScreen height={320}>
          <SectorSentiment
            trades={ts}
            currency={currency}
            onPickMonth={({ from, to, label, sector }) => {
              setFilters(f => ({ ...f, from, to, sector }));
              toast.info(`Filtered to ${sector ? `${sector} · ` : ""}${label.split(" · ").pop()}`);
            }}
          />
        </OnScreen>

        {/* The same pairing and the same order as the charts above, so a card and its table are
            found in the same place on the page. */}
        <div className="grid two breakdown-grid">
          {([
            ["Strategy Breakdown", strategy, undefined],
            ["Sector Breakdown", sector, undefined],
            ["Hourly Breakdown", hour, hourSessionLabel],
            ["Weekday Breakdown", weekday, undefined],
            ["Holding Period Breakdown", holding, undefined],
            ["Position Lot Breakdown", lots, undefined],
            ["IPO Breakdown", ipo, undefined],
            ["Setup Quality Breakdown", quality, undefined],
          ] as const).map(([title, rows, sectionOf]) => (
            <OnScreen key={title} height={tableHeight(rows)}>
              <Breakdown title={title} rows={rows} currency={currency} sectionOf={sectionOf} />
            </OnScreen>
          ))}
        </div>
      </>}
    </div>
  );
}

/** The totals of a run of rows, for a section's subtotal line. */
function totals(name: string, rows: GroupRow[]): GroupRow {
  const trades = rows.reduce((sum, r) => sum + r.trades, 0);
  const wins = rows.reduce((sum, r) => sum + r.wins, 0);
  const pnl = rows.reduce((sum, r) => sum + r.pnl, 0);
  return {
    name,
    order: 0,
    trades,
    wins,
    pnl: +pnl.toFixed(2),
    winRate: trades ? +(wins / trades * 100).toFixed(1) : 0,
    avg: trades ? +(pnl / trades).toFixed(2) : 0,
  };
}

function Row({ r, currency, bold }: { r: GroupRow; currency?: string | null; bold?: boolean }) {
  return (
    <TableRow className={bold ? "section-total" : r.trades ? undefined : "row-idle"}>
      <TableCell><b>{r.name}</b></TableCell>
      <TableCell>{r.trades || "—"}</TableCell>
      <TableCell>{r.trades ? `${r.winRate}%` : "—"}</TableCell>
      <TableCell className={r.trades ? (r.avg >= 0 ? "positive" : "negative") : "muted"}>
        {r.trades ? formatMoney(r.avg, currency, true) : "—"}
      </TableCell>
      <TableCell className={r.trades ? (r.pnl >= 0 ? "positive" : "negative") : "muted"}>
        {r.trades ? formatMoney(r.pnl, currency, true) : "—"}
      </TableCell>
    </TableRow>
  );
}

function Breakdown({ title, rows, currency, sectionOf }: {
  title: string;
  rows: GroupRow[];
  currency?: string | null;
  /** Labels a row's section; consecutive rows sharing one are drawn as a band with a subtotal. */
  sectionOf?: (name: string) => string | null;
}) {
  // Rows are already in axis order, so a section is just a run of neighbouring rows.
  const sections = rows.reduce<{ label: string; rows: GroupRow[] }[]>((out, r) => {
    const label = sectionOf?.(r.name) ?? null;
    if (!label) return out;
    const last = out[out.length - 1];
    if (last?.label === label) last.rows.push(r);
    else out.push({ label, rows: [r] });
    return out;
  }, []);
  const banded = new Set(sections.flatMap(s => s.rows.map(r => r.name)));

  return (
    <Card>
      <CardContent>
        <b>{title}</b>
        {/* Five columns beside a chart, so the cells are set tighter than the journal's full-width table. */}
        <Table wrapClassName="table-compact mt-2.5">
          <TableHeader>
            <TableRow><TableHead>Name</TableHead><TableHead>Trades</TableHead><TableHead>Win %</TableHead><TableHead>Avg</TableHead><TableHead>P&L</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {sections.map(s => (
              <Fragment key={s.label}>
                <TableRow className="section-head"><TableCell colSpan={5}>{s.label}</TableCell></TableRow>
                {s.rows.map(r => <Row key={r.name} r={r} currency={currency} />)}
                <Row r={totals(`${s.label.split(" · ")[0]} total`, s.rows)} currency={currency} bold />
              </Fragment>
            ))}
            {rows.filter(r => !banded.has(r.name)).map(r => <Row key={r.name} r={r} currency={currency} />)}
            {!rows.length && <TableRow><TableCell colSpan={5}><div className="empty">No data.</div></TableCell></TableRow>}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
