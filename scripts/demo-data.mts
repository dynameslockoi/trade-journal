/**
 * A demo journal, generated.
 *
 * The app is sold as a working journal, so somebody has to be able to sign in and see one. This writes
 * a realistic Bursa dataset — two accounts, cash movements, strategies, tags, reviews and roughly sixty
 * trades across the last twenty months — into an account of its own, and takes it away again.
 *
 *   npm run demo:seed     write the dataset (clears first, so a re-run is idempotent)
 *   npm run demo:clear    remove everything this script could have written
 *
 * It signs in with the demo account's own email and password and writes through the anon key, so it is
 * bound by the same row-level policies as the app: it cannot touch another account's journal even by
 * mistake, and it needs no service-role key. That also makes it a live check of those policies — if a
 * policy ever loosens or breaks, this is the script that stops working first. As a second guard it
 * refuses to run against an administrator, so pointing it at the owner's own credentials is an error
 * rather than a deletion.
 *
 * Every figure comes from the app's own functions (`calculateGrossPnl`, `calculateRisk`, the broker fee
 * engine), never from a hand-written number, so the demo cannot show arithmetic the app would not
 * produce. The dataset is random but *seeded*: the same seed and the same day give the same journal,
 * which is what makes a re-run idempotent and a bug reproducible.
 *
 * Credentials come from the environment, never from this file:
 *
 *   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY   (the app's own, from .env)
 *   DEMO_EMAIL        defaults to demo@gmail.com
 *   DEMO_PASSWORD     required
 */

import { createClient } from "@supabase/supabase-js";
import {
  BURSA_BOARD_LOT,
  calculateGrossPnl,
  calculateR,
  calculateRisk,
  dayKey,
  roundMoney,
  sessionForTime,
} from "../lib/trading.ts";
import { brokerPreset, roundTripFees, type AssetClass, type IpoChannelId, type IpoInputs } from "../lib/fees.ts";

/* ================================================================ the pool of stocks */

type Stock = {
  symbol: string;
  sector: string;
  /** The sub-sector inside `sector`; must be one of `SUB_SECTORS[sector]` — demo-check asserts it. */
  sub: string;
  price: number;
  assetClass?: AssetClass;
  /** Only meaningful on the IPO list: the channel the application was made through. */
  ipoChannel?: IpoChannelId;
};

/**
 * Real Bursa names with a plausible price and their own classification, spread across the sectors the
 * journal knows about, so the sector panels, the sub-sector breakdown, the sentiment grid and the
 * filters all have something real to show. The price is only a starting point — the generator drifts
 * each one across the twenty months it writes.
 */
const STOCKS: Stock[] = [
  { symbol: "MAYBANK", sector: "Financial Services", sub: "Banking", price: 10.2 },
  { symbol: "CIMB", sector: "Financial Services", sub: "Banking", price: 7.6 },
  { symbol: "PBBANK", sector: "Financial Services", sub: "Banking", price: 4.35 },
  { symbol: "TENAGA", sector: "Utilities", sub: "Electricity", price: 13.9 },
  { symbol: "SUNMED", sector: "Health Care", sub: "Health Care Providers", price: 1.85 },
  { symbol: "IHH", sector: "Health Care", sub: "Health Care Providers", price: 6.9 },
  { symbol: "GAMUDA", sector: "Construction", sub: "Construction", price: 5.4 },
  { symbol: "IJM", sector: "Construction", sub: "Construction", price: 3.1 },
  { symbol: "SPSETIA", sector: "Property", sub: "Property", price: 1.2 },
  { symbol: "MAHSING", sector: "Property", sub: "Property", price: 1.05 },
  { symbol: "MAHB", sector: "Transportation & Logistics", sub: "Transportation & Logistics Services", price: 10.9 },
  { symbol: "WPRTS", sector: "Transportation & Logistics", sub: "Transportation & Logistics Services", price: 4.2 },
  { symbol: "INARI", sector: "Technology", sub: "Semiconductors", price: 2.6 },
  { symbol: "FRONTKN", sector: "Technology", sub: "Semiconductors", price: 3.3 },
  { symbol: "TM", sector: "Telecommunications & Media", sub: "Telecommunications Service Providers", price: 6.4 },
  { symbol: "AXIATA", sector: "Telecommunications & Media", sub: "Telecommunications Service Providers", price: 2.7 },
  { symbol: "IOICORP", sector: "Plantation", sub: "Plantation", price: 3.85 },
  { symbol: "KLK", sector: "Plantation", sub: "Plantation", price: 21.0 },
  { symbol: "PETDAG", sector: "Energy", sub: "Oil & Gas Producers", price: 22.0 },
  { symbol: "DIALOG", sector: "Energy", sub: "Energy Infrastructure, Equipment & Services", price: 2.1 },
  { symbol: "PMETAL", sector: "Industrial Products & Services", sub: "Metals", price: 5.6 },
  { symbol: "CMSB", sector: "Industrial Products & Services", sub: "Building Materials", price: 1.3 },
  { symbol: "F&N", sector: "Consumer Products & Services", sub: "Food & Beverages", price: 30.0 },
  { symbol: "QL", sector: "Consumer Products & Services", sub: "Agricultural Products", price: 4.7 },
  // REITs pay a different stamp-duty cap, so having two in the journal exercises that branch of the
  // fee engine rather than leaving it untested on every page that shows charges.
  { symbol: "SUNREIT", sector: "Real Estate Investment Trusts", sub: "Real Estate Investment Trusts", price: 1.9, assetClass: "reit_warrant" },
  { symbol: "AXREIT", sector: "Real Estate Investment Trusts", sub: "Real Estate Investment Trusts", price: 1.75, assetClass: "reit_warrant" },
];

