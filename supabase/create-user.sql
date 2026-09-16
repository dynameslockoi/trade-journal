-- Admin-created accounts ---------------------------------------------------------------------------
--
-- Everything so far assumes the *customer* signs up: an invitation code, then an email they have to
-- confirm before they can sign in. That is the right rule for a paying customer and the wrong one for
-- two other cases the administrator has to handle:
--
--   * a test or demo account, where the address is made up and there is no inbox to confirm from;
--   * a customer you are onboarding by hand, where you would rather create the working account now
--     than wait for them to click a link.
--
-- This adds one function an administrator can call to create an account that is already confirmed, so
-- no email is ever sent and none is needed — while "Confirm email" stays switched on for everybody
-- signing themselves up. Nothing here weakens the signup gate; see the note on the trigger below.
--
-- Run this after `admin.sql`. Like `admin.sql`, it has to be re-run if you ever re-run `schema.sql`,
-- because that file recreates the signup trigger without the exemption added here.
--
-- The Admin page calls it. Nothing in the app can call it as a customer, and this file grants it to no
-- anonymous role.


-- 1. The signup trigger, taught one exemption ------------------------------------------------------
--
-- Same trigger as `admin.sql`, with one branch in front of it: when an administrator is creating the
-- row, there is nobody to invite and no code to require.
--
-- Both halves of that condition are load-bearing. `created_by_admin` is just a value in the signup
-- metadata — any form, or anybody posting straight at the auth API, can send it. It only counts when
-- `public.is_admin()` says the *caller* is an administrator, which it cannot be without a profile row
-- carrying `is_admin`. A customer sending the flag is still asked for a code, and the checks further
-- down in `scripts/sql-check.mjs` send exactly that request to prove it.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  by_admin boolean :=
    coalesce((new.raw_user_meta_data->>'created_by_admin')::boolean, false) and public.is_admin();
  c text := upper(regexp_replace(coalesce(new.raw_user_meta_data->>'invite_code', ''), '[^A-Za-z0-9]', '', 'g'));
  v public.invite_codes;
begin
  if by_admin then
    -- No code is consumed and none is recorded: the account did not come in on one.
    insert into public.profiles(id, display_name, is_admin)
    values (new.id, new.raw_user_meta_data->>'display_name', false)
    on conflict (id) do update set display_name = excluded.display_name;
    return new;
  end if;

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
  -- bottom of `admin.sql` is the one that counts.
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


-- 2. Repair an account created by the first version of this file -------------------------------------------------
--
-- The first version filled only the columns the catalogue marks NOT NULL, and everything GoTrue fills in
-- code is NULLable instead, so the row it produced failed in two separate ways, one behind the other:
--
--   1. The lookup found nothing, so sign-in answered `400 invalid_credentials`. A password grant looks a
--      user up with exactly this predicate (GoTrue `internal/models/user.go`, `FindUserByEmailAndAudience`):
--
--        where instance_id = '00000000-0000-0000-0000-000000000000' and lower(email) = $1
--          and aud = $2 and is_sso_user = false
--
--      `aud`, `role` and `instance_id` are all NULLable with no default, and a NULL in any of them means
--      the account is found by nothing: it exists, the password is right, and every sign-in is refused.
--
--   2. Once the lookup matched, the row still could not be read: `created_at`, `updated_at` and the token
--      columns are NULL, and GoTrue scans those into a `time.Time` and plain `string`s that cannot hold
--      NULL — `500 Database error querying schema`, on an account that was otherwise perfect.
--
-- This puts both right. There is nothing to repair on a database where the earlier version never ran;
-- it is idempotent either way, and it only ever fills a NULL, so it cannot damage a working account.
update auth.users
   set aud = coalesce(aud, 'authenticated'),
       "role" = coalesce("role", 'authenticated'),
       instance_id = coalesce(instance_id, '00000000-0000-0000-0000-000000000000'),
       created_at = coalesce(created_at, now()),
       updated_at = coalesce(updated_at, now()),
       confirmation_token = coalesce(confirmation_token, ''),
       recovery_token = coalesce(recovery_token, ''),
       email_change = coalesce(email_change, ''),
       email_change_token_current = coalesce(email_change_token_current, ''),
       email_change_token_new = coalesce(email_change_token_new, ''),
       phone_change = coalesce(phone_change, ''),
       phone_change_token = coalesce(phone_change_token, ''),
       reauthentication_token = coalesce(reauthentication_token, '')
 where aud is null or "role" is null or instance_id is null
    or created_at is null or updated_at is null
    or confirmation_token is null or recovery_token is null or email_change is null
    or email_change_token_current is null or email_change_token_new is null
    or phone_change is null or phone_change_token is null or reauthentication_token is null;


