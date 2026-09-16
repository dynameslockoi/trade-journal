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
