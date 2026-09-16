export type Trade = {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entry_at: string;
  exit_at?: string | null;
  entry_price?: number | string | null;
  exit_price?: number | string | null;
  position_size?: number | string | null;
  stop_loss?: number | string | null;
  gross_pnl?: number | string | null;
  commission?: number | string | null;
  swap?: number | string | null;
  fees?: number | string | null;
  net_pnl: number | string;
  r_multiple?: number | string | null;
  risk_amount?: number | string | null;
  account_id?: string | null;
  strategy_id?: string | null;
  session?: string | null;
  /** True when the position came from an IPO allocation rather than a market buy. */
  is_ipo?: boolean | null;
  mae?: number | string | null;
  mfe?: number | string | null;
  mistake?: string | null;
  setup_quality?: number | string | null;
  execution_quality?: number | string | null;
  discipline?: number | string | null;
  strategies?: { name: string } | null;
  trading_accounts?: { name: string; starting_balance?: number; currency?: string } | null;
  trade_tags?: { tag_id: string }[];
};

/** PostgREST returns an embedded to-one relation as an object when it can infer
 *  the foreign key, but as a single-element array when it cannot. Accept both. */
function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

/** Normalises raw Supabase rows into the `Trade` shape used across the UI. */
export function normalizeTrade(row: any): Trade {
  return {
    ...row,
    strategies: firstEmbed(row?.strategies),
    trading_accounts: firstEmbed(row?.trading_accounts),
    trade_tags: Array.isArray(row?.trade_tags) ? row.trade_tags : [],
    session: sessionBucket(row?.session, row?.entry_at),
  };
}

/** Bursa Malaysia trades in board lots of 100 shares. */
export const BURSA_BOARD_LOT = 100;

/**
 * Bursa Malaysia trades in two windows, so a trade is bucketed by the one it was opened in.
 * These are the only session options shared by the trade forms and the filter bar.
 */
export const SESSIONS = ["Morning", "Evening"];

/** Exchange hours behind each session, shown next to the option label. */
export const SESSION_WINDOWS: Record<string, string> = {
  Morning: "9:00–12:30",
  Evening: "14:30–17:00",
};

/** Morning runs until the 12:30 close; anything opened later is an evening trade. */
export const MORNING_CLOSE_MINUTES = 12 * 60 + 30;

/**
 * The journal is a Bursa Malaysia record, so the day, session and hour buckets a trade falls into
 * are read in Malaysia time rather than the viewer's clock: a trade opened at 09:05 stays a morning
 * trade after you fly to London. Malaysia has never used daylight saving, so the offset is a
 * constant and no timezone database is needed.
 */
export const MY_TIME_ZONE = "Asia/Kuala_Lumpur";
const MY_OFFSET_MS = 8 * 60 * 60 * 1000;

/** The Malaysia-time calendar fields of an instant, or null when the value is not a date. */
export function myParts(value: string | Date | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const shifted = new Date(date.getTime() + MY_OFFSET_MS);
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours,
    minutes,
    /** Minutes past midnight in Malaysia — what the session and hour buckets compare. */
    minutesOfDay: hours * 60 + minutes,
  };
}

/** The session a trade opened at `value` belongs to, by Malaysian local time. */
export function sessionForTime(value?: string | Date | null): string {
  const parts = myParts(value);
  if (!parts) return SESSIONS[0];
  return parts.minutesOfDay < MORNING_CLOSE_MINUTES ? "Morning" : "Evening";
}

/** Session plus its exchange hours, e.g. "Morning · 9:00–12:30". Non-sessions pass through. */
export function sessionLabel(session: string) {
  const window = SESSION_WINDOWS[session];
  return window ? `${session} · ${window}` : session;
}

/** Names used before sessions became the two Bursa windows. */
const SESSION_ALIASES: Record<string, string> = {
  "bursa morning": "Morning",
  morning: "Morning",
  "bursa afternoon": "Evening",
  afternoon: "Evening",
  evening: "Evening",
};

/**
 * The bucket a trade belongs to. A stored value is normalised when it names one of the windows
 * (so rows saved as "Bursa Morning" read as "Morning"); anything else — free-form values such as
 * "London" from the FX days, or nothing at all — falls back to the entry time.
 */
