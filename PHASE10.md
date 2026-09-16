# Phase 10 — the component layer moves to shadcn/ui (Radix)

The app now builds its controls out of **shadcn/ui** on **Radix primitives**, with the journal's
table on **TanStack Table**. Nothing about the look changed: the palette, the radii, the gradients
and the shadows are still the ones defined once in `app/globals.css`.

## The colours were kept by bridging, not by copying

shadcn components are written against *semantic* utilities — `bg-card`, `text-muted-foreground`,
`border-border`, `bg-primary`, `rounded-md`. Rather than give the components a second palette, a
single `@theme inline` block maps each of those names onto the token that was already here:

```css
@theme inline {
  --color-card: var(--panel);
  --color-primary: var(--accent);
  --color-muted-foreground: var(--muted);
  --color-border: var(--border);
  --radius-md: var(--r-md);
  /* … */
}
```

`inline` substitutes the *expression* (`var(--panel)`) into each utility rather than a resolved
colour, so a utility keeps following `[data-theme]` with everything else. There is still exactly
one place in the repo where a colour is written down.

`--color-accent` deliberately maps to `--surface-3` (the hover surface, which is what shadcn means
by `accent`) while `--color-primary` takes the brand violet, so both vocabularies resolve correctly.
The app's button variants are the app's own classes — `.btn`, `.btn-primary`, `.input`, `.card`,
`.badge` — exposed through `cva`, so a `<Button variant="default">` is the same object as the
`.btn.btn-primary` it replaced.

## One cascade change made it work

The stylesheet is now wrapped in `@layer components`. Unlayered CSS outranks every cascade layer,
so with the old structure a utility written beside one of these classes — `<Input className="pl-9">`,
`<Input className="w-[160px]">` — silently did nothing. Putting the application styles in the same
layer shadcn fills restores the normal expectation: utilities beat component classes. This was found
live (the search icon sat on top of its placeholder text) rather than by reading the code.

## The components

| | |
|---|---|
| `button` `input` `textarea` `label` `badge` `card` `table` `separator` `skeleton` `alert` | presentational, on the app's classes |
| `select` | Radix Select — replaces the hand-rolled listbox |
| `dialog` `alert-dialog` `sheet` | Radix Dialog, in three shapes |
| `dropdown-menu` `popover` `tooltip` `tabs` `collapsible` `scroll-area` | Radix overlays and disclosure |
| `checkbox` `switch` | Radix, with `data-state` styling |
| `progress` `avatar` | Radix |
| `sonner` | toasts, themed by `next-themes` |
| `data-table` | TanStack Table |

`components/select.tsx` (hand-rolled) is gone; `components/confirm-button.tsx` wraps
`AlertDialog` so a destructive action no longer falls back on the browser's own `confirm()` — the
same complaint a native `<select>` raises, since the browser draws it in its own colours.

Two Radix details worth knowing:

- **A blank option needs a sentinel.** Radix rejects `""` as a `SelectItem` value, so an "any"
  choice travels as `SELECT_NONE` and is mapped back at the boundary.
- **No `data-[state=closed]` exit animations anywhere in `components/ui`.** Radix keeps a closing
  layer mounted until its `animationend` fires. A renderer that never fires one — a headless
  webview, a throttled tab, a suppressed animation — leaves an invisible overlay swallowing every
  click. This was reproduced here: a closed dialog and its overlay stayed in the DOM indefinitely
  and `elementFromPoint` returned the overlay. Enter animations are not gated on an event, so they
  stay, and a `[data-state="closed"] { pointer-events: none }` rule is the belt to that braces.

## TanStack Table

`components/ui/data-table.tsx` is a generic table with **sorting** on every header (`aria-sort` and
a direction glyph), a **free-text search** that matches across cells, **pagination** with a page-size
picker, and a **column-visibility** menu in a popover. `searchText` builds a hidden column that
concatenates the fields worth searching, because TanStack filters by column.

The journal uses it with row actions in a dropdown menu — the menu is wrapped so its click does not
also trigger the row's own click, which opens the trade.

## Where the components landed

- **Shell** — the sidebar keeps its desktop rail; on a phone it is now a bottom bar of the four daily
  destinations plus **More**, which opens the full section list in a `Sheet`. Scrolling ten icons
  sideways along the bottom is gone.
- **Forms** — both trade forms, accounts, strategies, tags, zakat, reviews, settings, login and
  signup use `Input` / `Textarea` / `Label` / `Checkbox` / `Select`, with `Alert` for a notice.
- **Tables** — the journal (TanStack), the dashboard's recent trades, the zakat payment log and the
  analytics breakdowns.
- **Confirmations** — deleting an account, a strategy, a trade, a payment or a screenshot asks first
  in a themed `AlertDialog`.
- **Feedback** — Settings and Reviews report through toasts.

## The type scale

Every page header now reads the way the design reference did: a bold title whose last word takes
the brand colour (`Trade **Journal**`, `P&L **Calendar**`, `Strategy **Library**`), tightened to
`-0.025em` tracking and `1.18` leading, with a grey subtitle one clear step below it rather than
sitting directly under the title as a second heading. `accentTitle()` in `components/page-header.tsx`
does the split — a single-word title stays plain, since colouring the only word is just a heading in
colour, and a node title (the trade page's symbol plus its IPO badge) is passed through untouched.
The auth cards use the same helper, so `Welcome **back**` and `Create your **journal**` match.

The whole scale then stepped down one notch — about 8–10% — because the app read large:

| was | now | where |
| --- | --- | --- |
| 23px | 21px | auth card heading |
| 22px | 20px | page title, metric figures |
| 17px | 15.5px | stat card figures |
| 15px | 13.5px | card heading |
| 13.5px | 12.5px | body, inputs, nav |
| 13px | 12px | table cells |
| 11.5px | 10.5px | field labels |
| 10.5px | 9.5px | uppercase micro-labels |

The mapping stops at 8px so nothing becomes unreadable, and every `text-[Npx]` utility, the recharts
axis ticks and the two inline `fontSize` styles stepped with it. The phone breakpoint moved too
(`.page-head h1` 19px → 17px, `.stat-value` 20px → 18px). Nothing below the type moved: padding,
radii and control heights are unchanged, so the change is text-only and the layout got roomier
rather than tighter.

## Verification

- `npm run typecheck`, `npm run build` and the 53 fee checks are clean.
- Every route was rendered and inspected live with the auth redirect temporarily lifted: no page
  overflows horizontally, no card overflows, every grid collapses to one column on a phone, the
  journal table's sort/search/page/columns all behave, and Escape closes a dialog completely.
- Dark and light were both measured against the tokens: `--bg #08090e`, `--panel #0f131a`,
  `--field #0c1017`, `--text #f5f7fb` in dark, `--bg #f5f7fb` and `--panel #ffffff` in light.
- The temporary showcase route and both temporary switches were removed; `git diff` on the
  middleware is empty.
- The type step was measured live rather than eyeballed: `/login` reports a 21px title carrying the
  accent word, an 11.5px subtitle, 12.5px body and inputs, a 10.5px label and a 12px button; the
  journal's `td` is 12px; `/` has a 20px title and zero horizontal page overflow.
