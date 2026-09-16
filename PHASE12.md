# Phase 12 — going through the audit, claim by claim

An external review of this project returned 40 findings. This phase is the answer to them: each one
was checked against the code, the confirmed ones were fixed, and the rest are recorded below with
the reason they were left alone — because "probably fine" and "verified fine" are different, and so
are "a real problem" and "a real preference".

**Nine findings were real and are fixed. Eleven were not what they claimed. The rest are a phase of
work rather than a patch, and are named at the end.**

The one number worth reading even if you skip the rest: **1 of your 209 trades has a stop loss.** That
is not a bug, but it decides how much the R-based half of the app is worth.

---

## Confirmed and fixed

### 1. Average R counted the trades without a stop as zeroes

```ts
// before − a trade with no stop loss has no R, but it still divided the sum
const avgR = trades.length ? trades.reduce((sum, t) => sum + Number(t.r_multiple || 0), 0) / trades.length : 0;
```

Denominator wrong, consequence large. Your journal has **one** trade with a stop, at +1.53R, and 208
without — so the dashboard showed that sum divided by 209, about **+0.01R**: a figure that reads as
"my edge is break-even" when the truth is "I have recorded one R in my life". `metricSeries` had the
same fault per trade, and `dailySummaries` divided a day's R total by the day's whole trade count.

The mean is now over the trades that carry a stop, and the count travels with it (`rCount`), so the
card can say which trades it was taken over instead of leaving you to guess. `calculateStats` returns
`avgR: null` when nothing has a stop — an absence, which the R cards already knew how to render as
"—". The sparkline series holds its last value until the first R arrives, so every series still has
one point per trade.

Verified live: the dashboard now reads **+1.53R · stop recorded on 1 of 209**.

### 2. A failed query rendered as an empty journal

`setAll(((a.data ?? []) as any[]).map(normalizeTrade))` — one dropped connection or an expired
session and every page shows an empty state: "No trades match these filters", **RM 0.00**, a blank
calendar. Indistinguishable from data loss, and it hides the actual reason.

Every loader now collects the first error it saw (`components/load-error.tsx` → `firstError`) and the
page renders a banner naming it, with the page's own blocks suppressed — zeroed metrics beside a
failure are worse than nothing. Applied to the dashboard, journal, analytics, calendar, accounts,
strategies/tags, zakat, reviews, the trade page and both forms.

Verified by breaking a query on purpose and reading the result: the journal showed *"Could not load
your trades — column trades.bogus_col does not exist"*, no table, and no "no trades" message. The
deliberate break was then removed and the real table came back.

### 3. "Current Equity" was not equity

```ts
const equity = selectedAccount ? selectedAccount.starting_balance + stats.pnl : null;  // stats = FILTERED
```

Filter the dashboard to one strategy and the card still said *Current Equity* — but the number was
starting capital plus the P&L of the trades that survived the filter. Equity with the other trades
deleted from it.

Equity is now measured over **every trade in the selected account**, which is what a balance is, and
the card says so: *"Start + all 40 trades in this account"*. The filtered contribution is already on
screen as Net P&L, where it belongs.

### 4. Max drawdown was quoted against a meaningless base

It read **1999.5% of filtered peak** — arithmetically right, informationally empty: the peak of the
cumulative P&L curve was a few hundred ringgit in the journal's early days, so the ratio exploded.

The base is now the capital behind the account (its starting balance, or every account funded when
none is selected), falling back to the old percentage only when no capital is known. Live: **RM
-2,069.57 · 18.8% of RM 11,000.00 capital**. `maxDrawdownPct` is unchanged in the engine.

### 5. "Today" came from the UTC date *(not in the audit — found while reading it)*

```ts
const today = new Date().toISOString().slice(0, 10);   // reviews, and the zakat payment default
```

`toISOString()` is UTC, so between midnight and 08:00 Malaysian time both pages opened on
**yesterday's** date. The reviews page's Monday was derived the same way, so it could land a day off
too. Both now use the journal's own `dayKey`. The Malaysian wall clock also has a helper
(`lib/dates.ts` → `wallClock`) for the date-time picker's **Now** button.

