# Phase 8 — Bursa sessions and light mode

## Sessions are now the two Bursa windows

`lib/trading.ts` exports `SESSIONS = ["Morning", "Evening"]` — the FX sessions (Asia, London,
New York, London/NY Overlap) are gone, along with "Bursa Morning"/"Bursa Afternoon".

| Session | Exchange window |
|---|---|
| Morning | 9:00–12:30 |
| Evening | 14:30–17:00 |

- **A trade belongs to the window it was opened in.** `sessionForTime()` buckets an entry
  timestamp at the 12:30 close, and the Add Trade form follows the entry time until you pick a
  session yourself. The Edit form derives it the same way.
- The dropdowns show the window next to the name ("Morning · 9:00–12:30") via `sessionLabel()`.
- **Rows saved under an old name read as Morning/Evening**: `normalizeTrade()` runs the stored
  value through `sessionBucket()`, which maps `Bursa Morning` → `Morning`, `Bursa Afternoon` /
  `Afternoon` / `Evening` → `Evening`, and falls back to the entry time for anything else
  (e.g. `London` on an old FX row or an empty session). No database migration is needed — the
  journal, analytics, dashboard and detail page all display the bucket, and saving a trade
  rewrites the stored value.

## Dark and light themes

The palette lives in `app/globals.css`: `:root` holds the dark tokens and
`[data-theme="light"]` overrides them, so every surface (page, cards, sidebar, topbar, inputs,
tables, calendar cells, badges, alerts, links) is tokenised. `color-scheme` follows the theme so
native date pickers and select popups match.

- `components/theme-provider.tsx` wraps the app in `next-themes` (`attribute="data-theme"`,
  default dark, system preference ignored) and injects its no-flash script before the shell.
- `components/theme-toggle.tsx` is the sun/moon button in the topbar; the choice persists in
  localStorage under `theme`.
- `components/chart-theme.ts` now points recharts at the token names (`var(--positive)` etc.),
  which SVG presentation attributes resolve — so bars, lines, grid and tooltips re-theme with no
  re-render and can never silently fall back to black.

Also fixed while verifying: `.grid > * { min-width: 0 }` — grid items default to
`min-width:auto`, which let a wide breakdown table stretch the page past the viewport instead of
scrolling inside its own `.table-wrap`.

## Design system refresh

`app/globals.css` is now the single source of truth for the look, so pages never hard-code colour:

- **Type**: Inter self-hosted through `next/font` (`--font-sans`, with a system stack behind it),
  tighter heading tracking, and `tabular-nums` on every figure so P&L columns line up.
- **Depth**: tokenised shadows, a hairline sheen along the top edge of each card, an aurora
  gradient behind the page, and a soft accent bloom inside metric cards.
- **Chrome**: gradient brand tile, accent-tinted active nav pill with a hover nudge, and a sticky
  topbar with a frosted blur that shows the current section (`Workspace / Journal`).
- **Controls**: gradient primary buttons that lift on hover and glow, focus rings on inputs, and
  custom scrollbars, selection colour and `code` styling.
- **Charts**: the equity curve is a gradient-filled area chart and bars have rounded caps capped at
  46px, all driven by theme tokens.
- **Metric sparklines**: `metricSeries()` in `lib/trading.ts` returns the running value of each
  headline metric after every trade (equity, win rate, profit factor, average R, gross profit, gross
  loss, drawdown), and the dashboard passes each to `StatCard`'s optional `trend` prop.
  `components/sparkline.tsx` draws them as a plain inline SVG — no charting library, no axes —
  coloured with `currentColor` so the line and fill follow the theme and the card's tone. A single
  trade (nothing to trend) or a flat run (drawn as a bare line, since a filled band would read as a
  solid block) are both handled; the trend is opt-in, so analytics and calendar cards are unchanged.
- **Motion**: a short rise-in on page content, fully disabled under `prefers-reduced-motion`.

The calendar and dashboard month summaries now share the same metric card component as the rest of
the app.

## Layout, numbers and phone widths

- **One vertical rhythm.** Every page body is spaced by `.content > * + * { margin-top: var(--section-gap) }`
  (14px), so the filter bar no longer sits flush against the cards below it and no page needs its own
  margin hacks. The ad-hoc `marginTop`/`marginBottom` values were removed from every page.
