-- Access state, enforced by the database -----------------------------------------------------------
--
-- `profiles.status` and `access_until` used to be a decision the *app* made. The shell reads them
-- through `me()` and shows a blocked screen, and the sign-in page refuses a suspended account — but
-- every RLS policy in the project asked only "is this row yours?" (`auth.uid() = user_id`) and never
-- "are you still allowed in?". So a customer whose account had been switched off could walk around
-- the product entirely: sign in again with the password they already have — the auth server knows
-- nothing about your profile — and read and write the whole journal through the API.
--
-- The product was closed. The data was not.
--
-- This puts the access question into every policy that hands out a row, so a suspended or expired
-- account is refused by Postgres itself. No session to revoke, no service-role key, and nothing to
-- run on a schedule: the same stored dates that label the account on the admin page are the ones the
-- database now checks.
--
-- Run once in the Supabase SQL editor, LAST — after schema.sql, cashflow.sql, sectors.sql,
-- hardening.sql and admin.sql. It is re-runnable: every policy is dropped and created again under
-- the same name.
--
-- What it does NOT change: what any policy allows an *active* account to do, which is why the tests
-- in scripts/sql-check.mjs walk the ordinary write path (insert a trade, tag it, attach a
-- screenshot, save a review) as well as the refusal path. A wrong turn here would not be a hole, it
-- would be everybody's journal going empty.


-- 1. The rule -------------------------------------------------------------------------------------
--
-- Mirrors `accessState()` in lib/access.ts, which is what the app shows. Two properties matter more
-- than the rest:
--
--   * **An admin is always allowed.** The account that runs the install must not be able to lock
--     itself out of the page that unlocks everyone else, even if its own end date passes.
--   * **No profile row means allowed.** Failing closed would turn "this database has not had
--     admin.sql run yet" into an empty journal for every account on it — an error, not a paywall.
--
-- An end date is inclusive: the day itself still works, and the account expires the next day.
--
-- One deliberate difference from the app: the date here is the *database's* date, and on Supabase that
-- is UTC, while the admin page labels an end date with the Malaysian calendar (`lib/dates.ts`). For the
-- first eight hours of a Malaysian day the database is up to a day behind the label, so an account can
-- read "ended 16 Sept" on the admin page while the API still accepts it until 08:00 on the 17th. That
-- errs permissive, which is the safe direction — the app may say expired while the database still
-- allows, never the other way round, so this cannot lock anybody out. A suspension has no such
-- boundary; `status` is a value, not a date, and it is honoured the moment it is written.

create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select p.is_admin
          or (coalesce(p.status, 'active') = 'active'
              and (p.access_until is null or p.access_until >= current_date))
      from public.profiles p
      where p.id = auth.uid()
    ),
    true
  );
$$;

-- Who may call this — and it matters, because the policies below call it as the caller. A policy
-- expression is evaluated with the privileges of whoever is asking, so without these grants a
-- signed-in read of any table here fails with "permission denied for function is_active" instead of
-- returning the account's own rows.
--
-- There is a trap in that, worth knowing before someone edits these lines: with an empty table the
-- check is never reached, because no row is ever evaluated. A missing grant therefore looks harmless
-- on a fresh database and only shows up once an account has data — which is exactly when it is
-- reported as the app being broken. `scripts/sql-check.mjs` seeds rows first and then revokes the
-- grant, so the failure mode is pinned down rather than rediscovered.
--
-- Closed to PUBLIC and then handed to the two roles that need it, the same shape `admin.sql` uses for
-- its own functions: a new function is executable by PUBLIC unless somebody says otherwise, so
-- granting `to anon, authenticated` alone would rest on a default rather than state a rule.
-- `service_role` is left out because it bypasses RLS, so no policy of ours is evaluated as that role.
revoke all on function public.is_active() from public;
grant execute on function public.is_active() to anon, authenticated;