export function sessionBucket(session?: string | null, entryAt?: string | null): string {
  return SESSION_ALIASES[String(session ?? "").trim().toLowerCase()] ?? sessionForTime(entryAt);
}

/**
 * The clock hours Bursa Malaysia trades in: one run to the 12:30 close, then the afternoon from
 * 14:30. 13:00 is deliberately absent — the break is the gap in the axis, not a row of zeroes.
 */
export const BURSA_HOURS = [9, 10, 11, 12, 14, 15, 16];

/**
 * Hourly buckets for analysis. The last one is a home for anything entered outside the trading
 * windows — a fat-fingered entry time shows up there instead of being silently dropped.
 */
export const OUTSIDE_HOURS = "Outside";
export const HOUR_BUCKETS = [
  ...BURSA_HOURS.map(hour => `${String(hour).padStart(2, "0")}:00`),
  OUTSIDE_HOURS,
];

/** The clock hour a trade was opened in, by Malaysian local time. */
export function hourBucket(entryAt?: string | null) {
  const parts = myParts(entryAt);
  if (!parts) return OUTSIDE_HOURS;
  return BURSA_HOURS.includes(parts.hours) ? `${String(parts.hours).padStart(2, "0")}:00` : OUTSIDE_HOURS;
}

/** Which session an hour bucket sits in, or null for hours outside both windows. */
export function hourSession(hour: string): string | null {
  const match = /^(\d{2}):\d{2}$/.exec(hour);
  if (!match) return null;
  return Number(match[1]) * 60 < MORNING_CLOSE_MINUTES ? "Morning" : "Evening";
}

export function numberOrNull(value: unknown): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function calculateRisk(entry: unknown, stop: unknown, size: unknown, explicitRisk?: unknown) {
  const direct = numberOrNull(explicitRisk);
  if (direct !== null && direct > 0) return direct;
  const e = numberOrNull(entry);
  const sl = numberOrNull(stop);
  const s = numberOrNull(size);
  if (e === null || sl === null || s === null || s <= 0) return null;
  // Rounded to sen like gross P&L: the column stores two decimals, so keeping the float here only
  // makes the form disagree with what is saved (and with the R it derives from it).
  const risk = roundMoney(Math.abs(e - sl) * s);
  return risk > 0 ? risk : null;
}

/** Gross P&L before charges: (exit - entry) x quantity, inverted for shorts. */
export function calculateGrossPnl(
  entry: unknown,
  exit: unknown,
  quantity: unknown,
  direction: "long" | "short" = "long"
) {
  const e = numberOrNull(entry);
  const x = numberOrNull(exit);
  const q = numberOrNull(quantity);
  if (e === null || x === null || q === null || q <= 0) return null;
  const diff = direction === "short" ? e - x : x - e;
  return Number((diff * q).toFixed(2));
}

/** Round to sen, used when showing money derived from several numbers. */
export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateR(grossPnl: unknown, risk: unknown) {
  const pnl = numberOrNull(grossPnl) ?? 0;
  const r = numberOrNull(risk);
  return r && r > 0 ? pnl / r : null;
}

/** Currency is stored as a code but reads better as a symbol on screen. */
const CURRENCY_SYMBOLS: Record<string, string> = {
  MYR: "RM",
  SGD: "S$",
  USD: "US$",
  EUR: "€",
  GBP: "£",
  IDR: "Rp",
  AUD: "A$",
};

/** The journal trades Bursa Malaysia, so aggregated money falls back to the ringgit. */
export const DEFAULT_CURRENCY = "MYR";

/** "MYR" -> "RM", "SGD" -> "S$"; an unknown code passes through unchanged. */
export function currencySymbol(currency?: string | null) {
  const code = String(currency ?? DEFAULT_CURRENCY).trim().toUpperCase();
  return CURRENCY_SYMBOLS[code] ?? code;
}

