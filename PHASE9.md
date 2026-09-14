# Phase 9 — the whole diary, IPO allocations, and zakat

## record.xlsx came in as 208 trades

The journal now holds the diary's full record — **208 round-trip trades from 2020 to 2026**
(56 · 35 · 9 · 27 · 36 · 37 · 8 by entry year, plus 2021/2022 rows that opened at the end of the
previous December). They replace the 18 trades imported earlier from `2025.xlsx`, which are backed
up in `.tmp/replaced-trades.json` and were the same 2025 calendar only in name: `record.xlsx`'s 2025
sheet is a different set of days at different prices.

- The sheet was read **without adding a dependency** — an `.xlsx` is a zip, so `.tmp/` held a tiny
  reader (zip central directory + `inflateRaw`) that pulled the buy block (C–L), the sell block
  (O–W), the sell date (M, stored as a bare serial), the note (Z) and each row's fill.
- **One row is one round trip.** Fees come from the diary's own brokerage / stamp / clearing / SST
  columns per leg, then are applied the way Bursa charges them:
  `net = (soldQty × exit − qty × entry) − commission − fees`.
- **Ledger rows are skipped, not imported.** `MODAL`/`B·F`/`DEPO` and the IPO-application rows
  (`IPO PEKAT`, `WD CTOS`) carry a cash figure but no price or quantity; they name the symbols that
  were allotted that year, which is how the import recognises the 2021 and 2022 IPO buys.
- **A fee column holding the whole contract is not a fee.** Several years type the amount into the
  stamp cell (RM 3,511 on a RM 3,510 contract), so a fee above half the contract value is dropped
  and the position is charged nothing on the way in.
- **A partial exit pays only for the shares sold.** JFTECH sold 400 of 2,000 and KEEMING 4,000 of
  5,000; both are recorded at the realised P&L of the sold quantity, with the opening charges
  prorated by the same ratio. (A round-trip journal cannot show the shares still held.)
- Every imported trade carries the tag **`record.xlsx diary`** and a note
  `Imported from record.xlsx · <year> row N`, so the batch filters and deletes as one thing.
- **Entry times do not exist in the diary** (dates only), so entry is 09:00 and exit 17:00 local
  time. Holding periods and weekday P&L are exact; the hourly breakdown fills in as live trades are
  logged.

Where the journal disagrees with the diary: the **2025 sheet subtracts** buy-side fees from its cost
basis (`L = qty × price − fees`) instead of adding them, so its own net column adds them back — the
journal's 2025 total is **RM 215 lower** across 37 trades, which is the true figure. 2020, 2021,
2022, 2024 and 2026 reconcile to the sen (2024 differs by RM 1.01 of rounding in the sheet).

## IPO allocations are visible

A position bought through an IPO allotment is a different animal from a market buy, so it is marked
in the record rather than in the notes:

