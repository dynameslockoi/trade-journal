## Phase 12

An external audit of this project came back with 40 findings; this phase answers them one by one.
**Nine were real and are fixed**, including two that changed numbers you read every day: **Average R
was dividing by every trade instead of the trades that have a stop** (with 1 of 209 trades carrying
one, the dashboard reported ≈ +0.01R instead of +1.53R), and **"Current Equity" was adding a
*filtered* P&L to the account's starting balance**. Max Drawdown is now quoted against capital
(`18.8% of RM 11,000`) instead of against the P&L peak it used to report as `1999.5%`. A failed query
no longer renders as an empty journal — every page names the error and suppresses its own blocks —
and the whole day/session/hour axis now runs on **Malaysia time** rather than the viewer's clock,
including the date fields, which fixes "today" being yesterday before 08:00. `next.config.ts` adds
security headers; the auth callback reports a failed exchange. `supabase/hardening.sql` is **new and
needs running once**: it makes "this trade's account belongs to me" a database constraint (a
composite foreign key), constrains the columns the app already assumes, sets the storage bucket's own
size and MIME limits, and adds indexes for the journal's reads. `npm run test:calc` adds 77
calculation checks (`npm test` runs them with the fee checks). See `PHASE12.md`, which also records
the eleven findings that were **not** what they claimed, and why.

## Phase 11

