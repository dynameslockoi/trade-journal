/**
 * What keeps the first load small — the two decisions no other check can see.
 *
 * Both of them are invisible in behaviour, which is exactly why they need pinning. The app renders
 * identically whether the rows were read by the server or by the browser a moment later, and whether
 * the Supabase client travelled in the shell's bundle or in a chunk of its own; the difference is
 * only how long the page takes to show a number, and a refactor that quietly undoes either one would
 * fail nothing at all.
 *
 *   * **The server reads first.** `app/layout.tsx` runs the shared queries before it sends the page
 *     and hands the rows down through `CacheSeed`, so the first HTML already carries them. That is
 *     what took the data off the browser's critical path — it used to hydrate, then make nine
 *     requests of its own.
 *   * **The Supabase client is fetched on demand.** `@supabase/supabase-js` is about a quarter of the
 *     shell's JavaScript, and after a seed a page that is already holding its rows never needs it.
 *     A static import anywhere on the shell's path puts the whole library back in the first load.
 *
 * The seed has its own rules, and they are load-bearing: it must not fail the page (`allSettled`,
 * not `all`), and it must never reach the client cache — that store is a module-level singleton on
 * the server, so a write during one request's render would hand those rows to the next request.
 *
 *   npm run test:perf
 */
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const layout = read("app/layout.tsx");
const seed = read("lib/seed.ts");
const cache = read("lib/query-cache.ts");
const data = read("lib/data.ts");
const browser = read("lib/supabase/browser.ts");
const shell = read("components/app-shell.tsx");
const dashboard = read("app/page.tsx");

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual} expected ${expected}`);
}

/* --------------------------------------------------- the server puts the rows in the first HTML */
check("the layout loads the shared rows before it renders", /await\s+loadSeed\(\)/.test(layout), true);
check("and only for a signed-in render", /claims\?\.sub\s*\?\s*await\s+loadSeed\(\)/.test(layout), true);
check("the rows reach the pages through a provider", /<CacheSeed\s+seed=\{seed\}>/.test(layout), true);
check("the provider is above the shell, which reads the cache too", /<CacheSeed[\s\S]{0,120}<AppShell/.test(layout), true);

/* --------------------------------------------------- a failed read is omitted, never fatal */
// `Promise.all` here would turn one unreadable table into a page that never renders at all — the
// error belongs on the browser's copy of that key, where the page already knows how to show it.
check("one unreadable key cannot fail the page", seed.includes("allSettled"), true);
check("the seed never touches the client cache store", seed.includes("@/lib/query-cache"), false);
check("the seed reads through the shared queries", seed.includes('from "@/lib/queries"'), true);
// And the rule on the other side of it: adoption is a browser-only act.
check("the store refuses a seed while the server renders", /typeof window === "undefined"/.test(cache), true);

/* --------------------------------------------------- the browser asks for the client, not the build */
check("the loaders reach Supabase through the on-demand accessor", /from "@\/lib\/supabase\/browser"/.test(data), true);
check("the accessor is a dynamic import, not a re-export", /await import\(/.test(browser), true);
// Every module on the shell's own path: the layout, the shell, the two writes it can reach (sign-out
// and the access ladder), the loaders and the admin RPCs behind the shell's access check.
for (const [name, source] of [
  ["lib/data.ts", data],
  ["lib/admin.ts", read("lib/admin.ts")],
  ["components/app-shell.tsx", shell],
  ["components/user-menu.tsx", read("components/user-menu.tsx")],
  ["components/access-denied.tsx", read("components/access-denied.tsx")],
  ["app/layout.tsx", layout],
] as const) {
  check(`${name} does not bundle the Supabase client into the shell`, source.includes('from "@/lib/supabase/client"'), false);
}

/* --------------------------------------------------- nothing fetches rows in the background */
// The idle warm-up is gone on purpose: the seed already holds every shared row set, so warming would
// only repeat the same eight requests from the browser on every first page load.
check("the shell does not warm rows in the background", shell.includes("warmData"), false);
check("and nothing arms an idle callback to fetch them", shell.includes("requestIdleCallback"), false);

/* --------------------------------------------------- the chart library stays out of the first load */
check("the dashboard's chart is still a dynamic import", /dynamic\(\(\) => import\("@\/components\/equity-chart"\)/.test(dashboard), true);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll performance checks passed");
process.exit(failures ? 1 : 0);
