## Phase 9

The full diary came in: **208 trades across 2020–2026** from `record.xlsx`, tagged `record.xlsx diary`
so the batch filters or deletes as one thing. **IPO allocations are first-class** — `trades.is_ipo`, a
yellow `IPO` badge in the journal and on the trade page, a checkbox on both forms and an Entry filter
— and a new **Zakat page** computes each year's zakat (2.5% by default, editable per year) against a
choice of base, with an optional nisab threshold and a log of payments already made. Run the Phase 9
block in `supabase/schema.sql` to enable the IPO flags, the zakat settings and the payment records;
the journal and the zakat figures work either way. Every dropdown is now the app's own listbox
(`components/select.tsx`) instead of a browser `<select>`, which the browser draws in its own colours —
themed in both light and dark, keyboard-driven, and unable to run off the edge of the window. See
`PHASE9.md`.

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
Then:
```bash
npm install
npm run dev
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
