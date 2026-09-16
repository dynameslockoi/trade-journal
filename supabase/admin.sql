-- Phase 14 — running the journal for other people: invitation-only signups, an admin who can see who
-- is using it, and an access switch per account.
--
-- Run this after schema.sql, hardening.sql, sectors.sql and cashflow.sql — and then run access.sql,
-- which is the file that makes `status` and `access_until` mean something outside the app too. This
-- one is written to be re-runnable, and it changes nothing about how the journal reads or calculates
-- your own trades.
--
-- What it adds
--
--   1. `public.invite_codes` — the only way an account can be created. A signup without a usable code
--      is refused by the database itself (a trigger on `auth.users`), not by the sign-up form, so
--      posting straight to the auth API does not get around it.
--   2. Five columns on `public.profiles` — `is_admin`, `status`, `access_until`, `note` and
--      `invite_code` (which code the account came in on). No subscription, no plan tiers: access is
--      a switch an admin flips, optionally with an end date.
--   3. Admin-only functions the app calls: `me()`, `admin_overview()`, `admin_set_user(...)`,
--      `admin_create_invite(...)`, `admin_set_invite(...)`.
--   4. Closes a hole that already existed: every account could write its *own* `profiles` row — RLS
--      checks `auth.uid() = id` and said nothing about which columns — so any signed-in user could
--      have set `is_admin = true` on themselves. Column-level privileges below stop that.
--
-- There is still no service-role key anywhere. Admin reads and writes go through SECURITY DEFINER
-- functions that each check `public.is_admin()` first, so the browser never holds a key that can
-- bypass RLS, and a non-admin calling one of these functions gets an error rather than data.


-- 1. Who runs the shop --------------------------------------------------------------------------
--
-- `is_admin` is a column on the profile rather than a hardcoded email: which account admins the
-- journal is a data question, and it should not need a deploy to answer.
--
-- ▼▼ ONE MANUAL STEP. The block at the very bottom of this file promotes an account to admin. Open it
--    and put your own address in before running this file, or run it afterwards — either way the
--    admin page stays invisible until one account carries `is_admin = true`.

alter table public.profiles add column if not exists is_admin boolean not null default false;
-- 'active' or 'suspended'. A suspension is enforced on every page load (see components/app-shell.tsx)
-- and again at sign-in, so a suspended account cannot get back in by reloading.
alter table public.profiles add column if not exists status text not null default 'active';
-- Null means "no end date". A date in the past locks the account out on its own, without an admin
-- having to remember to suspend it — which is what makes a one-off sale (six months, a year) work
-- without a recurring subscription.
alter table public.profiles add column if not exists access_until date;
-- Why an account is in the state it is in. Rendered as-is on the admin page.
alter table public.profiles add column if not exists note text;
-- Which invitation code created the account, so a code's usage is answerable by joining, not by
-- keeping a separate log in step.
alter table public.profiles add column if not exists invite_code text;

alter table public.profiles drop constraint if exists profiles_status_values;
alter table public.profiles add constraint profiles_status_values check (status in ('active', 'suspended'));

create index if not exists profiles_status_idx on public.profiles(status);
create index if not exists profiles_invite_code_idx on public.profiles(invite_code);


-- 2. Invitation codes --------------------------------------------------------------------------
--
-- A code is stored normalised to upper-case letters and digits only, so "bursa-2026" and "Bursa 2026"
-- are the same code and nobody loses a signup to a stray dash. `lib/access.ts` normalises the same
-- way before the form sends it, and `scripts/admin-check.mts` asserts the two agree.

