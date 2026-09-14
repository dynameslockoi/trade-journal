"use client";
import { useEffect } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import {
  formatDurationMs,
  formatMoney,
  formatPercent,
  formatR,
  percentOf,
  shortDateTime,
  type DaySummary,
} from "@/lib/trading";

/**
 * The pop-up behind a calendar day: what the day made, the balance it started from, the trade
 * stats behind it, and the trades themselves — each one a link into the journal.
 */
export function CalendarDayModal({
  day,
  capital,
  currency,
  onClose,
}: {
  day: DaySummary;
  capital: number | null;
  currency?: string | null;
  onClose: () => void;
}) {
  // Escape closes, and the page behind does not scroll while the pop-up is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  // A day is keyed by local date, so noon keeps it on the right day whatever the timezone offset.
  const label = new Date(`${day.key}T12:00:00`).toLocaleDateString("en-MY", {
    weekday: "short", day: "2-digit", month: "short", year: "numeric",
  });
  const startBalance = capital === null ? null : capital + day.equityBefore;
  const endBalance = startBalance === null ? null : startBalance + day.pnl;
  const pct = percentOf(day.pnl, startBalance);
  const trades = [...day.trades].sort((a, b) => b.entry_at.localeCompare(a.entry_at));

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="day-modal" role="dialog" aria-modal="true" aria-label={`Trades on ${label}`} onClick={e => e.stopPropagation()}>
        <div className="day-modal-head">
          <div>
            <div className="day-modal-date">{label}</div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
              {day.count} trade{day.count === 1 ? "" : "s"} · {day.wins}W / {day.losses}L
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close day details"><X size={16} /></button>
        </div>

        <div className="day-pnl-row">
          <div>
            <div className="metric-label">Net P&amp;L</div>
            <div className={`day-pnl ${day.pnl >= 0 ? "positive" : "negative"}`}>{formatMoney(day.pnl, currency, true)}</div>
          </div>
          {pct !== null && (
            <span className={`badge ${pct >= 0 ? "positive" : "negative"}`}>{formatPercent(pct)} of capital</span>
          )}
        </div>

        <div className="day-section">Account Overview</div>
        {capital === null ? (
          <div className="day-note">
            Balances and % of capital need a starting balance. <Link className="link" href="/accounts">Add one on the Accounts page</Link>.
          </div>
        ) : (
          <div className="day-tiles">
            <Tile label="Start Balance" value={formatMoney(startBalance, currency)} />
            <Tile label="End Balance" value={formatMoney(endBalance, currency)} tone={day.pnl} />
            <Tile label="Capital" value={formatMoney(capital, currency)} />
          </div>
        )}

        <div className="day-section">Trade Stats</div>
        <div className="day-tiles two">
          <div className="day-tile day-tile-count"><span className="muted">Trades</span><b>{day.count}</b></div>
          <div className="day-tile day-tile-count"><span className="muted">Symbols</span><b>{day.symbols}</b></div>
        </div>
        <div className="day-rows">
          <Row label="Best Trade" value={tradeLabel(day.best, currency)} />
          <Row label="Worst Trade" value={tradeLabel(day.worst, currency)} />
          <Row label="Gross P&L" value={formatMoney(day.gross, currency, true)} tone={day.gross} />
          <Row label="Fees" value={formatMoney(-day.charges, currency)} />
          <Row label="Avg Hold Time" value={formatDurationMs(day.avgHoldMs)} />
          <Row label="Max Drawdown" value={formatMoney(day.drawdown, currency)} />
          <Row label="Win Rate" value={`${day.winRate.toFixed(1)}%`} />
          <Row label="Profit Factor" value={day.profitFactor === null ? "—" : day.profitFactor.toFixed(2)} />
          <Row label="Avg per Trade" value={formatMoney(day.expectancy, currency, true)} tone={day.expectancy} />
          <Row label="Total R" value={day.avgR === null ? "—" : formatR(day.rSum)} />
          <Row label="Avg R" value={day.avgR === null ? "—" : formatR(day.avgR)} />
        </div>

        <div className="day-section">Trades</div>
        <div className="day-trades">
          {trades.map(t => (
            <Link className="day-trade" key={t.id} href={`/journal/${t.id}`}>
              <span>
                <b>{t.symbol}</b>
                <span className="muted day-trade-time"> {shortDateTime(t.entry_at)}</span>
              </span>
              <b className={Number(t.net_pnl) >= 0 ? "positive" : "negative"}>{formatMoney(t.net_pnl, currency, true)}</b>
            </Link>
          ))}
        </div>

        <div className="day-modal-actions">
          <Link className="btn btn-primary" href={`/journal?from=${day.key}&to=${day.key}`}>View in Journal</Link>
        </div>
      </div>
    </div>
  );
}

/** "CHEEDING · RM +12.40" — the symbol and what it made, for the best/worst trade rows. */
function tradeLabel(trade: DaySummary["best"], currency?: string | null) {
  if (!trade) return "—";
  return `${trade.symbol} · ${formatMoney(trade.net_pnl, currency, true)}`;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="day-row">
      <span className="muted">{label}</span>
      <b className={tone === undefined ? undefined : tone >= 0 ? "positive" : "negative"}>{value}</b>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: number }) {
  return (
    <div className="day-tile">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${tone === undefined ? "" : tone >= 0 ? "positive" : "negative"}`}>{value}</div>
    </div>
  );
}