-- `admin.sql` grants `is_admin()` to `authenticated` alone and revokes it from `anon`, and this file
-- deliberately leaves that alone. The two helpers are granted differently because the answers a
-- visitor gets depend on it:
--
--   * `is_admin()` is only ever called from the `invite_codes` policy, and `anon` holds no privilege
--     on that table at all — `admin.sql` takes it away — so a visitor's request is refused before the
--     policy is ever evaluated. (The 401 that comes back says "permission denied for table
--     invite_codes", and PostgREST's hint under it suggests granting SELECT on the codes table. Do
--     not: the refusal is the feature.)
--   * `is_active()` is called from policies on tables `anon` *can* select — trades, profiles, accounts
--     — so it is granted to `anon` above. A visitor is answered with an empty list rather than an
--     error, because the policy is what refuses them: it needs `is_active()` to be callable in order
--     to run at all, and `auth.uid() = user_id` is what then comes back false.


-- 2. Every policy that hands out a row ------------------------------------------------------------
--
-- `(select public.is_active())` rather than a bare `public.is_active()` on purpose, and it is the
-- difference between a working app and a slow one. As a bare call the qual is evaluated for every
-- row the scan touches: measured on a 20,000-row `trades` table, 193 ms against 4.5 ms without the
-- clause. Wrapped in a scalar sub-select the planner turns it into an InitPlan and evaluates it
-- once per query: 5.2 ms, and the same plan shape as the query had before. Same answer, evaluated
-- a single time — so keep the parentheses if you edit these.
--
-- Both halves are needed. `using` decides which rows you can see and which you can change; `with
-- check` decides what a new row is allowed to look like. Without the second, a suspended account
-- could not read anything but could still insert.

drop policy if exists "profiles own" on public.profiles;
create policy "profiles own" on public.profiles
  for all using(auth.uid() = id and (select public.is_active()))
  with check(auth.uid() = id and (select public.is_active()));

drop policy if exists "accounts own" on public.trading_accounts;
create policy "accounts own" on public.trading_accounts
  for all using(auth.uid() = user_id and (select public.is_active()))
  with check(auth.uid() = user_id and (select public.is_active()));

drop policy if exists "strategies own" on public.strategies;
create policy "strategies own" on public.strategies
  for all using(auth.uid() = user_id and (select public.is_active()))
  with check(auth.uid() = user_id and (select public.is_active()));

drop policy if exists "trades own" on public.trades;
create policy "trades own" on public.trades
  for all using(auth.uid() = user_id and (select public.is_active()))
  with check(auth.uid() = user_id and (select public.is_active()));

drop policy if exists "tags own" on public.tags;
create policy "tags own" on public.tags
  for all using(auth.uid() = user_id and (select public.is_active()))
  with check(auth.uid() = user_id and (select public.is_active()));

drop policy if exists "screenshots own" on public.trade_screenshots;
create policy "screenshots own" on public.trade_screenshots
  for all using(auth.uid() = user_id and (select public.is_active()))
  with check(auth.uid() = user_id and (select public.is_active()));

drop policy if exists "daily reviews own" on public.daily_reviews;
create policy "daily reviews own" on public.daily_reviews
  for all using(auth.uid() = user_id and (select public.is_active()))
  with check(auth.uid() = user_id and (select public.is_active()));

drop policy if exists "weekly reviews own" on public.weekly_reviews;
create policy "weekly reviews own" on public.weekly_reviews
  for all using(auth.uid() = user_id and (select public.is_active()))
  with check(auth.uid() = user_id and (select public.is_active()));

drop policy if exists "zakat years own" on public.zakat_years;
create policy "zakat years own" on public.zakat_years
  for all using(auth.uid() = user_id and (select public.is_active()))
  with check(auth.uid() = user_id and (select public.is_active()));

drop policy if exists "zakat payments own" on public.zakat_payments;
create policy "zakat payments own" on public.zakat_payments
  for all using(auth.uid() = user_id and (select public.is_active()))
  with check(auth.uid() = user_id and (select public.is_active()));

