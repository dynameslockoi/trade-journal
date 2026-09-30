# Trading Journal Pro

A personal trading journal for **Bursa Malaysia** — one place to record what you traded, why you took
it, what it actually cost, and which part of your own behaviour paid for the rest.

It is a Next.js app on your own Supabase project: trades, screenshots, reviews and zakat records live in
*your* database behind per-user row-level security. No service-role key reaches the browser, and no
market-data vendor is involved.

---

## Why this exists

A spreadsheet diary records fills. It cannot answer the questions a trader actually has, and on Bursa
it gets several of the numbers wrong:

- **A diary has no "why".** The reason you entered, the mistake you made, the session you traded, the
  sector the stock belongs to, the screenshot you took — none of it fits in a price column, so it never
  gets kept, and a year later the only thing left is a P&L figure with no lesson attached.
- **Malaysian costs are per leg, not per trade.** Brokerage, clearing fee, stamp duty and SST are
  charged twice on a round trip, each with its own minimum, cap and exemption rules (M+ Global's RM8
  minimum, Moomoo's RM3 platform fee, stamp duty capped at RM1,000 on shares and RM200 on
  warrants/REITs, ETFs exempt). Typing one "fees" number into a spreadsheet hides all of that, and it
  hides which broker is actually cheaper for the size you trade.
- **An IPO allocation is not a market buy.** Applying through M+ Global or Moomoo costs nothing in cash,
  Maybank charges RM1.08, and borrowing to apply costs real interest. A diary that charges the standard
  opening leg overstates every allocation you ever received.
- **Equity is money in and money out, not one opening balance.** The moment you top up an account or pay
  yourself, percentages computed from the opening figure start drifting.
- **The record must not silently change.** Re-opening a trade to attach a screenshot must not rewrite
  what it earned.
- **Zakat is annual.** It is due on the year's trading, at a rate that changes, and payments are made
  against a year later — which is a database problem, not a spreadsheet one.

Everything below exists to serve those five things.

---

## What it does

### Sign in and sign up

Email + password accounts on Supabase Auth. Signing up sends a confirmation email; the link returns
through `/auth/callback`, which exchanges the code for a session. A display name is stored on the
profile and shown in the top bar. Every page except the auth pages requires a session, and the
middleware keeps the session cookie fresh on every request.

**Sign-up is invitation only.** A code is required, and it is checked by the database rather than by the
form — a trigger on `auth.users` refuses an account that arrives without a usable code, so posting
straight to the auth API does not get around it. Codes are stored as upper-case letters and digits, so
the dashes and capitals they were written with do not matter. Who is allowed in, and which codes exist,
is the **Admin** page below.

### Dashboard (`/`)

The state of your account at a glance: **Net P&L**, **Win Rate**, **Profit Factor** and **Expectancy**
(per trade, or in R when you record stop losses), then **Max Drawdown** — as a percentage of your live
capital when the cash ledger is set up — **Avg R**, and your best win and loss streaks. Each metric card
carries a small sparkline so you can see the trend behind the number rather than only its value. Below
that: the **equity curve**, the capital the percentages divide by, and your most recent trades.

### Journal (`/journal`)

Every trade in one sortable, searchable, paginated table: date, symbol (with an **IPO** badge on
allocations and a sector chip on the first row of a run), sector, strategy, session, net P&L and R
multiple, with a per-row menu for the things that act on a single trade. Columns can be toggled from the
**Columns** button and any sortable column sorts.

**Filters** are collapsed by default — unhide them when you need them and they stay out of the way
otherwise. Available: account, symbol, strategy, **sector**, session, result
(win/loss/breakeven), **IPO vs open market**, date range and tag. The text search covers symbol, sector,
strategy and session. The **Sectors** button classifies whole symbols at once: pick a sector for a
ticker and every trade of that ticker is updated in one write, which is how 200-odd historical trades get
organised without 200 edits.

