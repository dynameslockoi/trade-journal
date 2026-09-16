# Phase 13 — Pictures in three ways, and capital that follows the money

Two changes, both about how the journal is fed: attaching a picture to a trade, and telling an
account's capital by what moved in and out of it rather than by one number typed at creation.

## 1. `components/screenshot-input.tsx`

A chart is usually already on the clipboard by the time a trade is written up, so **paste** is the
fastest of the three routes and the one that was missing. The box now accepts:

- **click** — the picker, as before;
- **drag and drop** — onto the box, which switches from a dashed to a solid outline while a file is
  over it;
- **paste** — anywhere on the page, so there is no need to aim at the box first.

All three end in the same `File[]`, so a form only has to upload a list. Three details that came out
of doing it properly:

**A drop beside the box used to open the file in the tab**, taking the form and everything typed into
it with it. A window-level guard now calls `preventDefault` for file drags only — dragging *text*
still behaves, which is why the guard checks `dataTransfer.types` rather than intercepting every
drop.

**Identity for de-duplication is name and size, not the timestamp.** A pasted screenshot arrives
named something generic (`image.png`) and two pastes of it carry different `lastModified` stamps, so
a timestamp in the key would let a double Ctrl+V attach it twice — which is the exact case the key
exists to absorb.

**Text pastes are left alone** (no `preventDefault`, no pending file), so pasting a note into the
notes field still works.

Files are checked at intake against the same rules as the storage bucket (10 MB, images only) and
refused with a reason — `huge-screenshot.png — 11264 KB, over the 10 MB limit` — instead of failing
at save time. Pending files are shown as thumbnails with a remove button, so the wrong screenshot is
obvious before the trade is written rather than after.

## 2. The cash-flow ledger

Capital used to be `starting_balance`: one number typed into the account form. That says what an
account was opened with and nothing about what happened since — a top-up, profits taken out, money
paid to yourself. Every one of those moves the balance, so equity computed from the opening figure
alone drifts further from the account every month.

`supabase/cashflow.sql` adds `account_cash_flows` — one row per movement, with `kind` carrying the
direction so a typo cannot turn a withdrawal into a deposit — and makes those rows the source of
capital:

```
equity = (deposits − withdrawals) + the journal's P&L
```

That formula is right even when the money taken out *is* profit: a RM 5,000 withdrawal after a
RM 5,000 gain is recorded as money out, and the P&L stays a separate figure, so the two do not
double-count. Which means every transfer has to be recorded, including profit you pay yourself —
the card says so.

The script:

- creates the table, its RLS policy and indexes;
- adds the same **same-owner composite key** `hardening.sql` applies to trades, so a movement cannot
  be recorded against someone else's account (it creates the unique index it needs, in case
  `hardening.sql` has not been run);
- **seeds each existing account's starting balance as its first deposit**, dated before that
  account's first trade, and only where no opening row exists — so the capital every page divides by
  does not move when it runs, and re-running adds nothing.

### Before the script is run

The app is expected to live with this script not yet applied, the way it already tolerates the
Phase 7 and Phase 9 migrations being absent. A failed read of the ledger is not a page error:
`capitalByAccount(accounts, null)` falls back to each account's opening balance, so every percentage
that divides by capital keeps working, and the Accounts page says what to run instead of showing
`RM 0.00` capital. The deposit/withdraw buttons stay hidden until the ledger exists, rather than
inviting a write that cannot succeed.

### Where capital is read

`capitalByAccount()` and `capitalBehind()` in `lib/trading.ts` are now the only way the three pages
that quote a percentage get their base: the dashboard's drawdown (`18.8% of RM 11,000 capital`), the
analytics drawdown and the calendar's daily return. The dashboard's **Current Equity** is the
selected account's net capital plus every trade in that account — still measured over the whole
account rather than the filtered set, as Phase 12 established.

The Accounts page itself becomes a small ledger view: equity, net capital, journal P&L, money in and
out, and the movements themselves with a remove button, plus **+ Deposit** / − **Withdraw** dialogs
carrying an amount, a date and a note. `starting_balance` is still written when an account is created
so it has capital on a database without the ledger, and nothing reads it for maths once the ledger
is there.

## Verified

- **Paste, drop and picker** each land in the pending list, with thumbnails; the drag state switches
  the outline to solid; a double paste of the same file adds one copy; removing a thumbnail drops it;
  a text paste is not intercepted; a text file and an 11 MB PNG are refused by name.
- **End to end**: a trade saved with three attached images from the paste and drop paths rendered all
  three from signed URLs, and deleting the trade issued
  `DELETE /storage/v1/object/trade-screenshots → 200` and `DELETE /rest/v1/trades → 204`.
- **The fallback**: with the ledger absent, the Accounts page showed its "run `supabase/cashflow.sql`"
  notice, equity `RM 11,228.87`, net capital `RM 11,000.00`, and the dashboard still read
  `18.8% of RM 11,000.00 capital` — no number moved.

One note for later: a signed URL can still be served from Supabase's edge cache for a while after
the object is deleted, so a `200` on a deleted screenshot means nothing on its own. The delete
request and a later `NoSuchKey` are the evidence.
