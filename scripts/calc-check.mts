/**
 * The numbers the journal reports: P&L, R, sessions, day buckets, drawdown and zakat.
 *
 * These are the figures you make decisions from, and they are easy to break invisibly — a change to
 * an averaging denominator still renders a plausible-looking number. Every expected value below is
 * worked out by hand in the comment above it, so a failure names the rule that changed.
 *
 *   npm run test:calc
 */
import { readFileSync } from "node:fs";
import {
  bestStreak,
  calculateGrossPnl,
  calculateR,
  calculateRisk,
  calculateStats,
  dailySummaries,
  dayKey,
  formatMoney,
  formatPercent,
  formatR,
  holdingBucket,
  hourBucket,
  inDayRange,
  localDatetimeToIso,
  lotsBucket,
  metricSeries,
  percentOf,
  qualityBucket,
  monthBounds,
  monthKey,
  monthLabel,
  sectorOf,
  sessionForTime,
  SECTOR_UNSET,
  shiftMonth,
  toLocalDatetimeInput,
  tradeYear,
  zakatForYear,
  type Trade,
} from "../lib/trading.ts";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual} expected ${expected}`);
}

/** A trade with sensible defaults, so each case only states what it is about. */
function trade(over: Partial<Trade>): Trade {
  return {
    id: over.id ?? "t",
    symbol: over.symbol ?? "TEST",
    direction: over.direction ?? "long",
    entry_at: over.entry_at ?? "2026-09-16T01:00:00Z", // 09:00 in Malaysia
    ...over,
  } as Trade;
}

/* ---------------------------------------------------------------- gross P&L */
// Bursa long: 2,000 shares bought at 0.35 and sold at 0.40 → 0.05 × 2,000 = RM100.
check("long gross P&L", calculateGrossPnl(0.35, 0.4, 2000), 100);
// A short gains when the exit is lower: 1.20 → 1.10 on 1,000 shares = RM100.
check("short gross P&L", calculateGrossPnl(1.2, 1.1, 1000, "short"), 100);
check("short loss is negative", calculateGrossPnl(1.2, 1.3, 1000, "short"), -100);
// Fractional prices: 0.345 - 0.335 is 0.009999… in binary, so this pins the rounding to sen.
check("fractional prices round to sen", calculateGrossPnl(0.335, 0.345, 100), 1);
check("a zero quantity has no P&L", calculateGrossPnl(0.35, 0.4, 0), "null");
check("a missing price has no P&L", calculateGrossPnl(0.35, null, 100), "null");

/* --------------------------------------------------------------- risk and R */
// Risk is |entry - stop| × size: |0.35 - 0.30| × 2,000 = RM100, so +RM250 is 2.5R.
const risk = calculateRisk(0.35, 0.3, 2000);
check("risk from entry, stop and size", risk, 100);
check("R from a gain and its risk", calculateR(250, risk), 2.5);
check("an explicit risk wins", calculateRisk(0.35, 0.3, 2000, 150), 150);
// No stop loss means no denominator, so there is no R — that is an absence, not a zero.
check("no risk means no R", calculateR(250, null), "null");
check("zero risk means no R", calculateR(250, 0), "null");

/* ------------------------------------------------------------------ average R */
// +2R, -1R, and two trades with no stop at all. The mean over the trades that have a stop is
// (2 - 1) / 2 = 0.5R. Counting the blanks as zeroes would report 0.25R instead.
const mixed = [
  trade({ id: "a", entry_at: "2026-09-16T01:00:00Z", net_pnl: 200, r_multiple: 2 }),
  trade({ id: "b", entry_at: "2026-09-16T02:00:00Z", net_pnl: -100, r_multiple: -1 }),
  trade({ id: "c", entry_at: "2026-09-16T03:00:00Z", net_pnl: 50, r_multiple: null }),
  trade({ id: "d", entry_at: "2026-09-16T04:00:00Z", net_pnl: -50, r_multiple: null }),
];
const stats = calculateStats(mixed);
check("average R ignores trades without a stop", stats.avgR, 0.5);
check("expectancy is the same figure", stats.expectancyR, 0.5);
check("how many trades carry an R", stats.rCount, 2);
check("net P&L", stats.pnl, 100);
check("win rate", stats.winRate, 50);
check("profit factor is 250 / 150", Number(stats.profitFactor?.toFixed(4)), 1.6667);
// +100, +100 -150 +50… see the drawdown case below for the same sequence in full.
check("no R anywhere means no average", calculateStats([trade({ net_pnl: 10 })]).avgR, "null");

// The sparkline series advances only on trades that have an R, and holds its last value otherwise,
// so every series still has one point per trade.
const series = metricSeries(mixed);
check("series holds a point per trade", series.avgR.length, 4);
check("series after the second trade", series.avgR[1], 0.5);
check("series carries through an R-less trade", series.avgR[2], 0.5);

/* ------------------------------------------------------------------- drawdown */
// Running P&L: 100, 200, 50, 100. The peak is 200, so the worst fall is 150 — 75% of that peak.
const drawTrades = [
  trade({ id: "1", entry_at: "2026-01-05T01:00:00Z", net_pnl: 100 }),
  trade({ id: "2", entry_at: "2026-01-06T01:00:00Z", net_pnl: 100 }),
  trade({ id: "3", entry_at: "2026-01-07T01:00:00Z", net_pnl: -150 }),
  trade({ id: "4", entry_at: "2026-01-08T01:00:00Z", net_pnl: 50 }),
];
const draw = calculateStats(drawTrades);
check("max drawdown", draw.maxDrawdown, 150);
check("max drawdown as a share of the peak", draw.maxDrawdownPct, 75);
check("equity curve follows cumulative P&L", draw.equity.map(p => p.pnl).join(","), "100,200,50,100");

/* --------------------------------------------------------------------- streaks */
// +, +, -, + is two wins in a row — but only inside a run. mixed is +, -, +, -, so no run at all:
// the longest winning streak is one, and a streak resets on a loss.
check("best winning streak", bestStreak(drawTrades, true), 2);
check("no two wins in a row", bestStreak(mixed, true), 1);
check("best losing streak", bestStreak(mixed, false), 1);

/* ------------------------------------------------------- Malaysia time buckets */
// 17:00 UTC is 01:00 the next morning in Malaysia — the journal must file it under the 16th, not
// the 15th, whatever clock the machine reading it is on.
check("day key uses Malaysia time", dayKey("2026-09-15T17:00:00Z"), "2026-09-16");
check("08:30 in Malaysia is the same day", dayKey("2026-09-16T00:30:00Z"), "2026-09-16");
check("a new year starts in Malaysia", tradeYear("2025-12-31T16:30:00Z"), 2026);
check("unreadable timestamp has no day", dayKey("not a date"), "");

// Morning runs to the 12:30 close: 12:29 is a morning trade, 12:30 is not.
check("09:05 is a morning trade", sessionForTime("2026-09-16T01:05:00Z"), "Morning");
check("12:29 is a morning trade", sessionForTime("2026-09-16T04:29:00Z"), "Morning");
check("12:30 is an evening trade", sessionForTime("2026-09-16T04:30:00Z"), "Evening");
check("14:30 is an evening trade", sessionForTime("2026-09-16T06:30:00Z"), "Evening");
check("a missing time falls back to the morning", sessionForTime(null), "Morning");

// Hour buckets are the windows Bursa actually trades, with the lunch break left empty.
check("10:00 bucket", hourBucket("2026-09-16T02:00:00Z"), "10:00");
check("12:00 bucket", hourBucket("2026-09-16T04:00:00Z"), "12:00");
check("13:00 is the break", hourBucket("2026-09-16T05:00:00Z"), "Outside");
check("14:00 bucket", hourBucket("2026-09-16T06:00:00Z"), "14:00");
check("17:00 is after the close", hourBucket("2026-09-16T09:00:00Z"), "Outside");

// A form edits Malaysian wall clock, so 09:05 in and 09:05 out, whichever zone the browser is in.
check("wall clock to instant", localDatetimeToIso("2026-09-16T09:05"), "2026-09-16T01:05:00.000Z");
check("instant back to wall clock", toLocalDatetimeInput("2026-09-16T01:05:00Z"), "2026-09-16T09:05");

/* ---------------------------------------------------------------- day summaries */
// Two days: the first holds the two trades with stops, the second the two without them.
const days = dailySummaries([
  trade({ id: "a", entry_at: "2026-09-16T01:00:00Z", exit_at: "2026-09-16T05:00:00Z", net_pnl: 200, r_multiple: 2, commission: 10 }),
  trade({ id: "b", entry_at: "2026-09-16T02:00:00Z", exit_at: "2026-09-16T06:00:00Z", net_pnl: -100, r_multiple: -1 }),
  trade({ id: "c", entry_at: "2026-09-17T01:00:00Z", exit_at: "2026-09-17T05:00:00Z", net_pnl: 50 }),
  trade({ id: "d", entry_at: "2026-09-17T02:00:00Z", exit_at: "2026-09-17T06:00:00Z", net_pnl: -50 }),
]);
check("one summary per day", days.length, 2);
check("first day key", days[0].key, "2026-09-16");
check("first day P&L", days[0].pnl, 100);
check("first day average R", days[0].avgR, 0.5);
check("second day has no R at all", days[1].avgR, "null");
// The second day opened with the first day's result already banked.
check("second day starts from the first day's close", days[1].equityBefore, 100);
check("a day's charges come from the stored legs", days[0].charges, 10);
check("a day's gross is net plus charges", days[0].gross, 110);

/* -------------------------------------- the cached projection behind the calculators */
// `dailySummaries` and the stats read fields off the trades the shared cache hands them, and that
// projection is a hand-kept list (`TRADE_LIST_COLUMNS` in lib/queries.ts). A trim can drop a field the
// calculators still read without failing anything that runs here — the calendar then reports every
// day as free rather than erroring — so the list is read out of the source and checked against the
// fields those functions actually need.
const dataSource = readFileSync(new URL("../lib/queries.ts", import.meta.url), "utf8");
const columnsStart = dataSource.indexOf("export const TRADE_LIST_COLUMNS = [");
const columnsEnd = dataSource.indexOf('].join(",")', columnsStart);
check("the projection list was found in lib/queries.ts", columnsStart >= 0 && columnsEnd > columnsStart, "true");
const projected = new Set(
  [...dataSource.slice(columnsStart, columnsEnd).matchAll(/"([a-z_]+)"/g)].map(m => m[1]),
);
for (const column of [
  // calculateStats and metricSeries
  "id", "symbol", "entry_at", "exit_at", "net_pnl", "r_multiple", "position_size",
  // qualityBucket and lotsBucket, and the pages' own grouping and tables
  "setup_quality", "execution_quality", "discipline", "session", "is_ipo", "account_id", "strategy_id",
  // dailySummaries: a day's gross is its net plus the stored legs, so a missing one reads as no fees
  "commission", "swap", "fees",
]) {
  check(`the cached projection carries ${column}`, projected.has(column), "true");
}
// `sector` is prepended by the retry wrapper rather than named in the list itself.
check("the cached projection carries sector", dataSource.includes("`sector,${TRADE_LIST_COLUMNS}"), "true");