/** Applications rather than market buys — priced by the channel, not by the brokerage schedule. */
const IPO_STOCKS: Stock[] = [
  { symbol: "GTA", sector: "Industrial Products & Services", sub: "Industrial Services", price: 0.62, ipoChannel: "mplus" },
  { symbol: "OGX", sector: "Consumer Products & Services", sub: "Consumer Services", price: 0.4, ipoChannel: "mplus" },
  { symbol: "BETA", sector: "Technology", sub: "Software", price: 0.55, ipoChannel: "moomoo" },
  { symbol: "KEEMING", sector: "Industrial Products & Services", sub: "Industrial Engineering", price: 0.35, ipoChannel: "mplus" },
  { symbol: "AMBEST", sector: "Technology", sub: "Technology Equipment", price: 0.48, ipoChannel: "moomoo" },
  { symbol: "ISF", sector: "Property", sub: "Property", price: 0.28, ipoChannel: "mplus" },
  { symbol: "OGM", sector: "Energy", sub: "Oil & Gas Producers", price: 0.5, ipoChannel: "mplus" },
];

/** The form's own vocabulary, so a demo trade cannot carry a mistake or a mood the app would not offer. */
const EMOTIONS = ["Calm", "Confident", "Uncertain", "Fearful", "FOMO", "Greedy", "Revenge"];
const MISTAKES = ["FOMO", "Early entry", "Late exit", "Oversized", "Moved SL", "Overtrading", "Ignored plan"];

const NOTES = [
  "Broke out of a three-week base on above-average volume.",
  "Sector was leading the index; waited for the pullback rather than chasing.",
  "News catalyst in the morning, sold into the afternoon strength.",
  "Bought the retest of the breakout level, stop under the day's low.",
  "Thin volume all day — should have passed on this one.",
  "Government contract announcement; followed the sector rather than the stock.",
  "Averaged up after it held the 20-day. Size got away from me.",
  "Exited early because the market turned, and the stock carried on without me.",
];

/* ================================================================ deterministic randomness */

/**
 * The whole dataset hangs off one seed. `Math.random` would give a nicer-looking one-off and a
 * different journal on every re-run, which makes a re-run a diff, breaks a bug report, and means
 * `demo:seed` cannot be trusted to leave the database in a known state.
 */
export function rng(seed: number) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEFAULT_SEED = 20260917;

/* ================================================================ the shape of a demo journal */

export type DemoAccount = { name: string; broker: string; currency: string; opening: number };