create table if not exists public.invite_codes(
  code text primary key,
  note text,
  -- `max_uses` above 1 is for handing one code to a group; `used_count` is bumped inside the signup
  -- trigger, which takes a row lock, so two people racing one code cannot both take the last seat.
  max_uses int not null default 1 check (max_uses > 0),
  used_count int not null default 0 check (used_count >= 0),
  expires_at date,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.invite_codes enable row level security;


-- 3. Helpers -----------------------------------------------------------------------------------

-- Security definer so the check can read `profiles` without being filtered by that table's own RLS.
-- `stable` because it must return the same answer everywhere in one statement.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- Only an admin can see the invite table at all: codes must not be listable by a signed-in user
-- looking for a free seat. It is created here rather than beside the table because the policy calls
-- `is_admin()`, which has to exist first. `check_invite()` is the one deliberate exception, and it
-- answers about a code it is given rather than listing anything.
drop policy if exists "invite codes admin" on public.invite_codes;
create policy "invite codes admin" on public.invite_codes
  for all using (public.is_admin()) with check (public.is_admin());

-- Is this code usable? Read-only, callable without signing in, and deliberately vague: it answers
-- about the exact string it was handed, so it cannot be used to enumerate the table.
create or replace function public.check_invite(code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  v public.invite_codes;
begin
  if c = '' then
    return jsonb_build_object('ok', false, 'reason', 'Enter your invitation code.');
  end if;
  -- `ic.code` rather than `code`: the parameter has that name too, and an unqualified reference is an
  -- error in PL/pgSQL, not a guess.
  select * into v from public.invite_codes ic where ic.code = c;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'That invitation code is not recognised.');
  end if;
  if v.disabled then
    return jsonb_build_object('ok', false, 'reason', 'That invitation code has been switched off.');
  end if;
  if v.expires_at is not null and v.expires_at < current_date then
    return jsonb_build_object('ok', false, 'reason', 'That invitation code has expired.');
  end if;
  if v.used_count >= v.max_uses then
    return jsonb_build_object('ok', false, 'reason', 'That invitation code has already been used.');
  end if;
  return jsonb_build_object('ok', true, 'reason', '');
end;
$$;


-- 4. The signup gate ---------------------------------------------------------------------------
--
-- This replaces the function `schema.sql` installs on `auth.users`, keeping its original job (create
-- the profile row) and adding the gate in front of it. An account with no valid code is refused by
-- the database, which is the only place the rule cannot be skipped: the sign-up form can be edited by
-- anyone, and an unconfirmed email never reaches a page of ours.
--
-- The `for update` on the code is what makes `max_uses` mean something under a race.
--
-- NOTE: this trigger runs for every insert into `auth.users`, including ones made by hand in the
-- Supabase dashboard. To add an account that way, create its code first.
--
-- NOTE: if you re-run `schema.sql` later, run this file again afterwards — that file recreates
-- `handle_new_user` without the gate and would quietly reopen signups.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := upper(regexp_replace(coalesce(new.raw_user_meta_data->>'invite_code', ''), '[^A-Za-z0-9]', '', 'g'));
  v public.invite_codes;
begin
  if c = '' then
    raise exception 'An invitation code is required to create an account.';
  end if;
  select * into v from public.invite_codes where code = c for update;
  if not found then
    raise exception 'That invitation code is not recognised.';
  end if;
  if v.disabled or (v.expires_at is not null and v.expires_at < current_date) then
    raise exception 'That invitation code is no longer valid.';
  end if;
  if v.used_count >= v.max_uses then
    raise exception 'That invitation code has already been used.';
  end if;

  update public.invite_codes set used_count = used_count + 1 where code = c;

  -- The first account on a fresh install becomes the admin, so a new deployment is never locked out
  -- of its own admin page. On an existing database a profile already exists, so the promotion at the
  -- bottom of this file is the one that counts.
  insert into public.profiles(id, display_name, invite_code, is_admin)
  values (
    new.id,
    new.raw_user_meta_data->>'display_name',
    c,
    not exists (select 1 from public.profiles where is_admin)
  )
  on conflict (id) do update set invite_code = excluded.invite_code;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 5. What the signed-in user may know about themselves ------------------------------------------
--
-- The app calls this once per session: the shell uses `is_admin` to decide whether the Admin page
-- exists in the navigation, and `status`/`access_until` to decide whether the account is allowed in
-- at all. Returns null when there is no profile row, which the client reads as "nothing to enforce".

create or replace function public.me()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'email', (select u.email from auth.users u where u.id = auth.uid()),
    'display_name', p.display_name,
    'is_admin', p.is_admin,
    'status', p.status,
    'access_until', p.access_until
  )
  from public.profiles p
  where p.id = auth.uid();
$$;