/** 12345.6 -> "12,345.60" — grouped thousands, no currency. */
export function formatNumber(value: unknown, decimals = 2) {
  const n = numberOrNull(value);
  if (n === null) return "—";
  return n.toLocaleString("en-MY", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Money never wraps between the symbol and the figure, so a narrow table cell or calendar cell
 * cannot leave "RM" stranded on its own line. Callers that want them on separate lines (the
 * calendar) split on whitespace themselves.
 */
export const CURRENCY_GAP = "\u00A0";

/** Share prices keep their precision (up to four decimals) but still carry the currency. */
export function formatPrice(value: unknown, currency?: string | null) {
  const n = numberOrNull(value);
  if (n === null) return "—";
  return `${currencySymbol(currency)}${CURRENCY_GAP}${n.toLocaleString("en-MY", { maximumFractionDigits: 4 })}`;
}

/**
 * Money with the currency in front: 12345.6 -> "RM 12,345.60". The sign stays beside the figure
 * ("RM -882.54"), so every cell in a P&L column still lines up on its currency symbol. Pass
 * `signed` to show a leading "+" for gains.
 */
export function formatMoney(value: unknown, currency?: string | null, signed = false) {
  // Missing values read as "—" rather than "RM 0.00", so an empty field never looks like a zero.
  const n = numberOrNull(value);
  if (n === null) return "—";
  const sign = n < 0 ? "-" : signed && n > 0 ? "+" : "";
  return `${currencySymbol(currency)}${CURRENCY_GAP}${sign}${formatNumber(Math.abs(n))}`;
}

/** Compact date for table cells: "23 Jan 2025". */
export function shortDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: MY_TIME_ZONE });
}

/** Date and time for tables: "23 Jan 2025, 9:00 am". */
export function shortDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "—";
  return `${shortDate(value)}, ${d.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", timeZone: MY_TIME_ZONE })}`;
}

