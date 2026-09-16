"use client";

import { useMemo, useState } from "react";
import { Sparkline } from "@/components/sparkline";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SECTOR_UNSET, formatMoney, monthBounds, monthKey, monthLabel, sectorOf, shiftMonth, type Trade,
} from "@/lib/trading";

/**
 * Every month you have traded a sector, as a column. A sector that is warming shows up as a rising
 * sparkline and a run of green months on the right; one going cold shows the opposite, which is the
 * question a chart of sector totals ("which sector has made the most, ever") cannot answer.
 *
 * Cells are buttons: a month opens that month across the whole page, so "Technology, last June" is
 * one click away from the trades behind it.
 */
const WINDOWS = [
  { id: "12", label: "Last 12 months", months: 12 },
  { id: "24", label: "Last 24 months", months: 24 },
  { id: "36", label: "Last 36 months", months: 36 },
  { id: "all", label: "Every month", months: 0 },
];

type MonthCell = { pnl: number; count: number };

export function SectorSentiment({ trades, currency, onPickMonth }: {
  trades: Trade[];
  currency?: string | null;
  /**
   * Opens one cell as the page's filter: the month, and the sector when there is one to filter on
   * ("Not set" has no sector value to select, and filtering to the month alone is still useful).
   */
  onPickMonth: (pick: { from: string; to: string; label: string; sector: string }) => void;
}) {
  const [winId, setWinId] = useState("24");
  const months = WINDOWS.find(w => w.id === winId)?.months ?? 24;

  const { axis, rows } = useMemo(() => {
    const map = new Map<string, { months: Record<string, MonthCell>; total: number; count: number }>();
    let firstTradeMonth = "";
    let lastTradeMonth = "";
    for (const t of trades) {
      const key = monthKey(t.entry_at);
      if (!key) continue;
      const name = sectorOf(t);
      const row = map.get(name) ?? { months: {}, total: 0, count: 0 };
      const cell = (row.months[key] ??= { pnl: 0, count: 0 });
      const pnl = Number(t.net_pnl || 0);
      cell.pnl = +(cell.pnl + pnl).toFixed(2);
      cell.count += 1;
      row.total = +(row.total + pnl).toFixed(2);
      row.count += 1;
      map.set(name, row);
      if (!firstTradeMonth || key < firstTradeMonth) firstTradeMonth = key;
      if (!lastTradeMonth || key > lastTradeMonth) lastTradeMonth = key;
    }

    // The strip ends at the present month, so a sector that has gone quiet shows trailing empty
    // months rather than appearing to run right up to now.
    const now = monthKey(new Date());
    const end = lastTradeMonth > now ? lastTradeMonth : now;
    const start = months ? shiftMonth(end, -(months - 1)) : (firstTradeMonth || end);

    const axisKeys: string[] = [];
    // 600 is a guard against a malformed key looping forever, not a real bound.
    for (let k = start, i = 0; k && k <= end && i < 600; k = shiftMonth(k, 1), i++) axisKeys.push(k);

    const rows = [...map.entries()]
      .map(([name, v]) => {
        const series = axisKeys.map(k => v.months[k]?.pnl ?? 0);
        const windowTotal = +series.reduce((sum, x) => sum + x, 0).toFixed(2);
        const windowTrades = axisKeys.reduce((sum, k) => sum + (v.months[k]?.count ?? 0), 0);
        // Cumulative, because "warming up" is about the running total's direction, not this month's.
        const cumulative = series.reduce<number[]>((out, x) => [...out, +(out[out.length - 1] + x).toFixed(2)], [0]).slice(1);
        return { name, cells: v.months, series, cumulative, total: v.total, count: v.count, windowTotal, windowTrades };
      })
      // Best paying first, matching the Sector P&L chart; unclassified last, where it reads as a to-do.
      .sort((a, b) => (a.name === SECTOR_UNSET ? 1 : b.name === SECTOR_UNSET ? -1 : b.windowTotal - a.windowTotal));

    return { axis: axisKeys, rows };
  }, [trades, months]);

  const allUnset = rows.length === 1 && rows[0].name === SECTOR_UNSET;
  const columns = `minmax(180px, 210px) 84px repeat(${axis.length}, minmax(96px, 1fr)) 112px`;

  return (
    <Card>
      <CardContent>
        <div className="year-head">
          <div>
            <b>Sector Sentiment</b>
            <div className="muted text-[10px] mt-[3px]">
              A month per column, a sector per row, best paying first — the sparkline is the running
              total across the window. Click a month to filter the page to it.
            </div>
          </div>
          <div className="filter-actions">
            <Select value={winId} onValueChange={setWinId}>
              <SelectTrigger aria-label="Months shown"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WINDOWS.map(w => <SelectItem key={w.id} value={w.id}>{w.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {allUnset && (
          <div className="muted text-[11px] mt-3">
            Every trade is still unclassified — set sectors once per symbol with <b>Sectors</b> on the
            Journal page, and this strip fills in.
          </div>
        )}

        {!rows.length
          ? <div className="empty">No trades match these filters.</div>
          : <div className="ss-scroll">
            <div className="ss-grid">
              <div className="ss-row" style={{ gridTemplateColumns: columns }}>
                <div className="ss-label" aria-hidden="true" />
                <div className="ss-head-cell" aria-hidden="true" />
                {axis.map(k => <div className="ss-month" key={k}>{monthLabel(k)}</div>)}
                <div className="ss-month">Total</div>
              </div>

              {rows.map(row => (
                <div className="ss-row" key={row.name} style={{ gridTemplateColumns: columns }}>
                  <div className="ss-label">
                    <b title={row.name}>{row.name}</b>
                    <span className="muted text-[9.5px]">{row.count} trade{row.count === 1 ? "" : "s"} all time</span>
                  </div>
                  <div className="ss-spark">
                    <Sparkline values={row.cumulative} tone={row.windowTotal >= 0 ? "positive" : "negative"} height={30} />
                  </div>
                  {axis.map(k => {
                    const cell = row.cells[k];
                    const bounds = monthBounds(k);
                    const label = `${row.name} · ${monthLabel(k)}`;
                    if (!cell) {
                      return <div className="ss-cell ss-off" key={k} aria-label={`${label}: no trades`}>
                        <span className="ss-empty">—</span>
                      </div>;
                    }
                    const tone = cell.pnl > 0 ? "ss-positive" : cell.pnl < 0 ? "ss-negative" : "";
                    return <button
                      type="button"
                      className={`ss-cell ${tone} ${k === axis[axis.length - 1] ? "ss-now" : ""}`}
                      key={k}
                      aria-label={`${label}: ${formatMoney(cell.pnl, currency, true)} from ${cell.count} trade${cell.count === 1 ? "" : "s"} — filter to this month`}
                      onClick={() => onPickMonth({
                        from: bounds.from,
                        to: bounds.to,
                        label,
                        sector: row.name === SECTOR_UNSET ? "" : row.name,
                      })}
                    >
                      <span className="ss-pnl">{formatMoney(cell.pnl, currency, true)}</span>
                      <span className="ss-count">{cell.count} trade{cell.count === 1 ? "" : "s"}</span>
                    </button>;
                  })}
                  <div className={`ss-cell ss-total ${row.windowTotal > 0 ? "ss-positive" : row.windowTotal < 0 ? "ss-negative" : ""}`}
                    aria-label={`${row.name} in this window: ${formatMoney(row.windowTotal, currency, true)} from ${row.windowTrades} trades`}>
                    {row.windowTrades
                      ? <><span className="ss-pnl">{formatMoney(row.windowTotal, currency, true)}</span>
                        <span className="ss-count">{row.windowTrades} trade{row.windowTrades === 1 ? "" : "s"}</span></>
                      : <span className="ss-empty">—</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>}
      </CardContent>
    </Card>
  );
}
