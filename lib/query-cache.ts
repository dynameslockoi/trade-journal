"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A tiny cache for the data every page asks for.
 *
 * The journal, the dashboard, the calendar and the analytics all read the same trades, accounts,
 * strategies, tags and cash flows. Without a cache, switching between them re-runs those queries on
 * every navigation, so each page only arrives after a fresh round trip — which is what makes page
 * switching feel slow even though nothing is wrong. Here the answer a page already has is kept for a
 * short window and handed straight back, and a stale one is refreshed in the background while the old
 * one is still on screen.
 *
 * Four rules keep it honest:
 *
 *   * **A mutation invalidates.** Anything that writes a trade, an account, a strategy, a tag, a flow,
 *     a review or a zakat row calls `invalidate(...)` for what it touched, so no page keeps showing a
 *     figure the database no longer holds.
 *   * **Stale is only ever shown while fresh is on the way.** A cached value is a head start, never the
 *     final answer: past the TTL the query runs anyway and replaces it.
 *   * **A failure is not an answer.** Errors are reported, never stored as data, so the next visit asks
 *     again instead of rendering "no trades" over a dropped connection.
 *   * **A write outranks a request already in flight.** Each fetch carries a token; when a newer one
 *     starts, the older answer is discarded rather than written over it.
 *
 * The store lives in the module, so it survives the unmount a route change causes — and `clear()` wipes
 * it on sign-out, because everything in it belongs to one trader.
 */

/** How long an answer counts as fresh: long enough to cover a walk around the app. */
const DEFAULT_TTL = 60_000;

/**
 * How long a failed key waits before it is asked again.
 *
 * A failure has to notify — a page sitting on a spinner needs to hear that the read failed — and the
 * components listening to a key re-run their fetch when they are notified. Without a window those two
 * facts multiply: the failure notifies, the listener asks again, that fails, and the page becomes a
 * request loop against an endpoint that is not going to change its answer. Five seconds is short
 * enough that a dropped connection recovers on its own and long enough that it is not a loop.
 */
const DEFAULT_RETRY_AFTER = 5_000;

/**
 * The live back-off, so a check can exercise the retry without waiting five seconds. Production
 * code never moves it.
 */
let retryAfterMs = DEFAULT_RETRY_AFTER;

export function setRetryAfterMs(ms: number) {
  retryAfterMs = ms;
}

/**
 * Throw this from a loader when asking again cannot help — the function or table is not in the
 * database at all. Such a failure stands until something invalidates it or the page is reloaded,
 * rather than being retried against an endpoint that will keep saying no.
 */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentError";
  }
}

type Entry = {
  data: unknown;
  at: number;
  error?: string | null;
  promise?: Promise<void>;
  /** When this failed key may be asked again. Absent while it is healthy. */
  retryAt?: number;
  /** What the key was last fetched with, so a failed key can be asked again on its own. */
  fetcher?: () => Promise<unknown>;
  ttl?: number;
};

const store = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
/** Which request is the current one per key, so a superseded answer can be ignored. */
const tokens = new Map<string, number>();
let seq = 0;

/** A pending re-fetch per failed key, so a failure recovers without waiting for a navigation. */
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

function notify(key: string) {
  listeners.get(key)?.forEach(fn => fn());
}

/** Drop a pending retry — the key is being fetched, refreshed or forgotten anyway. */
function clearRetry(key: string) {
  const timer = retryTimers.get(key);
  if (timer === undefined) return;
  clearTimeout(timer);
  retryTimers.delete(key);
}

/**
 * Ask a failed key again after the back-off, without waiting for a caller.
 *
 * Failing only reports the error and notifies the listeners once; the component that was waiting then
 * re-runs its effect, finds the back-off still running and settles. So without this an open page
 * stays on its error until the user navigates or reloads, even when the connection is back a second
 * later. The timer re-runs the fetch through `ensure` with the fetcher the key was last asked with,
 * so a background warm-up recovers too, and it is dropped if anything refreshed or cleared the key
 * first.
 */
function scheduleRetry(key: string) {
  clearRetry(key);
  const timer = setTimeout(() => {
    retryTimers.delete(key);
    const entry = store.get(key);
    // The failure is no longer held, or the key was answered in the meantime.
    if (!entry?.error || !entry.fetcher) return;
    void ensure(key, entry.fetcher, entry.ttl ?? DEFAULT_TTL);
  }, retryAfterMs);
  // A pending retry must not hold the process open (a server render, or the check script).
  (timer as { unref?: () => void }).unref?.();
  retryTimers.set(key, timer);
}

/** A snapshot of what is held for a key, in the shape the hook renders. */
function snapshot<T>(key: string, ttl = DEFAULT_TTL): { data: T | null; error: string | null; loading: boolean } {
  const entry = store.get(key);
  const data = (entry?.data ?? null) as T | null;
  return {
    data,
    error: entry?.error ?? null,
    // Only a page with nothing to show is "loading" — a background refresh keeps the page it has.
    loading: data === null && !entry?.error,
  };
}

/** What is held for a key, and whether it is still fresh enough to skip the query. */
export function peek<T>(key: string, ttl = DEFAULT_TTL): { data: T | null; fresh: boolean; error: string | null } {
  const entry = store.get(key);
  return {
    data: (entry?.data ?? null) as T | null,
    fresh: Boolean(entry && entry.at > 0 && Date.now() - entry.at < ttl),
    error: entry?.error ?? null,
  };
}