-- 3. Create the account ---------------------------------------------------------------------------

-- The password has to be hashed the way GoTrue hashes it, which is `crypt` from pgcrypto. Supabase
-- installs it in the `extensions` schema; this line is a no-op when it is already there, and the
-- function below puts both schemas on its path so the call resolves either way.
create extension if not exists pgcrypto with schema extensions;

create or replace function public.admin_create_user(
  new_email text,
  new_password text,
  new_name text default null,
  new_access_until date default null,
  new_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(btrim(coalesce(new_email, '')));
  v_existing uuid;
  -- Columns the catalogue says are required and this insert has not named. See the loop below.
  v_columns text;
  v_values text;
  col record;
  -- Columns GoTrue writes itself and reads back into values that cannot be NULL. See the loop below.
  v_canonical text[] := array[
    'created_at', 'updated_at', 'confirmation_token', 'recovery_token', 'email_change',
    'email_change_token_current', 'email_change_token_new', 'phone_change', 'phone_change_token',
    'reauthentication_token'
  ];
begin
  -- The only thing standing between this function and anybody who can reach PostgREST.
  if not public.is_admin() then
    raise exception 'Only an administrator can create an account.';
  end if;

  -- Refusals that a person causes come back as a sentence the form can show, rather than as a
  -- database error: the caller is an administrator using a dialog, and "duplicate key value violates
  -- unique constraint" is not an answer to anything they did wrong.
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    return jsonb_build_object('ok', false, 'reason', 'That does not look like an email address.');
  end if;
  if length(coalesce(new_password, '')) < 8 then
    return jsonb_build_object('ok', false, 'reason', 'Use a password of at least 8 characters.');
  end if;
  select id into v_existing from auth.users where lower(email) = v_email;
  if v_existing is not null then
    return jsonb_build_object('ok', false, 'reason', 'That email already has an account.', 'id', v_existing);
  end if;

  -- GoTrue's `auth` schema drifts between versions, and a column that is NOT NULL with no default and
  -- is not named below would fail this insert with a message about a column nobody here has heard of. So
  -- the catalogue is asked what is required, and the missing ones are filled with the value the schema
  -- itself would use: an empty string for the change tokens, `false` for the flags.
  --
  -- `v_canonical` names the columns GoTrue writes itself and reads back into a value that cannot be NULL
  -- — `time.Time` for the timestamps, plain `string` for the tokens. Most of them have no default, so an
  -- insert that does not name them produces a row that is *found* by the lookup and then cannot be
  -- scanned: the grant answers `500 Database error querying schema` instead of minting a session. That is
  -- the second half of this file's history, and the NOT NULL test cannot catch it, because every one of
  -- these columns is NULLable in the schema.
  --
  -- `aud`, `role` and `instance_id` are included for the same kind of reason and fail one step earlier:
  -- they are what the lookup a password grant runs goes through, so a NULL in any of them means the
  -- account is found by nothing — it exists, the password is right, and sign-in says invalid credentials.
  for col in
    select column_name, data_type
      from information_schema.columns
     where table_schema = 'auth' and table_name = 'users'
       and column_name <> all (array['id', 'email', 'encrypted_password', 'email_confirmed_at', 'raw_user_meta_data', 'raw_app_meta_data'])
       and (
         (is_nullable = 'NO' and column_default is null)
         or column_name in ('aud', 'role', 'instance_id')
         or column_name = any (v_canonical)
       )
     order by column_name
  loop
    v_columns := concat_ws(', ', v_columns, quote_ident(col.column_name));
    v_values := concat_ws(
      ', ',
      v_values,
      case
        when col.column_name in ('aud', 'role') then quote_literal('authenticated')
        when col.data_type in ('text', 'character varying', 'character') then quote_literal('')
        when col.data_type = 'uuid' then quote_literal('00000000-0000-0000-0000-000000000000')
        when col.data_type like 'timestamp%' then 'now()'
        when col.data_type = 'boolean' then 'false'
        when col.data_type in ('smallint', 'integer', 'bigint') then '0'
        else 'null'
      end
    );
  end loop;

  -- `email_confirmed_at` is the whole point of this function: a set confirmation date is what makes
  -- GoTrue mint a session without a mail round trip, so the account works the moment it exists.
  execute format(
    'insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data%s) values (%L, %L, crypt(%L, gen_salt(''bf'')), now(), %L::jsonb, %L::jsonb%s)',
    case when v_columns is null then '' else ', ' || v_columns end,
    v_id,
    v_email,
    new_password,
    jsonb_build_object('display_name', new_name, 'created_by_admin', true)::text,
    '{"provider":"email","providers":["email"]}'::text,
    case when v_values is null then '' else ', ' || v_values end
  );

  -- GoTrue signs a password grant in against an identity row, not just the user: without this the
  -- account exists, the password is right, and every sign-in is refused as invalid credentials.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id'
  ) then
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    );
  else
    -- Before `provider_id` was split out, the identity's own id was the provider's user id.
    insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (
      v_id::text, v_id,
      jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
      'email', now(), now(), now()
    );
  end if;

  -- The trigger above created the profile row. The end date and the note are what the dialog asked
  -- for, so they are applied here rather than being left for a second visit to the Access dialog.
  update public.profiles
     set display_name = coalesce(nullif(btrim(coalesce(new_name, '')), ''), display_name),
         access_until = new_access_until,
         note = new_note,
         status = 'active'
   where id = v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'email', v_email, 'access_until', new_access_until);
