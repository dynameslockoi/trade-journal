"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { CalendarDayModal } from "@/components/calendar-day-modal";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  dailySummaries,
  dayKey,
  formatMoney,
  formatPercent,
  normalizeTrade,
  percentOf,
  roundMoney,
  type DaySummary,
  type Trade,
} from "@/lib/trading";

type Account = { id: string; name: string; starting_balance: number; currency: string };

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2024, i, 1).toLocaleString("en-MY", { month: "long" })
);
const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));
const pad = (n: number) => String(n).padStart(2, "0");
/**
 * Splits "RM -241.03" so the symbol can drop to its own line in a narrow cell while the figure
 * stays whole. Splits on any whitespace, since the gap `formatMoney` uses is non-breaking.
 */
const moneyParts = (value: unknown, currency?: string | null) => {
  const [symbol, ...figure] = formatMoney(value, currency, true).split(/\s+/);
  return { symbol, figure: figure.join(" ") };
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

export default function CalendarPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selected, setSelected] = useState<DaySummary | null>(null);
  const [loading, setLoading] = useState(true);
  // So a click in the year strip below can bring the month it opens back into view.
  const monthCard = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const s = createClient();
      const [t, a] = await Promise.all([
        s.from("trades")
          .select("id,symbol,direction,entry_at,exit_at,entry_price,exit_price,position_size,gross_pnl,commission,swap,fees,net_pnl,r_multiple,risk_amount,session,account_id,strategy_id,strategies(name),trading_accounts(name,currency)")
          .order("entry_at"),
        s.from("trading_accounts").select("id,name,starting_balance,currency").order("name"),
      ]);
      setTrades(((t.data ?? []) as any[]).map(normalizeTrade));
      setAccounts((a.data ?? []) as Account[]);
      setLoading(false);
    })();
  }, []);

  const days = useMemo(() => dailySummaries(trades), [trades]);
  const byDay = useMemo(() => new Map(days.map(d => [d.key, d])), [days]);
  // Capital is what every account was funded with — the base a day's return is measured against.
  const capital = useMemo(() => {
    const funded = accounts.reduce((sum, a) => sum + Number(a.starting_balance || 0), 0);
    return funded > 0 ? funded : null;
  }, [accounts]);
  const currency = accounts[0]?.currency;

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const todayKey = dayKey(new Date());
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const monthKeys = Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`);
  const inMonth = monthKeys.map(k => byDay.get(k)).filter(Boolean) as DaySummary[];
  const monthPnl = inMonth.reduce((sum, d) => sum + d.pnl, 0);
  const monthTrades = inMonth.reduce((sum, d) => sum + d.count, 0);
  const greenDays = inMonth.filter(d => d.pnl > 0).length;
  const redDays = inMonth.filter(d => d.pnl < 0).length;
  // The balance the month opened with: capital plus everything earned before it.
  const equityBeforeMonth = capital === null ? null : capital + days
    .filter(d => d.key < monthKeys[0])
    .reduce((sum, d) => sum + d.pnl, 0);
  const monthPct = percentOf(monthPnl, equityBeforeMonth);
  const years = useMemo(() => {
    const set = new Set<number>([new Date().getFullYear(), year]);
    days.forEach(d => set.add(Number(d.key.slice(0, 4))));
    return [...set].sort((a, b) => a - b);
  }, [days, year]);

  // Guarded so a stray value can never land the cursor on an invalid date.
  const go = (y: number, m: number) => {
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    setCursor(new Date(y, m, 1));
  };
  const today = () => setCursor(startOfMonth(new Date()));

  // Months across, years down — the whole journal at a glance, newest year first.
  const yearly = useMemo(() => {
    const rows = new Map<number, { pnl: number; count: number }[]>();
    const rowFor = (y: number) => {
      let row = rows.get(y);
      if (!row) {
        row = Array.from({ length: 12 }, () => ({ pnl: 0, count: 0 }));
        rows.set(y, row);
      }
      return row;
    };
    days.forEach(d => {
      const cell = rowFor(Number(d.key.slice(0, 4)))[Number(d.key.slice(5, 7)) - 1];
      cell.pnl = roundMoney(cell.pnl + d.pnl);
      cell.count += d.count;
    });
    // The current year is always shown, even before it has trades.
    rowFor(new Date().getFullYear());
    return [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([rowYear, months]) => ({
        year: rowYear,
        months,
        total: months.reduce((sum, m) => ({ pnl: roundMoney(sum.pnl + m.pnl), count: sum.count + m.count }), { pnl: 0, count: 0 }),
      }));
  }, [days]);

  return <div className="content">
    <PageHeader
      title="P&L Calendar"
      subtitle="Daily realised P&L, trade count and return on capital."
      actions={<Button variant="secondary" onClick={today}>Today</Button>}
    />
    {loading ? <Card><CardContent>Loading calendar…</CardContent></Card> : <>
      <div className="grid four">
        <StatCard label="Month P&L" value={formatMoney(monthPnl, currency, true)} positive={monthPnl >= 0}
          sub={monthPct === null ? "No starting capital set" : `${formatPercent(monthPct)} of capital`} />
        <StatCard label="Trades" value={String(monthTrades)} sub={`${greenDays} green / ${redDays} red days`} />
        <StatCard label="Trading Days" value={String(inMonth.length)} sub={inMonth.length ? `Avg ${formatMoney(inMonth.length ? monthPnl / inMonth.length : 0, currency, true)} a day` : "No trades this month"} />
        <StatCard label="Green Days" value={String(greenDays)} sub={inMonth.length ? `${(greenDays / inMonth.length * 100).toFixed(0)}% of trading days` : "—"} />
      </div>

      <Card ref={monthCard}>
        <CardContent>
          <div className="cal-nav">
            <div className="cal-nav-group">
              <Button variant="secondary" size="icon" className="icon-btn" aria-label="Previous year" onClick={() => go(year - 1, month)}><ChevronsLeft size={16} /></Button>
              <Button variant="secondary" size="icon" className="icon-btn" aria-label="Previous month" onClick={() => go(year, month - 1)}><ChevronLeft size={16} /></Button>
            </div>
            <div className="cal-pickers">
              <Select value={String(month)} onValueChange={v => go(year, Number(v))}>
                <SelectTrigger aria-label="Month"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={m} value={String(i)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={String(year)} onValueChange={v => go(Number(v), month)}>
                <SelectTrigger aria-label="Year"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="cal-nav-group">
              <Button variant="secondary" size="icon" className="icon-btn" aria-label="Next month" onClick={() => go(year, month + 1)}><ChevronRight size={16} /></Button>
              <Button variant="secondary" size="icon" className="icon-btn" aria-label="Next year" onClick={() => go(year + 1, month)}><ChevronsRight size={16} /></Button>
            </div>
          </div>

          <div className="calendar-grid">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(x => <div className="calendar-weekday muted" key={x}>{x}</div>)}
            {Array.from({ length: offset }).map((_, i) => <div key={`o${i}`} />)}
            {monthKeys.map((key, i) => {
              const day = byDay.get(key);
              const pnl = day?.pnl ?? 0;
              // A day's return is measured against the balance it opened with, not the month's start.
              const pct = day && equityBeforeMonth !== null && capital !== null
                ? percentOf(pnl, capital + day.equityBefore)
                : null;
              const open = day ? () => setSelected(day) : undefined;
              const money = day ? moneyParts(pnl, currency) : null;
              return <div
                key={key}
                className={`calendar-cell ${day ? "cal-click" : ""} ${pnl > 0 ? "calendar-positive" : pnl < 0 ? "calendar-negative" : "calendar-zero"} ${key === todayKey ? "calendar-today" : ""}`}
                role={day ? "button" : undefined}
                tabIndex={day ? 0 : undefined}
                aria-label={day ? `${day.count} trades on ${key}, ${formatMoney(pnl, currency, true)}` : undefined}
                onClick={open}
                onKeyDown={day ? e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open!(); } } : undefined}
              >
                <div className="cal-top">
                  <span className="calendar-day">{i + 1}</span>
                  {key === todayKey && <span className="cal-today-tag">Today</span>}
                </div>
                {day && money && <div className={`calendar-pnl ${pnl >= 0 ? "positive" : "negative"}`}>
                  <span>{money.symbol}</span>
                  <span className="cal-amt">{money.figure}</span>
                </div>}
                {day && <div className="cal-meta">
                  {day.count} trade{day.count === 1 ? "" : "s"}
                  {pct !== null && <span className="cal-pct"> · {formatPercent(pct)}</span>}
                </div>}
              </div>;
            })}
          </div>

          <div className="cal-legend muted">
            <span>{capital === null
              ? <>Return on capital and day balances need a starting balance — <Link className="link" href="/accounts">add one on the Accounts page</Link>.</>
              : `Return measured against capital of ${formatMoney(capital, currency)} plus realised P&L.`}</span>
            <span>Click a day for the full breakdown.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="year-head">
            <div>
              <b>Yearly Performance</b>
              <div className="muted text-[10px] mt-[3px]">Months across, years down — click a month to open it above. Scroll sideways for the full year.</div>
            </div>
          </div>
          <div className="year-scroll">
            <div className="year-grid">
              <div className="year-row">
                <div className="year-label" aria-hidden="true" />
                {MONTHS_SHORT.map(m => <div className="year-month" key={m}>{m}</div>)}
                <div className="year-month">YTD</div>
              </div>
              {yearly.map(row => (
                <div className="year-row" key={row.year}>
                  <div className="year-label">{row.year}</div>
                  {row.months.map((cell, i) => {
                    const label = `${MONTHS[i]} ${row.year}`;
                    const detail = cell.count
                      ? `${formatMoney(cell.pnl, currency, true)} from ${cell.count} trade${cell.count === 1 ? "" : "s"}`
                      : "no trades";
                    const tone = !cell.count ? "year-off" : cell.pnl > 0 ? "calendar-positive" : cell.pnl < 0 ? "calendar-negative" : "";
                    return <button
                      key={label}
                      className={`year-cell ${tone} ${row.year === year && i === month ? "year-current" : ""}`}
                      disabled={!cell.count}
                      aria-label={`${label}: ${detail}`}
                      onClick={() => {
                        go(row.year, i);
                        monthCard.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      {cell.count
                        ? <><span className="year-pnl">{formatMoney(cell.pnl, currency, true)}</span><span className="year-count">{cell.count} trade{cell.count === 1 ? "" : "s"}</span></>
                        : <span className="year-empty">—</span>}
                    </button>;
                  })}
                  <div
                    className={`year-cell year-total ${!row.total.count ? "year-off" : row.total.pnl > 0 ? "calendar-positive" : row.total.pnl < 0 ? "calendar-negative" : ""}`}
                    aria-label={`${row.year} to date: ${formatMoney(row.total.pnl, currency, true)} from ${row.total.count} trades`}
                  >
                    {row.total.count
                      ? <><span className="year-pnl">{formatMoney(row.total.pnl, currency, true)}</span><span className="year-count">{row.total.count} trades</span></>
                      : <span className="year-empty">—</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </>}
    {selected && <CalendarDayModal day={selected} capital={capital} currency={currency} onClose={() => setSelected(null)} />}
  </div>;
}