Every date field in the app is now its own control — a `react-day-picker` month grid in a Radix
popover (`components/ui/date-picker.tsx`), for the filter bar's From/To, both trade forms' entry and
exit stamps, the reviews dates and the zakat payment date. The browser's own `<input type="date">`
pop-up ignores CSS custom properties, so it arrived as a light sheet in dark mode; these follow the
same tokens as everything else. Values are unchanged (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`), converted in
local time by `lib/dates.ts`. **Tags moved in with Strategies** — one page, two tabs, with `/tags`
redirecting there, so two small label lists no longer hold two sidebar slots. The journal's column menu
got its tick back (the mark was 12px with a 1.5px stroke in a 17px box, which read as a smudge) and no
longer ends in a label-less row. See `PHASE11.md`.

## Phase 10

The UI is built on **shadcn/ui** with **Radix** primitives, and the journal's table on **TanStack
Table** — sorting, free-text search, paging and a column-visibility menu. The colours did not move:
an `@theme inline` bridge points shadcn's semantic names (`bg-card`, `border-border`, `rounded-md`)
at the tokens already in `app/globals.css`, so there is still one place a colour is written down.
The stylesheet now lives in `@layer components` so a utility written next to one of its classes
actually applies. What changed in behaviour: the hand-rolled listbox is a real Radix **Select**, the
calendar day pop-up is a Radix **Dialog**, deletes ask in a themed **AlertDialog** instead of the
browser's `confirm()`, Settings and Reviews report through **toasts**, and the phone's navigation is
a bottom bar with a **More** sheet rather than ten icons scrolling sideways. See `PHASE10.md`.

## Phase 9

The full diary came in: **208 trades across 2020–2026** from `record.xlsx`, tagged `record.xlsx diary`
so the batch filters or deletes as one thing. **IPO allocations are first-class** — `trades.is_ipo`, a
yellow `IPO` badge in the journal and on the trade page, a checkbox on both forms and an Entry filter
— and a new **Zakat page** computes each year's zakat (2.5% by default, editable per year) against a
choice of base, with an optional nisab threshold and a log of payments already made. Run the Phase 9
block in `supabase/schema.sql` to enable the IPO flags, the zakat settings and the payment records;
the journal and the zakat figures work either way. Every dropdown is the app's own listbox instead of
a browser `<select>`, which the browser draws in its own colours — themed in both light and dark,
keyboard-driven, and unable to run off the edge of the window. (Phase 10 rebuilt it as a Radix Select
in `components/ui/select.tsx`.) See `PHASE9.md`.

# Trading Journal Pro — Phase 4

Phase 4 adds the core journal workflow:
- Secure private Supabase Storage screenshot upload.
- Storage RLS scoped to the user's folder.
- Trade detail with signed screenshot URLs.
- Trade tags and tag management.
- Psychology mistake field.
- MAE/MFE fields.
- Holding-time calculation.
- Automatic risk and R-multiple calculation in the entry form.
- Account CRUD and Strategy CRUD from Phase 3.
- Real current-month P&L calendar and real analytics from previous phases.

## Setup
Run the complete `supabase/schema.sql` in Supabase SQL Editor (it is idempotent, so re-running it
applies any phase you have not run yet). It creates the tables, RLS policies and the **private** `trade-screenshots` Storage bucket with its folder-scoped policies, so no manual bucket setup is needed.

Set `.env.local` (copy `.env.example` and fill it in):
```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
```
Only the anon/publishable key is used — every table is guarded by per-user RLS, so the app never needs
a service-role key.
Then run `supabase/hardening.sql` **once** (Phase 12). It adds the ownership constraints, the
column-level checks, the storage bucket's size and MIME limits and the journal's indexes. Everything
in it is `NOT VALID`, so no historic row is rejected, and it is safe to re-run.

Then:
```bash
npm install
npm run dev
```

```bash
npm test        # fee engine + 77 calculation checks
npm run typecheck
npm run build
```

Screenshot paths are stored as `<user_id>/<trade_id>/<uuid>-filename`; the app only creates short-lived signed URLs after checking the user's authenticated session.

## Next phase
- Full trade edit/update workflow.
- Account selector and date-range filters across dashboard.
- Advanced journal filters.
- Daily/weekly review persistence and templates.
- Richer analytics: weekday/hour, strategy expectancy, session expectancy, R distribution, streaks, MAE/MFE analysis.

## Phase 7
Bursa Malaysia stock trading: automatic gross P&L, automatic broker fees (M+ Global, Moomoo Malaysia
and a generic Bursa preset), board-lot entry, per-account brokers, and a cost breakdown on every
trade. R multiples are now stored from net P&L. See `PHASE7.md`.

Run the two idempotent column additions in `supabase/schema.sql` (also listed in `PHASE7.md`) to
enable the broker dropdown and the stored fee breakdown.

## Phase 8
Trading sessions are the two Bursa windows — **Morning** (9:00–12:30) and **Evening**
(14:30–17:00) — picked automatically from a trade's entry time, and rows saved under an older
session name still display correctly. The app also ships a **dark/light theme toggle** in the
topbar (choice persisted per browser), plus a token-based design refresh: Inter typography,
layerable cards with sheen and shadow, a frosted topbar, gradient buttons, gradient-filled charts
and metric sparklines. Every figure is shown in currency with grouped thousands (`RM 1,725.06`),
the filter bar collapses, the topbar shows your profile name, and every page is phone-responsive.
The **P&L calendar** shows each day's P&L, trade count and return on capital, navigates by month or
year, opens a day pop-up with balances, trade stats and links into that day's trades, and closes
with a **yearly performance strip** — months across, years down, each cell showing that month's P&L
and trade count with a YTD column. Filters start collapsed, the topbar carries the theme toggle,
a settings avatar and an icon sign-out, and **Settings** updates your display name, email and
password. A floating **Add trade** button (or the **N** key) logs a trade from any page. Analytics
breaks the journal down by **Bursa trading hour**, **holding period**, **position size in board
lots** and **setup quality** — chart and table per dimension, with the hourly table banded by
morning and evening session and a subtotal per band. See `PHASE8.md`.

## Phase 6
Stability/polish pass completed. AI Trading Journal Analysis is intentionally deferred to a later phase.

Highlights: correct local timezone handling for trade timestamps, safer screenshot uploads/deletion, stronger trade/tag RLS, reusable trading calculations, account equity from journal P&L, calendar month navigation, better filters, and responsive UI polish.