### 6. The timezone in the database was decoration

`profiles.timezone` says `Asia/Kuala_Lumpur`, but every bucket came from `date.getHours()`,
`getFullYear()` and the browser's `getTimezoneOffset()` — the viewer's clock, not the journal's. A
Bursa 09:05 trade is a morning trade; read it from London and it was arriving as 01:05 and being
filed under the wrong day, session and hour.

`lib/trading.ts` now has one `myParts()` helper, and the day key, session, hour bucket, trade year,
weekday band and the displayed dates all read Malaysia time from it. Malaysia has no daylight saving,
so the offset is a constant (+08:00) and no timezone database is needed. **Verified on your data: the
calendar, sessions and dates are unchanged** — for a machine in Malaysia the two rules agree, which
is exactly why this was invisible.

The form path moved with it: `toLocalDatetimeInput`/`localDatetimeToIso` and `lib/dates.ts` now edit
Malaysian wall clock, so a trade typed as 09:05 is stored, shown and bucketed as 09:05.

### 7. A trade could point at someone else's account

`trades.account_id` and `trades.strategy_id` are plain foreign keys, and the RLS policy on `trades`
only checks `user_id`. The key proves the account **exists**, not that it is **yours**, so a request
that knows another user's account UUID could attach it to a trade of its own — RLS stops you *reading*
that account, so you would get a trade pointing at an invisible account.

Fixed at the database level, where it can be: `supabase/hardening.sql` adds a unique index on
`(id, user_id)` and a **composite foreign key** for each, so "same owner" is a fact the engine
enforces. `trade_tags` needs no equivalent — its policy already requires both sides on the way in.

> **This one needs you to run a file.** Paste `supabase/hardening.sql` into the Supabase SQL editor.
> Everything in it is `NOT VALID` (existing rows untouched, new writes held to the rule), it is
> re-runnable, and it normalises the old session spellings first so editing an old trade keeps
> working.

### 8. The screenshot bucket had no limits of its own

The 10 MB / image-only check lived in the browser, and a browser is what an attacker is not using —
an authenticated client can POST straight to Storage. It is now a bucket setting (`file_size_limit`,
`allowed_mime_types`), which is the only place it can be enforced for every caller. In the same file.

### 9. No security headers, and a silent auth failure

`next.config.ts` now sends `Content-Security-Policy` (`frame-ancestors 'none'`, `object-src 'none'`,
`base-uri`, `form-action`, plus Supabase in `img-src`/`connect-src`), `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` and HSTS. Verified with `curl -D-`.

`script-src` is deliberately **not** set: Next's inline bootstrap needs a per-request nonce, and a
wrong nonce breaks hydration rather than an attacker. The directives that stand alone are the ones
worth having, and `frame-ancestors: 'none'` is the one that matters for a logged-in record.

`app/auth/callback/route.ts` no longer redirects to `/` when the code exchange fails (expired or
already-used link, different browser) — that bounced you to `/login` with no explanation. It passes
the reason through, and the login card shows it.

### 10. Nothing tested the numbers

`npm run test:fees` covers the fee engine; nothing covered the figures you trade from. `npm run
test:calc` adds **77 checks** — P&L long and short, fractional prices, risk and R, average R with and
without stops, the drawdown sequence, streaks, Malaysian day keys across midnight and the new year,
the session boundary at 12:29/12:30, hour buckets across the lunch break, wall-clock round trips, day
summaries, the holding/lot/quality bands and the whole zakat calculation. Each expected value is
worked out in a comment above it, so a failure names the rule that changed. `npm test` runs both.

### 11. Database shape

`supabase/hardening.sql` also constrains what the app already assumes: `session` is one of the two
windows, numbers are positive where positive means something, a trade cannot close before it opens,
symbols and free text have length caps, zakat rates are 0–100 and years are plausible. Plus composite
indexes matching how the journal actually reads (`user_id, account_id, entry_at desc` and friends).

