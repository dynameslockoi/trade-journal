"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { embedStrategy, normalizeTrade, type Trade } from "@/lib/trading";
import { preload, useCachedQuery } from "@/lib/query-cache";

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
  /** The signed-in account's own access state, read once per session by the shell and the admin page. */
  me: "me",
  /** The admin page's single read of every account and invitation code. */
  admin: "admin",
  trades: "trades",
  accounts: "accounts",
  strategies: "strategies",
  tags: "tags",
  flows: "flows",
  zakat: "zakat",
  /** Which tags each trade carries — `{trade_id, tag_id}` pairs only, not full tag rows: this
   *  exists purely so the Tag filter (see `applyFilters`) can match without every list page
   *  carrying every trade's tags, which is what `TRADE_LIST_EMBEDS` deliberately leaves out. */
  tradeTags: "tradeTags",
  dailyReview: (date: string) => `review:daily:${date}`,
  weeklyReview: (week: string) => `review:weekly:${week}`,
};

/**
 * The columns the *list/aggregate* pages need — Dashboard, Journal, Analytics, Calendar,
 * Accounts and Zakat all read this one shared, cached array, and none of them opens a single
 * trade's own detail (the P&L breakdown, notes, screenshots, exact prices, MAE/MFE, mistake,
 * emotion…). Those live on `journal/[id]` and `journal/[id]/edit`, which already run their own
 * `select("*")` for the one row they need — they were never reading from this cache, so trimming
 * it here doesn't touch them. What's left is a union of exactly what `calculateStats`,
 * `metricSeries`, `qualityBucket`, `lotsBucket`, `dailySummaries` and each page's own
 * grouping/table columns use.
 *
 * The stored charge legs (`commission`, `swap`, `fees`) stay: the calendars' day breakdown adds
 * them back up to separate a day's gross P&L from what the broker took, so dropping them does not
 * fail loudly — it silently renders every day as free. `scripts/calc-check.mts` reads this array
 * and asserts the fields the calculators read are still in it, so a trim that forgets one fails
 * the checks instead of quietly changing a figure.
 *
 * It's a list rather than `*` because `sector` may not exist on the database yet and dropping a
 * name from a list is possible where dropping one from `*` is not.
 */
const TRADE_LIST_COLUMNS = [
  "id",
  "symbol",
  "entry_at",
  "exit_at",
  "net_pnl",
  "r_multiple",
  "position_size",
  "commission",
  "swap",
  "fees",
  "setup_quality",
  "execution_quality",
  "discipline",
  "session",
  "is_ipo",
  "account_id",
  "strategy_id",
].join(",");

/**
 * Only `strategies(name)` — not the account embed and not `trade_tags`. Every page here already
 * has its own copy of accounts (`loadAccounts`), and no list page reads a trade's tags: the
 * journal table doesn't show them and nothing filters by them, so the embed was fetched on every
 * trade, on every page, for a value nothing ever read.
 */
const TRADE_LIST_EMBEDS = embedStrategy();
const WITH_SECTOR = `sector,${TRADE_LIST_COLUMNS},${TRADE_LIST_EMBEDS}`;
const WITHOUT_SECTOR = `${TRADE_LIST_COLUMNS},${TRADE_LIST_EMBEDS}`;

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
  // Postgres' "undefined_column" — the one error that actually means `supabase/sectors.sql`
  // hasn't been run. A network error, a timeout, an RLS/permission failure or a transient 500
  // carries a different code (or none at all against a flaky connection) and must surface as a
  // load error like any other failure, not get read as "this database doesn't have sectors" and
  // silently and permanently switch every trade in the session to unsectored.
  if (res.error?.code === "42703" && sectorColumn !== false) {
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
 * `{trade_id, tag_id}` for every tagged trade — the whole point of `KEYS.tradeTags` (see above).
 * `useTradeTagsMap` below is how a page actually wants this; call that instead of this loader
 * directly unless building a different shape of the same rows.
 */
export async function loadTradeTags(): Promise<{ trade_id: string; tag_id: string }[]> {
  const s = createClient();
  const { data, error } = await s.from("trade_tags").select("trade_id,tag_id");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Trade id → the set of tag ids on it, for the Tag filter (`applyFilters` in filter-bar.tsx). A
 * page calls this instead of reading `.trade_tags` off a trade: the shared trades cache doesn't
 * carry that embed (see `TRADE_LIST_EMBEDS`), on purpose, since nothing else needs it.
 */
export function useTradeTagsMap(): { map: Map<string, Set<string>>; error: string | null; loading: boolean } {
  const q = useCachedQuery<{ trade_id: string; tag_id: string }[]>(KEYS.tradeTags, loadTradeTags);
  const map = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const row of q.data ?? []) {
      const set = m.get(row.trade_id) ?? new Set<string>();
      set.add(row.tag_id);
      m.set(row.trade_id, set);
    }
    return m;
  }, [q.data]);
  return { map, error: q.error, loading: q.loading };
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
  preload(KEYS.tradeTags, loadTradeTags);
  preload(KEYS.flows, loadFlows);
  preload(KEYS.zakat, loadZakat);
}
