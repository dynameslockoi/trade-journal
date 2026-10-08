/**
 * The hover prefetch upgrade, declared once so the shell can use it without a cast per call site.
 *
 * `unstable_dynamicOnHover` is Next's own prop, not ours: `next/dist/client/app-dir/link.d.ts` declares
 * it, and `next/dist/client/app-dir/link.js` reads it — on `mouseenter`/`touchstart` it swaps the link's
 * prefetch strategy from `auto` to `full`, which is gated on `experimental.dynamicOnHover` in
 * `next.config.ts`. The types that `next/link` actually re-exports are `next/dist/client/link.d.ts`,
 * which was never given the member, so `<Link unstable_dynamicOnHover>` fails `tsc` while it works at
 * runtime. This adds it, with the same optional boolean type, in the same shape as upstream.
 *
 * Merging rather than overriding: if a later Next declares the member itself, the two declarations are
 * identical and the compiler is happy. Nothing else about `LinkProps` is touched, and the two props
 * Next does type — `prefetch` and `prefetch={true}` — keep their own documented meanings.
 */
import "next/link";

declare module "next/link" {
  interface LinkProps<RouteInferType = any> {
    unstable_dynamicOnHover?: boolean;
  }
}