- **Shared page header.** `components/page-header.tsx` gives all ten pages the same title scale, an
  optional eyebrow (`Journal / Trade`) and actions that wrap under the title on narrow screens.
- **Smaller type scale.** Page titles 28px -> 22px (19px on phones), metric figures 30px -> 25px,
  table text 14px -> 13.5px, buttons, labels and nav links each dropped ~0.5px.
- **Currency everywhere.** `formatMoney` puts the symbol first and groups thousands
  (`RM 1,725.06`), with the sign beside the figure (`RM -882.54`, `RM +842.52`); `formatNumber`,
  `formatPrice` (share prices keep up to four decimals) and `shortDate`/`shortDateTime` cover the
  rest. MYR reads as **RM**, other codes as their symbol or code. Missing values stay `—` rather
  than becoming `RM 0.00`. Money follows the filtered account's currency, falling back to RM.
- **Collapsible filters.** The filter bar has a Hide/Show toggle (with `aria-expanded`) and a Reset
  button that is only enabled when something is filtered; the hint shows the active count.
- **Identity in the topbar.** The raw email is now an avatar plus the profile's `display_name`
  (falling back to a title-cased email local part), with the address as the hover title.
- **Grid columns.** `.grid.two/.three/.four` carry their desktop column counts (2, 3, 4); the
  media queries only ever narrow them — four becomes two below 1350px (metric cards with
  sparklines get cramped on a laptop), three becomes two below 1100px, and everything is one
  column below 700px. The filter bar is exempt from the 1350px step: it keeps four fields across
  down to 1100px via `.grid.four.filter-grid`, which carries three classes so it outranks the
  plain `.grid.four` base rule.
- **Mobile.** At 700px the sidebar becomes a bottom nav bar (the phone keeps the full content
  width, `.main` gets bottom padding to clear it) and at 900px it is the icon rail. Verified at
  390px: **no horizontal overflow on any of the 12 routes**, all grids single-column, calendar cells
  and metric cards scaled down, and the header actions full width.

## P&L calendar: counts, return on capital and a day pop-up

- **Day cells carry more than the amount.** Each trading day shows the net P&L, the number of
  trades that day and the day's return — measured against the balance the day *opened* with
  (capital + realised P&L of every earlier day), not the month's start, so an early-month loss does
  not inflate later percentages.
- **Month and year navigation.** Year jumps (`«` `»`) and month arrows sit either side of quick
  **month** and **year** pickers; the year list is the years in your data plus the current one, and
  a **Today** button returns to the current month. Today's cell is ringed and tagged.
- **Day pop-up**, matching the requested reference layout: the date and record, net P&L with its %
  of capital, an Account Overview (start balance, end balance, capital), trade stats (longs/shorts,
  best and worst trade, gross P&L, fees, average hold time, intraday max drawdown, win rate, profit
  factor, average per trade, total and average R) and the day's trades, each linking to its detail
  page. Closes on Escape, the close button or a backdrop click, locks the page behind it, and is
  keyboard-reachable from the cell (`role="button"`, Enter/Space). **View in Journal** opens the
  journal already filtered to that date, so `/journal?from=…&to=…` now seeds the filter bar.
- **Yearly performance strip** under the month grid, as in the reference screenshot: months
  across, one row per year (newest first, current year always present), every cell carrying the
  month's P&L and trade count, tone-tinted green or red with the figure in the same colour, and a
  **YTD** column closing each row. Empty months stay muted `—`. Clicking a month moves the calendar
  above to it and scrolls that grid back into view; the month you are looking at is ringed. The
  strip scrolls sideways inside its own card (14 columns), with the **year pinned** as a sticky
  first column — each row is its own grid, so the label travels with the scroll rather than leaving
  the sticky containing block.
- `dailySummaries()` in `lib/trading.ts` computes all of this in one pass, keyed by local day
  (`dayKey`), with `formatPercent` and `percentOf` for the percentages and `formatDurationMs` for
  average hold times. Every figure is null rather than zero when it cannot be computed — no R data
  shows `—`, and no capital shows `—` plus a link to the Accounts page instead of a fake 0%.

## Chrome, filters and account settings

- **Money never breaks.** `formatMoney`/`formatPrice` join the symbol to the figure with a
  non-breaking space (`RM\u00A0-882.54`) and table cells are `white-space: nowrap`, so `RM` can no
  longer be stranded on its own line in a narrow column. The calendar still splits the two onto
  separate lines on purpose — it splits on whitespace, which matches the non-breaking gap.