export type DemoTrade = {
  /** Which demo account it belongs to, by name — ids do not exist until the writer inserts the rows. */
  account: string;
  strategy: string;
  symbol: string;
  sector: string;
  sub_sector: string;
  asset_class: AssetClass;
  session: string;
  entry_at: string;
  exit_at: string | null;
  entryPrice: number;
  exitPrice: number | null;
  shares: number;
  stop_loss: number | null;
  take_profit: number | null;
  grossPnl: number;
  /** Brokerage, platform, SST and any IPO subscription — `trades.commission`. */
  commission: number;
  /** Clearing and stamp duty — `trades.fees`. */
  fees: number;
  swap: number;
  risk_amount: number | null;
  r_multiple: number | null;
  feeBreakdown: ReturnType<typeof roundTripFees> & { broker: string; brokerName: string };
  is_ipo: boolean;
  emotion: string;
  mistake: string;
  setup_quality: number;
  execution_quality: number;
  discipline: number;
  mae: number | null;
  mfe: number | null;
  notes: string | null;
  /** Names, resolved to ids by the writer. */
  tags: string[];
};

export type DemoFlow = { account: string; kind: "deposit" | "withdrawal"; amount: number; occurredOn: string; note: string };
export type DemoDailyReview = { date: string; planFollowed: boolean; execution: number; mood: number; wentWell: string; mistakes: string; tomorrow: string };
export type DemoWeeklyReview = { weekStart: string; summary: string; lessons: string; plan: string };