Clicking a row opens the trade.

### The trade form (`/journal/new`, `/journal/[id]/edit`)

- **Symbol and sector.** A sector is a property of the stock, so it sits beside the ticker and fills
  itself in from your last trade of that symbol rather than being picked again.
- **Position is entered in lots** (100 shares) and stored as shares, because that is what the brokers'
  charges are levied on.
- **Entry and exit prices, stop loss, take profit, risk.** Gross P&L, risk and R are computed from these
  and shown live in a calculation strip.
- **Dates and sessions.** Sessions are the two Bursa windows — **Morning** (9:00–12:30) and **Evening**
  (14:30–17:00) — and the session follows the entry time until you pick one yourself.
- **Account and strategy**, so the analytics can group by either.
- **Psychology**: emotion, mistake, and 1–10 setup, execution and discipline scores; MAE/MFE; free notes.
- **Screenshots** three ways — the file picker, drag and drop onto the box, or **paste anywhere on the
  page**, which is the fastest route when the chart is already on your clipboard. Files are validated
  against the same rules as the storage bucket before anything is saved, and duplicates are caught by
  name and size. Clicking a screenshot opens it full size with a **comment box** that is saved as its
  caption, so the grid says what each picture is.
- **Fees & Charges** — the broker preset, the intraday flag, an SST override, and a live fee panel
  showing each leg's components (brokerage, platform, clearing, stamp duty, SST) and the total. On an IPO
  allocation this is replaced by the **IPO subscription** block described below.
- **Auto-calculate** off lets you type every figure yourself, for anything the model does not cover.

### Trade detail (`/journal/[id]`)

The full record: gross P&L, charges, net P&L and R multiple as headline tiles, then risk, contract value
(in lots), holding time and sector; a Trade Details panel with account, strategy, broker, entry, exit,
position, stop loss, take profit, session, risk %, MAE and MFE; fees broken down leg by leg (or the IPO
subscription that replaced the opening leg); the psychology scores; notes; tags; and the screenshot
gallery. Deleting a trade removes its screenshots from storage as well.

### Analytics (`/analytics`)

Where the edge actually comes from, in three layers:

1. **Eight P&L charts, paired by the question they answer** — *Strategy* with *Sector* (what you trade),
   *Hourly* with *Weekday* (when), *Holding Period* with *Position Lot* (how long and how big), *IPO* with
   *Setup Quality* (how the trade came to you, and how it was executed). Banded dimensions draw a fixed
   axis so bands do not reshuffle under you, the hourly axis skips the 12:30–14:30 break, and sectors are
   ordered by what they actually paid. *IPO P&L* compares allocation trades against open-market ones.
2. **Equity Curve** and **R Distribution**, plus a **Sector Sentiment** strip: one row per sector, one
   column per month, each cell that sector's P&L in that month with a sparkline of its running total —
   so a sector warming up or going cold is visible instead of only its all-time total. Clicking a cell
   filters the page to that sector's month.
3. **Eight breakdown tables** under the same headings, with per-group trades, win rate, average and P&L,
   and subtotals per session band on the hourly table.

Every chart, table and percentage respects the same filter bar, and the capital used for drawdown comes
from the cash ledger.

### Calendar (`/calendar`)

A month grid where each day shows how much it made and **how many trades** it held, with the day's P&L
as a share of capital. Clicking a day opens a detail view of that day's trades. Month and year pickers
step quickly through history, today is marked, and a **yearly performance strip** underneath lays months
across and years down with each cell's P&L and trade count, so you can read a year at a time.

### Accounts (`/accounts`)

Capital is a **money-flow ledger**, not a number you type: record every **deposit** and **withdrawal**,
and equity becomes `(deposits − withdrawals) + the journal's P&L`. That stays right even when the money
you take out *is* profit, because the withdrawal is money out and the P&L stays separate. Each account
card shows equity, net capital, journal P&L, money in/out and its latest movement, with the whole ledger
one click away in a dialog — so a busy account cannot make the card grow without bound. Creating an
account records its opening balance as the first deposit.