export function formatR(value: unknown) {
  // A trade with no stop loss has no R multiple — that is an absence, not a zero.
  const n = numberOrNull(value);
  return n === null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

/** A duration in milliseconds as "2d 3h" / "3h 12m" / "45m". */
export function formatDurationMs(ms?: number | null) {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return "—";
  const minutes = Math.floor(ms / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function formatDuration(entry?: string | null, exit?: string | null) {
  if (!entry || !exit) return "Open";
  const ms = new Date(exit).getTime() - new Date(entry).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return formatDurationMs(ms);
}

/**
 * The Malaysian calendar day of a timestamp as "YYYY-MM-DD" — the key a day's trades share. An
 * unreadable value returns "" so callers group it under nothing rather than under today.
 */
export function dayKey(value: string | Date) {
  const parts = myParts(value);
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

/** "+0.18%" / "-1.20%" — a positive figure carries its sign so columns align. */
export function formatPercent(value: unknown, decimals = 2) {
  const n = numberOrNull(value);
  if (n === null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(decimals)}%`;
}

/**
 * A return as a percentage of the capital behind it — the "% from capital" the calendar shows.
 * Null when there is no capital to measure against, so the caller can show "—" instead of a fake 0%.
 */
export function percentOf(pnl: unknown, capital: unknown) {
  const p = numberOrNull(pnl);
  const base = numberOrNull(capital);
  if (p === null || base === null || base <= 0) return null;
  return p / base * 100;
}

/**
 * Drops a column the database does not know about yet and returns the rest, so a trade still
 * saves on a database where the latest migration has not been applied. PostgREST names the
 * offending column, e.g. "Could not find the 'fee_breakdown' column of 'trades' in the schema cache".
 */
export function stripUnknownColumn(payload: Record<string, any>, message?: string | null) {
  const next = { ...payload };
  const named = String(message ?? "").match(/'([a-z_]+)' column/i);
  if (named && named[1] in next) delete next[named[1]];
  else { delete next.fee_breakdown; delete next.asset_class; }
  return next;
}

export function calculateStats(trades: Trade[]) {
  const pnl = trades.reduce((sum, t) => sum + Number(t.net_pnl || 0), 0);
  const wins = trades.filter(t => Number(t.net_pnl) > 0);
  const losses = trades.filter(t => Number(t.net_pnl) < 0);
  const grossProfit = wins.reduce((sum, t) => sum + Number(t.net_pnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + Number(t.net_pnl), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : null;
  // A trade with no stop loss has no R multiple. Counting those blanks as zeroes would drag the
  // average towards break-even, so the mean is taken over the trades that actually carry an R.
  const rValues = trades.map(t => numberOrNull(t.r_multiple)).filter((r): r is number => r !== null);
  const rSum = rValues.reduce((sum, r) => sum + r, 0);
  const avgR = rValues.length ? rSum / rValues.length : null;

  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  const ordered = [...trades].sort((a, b) => a.entry_at.localeCompare(b.entry_at));
  const equity = ordered.map((t, index) => {
    running += Number(t.net_pnl || 0);
    peak = Math.max(peak, running);
    const drawdown = running - peak;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, Math.abs(drawdown) / peak * 100);
    return { x: index + 1, date: shortDate(t.entry_at), pnl: Number(running.toFixed(2)), drawdown: Number(drawdown.toFixed(2)) };
  });

  return {
    pnl,
    wins: wins.length,
    losses: losses.length,
    breakeven: trades.length - wins.length - losses.length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    grossProfit,
    grossLoss,
    profitFactor,
    expectancyR: avgR,
    avgR,
    /** How many trades carry an R multiple — the denominator `avgR` was taken over. */
    rCount: rValues.length,
    rSum: roundMoney(rSum),
    maxDrawdown: Math.abs(maxDrawdown),
    maxDrawdownPct,
    equity,
  };
}

export type MetricSeries = {
  equity: number[];
  winRate: number[];
  profitFactor: number[];
  avgR: number[];
  grossProfit: number[];
  grossLoss: number[];
  drawdown: number[];
};

/**
 * The running value of each headline metric after every trade, oldest first — the shape behind the
 * dashboard's numbers. Every series holds one point per trade, so they can be drawn as sparklines.
 */
export function metricSeries(trades: Trade[]): MetricSeries {
  const out: MetricSeries = { equity: [], winRate: [], profitFactor: [], avgR: [], grossProfit: [], grossLoss: [], drawdown: [] };
  const ordered = [...trades].sort((a, b) => a.entry_at.localeCompare(b.entry_at));
  let pnl = 0, wins = 0, grossProfit = 0, grossLoss = 0, rSum = 0, rCount = 0, peak = 0;
  ordered.forEach((trade, index) => {
    const net = Number(trade.net_pnl || 0);
    pnl += net;
    const r = numberOrNull(trade.r_multiple);
    if (r !== null) { rSum += r; rCount += 1; }
    if (net > 0) { wins += 1; grossProfit += net; }
    else if (net < 0) grossLoss += net; // kept negative, like the Gross Loss card
    peak = Math.max(peak, pnl);
    out.equity.push(roundMoney(pnl));
    out.winRate.push(Number((wins / (index + 1) * 100).toFixed(2)));
    out.grossProfit.push(roundMoney(grossProfit));
    out.grossLoss.push(roundMoney(grossLoss));
    out.drawdown.push(roundMoney(pnl - peak));
    // Until a trade carries a stop loss there is no ratio to plot; the series holds 0 so every
    // sparkline still has one point per trade.
    out.avgR.push(rCount ? Number((rSum / rCount).toFixed(4)) : 0);
    // Before the first losing trade there is no ratio to compute, so the profit side tracks instead.
    out.profitFactor.push(Number((grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit).toFixed(4)));
  });
  return out;
}

/**
 * Every day that holds at least one trade, oldest first, with the numbers the calendar cells and
 * the day pop-up need. `equityBefore` is the realised P&L of all earlier days, so a caller that
 * knows the starting capital can turn it into a balance and a percentage.
 */
export type DaySummary = {
  key: string;
  trades: Trade[];
  count: number;
  pnl: number;
  gross: number;
  charges: number;
  wins: number;
  losses: number;
  symbols: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  winRate: number;
  expectancy: number;
  rSum: number;
  avgR: number | null;
  drawdown: number;
  best: Trade | null;
  worst: Trade | null;
  avgHoldMs: number | null;
  equityBefore: number;
};

export function dailySummaries(trades: Trade[]): DaySummary[] {
  const ordered = [...trades].sort((a, b) => a.entry_at.localeCompare(b.entry_at));
  const map = new Map<string, DaySummary & { peak: number; running: number; holdMs: number; held: number; rCount: number }>();
  let cumulative = 0;

  ordered.forEach(trade => {
    const key = dayKey(trade.entry_at);
    const net = roundMoney(Number(trade.net_pnl || 0));
    let day = map.get(key);
    if (!day) {
      day = {
        key, trades: [], count: 0, pnl: 0, gross: 0, charges: 0, wins: 0, losses: 0, symbols: 0,
        grossProfit: 0, grossLoss: 0, profitFactor: null, winRate: 0, expectancy: 0, rSum: 0, avgR: null,
        drawdown: 0, best: null, worst: null, avgHoldMs: null,
        // Everything earned before this day opened — the balance the day started from.
        equityBefore: cumulative, peak: 0, running: 0, holdMs: 0, held: 0, rCount: 0,
      };
      map.set(key, day);
    }

    day.trades.push(trade);
    day.count += 1;
    day.pnl = roundMoney(day.pnl + net);
    // Charges come from the stored legs, so a day's gross is always net + what the broker took.
    day.charges = roundMoney(day.charges + Number(trade.commission || 0) + Number(trade.swap || 0) + Number(trade.fees || 0));
    if (net > 0) { day.wins += 1; day.grossProfit = roundMoney(day.grossProfit + net); }
    else if (net < 0) { day.losses += 1; day.grossLoss = roundMoney(day.grossLoss + Math.abs(net)); }
    if (day.best === null || net > Number(day.best.net_pnl || 0)) day.best = trade;
    if (day.worst === null || net < Number(day.worst.net_pnl || 0)) day.worst = trade;
    const r = numberOrNull(trade.r_multiple);
    if (r !== null) { day.rSum += r; day.rCount += 1; }
    if (trade.exit_at) {
      const held = new Date(trade.exit_at).getTime() - new Date(trade.entry_at).getTime();
      if (Number.isFinite(held) && held >= 0) { day.holdMs += held; day.held += 1; }
    }
    day.running = roundMoney(day.running + net);
    day.peak = Math.max(day.peak, day.running);
    day.drawdown = Math.min(day.drawdown, roundMoney(day.running - day.peak));
    cumulative = roundMoney(cumulative + net);
  });

  return [...map.values()].map(({ peak, running, holdMs, held, rCount, ...day }) => ({
    ...day,
    symbols: new Set(day.trades.map(t => t.symbol)).size,
    gross: roundMoney(day.pnl + day.charges),
    winRate: day.count ? day.wins / day.count * 100 : 0,
    profitFactor: day.grossLoss > 0 ? day.grossProfit / day.grossLoss : null,
    expectancy: day.count ? day.pnl / day.count : 0,
    // The day's mean R is over its trades with a stop loss, not over all of them.
    avgR: rCount ? day.rSum / rCount : null,
    avgHoldMs: held ? holdMs / held : null,
  }));
}

/**
 * Buckets the analytics page groups by. Each list is also the order its chart draws in, so the
 * axis stays put between datasets instead of only showing the buckets that happen to have trades.
 */
export const HOLDING_BUCKETS = ["Intraday", "1–3 days", "4–7 days", "1–3 weeks", "Over 3 weeks", "Still open"];
export const LOTS_BUCKETS = ["Odd lot", "1–5 lots", "6–20 lots", "21–50 lots", "Over 50 lots", "Not recorded"];
export const QUALITY_BUCKETS = ["1–3 / 10", "4–6 / 10", "7–8 / 10", "9–10 / 10", "Not scored"];

/** How long a position was held, as the band the analytics chart groups by. */
export function holdingBucket(entryAt?: string | null, exitAt?: string | null) {
  if (!entryAt || !exitAt) return "Still open";
  const days = (new Date(exitAt).getTime() - new Date(entryAt).getTime()) / 86400000;
  if (!Number.isFinite(days) || days < 0) return "Still open";
  if (days < 1) return "Intraday";
  if (days <= 3) return "1–3 days";
  if (days <= 7) return "4–7 days";
  if (days <= 21) return "1–3 weeks";
  return "Over 3 weeks";
}

/** Position size in Bursa board lots of 100 shares. */
export function lotsBucket(shares: unknown) {
  const size = numberOrNull(shares);
  if (size === null || size <= 0) return "Not recorded";
  const lots = size / BURSA_BOARD_LOT;
  if (lots < 1) return "Odd lot";
  if (lots <= 5) return "1–5 lots";
  if (lots <= 20) return "6–20 lots";
  if (lots <= 50) return "21–50 lots";
  return "Over 50 lots";
}

/** The average of whichever 1–10 scores a trade carries, as a band. */
export function qualityBucket(trade: Pick<Trade, "setup_quality" | "execution_quality" | "discipline">) {
  const scores = [trade.setup_quality, trade.execution_quality, trade.discipline]
    .map(numberOrNull)
    .filter((v): v is number => v !== null);
  if (!scores.length) return "Not scored";
  const average = scores.reduce((sum, v) => sum + v, 0) / scores.length;
  if (average <= 3) return "1–3 / 10";
  if (average <= 6) return "4–6 / 10";
  if (average <= 8) return "7–8 / 10";
  return "9–10 / 10";
}

/* ================================================================== zakat */

/** The rate most Malaysian zakat bodies use on savings and business assets. */
export const ZAKAT_RATE_DEFAULT = 2.5;

/**
 * What the rate is applied to. `net` is the year's whole P&L (losses offset wins), `wins` counts
 * only the profitable trades, and `manual` is a figure typed in by hand.
 */
export type ZakatBasis = "net" | "wins" | "manual";
export const ZAKAT_BASES: { id: ZakatBasis; label: string; hint: string }[] = [
  { id: "net", label: "Year net P&L", hint: "Every trade Jan–Dec; a losing year floors at zero." },
  { id: "wins", label: "Winning trades only", hint: "Losses cannot reduce the base." },
  { id: "manual", label: "Manual base", hint: "Type the zakatable amount yourself." },
];

export type ZakatInput = {
  basis: ZakatBasis;
  rate?: number | string | null;
  otherIncome?: number | string | null;
  manualBase?: number | string | null;
  /** Wealth below the nisab is not zakatable. Blank means "no threshold". */
  nisab?: number | string | null;
};

/** Splits a year's trades into the figures the zakat page shows. */
export function zakatForYear(trades: Trade[], input: ZakatInput) {
  const net = trades.reduce((sum, t) => sum + Number(t.net_pnl || 0), 0);
  const wins = trades.reduce((sum, t) => sum + Math.max(Number(t.net_pnl || 0), 0), 0);
  const other = numberOrNull(input.otherIncome) ?? 0;
  const manual = numberOrNull(input.manualBase);
  // A losing year has no profit to purify, but other wealth still counts towards the base.
  const base = roundMoney(
    (input.basis === "manual" ? (manual ?? 0) : input.basis === "wins" ? wins : Math.max(net, 0)) + other
  );
  const rate = numberOrNull(input.rate) ?? ZAKAT_RATE_DEFAULT;
  const nisab = numberOrNull(input.nisab);
  const computed = roundMoney(Math.max(base, 0) * rate / 100);
  const belowNisab = nisab !== null && nisab > 0 && base < nisab;
  return { trades: trades.length, net: roundMoney(net), wins: roundMoney(wins), other: roundMoney(other), base, rate, nisab, computed, due: belowNisab ? 0 : computed, belowNisab };
}

/** The calendar year a trade was opened in, by Malaysian local time. */
export function tradeYear(entryAt?: string | null) {
  return myParts(entryAt)?.year ?? null;
}

/** Every year present in the journal, newest first. */
export function tradeYears(trades: Trade[]) {
  const years = new Set<number>();
  trades.forEach(t => { const y = tradeYear(t.entry_at); if (y) years.add(y); });
  years.add(myParts(new Date())!.year);
  return [...years].sort((a, b) => b - a);
}

export function bestStreak(trades: Trade[], winning: boolean) {
  let current = 0;
  let best = 0;
  [...trades].sort((a, b) => a.entry_at.localeCompare(b.entry_at)).forEach(t => {
    const isWin = Number(t.net_pnl) > 0;
    const isLoss = Number(t.net_pnl) < 0;
    const matches = winning ? isWin : isLoss;
    if (matches) {
      current += 1;
      best = Math.max(best, current);
    } else if (isWin || isLoss) current = 0;
  });
  return best;
}

/**
 * An instant as the "YYYY-MM-DDTHH:mm" wall clock a trade form edits, read in Malaysia time — so the
 * time you type and the time the journal shows mean the same thing wherever the app is opened.
 */
export function toLocalDatetimeInput(value?: string | null) {
  const parts = myParts(value);
  if (!parts) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hours)}:${pad(parts.minutes)}`;
}

/** The reverse: a Malaysian wall clock string, stored as the instant it names. */
export function localDatetimeToIso(value?: string | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value ?? "");
  if (!m) return null;
  // Malaysia is UTC+8 all year, so the wall clock minus eight hours is the instant it names.
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0) - 8, Number(m[5] ?? 0)));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
