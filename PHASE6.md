# Trading Journal Pro — Phase 6

Phase 6 is a stability and polish pass. AI Trading Journal Analysis is intentionally NOT included.

## Main fixes
- Fixed local date/time handling so `datetime-local` values are stored as real UTC timestamps while displaying in the user's local timezone.
- Fixed trade edit form duplication and made edit calculations recalculate risk/R correctly.
- Added screenshot validation (images only, 10 MB max), cleanup on upload/database failure, and screenshot deletion.
- Deleting a trade now also attempts to remove its screenshot files from private Storage.
- Strengthened `trade_tags` RLS so both the trade and tag must belong to the signed-in user.
- Added symbol/date/result/tag filtering improvements.
- Added account-level journal equity calculation from starting balance + recorded P&L instead of trusting the stale `current_balance` field.
- Added month navigation to the P&L calendar.
- Added reusable trading-stat calculation helpers.
- Added focus states, responsive filter layout, hover states, and other UI polish.

## Supabase
Run `supabase/schema.sql` if you need the updated RLS policy. Keep `trade-screenshots` private.

## Local verification
After extracting/installing dependencies:

```bash
npm install
npm run typecheck
npm run build
```

AI analysis is deliberately reserved for a later phase.