/* ----------------------------------------------------------------- bucket helpers */
check("intraday hold", holdingBucket("2026-09-16T01:00:00Z", "2026-09-16T05:00:00Z"), "Intraday");
check("two-day hold", holdingBucket("2026-09-16T01:00:00Z", "2026-09-18T01:00:00Z"), "1–3 days");
check("an open trade has no holding band", holdingBucket("2026-09-16T01:00:00Z", null), "Still open");
check("an odd lot", lotsBucket(50), "Odd lot");
check("one to five board lots", lotsBucket(100), "1–5 lots");
check("six to twenty board lots", lotsBucket(600), "6–20 lots");
check("over fifty board lots", lotsBucket(6000), "Over 50 lots");
check("no size recorded", lotsBucket(null), "Not recorded");
check("an unscored trade", qualityBucket({ setup_quality: null, execution_quality: null, discipline: null }), "Not scored");
check("scores average to a band", qualityBucket({ setup_quality: 9, execution_quality: 8, discipline: 10 }), "9–10 / 10");

/* ---------------------------------------------------------------------- zakat */
// +1,000 and -200 in one year: the net basis is 800, so 2.5% is 20.
const year = [trade({ id: "1", entry_at: "2026-03-02T01:00:00Z", net_pnl: 1000 }), trade({ id: "2", entry_at: "2026-04-02T01:00:00Z", net_pnl: -200 })];
check("net basis zakatable base", zakatForYear(year, { basis: "net" }).base, 800);
check("net basis zakat", zakatForYear(year, { basis: "net" }).computed, 20);
// Losses cannot reduce a wins-only base: 1,000 → 25. A manual base is taken as typed: 10,000 → 250.
check("wins-only basis ignores losses", zakatForYear(year, { basis: "wins" }).computed, 25);
check("manual basis", zakatForYear(year, { basis: "manual", manualBase: 10000 }).computed, 250);
check("other wealth adds to the base", zakatForYear(year, { basis: "net", otherIncome: 200 }).computed, 25);
check("a custom rate", zakatForYear(year, { basis: "net", rate: 1 }).computed, 8);
// Below the nisab nothing is due, and the page says so rather than showing a small number.
const nisab = zakatForYear(year, { basis: "net", nisab: 5000 });
check("below the nisab nothing is due", nisab.due, 0);
check("and the page is told why", nisab.belowNisab, true);
check("a losing year floors at zero", zakatForYear([trade({ net_pnl: -500 })], { basis: "net" }).computed, 0);