/**
 * Mark cached answers stale after a write, so the pages holding them fetch again.
 *
 * Stale, not deleted, on purpose: the page keeps rendering the rows it has while the fresh ones
 * travel, instead of collapsing to a spinner and rebuilding itself — losing, on the journal page, the
 * column choices and the search that had just been set up.
 */
export function invalidate(prefix = "") {
  for (const key of [...store.keys()]) {
    if (prefix && !key.startsWith(prefix)) continue;
    const entry = store.get(key);
    if (!entry) continue;
    // The write is the retry: a pending one would only fetch the same rows twice.
    clearRetry(key);
    // Dropping the in-flight marker lets a request that is already running be superseded: without it
    // the write's fresh read would share the request that left before the write. The back-off goes
    // with it, so the invalidation after a write is also the retry — which is what the admin page's
    // Refresh button relies on.
    const { promise: _running, retryAt: _retry, ...held } = entry;
    store.set(key, { ...held, at: 0 });
    notify(key);
  }
}

/** Drop every cached answer. Signing out is the one moment the rows must not be kept at all. */
export function clear() {
  for (const key of [...retryTimers.keys()]) clearRetry(key);
  const keys = [...store.keys()];
  store.clear();
  tokens.clear();
  keys.forEach(notify);
}

/**
 * One fetch per key at a time: a page mounting while another already asked for the same rows, or a
 * warm-up racing the page that needs it, shares a single request instead of doubling the traffic.
 * Errors are absorbed here and reported through `peek`, so this promise never rejects.
 */
function ensure<T>(key: string, fetcher: () => Promise<T>, ttl: number): Promise<void> {
  const existing = store.get(key);
  if (existing?.promise) return existing.promise;
  // Inside the back-off window this is a no-op: no request, and no notification either, so the
  // listener that called it settles instead of asking again. `scheduleRetry` is what asks again once
  // the window has passed.
  if (existing?.error && existing.retryAt && Date.now() < existing.retryAt) return Promise.resolve();

  // A real fetch supersedes any retry that was waiting on this key.
  clearRetry(key);
  const token = ++seq;
  tokens.set(key, token);

  const promise = fetcher()
    .then(data => {
      // A write invalidated this key while the request was out: its answer is out of date.
      if (tokens.get(key) !== token) return;
      // A zero TTL means "read it once per visit", for data that should never look cached.
      if (ttl <= 0) store.delete(key);
      else store.set(key, { data, at: Date.now() });
    })
    .catch((e: unknown) => {
      if (tokens.get(key) !== token) return;
      const held = store.get(key);
      const message = e instanceof Error ? e.message : String(e);
      const permanent = e instanceof PermanentError;
      // `at: 0` marks a failure: present for the error message, stale on purpose.
      // The fetcher rides along so the retry below can run without a component asking again.
      store.set(key, {
        data: held?.data ?? null,
        at: 0,
        error: message,
        retryAt: permanent ? Number.POSITIVE_INFINITY : Date.now() + retryAfterMs,
        fetcher: fetcher as () => Promise<unknown>,
        ttl,
      });
      // A missing function or table will keep saying no, so only a transient failure is retried.
      if (!permanent) scheduleRetry(key);
    })
    .finally(() => {
      const held = store.get(key);
      if (held?.promise === promise) delete held.promise;
      notify(key);
    });

  store.set(key, {
    data: existing?.data ?? null,
    at: existing?.at ?? 0,
    error: existing?.error ?? null,
    promise,
    fetcher: fetcher as () => Promise<unknown>,
    ttl,
  });
  return promise;
}

/**
 * Fetch `key` into the cache without a component waiting on it — what the shell's warm-up uses so the
 * pages behind a link are already loaded by the time one is clicked.
 */
export function preload<T>(key: string, fetcher: () => Promise<T>, ttl = DEFAULT_TTL) {
  if (peek<T>(key, ttl).fresh) return Promise.resolve();
  return ensure(key, fetcher, ttl);
}

/**
 * Read `key`, fetching it when there is nothing fresh to show. The fetcher should throw on failure:
 * the thrown message is what the page's `LoadError` shows.
 */
export function useCachedQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { ttl?: number; enabled?: boolean } = {}
): { data: T | null; error: string | null; loading: boolean } {
  const { ttl = DEFAULT_TTL, enabled = true } = opts;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Read synchronously on the first render, so a cached page paints with its data already present
  // rather than flashing a spinner for a frame.
  const [state, setState] = useState(() => (enabled ? snapshot<T>(key, ttl) : { data: null, error: null, loading: false }));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const publish = () => { if (alive) setState(snapshot<T>(key, ttl)); };

    const set = listeners.get(key) ?? new Set<() => void>();
    listeners.set(key, set);
    // An invalidation has to reach this component even while it is sitting on cached data.
    const kick = () => setTick(t => t + 1);
    set.add(kick);

    publish();
    if (!peek<T>(key, ttl).fresh) void ensure(key, fetcherRef.current, ttl);

    return () => {
      alive = false;
      set.delete(kick);
      if (!set.size) listeners.delete(key);
    };
  }, [key, ttl, enabled, tick]);

  return state;
}

/**
 * The same cache, for the places that load imperatively and keep their own state — a form that needs
 * one row, or a review for a date. Throwing is expected: the message is the error.
 */
export async function readCached<T>(key: string, fetcher: () => Promise<T>, ttl = DEFAULT_TTL): Promise<{ data: T | null; error: string | null }> {
  if (!peek<T>(key, ttl).fresh) await ensure(key, fetcher, ttl);
  const { data, error } = peek<T>(key, ttl);
  return { data, error };
}
