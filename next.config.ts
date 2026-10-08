import type { NextConfig } from "next";

/**
 * A personal trading record sits behind a login, so the headers below are the cheap half of the
 * hardening: they cost nothing at runtime and close whole classes of attack (clickjacking, MIME
 * sniffing, referrer leakage, ambient device permissions).
 *
 * `Content-Security-Policy` is deliberately partial. A `script-src` needs a per-request nonce to
 * work with Next's inline bootstrap, and a wrong one breaks hydration rather than an attacker —
 * so only the directives that stand on their own are set here. The ones that matter most for an
 * authenticated app are `frame-ancestors` (no one may frame the journal and trick you into
 * clicking inside it) and `object-src`.
 */
const supabase = "https://*.supabase.co";
const csp = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `img-src 'self' data: blob: ${supabase}`,
  `connect-src 'self' ${supabase} wss://*.supabase.co`,
  "upgrade-insecure-requests",
].join("; ");

const nextConfig: NextConfig = {
  /**
   * The journal is served from a small VPS that also runs live media services, so the server
   * has to fit in a few hundred megabytes. `standalone` is what makes that possible: Next
   * traces the imports `server.js` actually reaches and emits only those files, instead of
   * the full 525 MB `node_modules` tree, and the process is started directly rather than
   * through the `next` CLI.
   */
  output: "standalone",
  /**
   * Two settings about the same thing: a page change in this app should never wait on the server.
   *
   * Every page here is a client component holding its rows in a browser cache (`lib/query-cache.ts`)
   * and every route is dynamic — `ƒ` in the build output, because the layout reads the session — so
   * Next's defaults make navigation slower than the architecture deserves:
   *
   *   * **`staleTimes.dynamic` is 0 by default**, which means a dynamic segment is never reusable.
   *     Going back to a page you were just on therefore asks the server for it again, and because
   *     every route in the shell has its own `loading.tsx` you also get a skeleton flashed over rows
   *     the browser is already holding. Thirty seconds of reuse covers a walk around the app; the figures
   *     still come from the client cache with its own TTL and its `invalidate()` on every write, so
   *     a reused page cannot show a number the database no longer has. `static` is only consulted
   *     for a link that asks for a full prefetch, and the schema requires it to be at least 30.
   *   * **A hovered link only prefetches as far as the nearest `loading.tsx`.** For a dynamic route
   *     that is the skeleton and nothing else, so the 70–95 KB of route JavaScript measured per page
   *     (`.next/diagnostics/route-bundle-stats.json`) only begins downloading after the click.
   *     `dynamicOnHover` enables the `unstable_dynamicOnHover` prop the nav links carry, which upgrades
   *     a hovered link to a full prefetch — the pointer resting on a section for a moment is enough.
   *
   * Both are navigation-only: neither changes what a page reads, and a hard load still renders the
   * whole thing on the server with its rows in the first HTML (see `lib/seed.ts`).
   */
  experimental: {
    staleTimes: { dynamic: 30, static: 180 },
    dynamicOnHover: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Nothing in the journal needs a camera, a mic or a location; the pickers are ours.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          // Two years, with subdomains, once the site is served over TLS. Ignored on http://localhost.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