export type DemoDataset = {
  accounts: DemoAccount[];
  strategies: { name: string; description: string; rules: string }[];
  tags: { name: string; category: string }[];
  flows: DemoFlow[];
  trades: DemoTrade[];
  daily: DemoDailyReview[];
  weekly: DemoWeeklyReview[];
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** Midnight UTC, so all the day arithmetic below is on whole days whatever the machine's timezone. */
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
const to2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const mostRecentMonday = (d: Date) => addDays(d, -((d.getUTCDay() + 6) % 7));

/** "2025-03-14T09:12:00+08:00" — Malaysian wall clock, which is what the journal stores and shows. */
function stamp(d: Date, minutes: number) {
  return `${isoDay(d)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00+08:00`;
}

/**
 * Build the whole journal. Pure and synchronous: no clock of its own beyond the `today` handed in, no
 * database and no network — so `demo-check.mts` can assert on it without a session.
 */
export function buildDemoDataset(options: { today: string; seed?: number }): DemoDataset {
  const next = rng(options.seed ?? DEFAULT_SEED);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length) % list.length];
  const between = (lo: number, hi: number) => lo + next() * (hi - lo);
  const whole = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));

  const today = new Date(`${options.today}T00:00:00Z`);
  const firstDay = day(2025, 1, 2);

  const accounts: DemoAccount[] = [
    { name: "M+ Global · Demo", broker: "mplus", currency: "MYR", opening: 40000 },
    { name: "Moomoo · Demo", broker: "moomoo_my", currency: "MYR", opening: 15000 },
  ];

  const strategies = [
    { name: "Breakout continuation", description: "Buy a break of a multi-week base with volume.", rules: "Base of at least three weeks. Volume above the 20-day average. Stop under the base low." },
    { name: "Pullback to support", description: "Buy the first retest after a breakout.", rules: "Wait for the retest, never the breakout. Stop under the retest low. Half size if the sector is weak." },
    { name: "Sector rotation", description: "Trade the leading sector rather than the cheapest name in it.", rules: "Sector in the top three by one-month return. Buy the strongest name only." },
    { name: "IPO allocation flip", description: "Sell an IPO allocation into the first days of trading.", rules: "Cash application only. Scale out across the first three sessions." },
    { name: "Earnings drift", description: "Hold the post-results drift.", rules: "Enter above the results-day high. Exit on a close below the 20-day." },
  ];

  // One tag goes on every trade, so a row that somehow outlives `demo:clear` is still identifiable.
  const tags = [
    { name: "Demo data", category: "Demo" },
    { name: "Sector leader", category: "Setup" },
    { name: "News catalyst", category: "Context" },
    { name: "Full position", category: "Size" },
    { name: "Half position", category: "Size" },
    { name: "Averaged up", category: "Size" },
    { name: "Waited for retest", category: "Setup" },
    { name: "Held overnight", category: "Context" },
  ];

  const flows: DemoFlow[] = [
    { account: accounts[0].name, kind: "deposit", amount: 40000, occurredOn: isoDay(firstDay), note: "Opening deposit" },
    { account: accounts[0].name, kind: "deposit", amount: 10000, occurredOn: "2025-06-02", note: "Top-up after a good quarter" },
    { account: accounts[0].name, kind: "withdrawal", amount: 6000, occurredOn: "2026-01-08", note: "Profits taken out" },
    { account: accounts[1].name, kind: "deposit", amount: 15000, occurredOn: isoDay(addDays(firstDay, 3)), note: "Opening deposit" },
    { account: accounts[1].name, kind: "deposit", amount: 5000, occurredOn: "2025-11-03", note: "For IPO applications" },
  ];

  const trades: DemoTrade[] = [];

  for (let d = new Date(firstDay); d <= today; d = addDays(d, 1)) {
    if (isWeekend(d)) continue;
    // Weekday trades are sprinkled, not poured: about three a month over twenty months, which reads as
    // a personal journal rather than a trading floor.
    if (next() > 0.135) continue;
    const ipo = next() < 0.12;
    const stock = ipo ? pick(IPO_STOCKS) : pick(STOCKS);
    const account = ipo ? accounts[1] : pick(accounts);
    const preset = brokerPreset(account.broker);

    const morning = next() < 0.6;
    const entryMinutes = morning ? whole(9 * 60, 12 * 60 + 15) : whole(14 * 60 + 30, 16 * 60 + 45);

    // The price drifts with the calendar, so the same stock is not the same price in 2025 and in 2026.
    const monthsIn = (d.getUTCFullYear() - 2025) * 12 + d.getUTCMonth();
    const drift = 1 + Math.sin(monthsIn / 3.1 + stock.symbol.length) * 0.12 + between(-0.04, 0.04);
    const entryPrice = to2(Math.max(0.1, stock.price * drift));

    // Target a contract value rather than a share count, so a RM22 stock and a RM0.35 IPO both come
    // out as sensible positions, and keep sizes on board lots.
    const lots = Math.max(1, Math.min(200, Math.round(between(3000, 22000) / (entryPrice * BURSA_BOARD_LOT))));
    const shares = lots * BURSA_BOARD_LOT;

    // Most trades risk 3–7% to a recorded stop; a fifth run without one, which is the missing case the
    // analytics has to cope with rather than a hole in the data.
    const hasStop = next() > 0.2;
    const stopDistance = between(0.03, 0.07);
    const stopLoss = hasStop ? to2(entryPrice * (1 - stopDistance)) : null;
    const riskPerShare = stopLoss ? entryPrice - stopLoss : entryPrice * stopDistance;

    // R first, price second: picking the target R and letting the stop decide the exit price is what
    // makes the win rate, the average R and the equity curve tell the same story.
    const roll = next();
    const rTarget = roll < 0.45 ? between(1.1, 3.4) : roll < 0.55 ? between(-0.2, 0.2) : between(-1.35, -0.85);
    const exitPrice = to2(Math.max(0.05, entryPrice + rTarget * riskPerShare));

    // Holding period: intraday is the exception, a few days is the norm, and a handful run for weeks.
    // An entry in the last few days is deliberately given a long hold, so the journal ends with open
    // positions — the "Still open" bucket is a real state, not an empty label.
    const daysToToday = Math.round((today.getTime() - d.getTime()) / 86400000);
    const holdRoll = daysToToday <= 5 ? 0.85 : next();
    let exitDay = d;
    if (holdRoll > 0.35 && holdRoll <= 0.6) exitDay = addDays(d, whole(1, 3));
    else if (holdRoll > 0.6 && holdRoll <= 0.78) exitDay = addDays(d, whole(4, 7));
    else if (holdRoll > 0.78 && holdRoll <= 0.9) exitDay = addDays(d, whole(8, 20));
    else if (holdRoll > 0.9) exitDay = addDays(d, whole(21, 40));
    while (isWeekend(exitDay) && exitDay < today) exitDay = addDays(exitDay, 1);
    const staysOpen = exitDay > today;

    // A same-day exit has to come *after* its entry: an evening entry closed in the afternoon of the
    // same day would be a negative holding time, which the journal renders as a broken duration.
    const exitMinutes =
      exitDay.getTime() === d.getTime()
        ? Math.min(17 * 60, Math.max(entryMinutes + whole(30, 120), 14 * 60 + 30))
        : whole(14 * 60 + 30, 17 * 60);
    const feesPreset = ipo ? brokerPreset("mplus") : preset;
    const ipoTerms: IpoInputs | null = ipo
      ? { channel: stock.ipoChannel ?? "mplus", method: "cash", multiple: null, financed: 0, days: 7 }
      : null;
    const fees = roundTripFees(feesPreset, entryPrice, exitPrice, shares, {
      assetClass: stock.assetClass ?? "shares",
      ipo: ipoTerms,
    });
    // A cash IPO application has no market leg at all, so the closing sale is the only leg the
    // schedule prices — which is exactly how the app's own form prices the same trade.
    const grossPnl = staysOpen ? 0 : calculateGrossPnl(entryPrice, exitPrice, shares, "long") ?? 0;
    const netPnl = roundMoney(grossPnl - fees.brokerCharges - fees.marketCharges);
    const risk = hasStop ? calculateRisk(entryPrice, stopLoss, shares) : null;
    const hasNotes = next() > 0.25;

    trades.push({
      account: account.name,
      strategy: ipo ? "IPO allocation flip" : pick(strategies.slice(0, 3)).name,
      symbol: stock.symbol,
      sector: stock.sector,
      sub_sector: stock.sub,
      asset_class: stock.assetClass ?? "shares",
      session: sessionForTime(stamp(d, entryMinutes)),
      entry_at: stamp(d, entryMinutes),
      exit_at: staysOpen ? null : stamp(exitDay, exitMinutes),
      entryPrice,
      exitPrice: staysOpen ? null : exitPrice,
      shares,
      stop_loss: stopLoss,
      take_profit: hasStop ? to2(entryPrice + 2 * riskPerShare) : null,
      grossPnl,
      commission: fees.brokerCharges,
      fees: fees.marketCharges,
      swap: 0,
      risk_amount: risk,
      // An open position has no R yet: charging it for the buys it has already paid for would show up
      // as a loss the trade has not taken.
      r_multiple: staysOpen || !risk ? null : calculateR(netPnl, risk),
      // The same shape the trade form stores, so the demo's fee panel reads like a recorded trade.
      feeBreakdown: { ...fees, broker: feesPreset.id, brokerName: feesPreset.name },
      is_ipo: ipo,
      emotion: pick(EMOTIONS),
      mistake: next() < 0.3 ? pick(MISTAKES) : "No mistake",
      setup_quality: whole(5, 10),
      execution_quality: whole(5, 10),
      discipline: whole(5, 10),
      mae: staysOpen ? null : to2(-Math.abs(between(0.2, 1) * riskPerShare * shares)),
      mfe: staysOpen ? null : to2(Math.abs(between(0.6, 2.2) * riskPerShare * shares)),
      notes: hasNotes ? pick(NOTES) : null,
      tags: ["Demo data", ipo ? "News catalyst" : pick(tags.slice(1)).name],
    });
  }

  // Reflection dated off the journal's own last trade, so the Reviews page opens onto a week the trade
  // list agrees with rather than a floating set of dates.
  const lastTradeDay = trades.length ? trades[trades.length - 1].entry_at.slice(0, 10) : options.today;
  const daily: DemoDailyReview[] = [];
  let cursor = new Date(`${lastTradeDay}T00:00:00Z`);
  for (let i = 0; i < 14 && daily.length < 6; i++, cursor = addDays(cursor, -1)) {
    if (isWeekend(cursor)) continue;
    daily.push({
      date: isoDay(cursor),
      plan_followed: next() > 0.3,
      execution: whole(5, 10),
      mood: whole(5, 10),
      wentWell: pick([
        "Waited for the retest instead of buying the breakout.",
        "Sized down after two losses in a row.",
        "Took the profit into strength rather than hoping for more.",
        "Nothing forced. Sat on my hands through a slow session.",
      ]),
      mistakes: pick(["Chased the second entry.", "No mistakes today.", "Held a loser past the close.", "Moved the stop once, then watched it get hit."]),
      tomorrow: pick([
        "Watch the sector leaders for a continuation, half size until the market confirms.",
        "No new positions unless the index holds its 20-day.",
        "Check the IPO applications and let the cash settle.",
      ]),
    });
  }
  // Weekly reviews, on the Mondays running back from that same day.
  const monday = mostRecentMonday(new Date(`${lastTradeDay}T00:00:00Z`));
  const weekly: DemoWeeklyReview[] = [
    { summary: "Quiet week, two trades, both from the same sector.", lessons: "The second trade was the same idea twice. One position per sector.", plan: "Track sector exposure in the journal before adding a position." },
    { summary: "Better execution than outcome — stopped out on both.", lessons: "The stops were right; the size was too big for a choppy market.", plan: "Halve size while the index is under its 20-day." },
    { summary: "IPO application filled and flipped across three sessions.", lessons: "Scaling out beat waiting for the top.", plan: "Keep applying for cash-only offers." },
    { summary: "Month end, one breakout held for two weeks.", lessons: "Patience paid more than activity.", plan: "Let winners run to the 20-day rather than to a fixed target." },
  ].map((r, i) => ({ weekStart: isoDay(addDays(monday, -7 * i)), ...r }));

  return { accounts, strategies, tags, flows, trades, daily, weekly };
}

