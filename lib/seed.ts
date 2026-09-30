import { createClient } from "@/lib/supabase/server";
import {
  KEYS,
  fetchAccounts,
  fetchFlows,
  fetchMe,
  fetchStrategies,
  fetchTags,
  fetchTradeTags,
  fetchTrades,
  fetchZakat,
} from "@/lib/queries";

/**
 * Read the shared row sets on the server, so the first HTML already carries them.
 *
 * Every page in this app is a client component that reads through `lib/query-cache.ts`, and until
 * now the rows only ever arrived one way: the browser hydrated, the cache was empty, each page asked
 * Supabase for its own copy, and the page swapped its skeleton for data about 200 ms of round trip
 * later. Measured on a production build, that read was the *last* thing to happen on a cold page —
 * HTML at 30 ms, first paint at ~330 ms, data at ~640 ms — and it happened over the wire from the
 * browser on nine separate requests, once per page load.
 *
 * The server, meanwhile, is already talking to Supabase for this request: the root layout checks the
 * session through it. So the rows are read here instead, in parallel, and handed to the client with
 * the page. The client cache takes them as its starting state, which means the numbers are in the
 * HTML before any JavaScript runs, the browser makes no Supabase request to show them, and every
 * page navigated to afterwards is already holding its rows.
 *
 * Two rules keep it honest:
 *
 *   * **A failed key is left out, not faked.** `allSettled` means one unreadable table (or a database
 *     where `supabase/cashflow.sql` has not been run yet) omits that key and leaves the browser to
 *     fetch it the way it always did — with the same error, on the same page, with the same message.
 *     A seed is a head start, never a different answer.
 *   * **Nothing is cached between requests.** This returns a plain object; it never touches the
 *     client cache module, whose store is a module-level singleton and would otherwise hand one
 *     trader's rows to the next request the server renders. The object travels as a React context
 *     value (see `components/cache-seed.tsx`), which is per request by construction.
 */
export type Seed = Record<string, unknown>;

/** Every shared row set the pages read, or as many of them as this database answered. */
export async function loadSeed(): Promise<Seed> {
  const s = await createClient();
  // All in parallel: eight queries cost one round trip's worth of latency, and that latency is what
  // the first paint waits on.
  const [trades, accounts, strategies, tags, tradeTags, flows, zakat, me] = await Promise.allSettled([
    fetchTrades(s),
    fetchAccounts(s),
    fetchStrategies(s),
    fetchTags(s),
    fetchTradeTags(s),
    fetchFlows(s),
    fetchZakat(s),
    fetchMe(s),
  ]);

  const seed: Seed = {};
  const keep = (key: string, result: PromiseSettledResult<unknown>) => {
    if (result.status === "fulfilled") seed[key] = result.value;
  };
  keep(KEYS.trades, trades);
  keep(KEYS.accounts, accounts);
  keep(KEYS.strategies, strategies);
  keep(KEYS.tags, tags);
  keep(KEYS.tradeTags, tradeTags);
  keep(KEYS.flows, flows);
  keep(KEYS.zakat, zakat);
  keep(KEYS.me, me);
  return seed;
}
