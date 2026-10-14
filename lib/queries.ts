import type { SupabaseClient } from "@supabase/supabase-js";
import { embedStrategy, normalizeTrade, type Trade } from "@/lib/trading";

/**
 * How the shared row sets are read, in one place, against whatever Supabase client is handed in.
 *
 * The same rows are asked for twice in a page's life: once by the server, which puts them in the
 * first HTML (see `lib/seed.ts`), and again by the browser, whenever the cache has nothing fresh to
 * show. Those two reads have to be the *same* read — the same columns, the same embeds, the same
 * order — or the page would quietly change shape depending on which one answered. So the query bodies
 * live here, take the client as an argument, and are called by both: `lib/data.ts` passes the browser
 * client, `lib/seed.ts` passes the server one.
 *
 * This file has no `"use client"`, because the server imports it too.
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
 * It's a list rather than `*` because `sector` and `sub_sector` may not exist on the database yet and
 * dropping a name from a list is possible where dropping one from `*` is not.
 */
export const TRADE_LIST_COLUMNS = [
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
 * has its own copy of accounts (`fetchAccounts`), and no list page reads a trade's tags: the
 * journal table doesn't show them and nothing filters by them, so the embed was fetched on every
 * trade, on every page, for a value nothing ever read.
 */
export const TRADE_LIST_EMBEDS = embedStrategy();
export const WITH_SUB_SECTOR = `sub_sector,sector,${TRADE_LIST_COLUMNS},${TRADE_LIST_EMBEDS}`;
export const WITH_SECTOR = `sector,${TRADE_LIST_COLUMNS},${TRADE_LIST_EMBEDS}`;
export const WITHOUT_SECTOR = `${TRADE_LIST_COLUMNS},${TRADE_LIST_EMBEDS}`;

/**
 * How much of the classification this database has: both columns, the sector alone, or neither.
 *
 * Each column arrives in its own SQL file (`sectors.sql`, `subsectors.sql`), so all three states
 * are real — a project that has run one and not the other is the ordinary case, not a broken one.
 * PostgREST answers a projection that names a missing column with 42703 and cannot say which name
 * was at fault, so discovery walks down one step at a time rather than asking.
 */
const PROJECTIONS: Record<0 | 1 | 2, string> = { 0: WITHOUT_SECTOR, 1: WITH_SECTOR, 2: WITH_SUB_SECTOR };

/**
 * Which of the three projections worked, remembered for the session. Without the memo every page
 * load would spend a failed request discovering the same thing before running the query that works.
 */
let classification: 0 | 1 | 2 | null = null;

/** Every trade, oldest first. */
export async function fetchTrades(s: SupabaseClient): Promise<Trade[]> {
  // `null` means this database has not been asked yet, and the full projection is what to try.
  if (classification === null) classification = 2;
  let res = await s.from("trades").select(PROJECTIONS[classification]).order("entry_at", { ascending: true });
  // Postgres' "undefined_column" — the one error that actually means one of the classification
  // files hasn't been run. A network error, a timeout, an RLS/permission failure or a transient 500
  // carries a different code (or none at all against a flaky connection) and must surface as a load
  // error like any other failure, not get read as "this database has no classification" and
  // silently and permanently drop every trade's sector for the session.
  while (res.error?.code === "42703" && classification > 0) {
    classification = (classification - 1) as 0 | 1 | 2;
    res = await s.from("trades").select(PROJECTIONS[classification]).order("entry_at", { ascending: true });
  }
  if (res.error) throw new Error(res.error.message);
  return ((res.data ?? []) as any[]).map(normalizeTrade) as Trade[];
}

/**
 * The classification recorded most recently for a symbol — the sector and sub-sector the trade forms
 * carry over so a stock is not classified again on every trade.
 *
 * Asks for both columns and falls back to `sector` alone when `subsectors.sql` has not been run: the
 * same walk `fetchTrades` makes, for the same reason. An unknown column is a fact about the schema,
 * not a failure, and the sector already recorded on a symbol is worth more than an error message.
 */
export async function fetchLatestClassification(
  s: SupabaseClient,
  symbol: string,
): Promise<{ sector: string; subSector: string | null } | null> {
  const ask = (fields: string) =>
    s.from("trades")
      .select(fields)
      .eq("symbol", symbol)
      .not("sector", "is", null)
      .order("entry_at", { ascending: false })
      .limit(1);
  let res = await ask("sector,sub_sector");
  if (res.error?.code === "42703") res = await ask("sector");
  const row = res.data?.[0] as any;
  if (!row?.sector) return null;
  return { sector: row.sector, subSector: row.sub_sector ?? null };
}

export async function fetchAccounts(s: SupabaseClient): Promise<any[]> {
  // Ordered by name: the calendar and the currency helpers read the first row.
  const { data, error } = await s.from("trading_accounts").select("*").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchStrategies(s: SupabaseClient): Promise<any[]> {
  const { data, error } = await s.from("strategies").select("*").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchTags(s: SupabaseClient): Promise<any[]> {
  const { data, error } = await s.from("tags").select("*").order("category").order("name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * `{trade_id, tag_id}` for every tagged trade — the whole point of `KEYS.tradeTags` (see above).
 * `useTradeTagsMap` in lib/data.ts is how a page actually wants this; call that instead of this
 * function directly unless building a different shape of the same rows.
 */
export async function fetchTradeTags(s: SupabaseClient): Promise<{ trade_id: string; tag_id: string }[]> {
  const { data, error } = await s.from("trade_tags").select("trade_id,tag_id");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * The deposit/withdrawal ledger. Throws when `supabase/cashflow.sql` has not been run — callers read
 * that error as "no ledger yet" and fall back to the accounts' opening balances.
 */
export async function fetchFlows(s: SupabaseClient): Promise<any[]> {
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
export async function fetchZakat(s: SupabaseClient): Promise<{ years: any[]; payments: any[]; needsSchema: boolean }> {
  const [y, p] = await Promise.all([
    s.from("zakat_years").select("*"),
    s.from("zakat_payments").select("*").order("paid_on", { ascending: false }),
  ]);
  return { years: y.data ?? [], payments: p.data ?? [], needsSchema: Boolean(y.error || p.error) };
}

/** The signed-in account: admin or not, allowed in or not. Null when there is no profile row. */
export type Me = {
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  status: string;
  access_until: string | null;
};

/**
 * The `public.me()` read behind the access gate. Thrown plainly: whether a failure is permanent
 * (the function is not in the database at all) is the client cache's business, and `lib/admin.ts` —
 * which owns that policy — is where the thrown error is classified.
 */
export async function fetchMe(s: SupabaseClient): Promise<Me | null> {
  const { data, error } = await s.rpc("me");
  if (error) throw new Error(error.message);
  return (data as Me | null) ?? null;
}