-- 6. The admin page's one read ------------------------------------------------------------------
--
-- Counts and per-account usage, not other people's trades. An admin needs to know whether an account
-- is being used and whether it should still be open; it does not need to read someone's journal, so
-- no P&L, symbol or note from `trades` is returned here.

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_stats jsonb;
  v_users jsonb;
  v_invites jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can read the admin overview.';
  end if;

  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'active', (select count(*) from public.profiles
                where status = 'active'
                  and (access_until is null or access_until >= current_date)),
    'blocked', (select count(*) from public.profiles
                 where status = 'suspended'
                    or (access_until is not null and access_until < current_date)),
    'admins', (select count(*) from public.profiles where is_admin),
    'new_this_month', (select count(*) from public.profiles where created_at >= date_trunc('month', now())),
    'trades', (select count(*) from public.trades),
    'codes', (select count(*) from public.invite_codes),
    'codes_available', (select count(*) from public.invite_codes
                         where not disabled
                           and used_count < max_uses
                           and (expires_at is null or expires_at >= current_date))
  ) into v_stats;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'email', u.email,
    'display_name', p.display_name,
    'created_at', p.created_at,
    'status', p.status,
    'is_admin', p.is_admin,
    'access_until', p.access_until,
    'note', p.note,
    'invite_code', p.invite_code,
    -- Usage, so "is this account alive?" is answerable without opening anyone's journal.
    'trades', (select count(*) from public.trades t where t.user_id = p.id),
    'accounts', (select count(*) from public.trading_accounts a where a.user_id = p.id),
    'last_trade_at', (select max(t.entry_at) from public.trades t where t.user_id = p.id)
  ) order by p.created_at desc), '[]'::jsonb)
  into v_users
  from public.profiles p
  left join auth.users u on u.id = p.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'code', c.code,
    'note', c.note,
    'max_uses', c.max_uses,
    'used_count', c.used_count,
    'expires_at', c.expires_at,
    'disabled', c.disabled,
    'created_at', c.created_at,
    'used_by', (select coalesce(jsonb_agg(u2.email), '[]'::jsonb)
                 from public.profiles p2
                 join auth.users u2 on u2.id = p2.id
                where p2.invite_code = c.code)
  ) order by c.created_at desc), '[]'::jsonb)
  into v_invites
  from public.invite_codes c;

  return jsonb_build_object('stats', v_stats, 'users', v_users, 'invites', v_invites);
end;
$$;


-- 7. The admin page's writes --------------------------------------------------------------------
--
-- `admin_set_user` replaces all three admin-controlled fields at once, and a null clears: the dialog
-- on the admin page always sends the state it means to end up with, so "reactivate this account" can
-- never leave a stale end date behind it. That is simpler than a second set of `clear_*` flags, and
-- it means one code path instead of a patchwork of partial updates.

