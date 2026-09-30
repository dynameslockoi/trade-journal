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
