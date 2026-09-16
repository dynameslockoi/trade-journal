-- Account cash flow -----------------------------------------------------------------------------
--
-- Capital used to be one number typed into the account form. That says what an account was opened
-- with, but nothing about what happened after: a top-up, profits taken out, money you pay yourself.
-- Every one of those moves the balance, so equity computed from the opening figure alone drifts
-- further from the real account every month.
--
-- This makes the movements the source of capital, with the opening figure as its first row:
--
--   equity = (deposits - withdrawals) + the journal's P&L
--
-- Run once in the Supabase SQL editor. It is re-runnable, and like hardening.sql the composite key
-- is added NOT VALID so no existing row can be rejected.

create table if not exists public.account_cash_flows(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.trading_accounts(id) on delete cascade,
  -- A movement in or out. Amounts are stored positive; `kind` carries the direction, so a typo
  -- cannot turn a withdrawal into a deposit.
  kind text not null check (kind in ('deposit', 'withdrawal')),
  amount numeric(18,2) not null check (amount > 0),
  occurred_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists cash_flows_account_date_idx
  on public.account_cash_flows(user_id, account_id, occurred_on desc);

alter table public.account_cash_flows enable row level security;

drop policy if exists "cash flows own" on public.account_cash_flows;
create policy "cash flows own" on public.account_cash_flows
  for all using(auth.uid() = user_id) with check(auth.uid() = user_id);

-- "This movement belongs to an account of mine" — the same rule hardening.sql applies to trades, so
-- a request that knows someone else's account id cannot record money against it. The referenced
-- pair has to be unique first; hardening.sql creates this index, and repeating it here means this
-- file stands on its own.
create unique index if not exists trading_accounts_id_user_idx on public.trading_accounts(id, user_id);

create unique index if not exists cash_flows_id_user_idx on public.account_cash_flows(id, user_id);
alter table public.account_cash_flows drop constraint if exists cash_flows_account_same_owner;
alter table public.account_cash_flows add constraint cash_flows_account_same_owner
  foreign key (account_id, user_id) references public.trading_accounts(id, user_id)
  on delete cascade not valid;

-- Each account's existing starting balance becomes its first deposit, dated before its first trade,
-- so the capital every page divides by does not move when this runs. Re-running adds nothing: the
-- insert only fires for an account that has no opening row yet.
insert into public.account_cash_flows (user_id, account_id, kind, amount, occurred_on, note)
select
  a.user_id,
  a.id,
  'deposit',
  a.starting_balance,
  coalesce(
    (select min(t.entry_at)::date from public.trades t where t.account_id = a.id),
    a.created_at::date
  ),
  'Opening balance'
from public.trading_accounts a
where a.starting_balance > 0
  and not exists (
    select 1 from public.account_cash_flows f
    where f.account_id = a.id and f.kind = 'deposit' and f.note = 'Opening balance'
  );