/* ================================================================ writing it down */

/** Exported for the checks: this is the shape the database actually receives. */
export function tradeRow(t: DemoTrade, userId: string, accountId: string | null, strategyId: string | null) {
  return {
    user_id: userId,
    account_id: accountId,
    strategy_id: strategyId,
    symbol: t.symbol,
    sector: t.sector,
    sub_sector: t.sub_sector,
    asset_class: t.asset_class,
    direction: "long",
    // Never `net_pnl`: it is a generated column, and sending it is a database error rather than a
    // mismatch the app could paper over.
    entry_at: t.entry_at,
    exit_at: t.exit_at,
    entry_price: t.entryPrice,
    exit_price: t.exitPrice,
    position_size: t.shares,
    stop_loss: t.stop_loss,
    take_profit: t.take_profit,
    gross_pnl: t.grossPnl,
    commission: t.commission,
    swap: t.swap,
    fees: t.fees,
    risk_amount: t.risk_amount,
    r_multiple: t.r_multiple,
    session: t.session,
    is_ipo: t.is_ipo,
    emotion: t.emotion,
    mistake: t.mistake,
    setup_quality: t.setup_quality,
    execution_quality: t.execution_quality,
    discipline: t.discipline,
    mae: t.mae,
    mfe: t.mfe,
    notes: t.notes,
    fee_breakdown: t.feeBreakdown,
  };
}