### Strategies & Tags (`/strategies`)

Strategies with a description and rules, and tags with a category. Both are used by the journal and the
analytics, so a setup you cannot name is a setup you cannot evaluate.

### Reviews (`/reviews`)

**Daily** — whether you followed your plan, an execution score, a mood score, and prompts for what went
well, your biggest mistake and tomorrow's plan. **Weekly** — what happened, the lessons and recurring
patterns, and an action plan for next week.

### Zakat (`/zakat`)

Per calendar year: the **rate** (2.5% by default, editable and remembered per year so an old year's rate
is never rewritten by today's), what it is applied to — the **year's net P&L** (losses offset wins), the
**winning trades only**, or a **manual base** — plus other zakatable income and an optional **nisab**
threshold below which nothing is due. Record each **payment** with its date, channel and note, and the
page shows what is due, what has been paid and what is outstanding. Years are kept separately because
zakat is normally settled after the year closes.

### Settings (`/settings`)

Display name, sign-in email (a confirmation link is sent to the new address before it takes over) and
password. The **theme** — dark or light — is a top-bar toggle, remembered per browser, and every chart is
theme-aware.

### Log a trade from anywhere

A floating **Add trade** button sits at the bottom-right of every workspace page with the `N` chip on it,
and pressing **N** opens the new-trade form — unless the caret is in a field, so typing an `n` in your
notes does not open a form.

### Admin (`/admin`) — the page customers never see

This is for the install that is sold to other people: **who is using it, and who may still get in**. The
sidebar link only exists for an admin, and the page refuses everyone else.

- **Accounts** — every account with when it joined, whether it can sign in, how many trades it has logged
  and when it last traded, plus the invitation code it came in on. It is **counts and dates only**: the
  function behind it returns no trade rows at all, because running a business on top of other people's
  journals does not require reading their P&L.
- **Access is a switch, not a subscription.** Each account is *active* or *suspended*, optionally with an
  **end date**. A date in the past locks the account out on its own, so a fixed term needs nothing to run
  when it expires — there is no plan table, no renewal job and no billing webhook to keep alive.
- **Invitation codes** — create one (typed, or generated with one click), give it a note, a number of uses
  and an end date, and see which accounts used it. *Switching a code off* is how you stop a shared code
  going further; the accounts it already created keep pointing at it.
- **Nothing gets deleted.** A suspension is reversible from this page, and an account's data is untouched
  while it is locked.
- **Create an account by hand.** *New account* makes one that is already confirmed, so it works the
  moment it exists with no email round trip: the case of a test or demo login on an address nobody can
  check, or a customer you are onboarding yourself. The password is shown so it can be handed over (there
  is a generator for one), and the end date is set as the account is made. The invitation gate is not
  weakened by this: the exemption applies only when the caller is an administrator, which the SQL tests
  send as a request from a customer and from an anonymous context to prove.
- **What "writing GoTrue's tables directly" actually costs.** GoTrue fills several of its columns in code
  rather than in a schema default, and it reads them back into values that cannot hold NULL — so a
  hand-written account has to supply them itself, or it fails in a way that looks like anything but a
  database problem: the account exists, the password is right, and sign-in answers *invalid credentials*
  because the lookup that matches an email goes through columns that are NULL (audience, role, instance),
  or *500 Database error querying schema* when the row is found and cannot be read (the timestamps and
  token strings). `create-user.sql` fills all of them, repairs accounts left stranded by its own earlier
  version, and ends with a query that lists any account still in that state — expect it to return no rows.
- **The customer is told, rather than surprised.** Once a fortnight is left on an end date, an amber
  countdown band sits above every page and can be dismissed for the session. The date itself always lives
  on the Settings page, so an account with a year to run is never nagged about it — and the blocked screen
  names the date the same way the rest of the app writes one ("8 Sept 2025") rather than the raw ISO
  string the gate carries internally.

A suspended or expired account does not merely get a warning: the shell renders a full stop instead of the
journal, and the sign-in page refuses the account too. The check costs nothing on a navigation; it is one
cached read per session, the same one that decides whether the Admin link exists.

**The database enforces it as well.** Closing the app is not enough on its own — Supabase Auth knows
nothing about your `profiles` table, so a switched-off customer could sign in again with the password they
already have and read and write their whole journal through the API, while every policy in the project
asked only whether a row was theirs. `supabase/access.sql` adds `is_active()` and puts it into every
policy that hands out a row, tables and the screenshot bucket alike, so a suspended or expired account is
refused by Postgres itself. An admin is always allowed, and a missing profile row is treated as allowed,
because failing closed would turn a database that has not had `admin.sql` run yet into an empty journal
for everyone on it.

---

## How the numbers work

**Gross and net.** `gross_pnl = (exit − entry) × shares`, and `net_pnl` is a *generated column* in
Postgres: `gross_pnl − commission − swap − fees`. The database is the final authority, so no page can
drift from another.

**Charges are computed per leg.** Each leg (opening contract and closing contract) is charged separately
using the trade's broker preset:

| Preset | Brokerage | Platform | Clearing | Stamp duty | SST |
|---|---|---|---|---|---|
| **M+ Global** | 0.08% to RM50k, 0.05% above, min RM8, intraday 0.05% | — | 0.03%, capped RM1,000 | RM1 per RM1,000, capped RM1,000 | on brokerage, for warrants/REITs/ETFs |
| **Moomoo Malaysia** | 0.03% | RM3 per order | 0.03%, capped RM1,000 | RM1 per RM1,000, capped RM1,000 | on brokerage + platform + clearing, for warrants/REITs/ETFs |
| **Other Bursa broker** | 0.08%, min RM8 | — | as above | as above | as above |

Stamp duty caps at RM200 for warrants/REITs and is exempt on ETFs; ordinary shares pay no SST. Every
figure can be overridden by turning **Auto-calculate** off, and `commission` holds the broker-side charges
(brokerage + platform + SST) while `fees` holds the market's (clearing + stamp duty).

**An IPO subscription replaces the opening leg.** Applying for an allocation is not a market buy, so
there is no brokerage, clearing fee or stamp duty on the buy side — only the channel's own charge, and
only the sell side is an ordinary market trade:

| Application channel | Cash | Financing |
|---|---|---|
| **M+ Global** | free | 2x / 5x / 10x (50% / 80% / 90% financed) at **8% p.a. ÷ 365 × interest-bearing days**, plus 8% SST, refunded if you are not allotted |
| **Moomoo Malaysia** | free | **6.8% p.a.**, charged daily |
| **Maybank eShare** | **RM1.08** (RM1 + 8% SST), non-refundable | not offered in the app |

Leave the financed amount blank and it defaults to the tier's share of the trade's contract value (7 days
of interest by default, editable). The terms travel with the trade, so a saved charge is not recomputed
against a changing date.

**Recorded figures are kept unless you change a money input.** Opening a trade to add a note, a tag, a
sector or a screenshot writes back exactly what was recorded. The form compares the prices and size
(gross P&L), those plus the broker and its settings (charges), and the stop (risk and R) — each separately
— and it says which of the two it is about to write, naming the difference when the stored prices and the
stored figures disagree. An old trade therefore only re-prices when you actually edit it.

**Times are Malaysian.** Days, weeks, months and years are all resolved in `Asia/Kuala_Lumpur`, so a trade
opened at 00:30 on 1 September is a September trade rather than an August one.

---

## Setup

### 1. Prerequisites

- **Node.js 20+** and **npm** (the repo has a `package-lock.json`; use `npm install`, not another client).
- A **Supabase project** — the free tier is enough. Everything runs against it: Postgres, Auth and
  Storage.

### 2. Create the database

In your Supabase project, open the **SQL editor** and run these seven files from `supabase/`, **in this
order**. Each one is written to be re-runnable, so a second run is harmless:

| File | What it creates |
|---|---|
| `supabase/schema.sql` | The tables (`profiles`, `trading_accounts`, `strategies`, `trades`, `tags`, `trade_tags`, `trade_screenshots`, `daily_reviews`, `weekly_reviews`), indexes, per-user RLS policies, the new-user trigger, and the **private** `trade-screenshots` storage bucket with its folder-scoped policies. |
| `supabase/hardening.sql` | The same-owner composite keys (so a trade cannot reference someone else's account), the shape constraints on session/symbol/side, the storage size and MIME limits (10 MB; PNG/JPEG/WEBP/GIF). Constraints are added `NOT VALID`, so your existing rows are never rejected. |
| `supabase/sectors.sql` | `trades.sector` and its index, for the sector column, filter, charts and the sentiment strip. |
| `supabase/cashflow.sql` | `account_cash_flows` — one row per deposit or withdrawal — and seeds each account's existing opening balance as its first deposit. |
| `supabase/admin.sql` | Invitation-only signup (`invite_codes` plus the trigger that enforces it), the access columns on `profiles` (`is_admin`, `status`, `access_until`, `note`, `invite_code`), the admin-only functions the Admin page calls, and a guard that stops a signed-in account writing those columns to its own row. |
| `supabase/access.sql` | Adds `is_active()` and puts it into every policy that hands out a row — tables *and* the screenshot bucket — so a suspended or expired account is refused by Postgres, not only by the app. Run it after `admin.sql`. |
| `supabase/create-user.sql` | **Run this last.** Adds `admin_create_user()`, which lets the Admin page create an account that is already confirmed — for a test login on an address nobody can check, or a customer you are onboarding by hand — and with its end date set as it is made. Also teaches the signup trigger the one exemption that makes it possible, without opening the invitation gate to anybody else. |

Two notes on `admin.sql` and `create-user.sql`, both easy to miss:

- **Promote yourself.** The file ends with a single commented `update` that gives your own account the
  admin flag. Replace the placeholder address and run that one statement, or the Admin page will tell you
  it is not set up. On a brand-new install the first account is promoted automatically, but a database
  that already has profiles needs the statement.
- **Run `admin.sql` and `create-user.sql` again if you re-run `schema.sql`.** That file recreates the new-user trigger without the code
  check, which would quietly reopen signups. `schema.sql` also recreates the per-user policies without
  the access clause, so re-run `access.sql` after it for the same reason.

Nothing in the app depends on a service-role key; the browser talks to Postgres with the anon key and is
constrained by RLS. The admin reads and writes go through `security definer` functions that check
`is_admin()` first, so a customer's browser can no more read another account than it can read another
journal. That includes creating an account: `admin_create_user()` writes the user into GoTrue's own
tables with its confirmation date already set, which is how the Admin page can hand somebody a working
login while "Confirm email" stays on for everybody signing up themselves.

### 3. Point Supabase Auth at your app

In **Authentication → URL Configuration**, set the **Site URL** to where the app runs and add the
origins you sign in from as **Redirect URLs** (`http://localhost:3000/**` for local work, plus your
deployed URL). Email confirmation returns to `/auth/callback`, and anything missing from that list is
refused by Supabase before the app ever sees it.

### 4. Configure the environment

The app reads a plain **`.env`** in the project root:

```bash
cp .env.example .env
```

```ini
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your anon / publishable key>
```

Both values are on your project's **Settings → API** page. Only the publishable key is used — there is no
`SUPABASE_SERVICE_ROLE_KEY` anywhere in this project, and none is needed.

### 5. Install and run

```bash
npm install
npm run dev          # http://localhost:3000
```

Open the app, **create an account**, confirm the email, sign in — and log your first trade. The journal
starts empty unless you ask for the demo journal in step 7.

With `admin.sql` in place you cannot create that first account until a code exists, so **create your own
code first**, in the SQL editor:

```sql
insert into public.invite_codes(code, note) values ('MYFIRSTCODE', 'me');
```

Sign up with it, run the promotion statement at the end of `admin.sql`, and the **Admin** item appears in
the sidebar.

### 6. Verify the install

```bash
npm run typecheck    # tsc --noEmit, 0 errors expected
npm test             # fee model, calculations, access rules, the demo journal, and the SQL run for real
```

Then, in the app: add an account with an opening balance, record a trade, and check that the Accounts page
shows it under *Movements*. If a page reports a missing column, one of the five SQL files above has not
been run yet — the app degrades instead of breaking, and says which script it wants.

### 7. Optional: a demo account

If you want to show the journal to somebody — a buyer, a friend, a support call — give it an account of
its own and fill it with a generated Bursa journal:

1. On the **Admin page**, press **New account** and fill it in: an address (it does not have to exist —
   nothing is emailed to it), the password you want to hand over, and an end date if the demo should
   expire on its own. The dialog shows the credentials when it is done so you can copy them out.
2. Write the journal into that account:

```bash
DEMO_PASSWORD='the password you just set' npm run demo:seed
```

That creates two demo broker accounts with deposits and withdrawals, ~60 long-only Bursa trades with real
M+/Moomoo charges, strategies, tags, and a fortnight of daily reviews. Sign in as the demo account to see
it. `npm run demo:clear` removes all of it and leaves the login alone.

Two things worth knowing:

- **It writes as that account, not as an administrator.** `scripts/demo-data.mts` signs in with the demo
  password and goes through the anon key like the app does, so it can only ever reach that account's own
  rows — no service-role key, nothing to leak. It refuses to run at all if the account it signed in as is
  an administrator.
- **The data is random but seeded**, so a re-run produces the same journal rather than a diff, and every
  row it writes carries a *Demo data* tag. Because rows are scoped per user, none of it appears in your
  own analytics or zakat — the demo account shows up in the Admin page's account list and trade count,
  and nowhere else.

### 8. Deploy

Any Node host that can run `next build` / `next start` (Vercel is the shortest path). Set the same two
environment variables there, add the deployed origin to Supabase's redirect list, and you are done. The
security headers in `next.config.ts` (CSP with `frame-ancestors 'none'`, `nosniff`, referrer policy,
permissions policy, HSTS) are applied by Next itself.

---

## Why the pages change instantly

Every page reads the same handful of row sets — trades, accounts, strategies, tags, cash flows, zakat —
so the app fetches each one **once** and keeps it, rather than re-querying on every page you open. Four
parts make that work, and they are worth knowing about before touching a page's data loading:

- **`lib/queries.ts`** holds one query per row set — the column list, the embeds and the order, as a
  function that takes a Supabase client — so the server and the browser ask for exactly the same rows.
  `lib/data.ts` wraps each of them in the cache, one loader per row set. Pages call
  `useCachedQuery(KEYS.trades, loadTrades)` and get `{ data, error, loading }`; they do not build their own
  queries. This is also what lets the journal, the dashboard and the analytics share one copy of the same
  trades — and why a loader that throws is better than one that returns `[]`: a failed read has to look
  like a failure, not like an empty journal.
- **`lib/query-cache.ts`** is the store: a minute of freshness, one request per key at a time, and a
  background refresh that keeps the previous rows on screen. **A write calls `invalidate(...)`** for what
  it changed — that is the whole invalidation story, and it is why a saved trade appears in the journal
  without a reload. It marks the rows stale instead of dropping them, so the journal does not lose your
  column choices and search while the fresh rows travel.
- **The server reads them first.** `lib/seed.ts` runs those queries while it renders the page you asked
  for — it is talking to the same database anyway, for the session — and hands the rows down as a context
  value, so the first HTML already carries your numbers instead of a skeleton. On a production build that
  moved the figures from ~640 ms (the browser hydrated, then asked for nine separate row sets) to the
  first paint, and the browser now makes **no** Supabase request to show them. The seed is a head start,
  never a different answer: a key it could not read is simply left out and fetched by the page the way it
  always was, and the cache outranks it whenever it holds anything.

Two server-side details matter for the same reason: the middleware and the root layout check the session
with `getClaims()` (the session's JWT is verified against the project's cached signing keys) instead of
`getUser()` (a request to the auth server), and the layout reads your display name from the token rather
than querying `profiles` on every navigation. The chart library is a dynamic import, so the dashboard
paints its cards and trades before the few hundred kilobytes of charting code arrive — and the Supabase
browser client is imported **on demand** (`@/lib/supabase/browser`) rather than at the top of every
module, because after a seed a page that is already holding its rows never needs it. That took the
library, a quarter of the shell's JavaScript, out of the first load altogether.

---

## Checks

`npm test` runs eight check scripts, all of which exist because a plausible wrong number — or a rule
that quietly stopped applying — is worse than a crash:

- **`scripts/fee-check.mts`** — the published broker schedules (M+ worked examples, Moomoo's platform
  fee, the tariff boundaries and stamp-duty caps), the tiered/intraday rates, the IPO subscription maths
  for every channel including the financing formula and the cash-only case, and the split between the
  broker's charges and the market's.
- **`scripts/calc-check.mts`** — gross P&L, risk, R formatting, percentages, holding-time buckets, and the
  Malaysian-time day/month boundaries including leap Februaries. It also reads `lib/queries.ts` and asserts
  the projection every page shares still carries each field the calculators read, so trimming that list
  cannot silently turn a day's charges into zero; and it covers the date-range filter's Malaysian day
  boundary.
- **`scripts/admin-check.mts`** — the access rules: code normalising, generated codes, an inclusive end
  date, suspension outranking an end date, an admin that cannot be locked out, what a used, expired or
  switched-off code reads as, and the fortnight's warning window — its last day, the day it goes quiet
  again, and which of the three notices the band is willing to draw. It also reads `supabase/admin.sql` and asserts the parts that would fail
  silently — that the code normalisation the form uses is the one the database uses, and that the guard
  which stops a customer promoting themselves is still there and still not `security definer`.
- **`scripts/demo-check.mts`** — recomputes the generated demo journal from its own prices: gross P&L,
  risk from the stop, R measured after charges, board-lot sizes, entry sessions, no entry or exit on a
  weekend or in the future, exits never before their entry, an open position carrying no result, and the
  fee breakdown splitting the broker's side from the market's. A demo is the first thing a buyer sees, so
  a wrong number in it is the product disagreeing with itself in front of an audience.
- **`scripts/cache-check.mts`** — the client cache's failure behaviour: a healthy key is fetched once, a
  transient failure retries itself after the back-off with no navigation and no listener, a permanent one
  (a missing function or table) is left alone, and an invalidation or a clear cancels a retry already
  waiting. A cache that stopped retrying would not crash — it would just look like the journal went empty.
  It also pins what the server's seed may do: fill a gap, never override an answer the store already
  holds (a write's invalidation included), never hide a failure, and never be adopted while the server
  renders — that store is a module-level singleton there, and a write during one request's render would
  hand that trader's rows to the next request.
- **`scripts/picker-check.mts`** — the date picker's layout, which no other check can see: a panel
  that renders perfectly can still refuse every click if the caption is allowed to paint over the nav
  buttons. It pins the nav into the caption's row rather than an overlay, the month and year dropdowns
  with the native `<select>` hidden behind the label, the grid opting out of the journal's own `th`/`td`
  rules, and the circular chosen day.
- **`scripts/perf-check.mts`** — the two decisions that keep the first load small, neither of which is
  visible in any behaviour: the layout reads the shared rows on the server before it sends the page, and
  the Supabase browser client is reached through the on-demand accessor instead of imported outright. It
  reads the sources and fails if the layout stops seeding, if a module on the shell's own path starts
  importing `@/lib/supabase/client` directly, if the shell goes back to fetching rows in the background,
  or if the dashboard's chart stops being a dynamic import.
- **`scripts/sql-check.mjs`** — runs `schema.sql`, `admin.sql`, `cashflow.sql`, `access.sql` and
  `create-user.sql` against a real Postgres (PGlite, in WASM) inside a fake Supabase environment, then
  tries to break in: sign up with no code, reuse a spent one, promote myself, extend my own access, read
  the admin overview as a customer, create an account while claiming to be the administrator in signup
  metadata. It is the only check that executes SQL at all, and it caught a bug on its first run.
  It then walks the access gate from both sides — a suspended and an expired account refused on every
  table and on the screenshot bucket, and an ordinary account still able to save a trade, a tag, a
  review, a payment and a picture — because a wrong turn in that clause would not be a hole, it would
  be everybody's journal going empty.

---

## Project layout

```
app/                      routes (App Router)
  login, signup           auth pages
  auth/callback, signout  session exchange and sign-out
  page.tsx                dashboard
  journal/                list, new, [id] detail, [id]/edit
  analytics, calendar, accounts, strategies, tags, reviews, zakat, settings, admin
components/               shared UI: shell, sidebar, filter bar, stat cards, sparkline,
                          screenshots (input + gallery), sector tools, quick add, IPO fieldset,
                          access-denied, access-expiry (the countdown band)
components/ui/            shadcn/ui primitives on Radix + Tailwind
lib/
  queries.ts              the shared reads, run against whichever Supabase client is passed in
  data.ts                 one cached loader per row set, plus the cache keys
  seed.ts                 those same reads on the server, for the page's first HTML
  query-cache.ts          the client cache: TTL, de-duped requests, invalidation, the server's seed
  admin.ts                the admin RPCs: me(), the overview, access and invitation writes
  access.ts               who may sign in, and which invitation codes still work
  fees.ts                 the Bursa cost model and the IPO subscription model
  trading.ts              trade types, filters, stats, grouping, dates, zakat
  dates.ts                Malaysian-time helpers
  supabase/               browser (imported on demand), server and middleware clients
  utils.ts                cn()
supabase/                 the SQL files to run, in order
scripts/                  the check scripts (fees, calculations, access, demo, cache, picker, performance, SQL)
  demo-data.mts           generates the demo journal; `npm run demo:seed` / `demo:clear`
proxy.ts                  keeps the Supabase session fresh
next.config.ts            security headers
```

---

## Notes and limits

- **One trader, one dataset.** RLS scopes every row to its owner; there is no sharing, team or
  multi-tenant mode, by design. Selling it to other people means other people run their own copy — the
  Admin page manages access to a journal, it does not put two traders in one.
- **No plans, no billing.** Access is a switch and an optional end date, set by hand on the Admin page.
  Anything recurring would need a renewal job and a payment provider, and neither is here.
- **Nobody reads anyone's trades.** The admin functions return counts and dates; the only thing an admin
  can change about another account is whether it can sign in.
- **Bursa Malaysia conventions.** Long only, shares/REITs/warrants/ETFs, positions in lots of 100, fees
  in the ringgit amounts the brokers publish. The fee model understands FX/CFD as charge-free so old data
  priced that way still loads, but the UI is built for stocks.
- **No market data.** Nothing fetches prices, candles or index levels — what you record is what it shows.
  Screenshots are the visual record of what a chart looked like.
- **Screenshots are private.** The bucket is not public; images are served through short-lived signed URLs
  in your own folder, at 10 MB each in PNG, JPEG, WEBP or GIF.
