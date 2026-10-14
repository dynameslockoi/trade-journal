/**
 * How the Analytics page is divided, and which view a URL opens.
 *
 * The page is one filtered set of trades asked four different questions, and each question gets its
 * own view rather than a share of one 6,000-odd-pixel column:
 *
 *   * **Overview** — whether there is an edge at all, and what it cost in drawdown: the eight metric
 *     cards, the equity curve and the R distribution. Everything in the other three is a breakdown of
 *     this answer.
 *   * **Setups** — what you trade and how the trade came to you: the setup, the setup's quality
 *     score, and whether the shares were an IPO allocation or a market buy.
 *   * **Timing** — when you trade, how long you hold, how big you go: the Bursa hour (with its
 *     session bands), the weekday, the holding period and the position lot.
 *   * **Sectors** — which Bursa sectors pay you, and which sub-sector inside them, including the
 *     month-by-month strip, which is the one block on the page that needs the full width to say
 *     anything.
 *
 * A dimension belongs to exactly one view, and its chart and its table are always read together —
 * the table is how you find out whether a bar is one trade or a hundred, so a chart that travelled to
 * a different view from its table would leave that question unanswerable. Those two rules are what
 * `scripts/analytics-check.mts` pins; they are also invisible in the rendering, which is why they are
 * checked rather than assumed.
 *
 * The rules live here, with no React and no page import, for the same reason `lib/session.ts` is out
 * of the middleware: the view resolver, the deep-link precedence and the URL builder can all be
 * exercised without a browser.
 */

/** The views, in the order the tab strip draws them, each with the label it is drawn under. */
export const VIEWS = [
  ["overview", "Overview"],
  ["setups", "Setups"],
  ["timing", "Timing"],
  ["sectors", "Sectors"],
] as const;

export type View = (typeof VIEWS)[number][0];

/**
 * The dimensions trades are broken down by on this page — the same keys `grouped` bands trades with,
 * so every dimension listed here is one the page can actually draw.
 */
export const DIMENSIONS = ["strategy", "sector", "subsector", "hour", "weekday", "holding", "lots", "quality", "ipo"] as const;

export type Dimension = (typeof DIMENSIONS)[number];

/** Which view owns which dimension. Overview's own blocks are not dimensions, so it owns none. */
export const VIEW_DIMENSIONS: Record<View, readonly Dimension[]> = {
  overview: [],
  setups: ["strategy", "quality", "ipo"],
  timing: ["hour", "weekday", "holding", "lots"],
  sectors: ["sector", "subsector"],
};

/** The view a bare `/analytics` opens on. */
export const DEFAULT_VIEW: View = "overview";

/**
 * Where a link that names a strategy lands.
 *
 * `app/page.tsx` reaches this page with the strategy its own table was showing
 * (`/analytics?strategy=<id>` — see the view-all link there). That strategy's chart lives in Setups,
 * so opening on Overview would hide the one thing the link was about; the strategy has to imply the
 * view that draws it.
 */
export const STRATEGY_VIEW: View = "setups";

/** Is this a view the page knows? Anything else in `?view=` is treated as absent. */
export function isView(value: string | null | undefined): value is View {
  return !!value && VIEWS.some(([view]) => view === value);
}

/**
 * The view to draw for a URL, in precedence order: an explicit `?view=` wins, then a strategy deep
 * link (see `STRATEGY_VIEW`), then the default. An unknown value falls through rather than breaking
 * the page — a stale bookmark or a hand-typed URL should not land on a blank tab strip.
 */
export function resolveView(view: string | null | undefined, strategy: string | null | undefined): View {
  if (isView(view)) return view;
  return strategy ? STRATEGY_VIEW : DEFAULT_VIEW;
}

/**
 * The address bar for a view switch: the view is set, and every other parameter is kept, so a filter
 * that travels in the URL survives the switch (the journal's filter links put the dates there).
 *
 * `search` may be a `?`-first query string or a bare one; `URLSearchParams` accepts both.
 */
export function viewHref(pathname: string, search: string, view: View): string {
  const params = new URLSearchParams(search);
  params.set("view", view);
  return `${pathname}?${params}`;
}