/** Cleared parents first, and only for the account this script is signed in as — RLS does the rest. */
const TABLES = ["trades", "tags", "strategies", "account_cash_flows", "trading_accounts", "daily_reviews", "weekly_reviews"] as const;

const env = (name: string, fallback = "") => (process.env[name] ?? fallback).trim();

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function main() {
  const mode = (process.argv[2] ?? "seed").toLowerCase();
  if (mode !== "seed" && mode !== "clear") fail("Usage: node scripts/demo-data.mts [seed|clear]");

  const url = env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const email = env("DEMO_EMAIL", "demo@gmail.com");
  const password = env("DEMO_PASSWORD");
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set — run this through npm run demo:seed, which loads .env.");
  if (!password) fail("DEMO_PASSWORD is not set. It is deliberately not in this file nor in the repository: DEMO_PASSWORD=… npm run demo:seed");

  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: signIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) fail(`${email} could not sign in: ${signInError.message}`);
  const userId = signIn.user?.id;
  if (!userId) fail("Signing in returned no user.");

  /**
   * The one guard that matters. This script deletes every row it can reach, and the only thing between
   * it and the owner's real journal is which account it signed in as — so it checks, and it checks on
   * the database side rather than trusting the address in the environment.
   */
  const { data: profile, error: profileError } = await supabase.from("profiles").select("is_admin").eq("id", userId).maybeSingle();
  if (profileError) fail(`Could not read the profile: ${profileError.message}`);
  if (profile?.is_admin) fail(`${email} is an administrator — this script only writes to a demo account, and it will not touch the account that runs the journal.`);

  console.log(`\n  ${mode === "seed" ? "Seeding" : "Clearing"} the demo journal as ${email} (${userId})`);
  for (const table of TABLES) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) fail(`Could not clear ${table}: ${error.message}`);
  }
  console.log(`  cleared ${TABLES.length} tables`);
  if (mode === "clear") {
    console.log("\n  Done. The account, its login and its invite code are untouched.\n");
    return;
  }

  const dataset = buildDemoDataset({ today: dayKey(new Date()) });
  const accountIds = new Map<string, string>();
  const strategyIds = new Map<string, string>();
  const tagIds = new Map<string, string>();

  const { data: accountRows, error: accountError } = await supabase
    .from("trading_accounts")
    .insert(
      dataset.accounts.map(a => ({
        user_id: userId,
        name: a.name,
        broker: a.broker,
        // The ledger is the source of capital, but the opening figure is still written: on a database
        // where `cashflow.sql` has not been run it is the only number the pages can divide by.
        starting_balance: a.opening,
        current_balance: a.opening,
        currency: a.currency,
        account_type: "personal",
      })),
    )
    .select("id, name");
  if (accountError) fail(`Could not create the accounts: ${accountError.message}`);
  for (const row of accountRows ?? []) accountIds.set(row.name, row.id);

  const { data: strategyRows, error: strategyError } = await supabase
    .from("strategies")
    .insert(dataset.strategies.map(s => ({ user_id: userId, name: s.name, description: s.description, rules: s.rules })))
    .select("id, name");
  if (strategyError) fail(`Could not create the strategies: ${strategyError.message}`);
  for (const row of strategyRows ?? []) strategyIds.set(row.name, row.id);

  const { data: tagRows, error: tagError } = await supabase
    .from("tags")
    .insert(dataset.tags.map(t => ({ user_id: userId, name: t.name, category: t.category })))
    .select("id, name");
  if (tagError) fail(`Could not create the tags: ${tagError.message}`);
  for (const row of tagRows ?? []) tagIds.set(row.name, row.id);

  const { error: flowError } = await supabase.from("account_cash_flows").insert(
    dataset.flows.map(f => ({
      user_id: userId,
      account_id: accountIds.get(f.account) ?? null,
      kind: f.kind,
      amount: f.amount,
      occurred_on: f.occurredOn,
      note: f.note,
    })),
  );
  if (flowError) fail(`Could not record the cash movements: ${flowError.message}`);

  // Written in one call so the returned ids line up with the dataset by index — the tag links below
  // depend on that order, and the length check makes a mismatch loud instead of silently mis-tagging.
  const { data: tradeRows, error: tradeError } = await supabase
    .from("trades")
    .insert(dataset.trades.map(t => tradeRow(t, userId, accountIds.get(t.account) ?? null, strategyIds.get(t.strategy) ?? null)))
    .select("id");
  if (tradeError) fail(`Could not write the trades: ${tradeError.message}`);
  const ids = (tradeRows ?? []).map(r => r.id);
  if (ids.length !== dataset.trades.length) fail(`Wrote ${ids.length} trades but generated ${dataset.trades.length} — the trade-to-tag links would be wrong.`);

  const links = dataset.trades.flatMap((t, i) =>
    t.tags.map(name => tagIds.get(name)).filter((id): id is string => Boolean(id)).map(tag_id => ({ trade_id: ids[i], tag_id })),
  );
  if (links.length) {
    const { error } = await supabase.from("trade_tags").insert(links);
    if (error) fail(`Could not tag the trades: ${error.message}`);
  }

  const { error: dailyError } = await supabase.from("daily_reviews").insert(
    dataset.daily.map(r => ({
      user_id: userId,
      review_date: r.date,
      plan_followed: r.planFollowed,
      execution_score: r.execution,
      mood_score: r.mood,
      what_went_well: r.wentWell,
      mistakes: r.mistakes,
      tomorrow_plan: r.tomorrow,
    })),
  );
  if (dailyError) fail(`Could not write the daily reviews: ${dailyError.message}`);

  const { error: weeklyError } = await supabase.from("weekly_reviews").insert(
    dataset.weekly.map(r => ({ user_id: userId, week_start: r.weekStart, summary: r.summary, lessons: r.lessons, action_plan: r.plan })),
  );
  if (weeklyError) fail(`Could not write the weekly reviews: ${weeklyError.message}`);

  const open = dataset.trades.filter(t => !t.exit_at).length;
  const net = (t: DemoTrade) => t.grossPnl - t.commission - t.fees;
  const wins = dataset.trades.filter(t => net(t) > 0).length;
  const losses = dataset.trades.filter(t => net(t) < 0).length;
  console.log(
    [
      `  ${dataset.accounts.length} accounts, ${dataset.flows.length} cash movements`,
      `  ${dataset.trades.length} trades — ${wins} winners, ${losses} losers, ${open} still open`,
      `  ${dataset.strategies.length} strategies, ${dataset.tags.length} tags, ${dataset.daily.length} daily and ${dataset.weekly.length} weekly reviews`,
      "",
      `  Sign in as ${email} to see it. Remove it with npm run demo:clear.`,
      "",
    ].join("\n"),
  );
}

// Only run when invoked directly, so the checks can import the generator without touching a database.
if (process.argv[1] && /demo-data\.mts$/.test(process.argv[1])) await main();