end;
$$;


-- 4. Privileges -------------------------------------------------------------------------------------
--
-- Postgres grants EXECUTE on a new function to PUBLIC, and Supabase grants the API roles everything in
-- `public`, so both are taken back. An administrator calls this through their own session; nobody
-- anonymous can reach it at all.
revoke all on function public.admin_create_user(text, text, text, date, text) from public, anon;
grant execute on function public.admin_create_user(text, text, text, date, text) to authenticated;


-- 5. Check it landed --------------------------------------------------------------------------------
--
-- Expect one row per function. If either is missing, this file did not run.
--
--   select proname from pg_proc where proname in ('admin_create_user', 'handle_new_user');
--
-- And expect this to return **no rows**: one row here is an account made by the first version of this
-- file that the repair above has not brought back, i.e. one that exists and cannot sign in. It is also
-- the quickest way to ask the database whether every hand-created account is whole.
select u.email,
       concat_ws(', ',
                 case when u.aud is null then 'aud' end,
                 case when u."role" is null then 'role' end,
                 case when u.instance_id is null then 'instance_id' end,
                 case when u.created_at is null then 'created_at' end,
                 case when u.updated_at is null then 'updated_at' end,
                 case when u.confirmation_token is null then 'confirmation_token' end,
                 case when u.recovery_token is null then 'recovery_token' end,
                 case when u.email_change is null then 'email_change' end,
                 case when u.email_change_token_new is null then 'email_change_token_new' end,
                 case when u.phone_change is null then 'phone_change' end,
                 case when u.phone_change_token is null then 'phone_change_token' end,
                 case when u.reauthentication_token is null then 'reauthentication_token' end
       ) as still_null
  from auth.users u
 where coalesce(u.raw_user_meta_data->>'created_by_admin', 'false') = 'true'
   and (u.aud is null or u."role" is null or u.instance_id is null or u.created_at is null or u.updated_at is null
        or u.confirmation_token is null or u.recovery_token is null or u.email_change is null
        or u.email_change_token_new is null or u.phone_change is null or u.phone_change_token is null
        or u.reauthentication_token is null);