- **Filters start collapsed.** The filter bar is closed on first paint, so the data is the first
  thing on the page; **Show** reveals the nine fields and the hint still reports how many are
  active.
- **Topbar.** The account controls are pinned right with `margin-left: auto` — a lone flex child of
  a `space-between` row used to sit on the left once the breadcrumbs were hidden on a phone. The
  display name is gone: the avatar is now the Settings link (its tooltip carries the name or
  email) and signing out is an icon button.
- **Settings is a real page.** Update the display name (written to `profiles.display_name` and to
  auth metadata), the email (Supabase sends a confirmation link to the new address before it takes
  over) and the password (8 characters minimum, confirmed twice, with the same session kept). The
  old placeholder fields were removed — currency, broker, starting balance and risk limits belong
  to each account, and the page now says so with a link to Accounts.
- **Bottom nav.** On a phone the nav bar sits at `z-index: 30` with a solid background and top
  shadow, and `.main` clears it by 84px (+ the safe-area inset), so the last row of a table is no
  longer tucked behind the menu.

## Quick add from anywhere

- `components/quick-add.tsx` renders a floating **Add trade** pill bottom-right with an `N` chip,
  mounted from the app shell so it is on every workspace page. It hides itself on `/journal/new`
  and on an edit route, where it would only point at the form already on screen.
- **`N`** opens the new-trade form. The key is ignored while the caret is in an input, textarea or
  select, when a modifier is held (so `Ctrl/Cmd+N` still belongs to the browser), on key repeat,
  and while a pop-up with `role="dialog"` (the calendar day modal) is open.
- On a phone the pill collapses to a circle and floats above the 64px bottom nav; `.main:has(.fab)`
  adds 88px of bottom clearance (142px on a phone) so the button never covers the last row of a
  table. Browsers without `:has()` simply keep the nav clearance.

## Long-only journal, and editing accounts and strategies

- **Bursa is long-only here.** The Direction control is gone from both trade forms, the Direction
  filter is gone from the filter bar, and the Direction column is gone from the journal and the
  dashboard's recent trades; the detail page titles a trade by its symbol alone and the day pop-up
  shows Trades/Symbols instead of Long/Short. Every new trade is saved as `direction: "long"` (the
  column is `not null`, so it still has to be written), and an existing row being edited keeps the
  direction it was saved with — so a legacy short is re-priced correctly rather than silently
  flipped. `calculateGrossPnl` still understands shorts for that case.
- **Accounts and Strategies have an Edit button** beside Delete. Edit reopens the same form
  pre-filled — headed *Edit Account* / *Edit Strategy* with a **Save Changes** button — and writes
  with `update(...).eq("id", …)` instead of an insert; Cancel restores the create form. The form
  scrolls itself into view when it opens, since it sits above the cards, and the account form keeps
  the retry-without-`broker` fallback for a database the Phase 7 migration has not reached.

## Analytics grouped the way a Bursa share trader thinks

The old **Hour P&L** chart was a free-for-all hour bucket that could only ever draw one bar. It is
replaced by four breakdowns, each with its own chart **and** its own table:

| Dimension | Bands |
|---|---|
| Hour | 09:00 · 10:00 · 11:00 · 12:00 · 14:00 · 15:00 · 16:00 · Outside |
| Holding period | Intraday · 1–3 days · 4–7 days · 1–3 weeks · Over 3 weeks · Still open |
| Position size | Odd lot · 1–5 lots · 6–20 lots · 21–50 lots · Over 50 lots · Not recorded |
| Setup quality | 1–3 / 10 · 4–6 / 10 · 7–8 / 10 · 9–10 / 10 · Not scored |

- `hourBucket(entryAt)` buckets by the **Bursa trading hours** — one run to the 12:30 close, then
  14:30 to 17:00. 13:00 is deliberately not a bucket: the axis jumps 12:00 → 14:00, so the lunch
  break is the gap rather than a row of zeroes. Anything entered outside both windows lands in
  `Outside`, which is a visible home for a fat-fingered entry time rather than a silent drop.
- `holdingBucket(entryAt, exitAt)` measures the position's life; `lotsBucket(shares)` divides by
  `BURSA_BOARD_LOT`; `qualityBucket(trade)` averages whichever 1–10 scores a trade carries.
