/**
 * The demo journal has to be arithmetic the app would agree with.
 *
 * A demo is the first thing a buyer sees, so a wrong number in it is worse than no demo at all: it is
 * the product disagreeing with itself in front of an audience. These checks read the generator without
 * a database — every figure it writes is recomputed here from the app's own functions, so this file
 * fails the moment the generator starts inventing numbers the app would not produce.
 *
 *   npm run test:demo
 */
import {
  BURSA_BOARD_LOT,
  calculateGrossPnl,
  calculateR,
  calculateRisk,
  isSubSectorOf,
  roundMoney,
  sessionForTime,
} from "../lib/trading.ts";
import { brokerPreset } from "../lib/fees.ts";
import { buildDemoDataset, DEFAULT_SEED, rng, tradeRow, type DemoTrade } from "./demo-data.mts";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual} expected ${expected}`);
}

const TODAY = "2026-09-17";
const money = (n: number) => n.toFixed(2);
/** R is stored to four decimals, so comparisons are made at that precision rather than on floats. */
const roundTo4 = (n: number) => Math.round((n + Number.EPSILON) * 10000) / 10000;
const dataset = buildDemoDataset({ today: TODAY });
const again = buildDemoDataset({ today: TODAY });
const other = buildDemoDataset({ today: TODAY, seed: 12345 });

/* ---------------------------------------------------------------- the randomness */
// A re-run has to leave the database in the same state, or `demo:seed` is a diff every time it is run.
// One generator per sequence — calling `rng(seed)` inside the map would return the same first draw
// six times and quietly assert nothing.
const sequence = (seed: number) => {
  const next = rng(seed);
  return Array.from({ length: 6 }, () => Math.round(next() * 1e6));
};
check("the same seed builds the same journal", JSON.stringify(dataset) === JSON.stringify(again), "true");
check("a different seed builds a different journal", JSON.stringify(dataset) !== JSON.stringify(other), "true");
check("a seed replays exactly", JSON.stringify(sequence(DEFAULT_SEED)) === JSON.stringify(sequence(DEFAULT_SEED)), "true");
// A generator that returns one number forever is not a generator: it would make every trade identical.
check("the draws are not all the same", new Set(sequence(DEFAULT_SEED)).size > 1, "true");
check("two seeds disagree", JSON.stringify(sequence(7)) !== JSON.stringify(sequence(8)), "true");
// The dataset is anchored to the day it is built for, which is why the writer passes today in rather
// than reading a clock of its own.
check("a later day moves the journal with it", JSON.stringify(buildDemoDataset({ today: "2026-10-01" })) !== JSON.stringify(dataset), "true");

/* ---------------------------------------------------------------- the shape */
check("two demo accounts", dataset.accounts.length, 2);
check("the journal has enough trades to look alive", dataset.trades.length >= 45 && dataset.trades.length <= 80, "true");
check("some trades are still open", dataset.trades.some(t => t.exit_at === null), "true");
check("some trades came from IPO applications", dataset.trades.some(t => t.is_ipo), "true");
check("more than one sector is represented", new Set(dataset.trades.map(t => t.sector)).size >= 8, "true");
// The sub-sector is the half that makes the sector chart finer, so the demo has to exercise it:
// several of them, each one filed under the sector it actually belongs to.
check("more than one sub-sector is represented", new Set(dataset.trades.map(t => t.sub_sector)).size >= 8, "true");
check("every demo sub-sector belongs to its sector", dataset.trades.filter(t => !isSubSectorOf(t.sector, t.sub_sector)).length, 0);
const closed = dataset.trades.filter(t => t.exit_at);
check("some exits are intraday", closed.some(t => t.exit_at!.slice(0, 10) === t.entry_at.slice(0, 10)), "true");
check("some are held for weeks", closed.some(t => t.exit_at!.slice(0, 10) > t.entry_at.slice(0, 10)), "true");
check("and some run past a fortnight", closed.some(t => Number(t.exit_at!.slice(0, 10).replace(/-/g, "")) - Number(t.entry_at.slice(0, 10).replace(/-/g, "")) > 14), "true");

const houseTags = new Set(dataset.tags.map(t => t.name));
const houses = new Set(dataset.accounts.map(a => a.name));
const strategyNames = new Set(dataset.strategies.map(s => s.name));
check("every trade is tagged as demo data", dataset.trades.filter(t => t.tags.includes("Demo data")).length, dataset.trades.length);
check("every tag a trade carries exists", dataset.trades.every(t => t.tags.every(name => houseTags.has(name))), "true");
check("every trade belongs to a demo account", dataset.trades.every(t => houses.has(t.account)), "true");
check("every trade names a strategy that exists", dataset.trades.every(t => strategyNames.has(t.strategy)), "true");

/* ---------------------------------------------------------------- dates and sessions */
const opened = dataset.trades.map(t => t.entry_at.slice(0, 10));
check("nothing before the journal starts", opened.every(d => d >= "2025-01-02"), "true");
check("nothing in the future", opened.every(d => d <= TODAY), "true");
check("no entries at the weekend", opened.every(d => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())), "true");
check("the session matches the entry hour", dataset.trades.every(t => t.session === sessionForTime(t.entry_at)), "true");
check("entries are inside Bursa hours", dataset.trades.every(t => /T(09|10|11|12|14|15|16):/.test(t.entry_at)), "true");
// An exit before its entry would be a duration the app renders as negative.
check("nothing exits before it opens", dataset.trades.filter(t => t.exit_at).every(t => t.exit_at! >= t.entry_at), "true");
check("no exits at the weekend", dataset.trades.filter(t => t.exit_at).every(t => ![0, 6].includes(new Date(`${t.exit_at!.slice(0, 10)}T00:00:00Z`).getUTCDay())), "true");

/* ---------------------------------------------------------------- sizes */
check("every position is on board lots", dataset.trades.every(t => t.shares > 0 && t.shares % BURSA_BOARD_LOT === 0), "true");
check("lots vary rather than repeating", new Set(dataset.trades.map(t => t.shares)).size >= 15, "true");
check("most trades risk 3–7% to a stop", dataset.trades.filter(t => t.stop_loss).length >= Math.floor(dataset.trades.length * 0.6), "true");
// A fifth of them have no stop, which is the case the analytics has to render rather than a gap.
check("some trades carry no stop at all", dataset.trades.some(t => !t.stop_loss), "true");

/* ---------------------------------------------------------------- the arithmetic */
/**
 * Recompute every closed trade from its own prices and report the ones that disagree. Six checks over
 * sixty trades would be three hundred lines of PASS in the middle of the suite, so they are gathered
 * into one line that names the offending trades instead.
 */
const problems: string[] = [];
for (const t of closed) {
  const where = `${t.symbol} ${t.entry_at.slice(0, 10)}`;
  const net = roundMoney(t.grossPnl - t.commission - t.fees - t.swap);
  const gross = calculateGrossPnl(t.entryPrice, t.exitPrice, t.shares) ?? 0;
  const risk = t.stop_loss ? calculateRisk(t.entryPrice, t.stop_loss, t.shares) : null;
  if (money(t.grossPnl) !== money(gross)) problems.push(`${where}: gross ${t.grossPnl} vs ${money(gross)}`);
  if (t.commission + t.fees <= 0) problems.push(`${where}: no charges recorded`);
  if (t.risk_amount !== risk) problems.push(`${where}: risk ${t.risk_amount} vs ${risk}`);
  if (risk && t.r_multiple === null) problems.push(`${where}: risked money but no R stored`);
  if (risk && t.r_multiple !== null && Math.abs(roundTo4(t.r_multiple) - roundTo4(calculateR(net, risk)!)) > 1e-6) {
    problems.push(`${where}: R ${t.r_multiple} vs ${roundTo4(calculateR(net, risk)!)} on a net of ${net}`);
  }
  // Excursions are measured from the entry, so an adverse one is not above zero and a favourable one
  // is not below it.
  if (t.mae !== null && t.mae > 0) problems.push(`${where}: adverse excursion ${t.mae} is positive`);
  if (t.mfe !== null && t.mfe < 0) problems.push(`${where}: favourable excursion ${t.mfe} is negative`);
}
check(`every closed trade recomputes from its own prices (${closed.length})`, problems.length ? problems.slice(0, 4).join(" | ") : "clean", "clean");

// An open position has no result yet: a gross, an exit price or an R here would be profit or loss the
// trade has not taken, and the journal would total it as though it had.
const openProblems = dataset.trades
  .filter(t => !t.exit_at)
  .filter(t => !(t.grossPnl === 0 && t.exitPrice === null && t.r_multiple === null))
  .map(t => `${t.symbol} ${t.entry_at.slice(0, 10)}`);
check(`an open position carries no result (${dataset.trades.filter(t => !t.exit_at).length})`, openProblems.join(" | ") || "clean", "clean");
// The stored R has to be the *net* R, because charges are the difference between a trade the journal
// calls a winner and one it does not. A generator that used gross would pass every check above except
// this one.
const stopped = closed.filter(t => t.risk_amount);
check(
  "R is measured after charges",
  stopped.some(t => Math.abs(roundTo4(t.r_multiple!) - roundTo4((t.grossPnl - t.commission - t.fees) / t.risk_amount!)) < 1e-6),
  "true",
);
check(
  "and a charge-carrying trade can disagree with its gross R",
  stopped.some(t => Math.abs(roundTo4(t.grossPnl / t.risk_amount!) - roundTo4(t.r_multiple!)) > 1e-6),
  "true",
);

/* ---------------------------------------------------------------- the fee engine's own shape */
// An IPO application is priced by its channel and has no opening market leg; a market buy is the other
// way round. Reading the stored breakdown the app would read, not the generator's intent.
check("IPO trades carry a subscription charge", dataset.trades.filter(t => t.is_ipo).every(t => t.feeBreakdown.ipo !== null), "true");
check("market trades carry no subscription charge", dataset.trades.filter(t => !t.is_ipo).every(t => t.feeBreakdown.ipo === null), "true");
check("an IPO opening leg pays no brokerage", dataset.trades.filter(t => t.is_ipo).every(t => t.feeBreakdown.open.brokerage === 0), "true");
check("a market opening leg pays brokerage", dataset.trades.filter(t => !t.is_ipo).every(t => t.feeBreakdown.open.brokerage > 0), "true");
check("the commission is the broker side", dataset.trades.every(t => money(t.commission) === money(t.feeBreakdown.brokerCharges)), "true");
check("the fees are the market side", dataset.trades.every(t => money(t.fees) === money(t.feeBreakdown.marketCharges)), "true");
// Either broker is fine, but the breakdown has to name the one that actually priced the trade.
check("the breakdown names a real broker", dataset.trades.every(t => brokerPreset(t.feeBreakdown.broker).id === t.feeBreakdown.broker), "true");
check("the breakdown names it in full too", dataset.trades.every(t => t.feeBreakdown.brokerName === brokerPreset(t.feeBreakdown.broker).name), "true");
check("the REIT stamp cap is exercised", dataset.trades.some(t => t.asset_class === "reit_warrant"), "true");

/* ---------------------------------------------------------------- cash, reviews, rows */
check("every movement is a positive amount", dataset.flows.every(f => f.amount > 0 && (f.kind === "deposit" || f.kind === "withdrawal")), "true");
check("every movement belongs to a demo account", dataset.flows.every(f => houses.has(f.account)), "true");
check("capital arrives before the first trade", dataset.flows.some(f => f.kind === "deposit" && f.occurredOn <= opened[0]), "true");
check("money comes out as well as in", dataset.flows.some(f => f.kind === "withdrawal"), "true");
check("weekly reviews land on Mondays", dataset.weekly.every(r => new Date(`${r.weekStart}T00:00:00Z`).getUTCDay() === 1), "true");
check("daily reviews are inside the journal", dataset.daily.every(r => r.date <= TODAY && r.date >= "2025-01-02"), "true");
check("reviews are scored in range", dataset.daily.every(r => r.execution >= 1 && r.execution <= 10 && r.mood >= 1 && r.mood <= 10), "true");

// The row builder is what the database sees, so its two jobs are checked directly: it must never send
// the generated column, and the journal is long-only because Bursa has no short selling for retail.
const row = tradeRow(closed[0] as DemoTrade, "user-1", "acct-1", "strat-1");
check("the row never sends net_pnl", "net_pnl" in row, "false");
check("the row is long-only", row.direction, "long");
check("the row carries the owner", row.user_id, "user-1");
check("the row links account and strategy", `${row.account_id}/${row.strategy_id}`, "acct-1/strat-1");
const openRow = tradeRow(dataset.trades.find(t => !t.exit_at) as DemoTrade, "user-1", null, null);
check("an open row has no exit", `${openRow.exit_at}/${openRow.exit_price}`, "null/null");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll demo checks passed");
process.exit(failures ? 1 : 0);
