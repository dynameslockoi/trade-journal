-- Trade sub-sector -------------------------------------------------------------------------------
--
-- Bursa classifies a stock twice: into a sector, and into the sub-sector that says what the company
-- actually does. Technology holds Semiconductors, Software, Technology Equipment and Digital
-- Services — and treating those as one line hides the thing the classification exists for, because
-- a chip cycle and a software cycle are not the same cycle. A journal that cannot tell them apart
-- cannot say which of the two it is actually trading.
--
-- Like `sector`, the sub-sector is really a property of the stock stored on the trade (see
-- sectors.sql): one source of truth, and a single update can classify every trade of a symbol,
-- including the ones recorded before this column existed.
--
-- Run once in the Supabase SQL editor, after sectors.sql. It is re-runnable.

alter table public.trades add column if not exists sub_sector text;

-- The analytics group by it and the journal filters on it, always beside the sector it belongs to.
create index if not exists trades_user_sub_sector_idx on public.trades(user_id, sub_sector);

-- The sub-sector list lives in the app (`SUB_SECTORS` in lib/trading.ts), which is where it can
-- change; the column takes any text so a sub-sector added by the exchange cannot make a trade
-- unsavable.