- **A band with no trades keeps its slot.** The bucket lists are the axis order and the tables seed
  every band up front, so switching the filter never reshuffles the other bands around a gap. Empty
  bands render as a dimmed `—` row (`.row-idle`).
- Each table carries **Name · Trades · Win % · Avg / trade · P&L**. Average per trade is money, not
  R: it is comparable across bands even before any stop loss is recorded.
- The **Expectancy** and **Avg R** cards no longer print `+0.00R` when nothing has a stop loss — a
  zero that reads like a break-even edge but is really an absence. Expectancy falls back to money
  per trade ("per trade · no stop losses recorded") and Avg R shows `—` ("needs a stop loss"), until
  a trade carries an R multiple.
- Bar tooltips name the sample size (`18 trades : RM -882.54`) rather than just `P&L`, because a
  band is only as meaningful as the number of trades behind it; an empty band's tooltip — which the
  hover cursor still raises — reads `P&L : no trades` instead of `RM 0.00`.
- **The hourly table keeps the sessions.** `hourSession()` labels each hour `Morning · 9:00–12:30`
  or `Evening · 14:30–17:00`, and the table draws a band label above each run of hours with a
  **subtotal** line under it — so "am I better in the morning or the evening?" survives replacing
  the session chart. The hourly axis labels every hour (`interval={0}`) and recharts drops labels
  on the other banded charts where they would collide.
- **The tables fit their cards.** Five columns need ~420px, so `.table-compact` sets them tighter
  than the journal's full-width table and `.grid.two.breakdown-grid` keeps them paired only above
  1200px, stacking them full width below that — the P&L column is never scrolled out of sight. At
  700px and under the band name is the only cell that wraps, and the five columns still fit a
  390px-wide screen exactly.

## Verification

`npm run typecheck` and `npm run build` clean (`next/font` fetched Inter at build time). Checked
live against the real journal:

- Session select offers exactly `Morning · 9:00–12:30` and `Evening · 14:30–17:00`; an entry at
  10:00 sets Morning, 15:30 sets Evening, and a manual pick stops the auto-follow.
- All 18 diary trades (stored as `Bursa Morning`) display **Morning** in the journal, the detail
  page and the session filter; filtering by Morning returns all 18, Evening returns none.
- Toggling to light flips `--bg/--panel/--surface/--input` to the light values and the charts
  render light green/red/accent (`rgb(15,157,88)` / `rgb(217,45,63)` / `rgb(109,92,240)`);
  toggling back restores the dark palette, and the page no longer scrolls horizontally.
- The dashboard draws 7 sparklines over 18 trades (Current Equity has none until an account is
  picked), each with 18 points; Net P&L and Max Drawdown fall, Win Rate and Profit Factor climb,
  and Average R — which has no R data in the imported diary — is a flat line.
- Section gaps measure a uniform 14px on the dashboard, analytics, the journal and the trade detail
  page; the filter bar collapses from 9 fields to 0 and back, and Reset is disabled until a filter
  is set.
- The hourly table reads `MORNING · 9:00–12:30`, then `09:00 · 18 trades · 16.7% · RM -882.54`
  with `10:00`–`12:00` empty, then `Morning total 18 · RM -882.54`; `EVENING · 14:30–17:00` follows
  with 14:00/15:00/16:00 empty and `Evening total —`; `Outside` is the last row. The chart labels
  all eight bands 09:00 → Outside with no overlapping text, and skips 13:00.
- The analytics page reconciles against the diary: **Holding period** over 3 weeks gives
  `6 trades · 33.3% · RM +62.04 avg · RM +372.23`, 1–3 weeks gives `8 trades · 12.5% · RM -716.23`,
  and every band sums back to the dashboard's `RM -882.54` over 18 trades. **Position size** splits
  them `6–20 lots: 2`, `21–50 lots: 13`, `Over 50 lots: 3`; **setup quality** is entirely
  `Not scored: 18`, since the imported diary has no scores — the band is there waiting for them.
- Money reads `RM -882.54`, `RM 1,825.00`, `RM +100.00` across the dashboard, journal, analytics,
  calendar, accounts, both trade forms and the detail page, while share prices keep their
  precision (`RM 0.365`) and a blank field stays `—`.
