-- Phase 12 — hardening.
--
-- Nothing here changes what the journal shows. Every statement closes a gap that the application
-- layer cannot close on its own: a rule the browser can enforce but a direct API call cannot, or a
-- relationship the API checks only by convention. Run the whole file in the Supabase SQL editor.
-- It is written to be re-runnable, and every constraint is added NOT VALID, which means:
--
--   * existing rows are left exactly as they are,
--   * every new or updated row is held to the rule.
--
-- That matters because the journal holds real history — a constraint added in a hurry should never
-- reject a trade you already recorded. The two data statements in part 1 normalise the older
-- session spellings *before* the constraint lands, so editing an old trade keeps working.
--
-- Requires PostgreSQL 15+ (the column list on ON DELETE SET NULL). All current Supabase projects are.


-- 1. Ownership ---------------------------------------------------------------------------------
--
-- A trade carries user_id, account_id and strategy_id, and the RLS policy on trades only checks
-- user_id. The plain foreign keys prove the account exists, not that it is yours, so a request that
-- knows another user's account UUID can attach it to a trade of its own. A composite foreign key
-- makes "same owner" a database fact. It needs the referenced pair to be unique first.

create unique index if not exists trading_accounts_id_user_idx on public.trading_accounts(id, user_id);
create unique index if not exists strategies_id_user_idx on public.strategies(id, user_id);
create unique index if not exists trades_id_user_idx on public.trades(id, user_id);

-- Old rows may still carry the free-form session names the app used to write ("Bursa Morning").
-- Normalise them the same way lib/trading.ts does, so an edit of an old trade cannot trip the
-- session constraint added below.
update public.trades set session = 'Morning' where session is not null and lower(session) like '%morning%' and session <> 'Morning';
update public.trades set session = 'Evening' where session is not null and lower(session) in ('evening', 'afternoon', 'bursa afternoon');
update public.trades set session = null where session is not null and session not in ('Morning', 'Evening');

alter table public.trades drop constraint if exists trades_account_same_owner;
alter table public.trades add constraint trades_account_same_owner
  foreign key (account_id, user_id) references public.trading_accounts(id, user_id)
  -- Clearing only the account: user_id is NOT NULL and must survive the account's deletion.
  on delete set null (account_id) not valid;

alter table public.trades drop constraint if exists trades_strategy_same_owner;
alter table public.trades add constraint trades_strategy_same_owner
  foreign key (strategy_id, user_id) references public.strategies(id, user_id)
  on delete set null (strategy_id) not valid;

alter table public.trade_screenshots drop constraint if exists screenshots_same_owner;
alter table public.trade_screenshots add constraint screenshots_same_owner
  foreign key (trade_id, user_id) references public.trades(id, user_id) on delete cascade not valid;

-- trade_tags needs no equivalent: its RLS policy already requires the trade *and* the tag to belong
-- to the caller on both USING and WITH CHECK, which is the same guarantee.
--
-- To see whether any historic row would fail these, after an `alter table ... validate constraint`
-- attempt Postgres names the offending row; or run
--   select t.id from public.trades t join public.trading_accounts a on a.id = t.account_id
--   where a.user_id <> t.user_id;


-- 2. Shape -------------------------------------------------------------------------------------
--
-- The charts group by these strings, so a stray "morning" or a 40-character symbol becomes a bar
-- nobody recognises — or a table column that no longer lines up. Length caps are generous: they
-- exist to bound a payload, not to police your wording.

alter table public.trades drop constraint if exists trades_session_values;
alter table public.trades add constraint trades_session_values
  check (session is null or session in ('Morning', 'Evening')) not valid;

alter table public.trades drop constraint if exists trades_lengths;
alter table public.trades add constraint trades_lengths check (
  char_length(symbol) between 1 and 32
  and char_length(asset_class) <= 32
  and char_length(emotion) <= 64
  and char_length(mistake) <= 64
  and char_length(notes) <= 10000
) not valid;

