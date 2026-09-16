-- Trade sector -----------------------------------------------------------------------------------
--
-- Bursa Malaysia classifies every listed stock into one sector, and sectors move for their own
-- reasons — a plantation cycle, an oil price, a construction budget. Without that on the trade there
-- is no way to ask "which sector pays me, and which one keeps taking it back".
--
-- A sector is really a property of the stock, but it is stored on the trade, which keeps one source
-- of truth and lets a sector be assigned to every trade of a symbol in a single update — the useful
-- path for the trades already in the journal.
--
-- Run once in the Supabase SQL editor. It is re-runnable.

alter table public.trades add column if not exists sector text;

-- The journal filters on it and the analytics group by it, so a user's sectors are the read pattern.
create index if not exists trades_user_sector_idx on public.trades(user_id, sector);

-- The sector list lives in the app (`BURSA_SECTORS`), which is where it can change; the column takes
-- any text so a sector added by the exchange cannot make a trade unsavable.
