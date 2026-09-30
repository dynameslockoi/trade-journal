"use client";

import { useMemo } from "react";
import { browserClient } from "@/lib/supabase/browser";
import {
  KEYS,
  fetchAccounts,
  fetchFlows,
  fetchStrategies,
  fetchTags,
  fetchTradeTags,
  fetchTrades,
  fetchZakat,
} from "@/lib/queries";
import { useCachedQuery } from "@/lib/query-cache";

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
 * These functions are the browser half of that. The query bodies themselves live in `lib/queries.ts`
 * because the server runs the same reads to put the rows in the first HTML (`lib/seed.ts`); these
 * wrap them in the cache. The Supabase client is imported on demand (`@/lib/supabase/browser`), so a
 * page that is already holding its rows — which, after a server seed, is every page on the first walk
 * through the app — never downloads the library at all.
 *
 * Loaders throw on failure. The cache turns that into the `error` a page shows, so a dropped request
 * reads as a problem rather than as an empty journal.
 */

export { KEYS };

/** Every trade, oldest first — from the shared cached row set. */
export async function loadTrades() {
  return fetchTrades(await browserClient());
}

export async function loadAccounts() {
  return fetchAccounts(await browserClient());
}

export async function loadStrategies() {
  return fetchStrategies(await browserClient());
}

export async function loadTags() {
  return fetchTags(await browserClient());
}

export async function loadTradeTags() {
  return fetchTradeTags(await browserClient());
}

export async function loadFlows() {
  return fetchFlows(await browserClient());
}

export async function loadZakat() {
  return fetchZakat(await browserClient());
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

export async function loadDailyReview(date: string): Promise<any | null> {
  const s = await browserClient();
  const { data, error } = await s.from("daily_reviews").select("*").eq("review_date", date).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function loadWeeklyReview(week: string): Promise<any | null> {
  const s = await browserClient();
  const { data, error } = await s.from("weekly_reviews").select("*").eq("week_start", week).maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}