- **`trades.is_ipo`** (Phase 9 keeps the column addition idempotent, like Phase 7's).
- A **yellow `IPO` badge** beside the symbol in the journal and in the trade page title.
- A **checkbox on both trade forms** — "IPO allocation — bought through an IPO allotment, not the
  open market".
- An **Entry filter** in the filter bar: all entries / IPO allocation / market buy.

The diary marks these rows three different ways across the years and the import understands all
three: a **yellow fill** (2020), a **themed highlight with no stamp duty and no clearing fee on the
way in** (2021 onward — an allotment is not bought on the exchange), and an **`IPO` transaction
type** (2025 and later). 73 of the 208 imported trades are flagged.

The journal also keeps working **before** the migration: the trade list retries its query without
`is_ipo` when the column is missing, so nothing goes blank in the gap.

## The Zakat page

`/zakat` computes each year's zakat from the journal and tracks what has been paid.

| Control | Default | Notes |
|---|---|---|
| Rate % | **2.5** | Editable, and stored **per year**, so an old year is never rewritten by today's rate. |
| Basis | **Year net P&L** | Also *Winning trades only* (losses cannot shrink the base) or a *Manual base*. |
| Other income / assets | empty | Added to the base. |
| Nisab | empty | Optional threshold; wealth below it pays nothing, and the card says so. |
| Payments | — | Date, amount, channel and note per payment, logged against the year it belongs to. |

- A **losing year floors at zero** — a loss is not a debt, so 2020 and 2022 show `settled` rather
  than a negative zakat.
- The year-by-year table shows trades, net P&L, base, rate, zakat, paid and balance for every year,
  and clicking a row switches the whole page to that year.
- Years are measured **Jan–Dec on the day a trade was opened**, which is why a trade bought on
  27 Dec 2021 counts towards 2021 even though the diary files it in its 2022 sheet.
- The settings card is laid out **two fields to a row with a hint under each**, because a three-column
  grid left the fourth field alone with a two-cell hole and clipped its placeholder ("wealth below
  this pays nothing" in a 117px box). It now states its own result — `RM 7,199.42 × 2.5%` on the left,
  `RM 179.99` on the right — and a pill in the card header shows the rate and basis in force. The two
  cards sit in `.grid.pair-grid` (`align-items: start`), so neither stretches to leave a dead half.
- The page works **before** the Phase 9 tables exist: the figures are computed from the journal
  either way, and a card says which SQL still needs running before anything can be saved. The page
  also states plainly that it is a record of how you calculate zakat, not a fatwa.

## The dropdowns are ours now

A native `<select>` pop-up is drawn by the browser, not the page, so it ignored both palettes: a white
list with a system-blue highlight band — the one surface in the app that belonged to neither theme.
`components/select.tsx` replaces it with a listbox rendered from the page, and every one of the 19
selects now uses it (journal and edit forms, the filter bar, accounts, calendar month/year, zakat,
tags).

Call sites still write native markup — `<Select value={x} onChange={fn}><option value="a">A</option>`
— so the change is one word per tag and the option lists stay readable. What the component adds:

- **The list is themed** — `--panel-2` background, `--border-strong` hairline, `--shadow-2`, and the
  highlighted row in `--surface-3` (or `--accent-soft` with a violet tick when it is the selected row).
- **Keyboard** — Up/Down/Home/End move the highlight, Enter or Space picks, Esc and click-away close,
  Tab closes. Focus stays on the trigger, so the rest of the page is not disturbed.
- **`role="combobox"` / `role="listbox"` / `role="option"` with `aria-expanded` and `aria-selected`,**
  which the accessibility tree reads exactly as a native select does.
- **It stays on screen.** `min-width: 100%` keeps the list at least as wide as its trigger, and
  `max-width: min(92vw, 340px)` caps a long label. A layout effect then measures the list and flips it
  to the trigger's right edge if it would otherwise run off the window, and drops it *upwards* when
  there is no room below — so a dropdown in a right-hand column or near the bottom of the window can
  never add a page scrollbar.

## Verification

`npm run typecheck`, `npm run build` (17 routes) and `npm run test:fees` (53 checks) are clean.

- The journal lists **208 trades** from 14 Apr 2020 to 18 Mar 2026, netting **RM +32,990.67**, which
  is what the dashboard, the calendar's yearly strip and the zakat page each report per year
  (2020 −849.20 · 2021 +6,419.54 · 2022 −799.18 · 2023 +4,196.67 · 2024 +10,108.31 · 2025 +9,216.93 ·
  2026 +7,199.42).
- Spot checks against the diary: JAKS 100 @ 0.965 → 0.975 nets **−16.02** (the diary's own figure),
  SUNMED 10,000 @ 1.45 → 1.95 nets **+4,958.55**, KEEMING's partial exit nets **+1,667.04**.
- The yearly strip in the calendar renders all seven years; the dashboard's win rate is 42.3% and
  profit factor 2.85 over the full record.
- Zakat at 2.5% of each year's net: 2021 RM 160.49, 2023 RM 104.92, 2024 RM 252.71, 2025 RM 230.42,
  2026 RM 179.99, with 2020 and 2022 at zero.
- All eleven routes sweep with **zero native `<select>` elements** and no horizontal overflow; the
  themed trigger resolves to `--field` with an accent border and `--accent-soft` ring while open, and
  the list to `--panel-2` in both themes.
- Picking works end to end: the zakat base ends at *Winning trades only* (RM 8,533.39 × 2.5% →
  RM 213.33, manual-base field appears on *Manual base*), the trade form's Session ends at
  *Evening · 14:30–17:00*, and pressing Down then Enter selects from the keyboard.
- The edge guards were exercised on a scratch page: a 340px list at x=951 flipped to the trigger's
  right edge (right 1151 of 1175, `pageOverflowX: 0`), and a trigger with 94px below it opened with
  `drop-up`, sitting entirely above the button.