**One consequence worth knowing about the composite keys.** Adding a `(id, user_id)` foreign key
alongside the plain single-column one gives PostgREST *two* candidate relationships between `trades`
and each of `strategies` and `trading_accounts`, and it refuses to choose (PGRST201: *"Could not embed
because more than one relationship was found"*). The moment the SQL was applied, every page that loads
trades began failing with exactly that message. Rather than let each of the five queries carry a
constraint name, `embedStrategy()` and `embedAccount()` in `lib/trading.ts` hold them, and the SQL
carries a note pointing back at them. The hints name the *plain* constraints, which exist whether or
not the hardening script has been run — so the app now works in both states.

---

## Not what it claimed

**"The session calculation has an edge-case bug" (their #5).** It argued for a third bucket,
*Outside*, for 08:00 and 18:00. That is a reversal of your own instruction — you asked for morning and
evening because "session seem to many … no need others" — and the hour breakdown already isolates odd
times: `hourBucket` files anything outside 09:00–17:00 under **Outside**, which is visible on the
hourly chart. The two-session split stays. (If you ever want that third band, it is a two-line change
to `SESSIONS`.)

**"Max drawdown should be measured on equity, not cumulative P&L" (their #23).** The card's own label
said *"of filtered peak"*, so it was describing what it did. It was nevertheless uninformative, and
that part is fixed above by quoting the drawdown against capital.

**"`select("*")` is overused" (their #12).** True, and harmless: the tables hold tens of rows and
PostgREST sends all columns whatever the client asks for only when it must. The journal already names
its columns.

**"High `any` usage" (their #13).** 39 annotations, mostly in form state and TanStack's
`ColumnDef<Trade, any>`, which is the upstream signature's own default. Worth doing properly with
generated database types — a phase, not a patch, and not a bug.

**"Broker presets should be data, not code" (their #26).** The design point is fair — published
broker schedules do change — but the remedy already exists: `fee_breakdown` stores the charge each
trade was actually booked with, and the edit form reads the preset *back out of the trade* rather than
from today's table. Historical trades are not silently repriced. Moving schedules into `effective_from`
rows is a nice-to-have.

**"Zakat deserves a domain review" (their #24).** They are right that this is not Islamic accounting,
and the page now says so out loud in its subtitle: *"A journal estimate … confirm the basis and rate
with your zakat authority."*

**"Typecheck currently fails" (their #15).** Their `node_modules` was incomplete. Here: `typecheck`,
`build` and both check scripts are clean.

**"Next.js 16.3.5 is current and safe" (their #16).** Confirmed — installed and locked at 16.3.5. No
action, and no downgrade.

**Storage cleanup (#10, #11).** The two-stage delete (read paths → remove objects → delete row) is
best-effort, as they say. It is the right shape for a client-only app: Postgres cascades cannot reach
Storage objects, so *something* has to be explicit about it. An orphaned object costs kilobytes.

**Rate limiting (#38) and an audit log (#39).** Real capabilities the app does not have. Neither is a
bug: this is a single-user journal behind Supabase auth and RLS. Both belong to the roadmap below.

---

## Confirmed, and a phase rather than a patch

Their headline finding — **every page downloads the whole journal and computes in the browser** — is
correct, and worth answering honestly rather than with a patch.

Today `/`, `/journal`, `/analytics`, `/calendar`, `/zakat` and `/accounts` each fetch all trades. At
209 trades that is a few hundred kilobytes and no perceptible cost; the journal's paging is
presentation-only (TanStack pages 15 rows that Supabase already sent). The ceiling arrives somewhere
in the thousands of trades, and a trading journal is a file that only grows.

The fix is a real redesign, not a tweak — server-side filtering, sorting and keyset pagination for the
journal, and aggregation pushed into Postgres (a view or an RPC returning each chart's dataset) so
Recharts receives tens of points instead of tens of thousands of rows. It touches every page's data
path and every filter's semantics, and it is worth doing deliberately, with the current behaviour as
the reference. Their instinct to keep the component stack is right: **the bottleneck is where the
maths happens, not shadcn, Radix, TanStack or Recharts.**

Until then the app is honest about its size: the numbers are computed once per filter change and
memoized, and the journal shows 15 rows at a time.
