"use client";

import { createClient } from "@/lib/supabase/client";
import { embedAccount, embedStrategy, normalizeTrade, type Trade } from "@/lib/trading";
import { preload } from "@/lib/query-cache";

/**
 * One loader per dataset, shared by every page.
 *
 * Before this, each page ran its own query with its own column list, so moving from the dashboard to
 * the journal asked Supabase for the same trades again and the page only appeared once that answer
 * came back — which is what made switching feel slow. Now a page asks for *rows*, not a projection:
 * the trades are read once, kept in the cache for a minute, and every page that needs them gets the
 * same array. Sharing a row shape is the point — a page can add a column it needs without every other
 * page fetching its own copy.
 *
 * Loaders throw on failure. The cache turns that into the `error` a page shows, so a dropped request
 * reads as a problem rather than as an empty journal.
 */

/** Cache keys. Reviews are per date, everything else is one row set per table. */
export const KEYS = {
  trades: "trades",
  accounts: "accounts",
  strategies: "strategies",
  tags: "tags",
  flows: "flows",
  zakat: "zakat",
  dailyReview: (date: string) => `review:daily:${date}`,
  weeklyReview: (week: string) => `review:weekly:${week}`,
};

/**
 * The columns every page can need, in one list. It is a union rather than `*` because `sector` may not
 * exist on the database yet and dropping a name from a list is possible where dropping one from `*` is
 * not.
 */
const TRADE_COLUMNS = [
  "id",
  "symbol",
  "direction",
  "asset_class",
  "entry_at",
  "exit_at",
  "entry_price",
  "exit_price",
  "position_size",
  "stop_loss",
  "take_profit",
  "gross_pnl",
  "commission",
  "swap",
  "fees",
  "fee_breakdown",
  "net_pnl",
  "r_multiple",
  "risk_amount",
  "risk_percent",
  "session",
  "emotion",
  "mistake",
  "setup_quality",
  "execution_quality",
  "discipline",
  "mae",
  "mfe",
  "notes",
  "is_ipo",
  "account_id",
  "strategy_id",
].join(",");

const TRADE_EMBEDS = `${embedStrategy()},${embedAccount("name,starting_balance,currency")},trade_tags(tag_id)`;
const WITH_SECTOR = `sector,${TRADE_COLUMNS},${TRADE_EMBEDS}`;
const WITHOUT_SECTOR = `${TRADE_COLUMNS},${TRADE_EMBEDS}`;

/**
 * Whether `sector` is on this database, remembered for the session. Without the memo every page load
 * would spend a failed request discovering the same thing before running the query that works.
 */
let sectorColumn: boolean | null = null;

/** Every trade, oldest first. */
export async function loadTrades(): Promise<Trade[]> {
  const s = createClient();
  const columns = sectorColumn === false ? WITHOUT_SECTOR : WITH_SECTOR;
  let res = await s.from("trades").select(columns).order("entry_at", { ascending: true });
  if (res.error && sectorColumn !== false) {
    // supabase/sectors.sql has not been run: retry without the column so the journal still opens.
    sectorColumn = false;
    res = await s.from("trades").select(WITHOUT_SECTOR).order("entry_at", { ascending: true });
  } else if (!res.error) {
    sectorColumn = true;
  }
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as any[]).map(normalizeTrade) as Trade[];
}

export async function loadAccounts(): Promise<any[]> {
  const s = createClient();
  // Ordered by name: the calendar and the currency helpers read the first row.
  const { data, error } = await s.from("trading_accounts").select("*").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadStrategies(): Promise<any[]> {
  const s = createClient();
  const { data, error } = await s.from("strategies").select("*").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function loadTags(): Promise<any[]> {
  const s = createClient();
  const { data, error } = await s.from("tags").select("*").order("category").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * The deposit/withdrawal ledger. Throws when `supabase/cashflow.sql` has not been run — callers read
 * that error as "no ledger yet" and fall back to the accounts' opening balances.
 */
export async function loadFlows(): Promise<any[]> {
  const s = createClient();
  const { data, error } = await s
    .from("account_cash_flows")
    .select("id,account_id,kind,amount,occurred_on,note")
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Zakat settings and payments. A missing table is an expected state with its own message on the page,
 * so it is reported as a flag rather than thrown.
 */
export async function loadZakat(): Promise<{ years: any[]; payments: any[]; needsSchema: boolean }> {
  const s = createClient();
  const [y, p] = await Promise.all([
    s.from("zakat_years").select("*"),
    s.from("zakat_payments").select("*").order("paid_on", { ascending: false }),
  ]);
  return { years: y.data ?? [], payments: p.data ?? [], needsSchema: Boolean(y.error || p.error) };
}

export async function loadDailyReview(date: string): Promise<any | null> {
  const s = createClient();
  const { data, error } = await s.from("daily_reviews").select("*").eq("review_date", date).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function loadWeeklyReview(week: string): Promise<any | null> {
  const s = createClient();
  const { data, error } = await s.from("weekly_reviews").select("*").eq("week_start", week).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Load the row sets behind the pages the user has not opened yet.
 *
 * A cached page is instant, but a page nobody has visited still waits on its query — and the first
 * walk around the app is exactly when it feels slow. So once the shell is up and the first page has
 * settled, the shared datasets are fetched in the background on an idle callback. Clicking Journal
 * then costs nothing: the rows are already in memory and the query is skipped.
 *
 * Failures are ignored on purpose: this is an optimisation, and a page that opens to its own error
 * state is better than one that opens to an error caused by a warm-up nobody asked for.
 */
export function warmData() {
  preload(KEYS.trades, loadTrades);
  preload(KEYS.accounts, loadAccounts);
  preload(KEYS.strategies, loadStrategies);
  preload(KEYS.tags, loadTags);
  preload(KEYS.flows, loadFlows);
  preload(KEYS.zakat, loadZakat);
}