- The calendar's month and year pickers, both arrow pairs and Today all move the cursor correctly
  (September 2025 -> December 2025 -> December 2026 -> Today -> September 2026, with 14 September
  ringed as today). With an RM11,000 starting balance the day cells read `RM -241.03 / 1 trade ·
  -2.22%`, the month card `RM -477.67 / -4.39% of capital`, and the 3 September pop-up shows a
  start balance of RM 10,877.76 (RM11,000 plus the RM122.24 lost earlier) and an end balance of
  RM 10,636.73. That test account was deleted afterwards.
- The pop-up opens by click and by keyboard, and closes on Escape, the close button and a backdrop
  click, restoring page scroll each time; **View in Journal** lands on
  `/journal?from=2025-09-03&to=2025-09-03` with the filter bar showing that range and exactly one
  matching trade.
- At 390px the calendar has no horizontal overflow (document width 379px), the pickers wrap onto
  their own row, cells are ~51px wide with the figure kept unbroken, the percent is hidden in the
  cell and the pop-up is bottom-anchored at 776px tall with its balance tiles in three columns. The
  year strip scrolls inside its own 319px card (1371px of content) without widening the page, its
  header and data columns stay aligned (`aligned: 0`px), and the pinned year label sits at the
  container edge (`0`px) while scrolled.
- The journal table's money and date cells each render on one line (cell `scrollWidth` equals its
  `clientWidth`) and the table scrolls inside its own wrapper; the topbar's controls sit 28px from
  the right edge at 1175px and 14px at 500px (the topbar's own padding at each breakpoint).
- Quick add: the floating pill reports `href="/journal/new"`, `aria-keyshortcuts="n"` and the
  text `Add trade N`, sits 26px from the bottom-right corner at `z-index: 40` (below the day
  modal's 80, so a dialog covers it), and disappears on `/journal/new`. Pressing `N` from the
  dashboard, journal and calendar lands on the new-trade form; pressing it inside the journal's
  search box, with `Ctrl` held, or while the calendar day modal is open does **not** navigate.
- At 500×535 the pill is a 42px circle 78px above the bottom edge (clearing the nav), `.main`
  reports 142px of bottom padding, and the last journal row's bottom sits 50px above it.
- Long-only: the journal's headers are `Date, Symbol, Strategy, Session, P&L, R` with no badges in\n  the rows, the dashboard's recent trades match, the detail page title reads `CHEEDING` with no\n  direction, both forms show no Long/Short buttons, and the day pop-up reads `Trades 1 / Symbols 1`.\n  Auto-calculation is untouched: 2,000 shares at 0.35 → 0.40 still gives `Gross: RM +100.00` and\n  `Net after charges: RM +81.55`.
- Accounts edit, end to end on a throwaway account: Edit opened `Edit Account` pre-filled with\n  `ZZ Edit Check / mplus / personal / MYR / 500`, **Save Changes** renamed it to `ZZ Edit Check 2`\n  in the list, and Delete removed it — the real `test` account was left as it was. Strategies: Edit\n  opened `Edit Strategy` pre-filled with `EMA 20`, its description and rules, and saving the same\n  values succeeded with the card unchanged.
- Settings: the profile card loads `dyno` and the email field shows the signed-in address; saving
  the name reports "Name updated.", a 7-character password is rejected with "Use at least 8
  characters." and a mismatched pair with "The two passwords do not match." (no writes made), and
  the avatar's tooltip carries the name.
- At 500×535 (the reported window size) the bottom nav is fixed at 64px with `z-index: 30`, `.main`
  pads 84px, and the last journal row's bottom edge sits 56px above the nav — plus no horizontal
  overflow on any of the ten routes.
- Grid columns measured in real iframes: the dashboard's eight metric cards sit **four per row at
  1440px** (272px each, one row of tops), two per row at 1200px and 944px, one per row at 390px;
  the filter bar keeps four columns at 1440/1200px, two at 944px and one at 390px; `grid three`
  pages (Accounts, Strategies, both trade forms) show three across on a wide screen, and no width
  produced any horizontal page overflow.
- The strip's 2025 row sums to **RM -882.54 across 18 trades**, matching the dashboard total, and
  every month reconciles: `-309.56 (2) -262.05 (2) -95.94 (1) -83.32 (1) +294.14 (1) +325.85 (3)
  +8.64 (2) -477.67 (3) -261.63 (2) -21.00 (1)`. 2026 is all `—` with an empty YTD.