-- A tag link belongs to a trade of mine and a tag of mine — and, like everything else, only while
-- this account is allowed in.
drop policy if exists "trade tags own rows" on public.trade_tags;
create policy "trade tags own rows" on public.trade_tags
  for all
  using(
    exists(select 1 from public.trades t where t.id = trade_id and t.user_id = auth.uid())
    and exists(select 1 from public.tags x where x.id = tag_id and x.user_id = auth.uid())
    and (select public.is_active())
  )
  with check(
    exists(select 1 from public.trades t where t.id = trade_id and t.user_id = auth.uid())
    and exists(select 1 from public.tags x where x.id = tag_id and x.user_id = auth.uid())
    and (select public.is_active())
  );

-- cashflow.sql's table, if that file has been run. Wrapped rather than assumed, so this file can be
-- applied to a database that has not got there yet without failing on a table that does not exist.
do $$
begin
  if to_regclass('public.account_cash_flows') is null then
    return;
  end if;
  drop policy if exists "cash flows own" on public.account_cash_flows;
  create policy "cash flows own" on public.account_cash_flows
    for all using(auth.uid() = user_id and (select public.is_active()))
    with check(auth.uid() = user_id and (select public.is_active()));
end $$;


-- 3. The screenshot bucket ------------------------------------------------------------------------
--
-- The bucket held the pictures behind the same "your own folder" rule, which is why deleting an
-- account used to leave nothing behind but left a suspended one everything. Storage evaluates its
-- policies as the signed-in role too, so the same clause closes it.

drop policy if exists "screenshots insert own folder" on storage.objects;
create policy "screenshots insert own folder" on storage.objects
  for insert to authenticated
  with check(bucket_id = 'trade-screenshots'
             and (storage.foldername(name))[1] = auth.uid()::text
             and (select public.is_active()));

drop policy if exists "screenshots read own folder" on storage.objects;
create policy "screenshots read own folder" on storage.objects
  for select to authenticated
  using(bucket_id = 'trade-screenshots'
        and (storage.foldername(name))[1] = auth.uid()::text
        and (select public.is_active()));

drop policy if exists "screenshots delete own folder" on storage.objects;
create policy "screenshots delete own folder" on storage.objects
  for delete to authenticated
  using(bucket_id = 'trade-screenshots'
        and (storage.foldername(name))[1] = auth.uid()::text
        and (select public.is_active()));


-- 4. Leaving, and the two rules that stay outside this ---------------------------------------------
--
-- `invite_codes` is deliberately not in the list above: its policy is `public.is_admin()`, and an
-- admin is allowed in whatever `status` says. `me()` and `check_invite()` are SECURITY DEFINER
-- functions rather than policies, so they keep answering — `me()` has to, or a blocked account could
-- not be told why it is blocked.


-- 5. Check it worked ------------------------------------------------------------------------------
--
-- Signed in as a test account, before:
--   select count(*) from public.trades;                              -- your rows
--   insert into public.tags(name) values ('probe');                  -- succeeds
--
-- Suspend it (SQL editor, as the database owner):
--   update public.profiles set status = 'suspended'
--    where id = (select id from auth.users where email = 'test@example.com');
--
-- Signed in as that account again — note that nothing errors, which is the point. A policy that
-- hides rows returns none, and a write that is not allowed is refused:
--   select count(*) from public.trades;                              -- 0
--   insert into public.tags(name) values ('probe');                  -- refused: row-level security
--   select * from storage.objects where bucket_id = 'trade-screenshots';  -- 0
--   select public.me();                                              -- still answers: suspended
--
-- Reactivate it and the journal comes back:
--   update public.profiles set status = 'active', access_until = null where ...;
--
-- To undo this file, re-run the "policies" block of schema.sql (and cashflow.sql for the money
-- rows), which recreates the same policies without the access clause.
