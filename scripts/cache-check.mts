/**
 * The client cache's failure behaviour.
 *
 * Every page reads through this store, so how it behaves when a read *fails* decides whether the app
 * recovers on its own or sits on an error until the user reloads. The failure mode is quiet: a cache
 * that never retries still renders, it just looks like the journal went empty and stayed that way.
 *
 * Three rules are pinned here:
 *
 *   * a healthy key is fetched once and served from the cache;
 *   * a transient failure retries itself after the back-off, with no navigation and no listener;
 *   * a permanent failure (a missing function or table) is left alone, because asking again cannot
 *     change the answer — and an invalidation or a clear cancels a retry that is already waiting.
 *
 * `setRetryAfterMs` exists so this can run in milliseconds rather than five seconds at a time.
 *
 *   npm run test:cache
 */
import { PermanentError, clear, invalidate, peek, readCached, setRetryAfterMs } from "../lib/query-cache.ts";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual} expected ${expected}`);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Comfortably past a 20 ms back-off, and past a couple of retries for the flaky case. */
const RETRY = 20;
const WAIT = RETRY * 6;
setRetryAfterMs(RETRY);

/* ------------------------------------------------------------- a healthy read is cached */
let healthy = 0;
const first = await readCached("healthy", async () => { healthy++; return { ok: true } });
check("a fresh key returns its data", (first.data as { ok: boolean } | null)?.ok, true);
check("a fresh key reports no error", first.error, null);
await readCached("healthy", async () => { healthy++; return { ok: true } });
check("a fresh key is asked for once, not twice", healthy, 1);

/* ------------------------------------------------------------- a transient failure heals itself */
// Nothing calls the cache again here: the point is that the timer asks on its own, the way it would
// while a page is open and the connection has come back.
let transient = 0;
const failed = await readCached("transient", async () => {
  transient++;
  if (transient === 1) throw new Error("network down");
  return { ok: true };
});
check("the first read reports the failure", failed.error, "network down");
check("the failure was fetched exactly once so far", transient, 1);
await sleep(WAIT);
check("the retry ran without a caller", transient >= 2, "true");
check("the retry cleared the error", peek("transient").error, null);
check("the retry stored the fresh answer", (peek("transient").data as { ok: boolean } | null)?.ok, true);

// A key that fails more than once keeps coming back until it succeeds — the loop is not one-shot.
let flaky = 0;
await readCached("flaky", async () => {
  flaky++;
  if (flaky < 3) throw new Error("still down");
  return { ok: true };
});
await sleep(WAIT);
check("a key that fails twice still recovers", flaky >= 3, "true");
check("and it ends up holding the answer", (peek("flaky").data as { ok: boolean } | null)?.ok, true);

/* ------------------------------------------------------------- a permanent failure is left alone */
let permanent = 0;
const gone = await readCached("permanent", async () => {
  permanent++;
  throw new PermanentError("Could not find the function public.me()");
});
check("a permanent failure is reported", gone.error, "Could not find the function public.me()");
await sleep(WAIT);
check("a permanent failure is never retried", permanent, 1);

/* ------------------------------------------------------------- invalidate and clear cancel a retry */
// A write invalidates its keys; the fresh read that follows *is* the retry, so the timer must not fire
// a second request for the same rows.
let invalidated = 0;
await readCached("invalidated", async () => { invalidated++; throw new Error("down") });
check("the key failed once", invalidated, 1);
invalidate("invalidated");
await sleep(WAIT);
check("an invalidated key's timer is dropped", invalidated, 1);

// Signing out wipes the store entirely; a retry queued before that must not resurrect a row set that
// belonged to the previous account.
let cleared = 0;
await readCached("cleared", async () => { cleared++; throw new Error("down") });
clear();
await sleep(WAIT);
check("a cleared key's timer is dropped", cleared, 1);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll cache checks passed");
process.exit(failures ? 1 : 0);
