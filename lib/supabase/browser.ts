/**
 * The browser Supabase client, fetched on demand rather than imported at the top of the file.
 *
 * `@supabase/supabase-js` is the single largest dependency in the app's first load — around 76 KB of
 * the ~300 KB of JavaScript the shell ships, a quarter of it — and it is there for something most
 * visits never do. Every page reads its rows through the shared cache, the server puts those rows in
 * the first HTML (see `lib/seed.ts`), and a read that the cache can answer never touches Supabase at
 * all. So the client is worth loading the moment the app actually talks to Supabase — a write, a
 * storage URL, a sign-out, a read the seed could not fill — and not one moment before.
 *
 * A static `import` cannot be deferred: Turbopack would put the whole library in the chunk of every
 * page that mentions it, which is every page. An `await import(...)` inside this function is a chunk
 * boundary, so the library travels in its own file and is requested only when a caller asks for it.
 * The dynamic import is cached by the module system, so the second caller gets the same module
 * instance and `createBrowserClient` — which is a singleton already — is never built twice.
 *
 * Callers are async by nature (loaders, click handlers), which is why this can be async at all. A
 * component that needs the client during render is a mistake the old API allowed and this one makes
 * visible.
 */
export async function browserClient() {
  const { createClient } = await import("@/lib/supabase/client");
  return createClient();
}
