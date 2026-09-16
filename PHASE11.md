# Phase 11 — the app's own date fields, one list page, and a tick you can see

Three loose ends from spending real time in the app: the date fields were still the browser's, tags had
a page of their own for two rows of data, and the journal's column menu looked like it had lost its
ticks.

## Every date field is now the app's own

`react-day-picker` under a Radix **Popover**, styled entirely from `app/globals.css` through
`components/ui/date-picker.tsx`:

| field | where | picker |
| --- | --- | --- |
| From / To | the filter bar on the dashboard, journal, analytics and calendar | `DatePicker` |
| Entry date/time, Exit date/time | both trade forms | `DateTimePicker` — calendar plus hour and minute |
| Review date, Week start | Reviews | `DatePicker` |
| Date paid | Zakat payments | `DatePicker` |

They were all `<input type="date">` / `datetime-local` before. A browser draws that pop-up itself: it
ignores CSS custom properties, so it arrives as a white sheet with a system-blue highlight in dark mode
— word for word the complaint that retired the native `<select>` in Phase 10.

The two pickers keep the values the app already spoke, so nothing downstream changed: `"YYYY-MM-DD"`
and `"YYYY-MM-DDTHH:mm"`. `lib/dates.ts` holds the conversions and is deliberately local-time —
`new Date("2026-09-16")` parses as UTC midnight, which shows up as the 15th in +08, and `toISOString()`
writes the same off-by-one back. The trigger is a `.select-btn`, so a date field, a dropdown and a text
input are the same object on screen; the panel carries `Today`/`Clear` (and `Now`/`Done` for a
date-time).

### The trap: an unlayered stylesheet beats every layer

react-day-picker ships its own CSS, and importing it broke the calendar in a way worth recording. The
app's stylesheet lives in `@layer components` (Phase 10), and **an unlayered rule outranks every layer**
— so the library's defaults won: the grid rendered at its own 44px day cells with none of the app's
palette, and the panel came out **488px tall**. It flipped above its trigger, could not fit there
either, and rendered 29px off the top of the window.

The fix is not to fight it with specificity: the library's stylesheet is simply not imported. Its markup
is styled by the app instead, through `classNames` in `components/ui/calendar.tsx` mapping onto
`.pick-*` classes. Two follow-on details:

- The prefix is `pick-`, not `cal-`. The P&L calendar page owns a `.cal-nav` (its month/year strip), and
  a shared name silently gave the month grid `gap: 10px` and a `margin-bottom: 14px` meant for the year
  strip.
- The nav is a child of the months *wrapper*, not of the month box, so `.pick-months` — not
  `.pick-month` — is what the buttons anchor against.

## Tags moved in with strategies

Both are small label lists, so they share one page behind tabs rather than holding two sidebar slots:
**Strategies & Tags**, with each tab showing its count. The sidebar entry is renamed, the old `/tags`
address redirects there so bookmarks and stale links still land, and the tag data and its filter are
untouched.

Each tab owns its controls, which is what stops the two jobs fighting for one row: the strategies tab
puts **+ New Strategy** at the end of the tab strip, and the tags tab's creator sits *in the card whose
list it feeds* — tried in the strip first, where it wrapped its own Add button onto a second line at a
laptop width. Tags are grouped by category (setup / mistake / condition / custom) with a one-line
reminder of what each is for, because a flat pile of thirty chips says nothing about how they are used.

## The columns menu's missing tick

The ticks were rendering — measuring the screenshot pixel by pixel showed all seven boxes with the same
9 bright pixels each. The problem was the size of the mark: a **12px** icon with a `stroke-width` of 3
inside a **17px** box is a 1.5px line at 1x, which reads as a smudge rather than a tick. It is now 14px
on a 3.5 stroke, and the indicator states `line-height: 0` so the line box cannot push the SVG off
centre.

The same menu had a second, unrelated flaw: it listed *every* leaf column, including the row-actions
column that cannot be hidden, so the list ended in a checkbox with no label that toggled nothing. It
now lists only hideable columns — and offers **Show every column** whenever one is hidden, since
`resetColumnVisibility()` was reachable before only by reopening the page.

## The zakat card pair

Two fixes followed from the same screenshot. The pair was **not the same height** — measured live, 494px
beside 569px, a 75px step — because `.grid.pair-grid` deliberately let each card end where its content
did. It now stretches, and each card is a flex column whose last block is pushed to its bottom edge
(`.pair-foot`), so both cards share one height and the shorter one spends the difference as breathing
room in the middle rather than as a ragged edge. The payments card's empty state also stopped being a
row *inside* the table: a header row over nothing reads as a table that failed to load, so it is now its
own block that grows to fill the card.

At a laptop width the pair was worse: side by side below 1200px each card dropped to ~300px, the inputs
to **126px**, and every field hint wrapped to three lines — the screenshot's “word and box not nice”.
The pair now stacks to one column under 1200px (it is the only `pair-grid` in the app), which gives each
card the full content width and keeps its own two-column field grid comfortable at 287px per field.

The long hint in a card head had a related fault: flex line breaking measures an item by its
max-content width, so “Zakat is normally paid after the year closes…” pushed the summary pill onto a row
of its own. A small basis on `.card-head > :first-child` makes the text block claim the leftover room
and wrap inside itself, which keeps the pill top-right in all three cards that use it.

## Verification

- `npm run typecheck`, `npm run build` and the 53 fee checks are clean.
- Verified signed in, against the real 209-trade journal: zero native `date`/`datetime-local` inputs
  remain on the filter bar, journal form, reviews or zakat; the calendar panel measures 302×287 and
  fits inside the viewport with its nav buttons inside the panel's own content box; picking a day
  switches tabs and fields as expected, and the column menu now lists six labelled columns, all ticked.
- Both themes were measured for the picker panel (`--panel` white in light, `--panel #0f131a` in dark),
  and `/zakat`'s narrow date field reads `16 Sept 2026` untruncated in a 149px trigger.
- The temporary auth-redirect lift used for the earlier phase was not needed this time — but
  `git diff lib/supabase/middleware.ts` is empty all the same.
- The zakat pair was measured in both states, by temporarily disabling the new breakpoint to force the
  paired layout: paired, both cards report **510px tall at the same top** with the settings footer 21px
  off the bottom edge; stacked at 940px, each card takes the full 631px width, the field grid resolves
  to 287.5px columns and the hints drop from three lines to one or two. No page overflows horizontally
  in either state.