/* ------------------------------------------------------------- months and sectors */
// The sector sentiment strip is a grid of months, so a month key that lands in the wrong month — or
// a window that walks past a year boundary — draws a plausible but wrong picture.
// 2026-08-31 16:30 UTC is 00:30 on 1 September in Malaysia: the trade belongs to September, which is
// the same rule `dayKey` follows.
check("a month is read in Malaysia, not UTC", monthKey("2026-08-31T16:30:00Z"), "2026-09");
check("the last minute of a Malaysian month", monthKey("2026-08-31T15:59:00Z"), "2026-08");
check("stepping back over a year boundary", shiftMonth("2026-01", -1), "2025-12");
check("stepping forward over a year boundary", shiftMonth("2025-12", 1), "2026-01");
check("stepping back a full year", shiftMonth("2026-09", -12), "2025-09");
check("a month heading", monthLabel("2026-09"), "Sept 2026");
// The month's own last day, which is what a click on a cell hands the date filter: February in a
// leap year is 29, and the short months are not all 30.
check("february in a leap year", monthBounds("2024-02").to, "2024-02-29");
check("february in a common year", monthBounds("2025-02").to, "2025-02-28");
check("a 30-day month", monthBounds("2026-09").to, "2026-09-30");
check("a 31-day month", monthBounds("2026-12").to, "2026-12-31");
check("the first of a month", monthBounds("2026-09").from, "2026-09-01");
// A trade with no sector is "Not set", never blank: it is a line in the table, not a missing row.
/* ------------------------------------------------------------ the date-range filter */
// A range arrives as two Malaysian calendar days (the calendar's own day keys), and the trade is
// bucketed by its Malaysian day too. Comparing instants instead would file a trade after Malaysian
// midnight under the previous day for anyone reading the journal from another timezone —
// 2026-09-15T17:00:00Z is 01:00 on the 16th in Kuala Lumpur, the same rule `dayKey` follows.
const edge = "2026-09-15T17:00:00Z";
check("a trade after Malaysian midnight is that day", inDayRange(edge, "2026-09-16", "2026-09-16"), true);
check("and not the day before", inDayRange(edge, "2026-09-15", "2026-09-15"), false);
check("a day inside a month's range", inDayRange(edge, "2026-09-01", "2026-09-30"), true);
check("a range that ends before the trade", inDayRange(edge, "2026-09-01", "2026-09-15"), false);
check("an unbounded range keeps everything", inDayRange(edge, "", ""), true);
check("an open start", inDayRange(edge, "", "2026-09-16"), true);
check("an open end", inDayRange(edge, "2026-09-16", ""), true);
check("no date is outside any range", inDayRange("not a date", "2026-09-01", "2026-09-30"), false);

check("no sector reads as not set", sectorOf({ sector: null }), SECTOR_UNSET);
check("a blank sector reads as not set", sectorOf({ sector: "   " }), SECTOR_UNSET);
check("a sector is kept as written", sectorOf({ sector: "Technology" }), "Technology");

/* ------------------------------------------------------------------ formatting */
// An absence must never render as a zero: a blank field is not a break-even trade.
check("an empty amount is a dash", formatMoney(null, "MYR"), "—");
check("an empty R is a dash", formatR(null), "—");
check("an empty percentage is a dash", formatPercent(null), "—");
check("a gain carries its sign", formatR(1.25), "+1.25R");
check("a loss keeps its sign", formatR(-0.5), "-0.50R");
check("a return on capital", percentOf(100, 10000), 1);
check("no capital means no percentage", percentOf(100, 0), "null");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll calculation checks passed");
process.exit(failures ? 1 : 0);