alter table public.trades drop constraint if exists trades_numbers;
alter table public.trades add constraint trades_numbers check (
  (entry_price is null or entry_price > 0)
  and (exit_price is null or exit_price > 0)
  and (position_size is null or position_size > 0)
  and (stop_loss is null or stop_loss > 0)
  and (take_profit is null or take_profit > 0)
  and (risk_amount is null or risk_amount >= 0)
  and (mae is null or mae >= 0)
  and (mfe is null or mfe >= 0)
  and commission >= 0 and swap >= 0 and fees >= 0
) not valid;

-- A trade cannot be closed before it was opened. The app already guards this in the form; the
-- database should not depend on that.
alter table public.trades drop constraint if exists trades_exit_after_entry;
alter table public.trades add constraint trades_exit_after_entry
  check (exit_at is null or exit_at >= entry_at) not valid;

alter table public.trading_accounts drop constraint if exists accounts_numbers;
alter table public.trading_accounts add constraint accounts_numbers check (
  starting_balance >= 0
  and (max_daily_loss is null or max_daily_loss >= 0)
  and (max_drawdown is null or max_drawdown >= 0)
) not valid;

alter table public.strategies drop constraint if exists strategies_lengths;
alter table public.strategies add constraint strategies_lengths check (
  char_length(name) between 1 and 80
  and (description is null or char_length(description) <= 2000)
  and (rules is null or char_length(rules) <= 10000)
) not valid;

alter table public.tags drop constraint if exists tags_lengths;
alter table public.tags add constraint tags_lengths check (
  char_length(name) between 1 and 40
  and (category is null or char_length(category) <= 32)
) not valid;

alter table public.trade_screenshots drop constraint if exists screenshots_lengths;
alter table public.trade_screenshots add constraint screenshots_lengths check (
  char_length(storage_path) between 1 and 512
  and (caption is null or char_length(caption) <= 255)
) not valid;

-- Zakat settings: a rate outside 0–100 or a year of 27500 is a typo, not a year's zakat.
alter table public.zakat_years drop constraint if exists zakat_years_sane;
alter table public.zakat_years add constraint zakat_years_sane check (
  year between 2000 and 2100 and rate >= 0 and rate <= 100 and other_income >= 0
) not valid;

alter table public.zakat_payments drop constraint if exists zakat_payments_sane;
alter table public.zakat_payments add constraint zakat_payments_sane check (
  year between 2000 and 2100 and amount >= 0
) not valid;

-- Optional, and deliberately left commented: two strategies with the same name are legal today and
-- this fails if any exist. Uncomment only if you want names unique per user, like tags already are.
--   select user_id, lower(name), count(*) from public.strategies group by 1, 2 having count(*) > 1;
--   create unique index if not exists strategies_user_name_idx on public.strategies(user_id, lower(name));


-- 3. Storage -----------------------------------------------------------------------------------
--
-- The upload form checks size and MIME type, but that check lives in the browser: an authenticated
-- client can POST straight to Storage and skip it. The bucket is the only place the rule can be
-- enforced for every caller.

update storage.buckets
set file_size_limit = 10485760, -- 10 MB, matching the form's own limit
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'trade-screenshots';


-- 4. Indexes -----------------------------------------------------------------------------------
--
-- The journal always reads its own rows newest-first, optionally narrowed to one account, strategy
-- or symbol. These match those reads; `trades_user_entry_idx` from the first schema still covers the
-- unfiltered case.

create index if not exists trades_user_entry_id_idx on public.trades(user_id, entry_at desc, id);
create index if not exists trades_user_account_entry_idx on public.trades(user_id, account_id, entry_at desc);
create index if not exists trades_user_strategy_entry_idx on public.trades(user_id, strategy_id, entry_at desc);
create index if not exists trades_user_exit_idx on public.trades(user_id, exit_at);
create index if not exists trade_tags_tag_idx on public.trade_tags(tag_id);
create index if not exists screenshots_user_idx on public.trade_screenshots(user_id);
create index if not exists reviews_user_date_idx on public.daily_reviews(user_id, review_date desc);
create index if not exists weekly_reviews_user_start_idx on public.weekly_reviews(user_id, week_start desc);