create or replace function public.admin_set_user(
  target uuid,
  new_status text default null,
  new_access_until date default null,
  new_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change an account.';
  end if;
  -- An admin suspending themselves would leave an install with nobody who can undo it.
  if target = auth.uid() then
    raise exception 'You cannot change your own access here.';
  end if;
  if new_status is not null and new_status not in ('active', 'suspended') then
    raise exception 'Unknown status: %', new_status;
  end if;

  update public.profiles
     set status = coalesce(new_status, 'active'),
         access_until = new_access_until,
         note = nullif(btrim(coalesce(new_note, '')), '')
   where id = target;

  if not found then
    raise exception 'No such account.';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- An empty `new_code` generates one, so the common case is a single click. Codes are stored
-- normalised, which is why a code typed as "kursus-2026" comes back as "KURSUS2026".
create or replace function public.admin_create_invite(
  new_code text default null,
  new_note text default null,
  new_max_uses int default 1,
  new_expires_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := upper(regexp_replace(coalesce(new_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can create invitation codes.';
  end if;
  if c = '' then
    c := upper(encode(gen_random_bytes(5), 'hex'));
  end if;
  if char_length(c) > 32 then
    raise exception 'An invitation code can be at most 32 characters.';
  end if;

  insert into public.invite_codes(code, note, max_uses, expires_at)
  values (c, nullif(btrim(coalesce(new_note, '')), ''), greatest(coalesce(new_max_uses, 1), 1), new_expires_at)
  on conflict (code) do nothing;

  -- `on conflict do nothing` leaves FOUND false, so this reports a clash instead of silently doing
  -- nothing while the form says "created".
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'That code already exists.');
  end if;
  return jsonb_build_object('ok', true, 'code', c);
end;
$$;

-- Switching a code off is the way to stop a shared code going further; it is reversible, which
-- deleting it would not be — the accounts it created keep pointing at it.
create or replace function public.admin_set_invite(
  target_code text,
  new_disabled boolean default null,
  new_expires_at date default null,
  clear_expiry boolean default false,
  new_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c text := upper(regexp_replace(coalesce(target_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can change invitation codes.';
  end if;

  update public.invite_codes
     set disabled = coalesce(new_disabled, disabled),
         expires_at = case when clear_expiry then null else coalesce(new_expires_at, expires_at) end,
         note = coalesce(new_note, note)
   where code = c;

  if not found then
    raise exception 'No such invitation code.';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;


-- 8. Closing the self-promotion hole -----------------------------------------------------------
--
-- RLS on `profiles` checks `auth.uid() = id` and says nothing about *which* columns, so before this
-- trigger any signed-in account could write `is_admin = true` onto its own row through the API — and
-- every admin check in this file would then be checking a value the caller had just written.
--
-- A trigger rather than column privileges, deliberately. Column grants would have to match exactly
-- what PostgREST writes in its upsert's SET clause, and a mismatch there fails the *ordinary* save of
-- your own display name while the rule it was meant to state is written down nowhere. This says the
-- rule instead: through the API, these five columns cannot move unless the caller is an admin.
--
-- `current_user` is the role the statement is executing as, which is what separates the two kinds of
-- caller. Our own database code — `handle_new_user` stamping a new account, this file promoting you,
-- the service role — runs as one of the roles listed below and is left alone. Anything arriving
-- through PostgREST is a client, whatever key it holds.

create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role') then
    return new;
  end if;
  if public.is_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A profile row is created for you at signup; one arriving over the API is a client writing it.
    if new.is_admin
       or new.status <> 'active'
       or new.access_until is not null
       or new.note is not null
       or new.invite_code is not null then
      raise exception 'Only an administrator can set access on an account.';
    end if;
  elsif new.is_admin is distinct from old.is_admin
     or new.status is distinct from old.status
     or new.access_until is distinct from old.access_until
     or new.note is distinct from old.note
     or new.invite_code is distinct from old.invite_code then
    raise exception 'Only an administrator can change access on an account.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before insert or update on public.profiles
  for each row execute procedure public.guard_profile_columns();


-- 9. Privileges --------------------------------------------------------------------------------
--
-- Supabase grants `authenticated` and `anon` everything on new tables in `public`, and Postgres
-- grants EXECUTE on new functions to PUBLIC. Both defaults are wrong for this file, so each of them
-- is taken back explicitly. The one deliberate grant to `anon` is `check_invite`, which the sign-up
-- form calls before an account exists.
revoke all on public.invite_codes from anon;
grant select, insert, update, delete on public.invite_codes to authenticated;

-- `is_admin()` must stay callable by a signed-in user: the guard trigger above runs as them and asks
-- it whether they may move those columns.
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.check_invite(text) from public;
grant execute on function public.check_invite(text) to anon, authenticated;

revoke all on function public.me() from public, anon;
grant execute on function public.me() to authenticated;

revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

revoke all on function public.admin_set_user(uuid, text, date, text) from public, anon;
grant execute on function public.admin_set_user(uuid, text, date, text) to authenticated;

revoke all on function public.admin_create_invite(text, text, int, date) from public, anon;
grant execute on function public.admin_create_invite(text, text, int, date) to authenticated;

revoke all on function public.admin_set_invite(text, boolean, date, boolean, text) from public, anon;
grant execute on function public.admin_set_invite(text, boolean, date, boolean, text) to authenticated;


-- 10. ▼▼ THE ONE LINE YOU MUST EDIT ▼▼ -----------------------------------------------------------
--
-- Put the address you sign in with in place of the placeholder, then run just this statement (the
-- rest of the file is already applied by now). It promotes your existing account to admin — the
-- auto-promotion inside `handle_new_user` cannot help here, because your profile row already exists.
--
-- To check first who would be promoted, run the select; it lists every account.
--   select u.email, p.created_at, p.is_admin from public.profiles p join auth.users u on u.id = p.id order by p.created_at;
--
-- update public.profiles set is_admin = true
--  where id = (select id from auth.users where email = 'you@example.com');
--
-- If the update reports 0 rows, the address does not match an account — copy it from the select
-- above rather than retyping it.
