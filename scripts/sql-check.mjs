/**
 * The SQL, executed.
 *
 * `supabase/admin.sql` is the only way into this journal, and its rules live where the app cannot
 * test them without a database — a signup trigger, an RLS policy, a guard on `profiles`. So this runs
 * the real files against a real Postgres (PGlite: Postgres compiled to WASM) inside a fake Supabase
 * environment — the `anon`/`authenticated`/`service_role` roles, `auth.users`, `auth.uid()`, a stub
 * storage schema — and then tries to break in: sign up with no code, reuse a spent one, promote
 * myself, extend my own access, read the admin overview as a customer.
 *
 * It has already earned its keep: `check_invite` shipped for about ten minutes with `where code = c`,
 * which PL/pgSQL refuses as an ambiguous reference to both the parameter and the column. That is the
 * kind of error that only shows up when the SQL runs, and the first run of it would otherwise have
 * been the sign-up form on a live site.
 *
 * Covers the four files that decide who gets in and what they can reach: `schema.sql`, `admin.sql`,
 * `cashflow.sql` and `access.sql`. `sectors.sql` only adds a column, so it is not part of this.
 *
 *   npm run test:sql
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

let failures = 0;
const ok = (label) => console.log(`PASS  ${label}`);
const bad = (label, detail) => {
  failures++;
  console.log(`FAIL  ${label}${detail ? `: ${detail}` : ""}`);
};
function check(label, passed, detail) {
  passed ? ok(label) : bad(label, detail);
}

/** Expect the statement to be refused, with the refusal mentioned in `match`. */
async function refused(label, sql, match) {
  try {
    await db.exec(sql);
    bad(label, "it was allowed");
  } catch (e) {
    const message = String(e.message ?? e);
    check(label, !match || message.includes(match), `refused with "${message}"`);
  }
}

async function allowed(label, sql) {
  try {
    await db.exec(sql);
    ok(label);
  } catch (e) {
    bad(label, String(e.message ?? e));
  }
}

const db = new PGlite();

/**
 * pgcrypto is what hashes a password the way GoTrue does. PGlite may not carry the extension, so a
 * stand-in is defined in the same schema the real one lives in: the checks below prove the function
 * reaches the right place with the right arguments, not that the hash is bcrypt — that part is
 * GoTrue's and is not this project's to test.
 */
async function ensureCrypt(target) {
  try {
    await target.exec(`create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions`);
    // Qualified on purpose: the session's search path does not include `extensions`, which is exactly
    // why the function under test puts it on its own path.
    const probe = await target.query(`select length(extensions.crypt('probe', extensions.gen_salt('bf'))) as n`);
    if (Number(probe.rows[0]?.n) > 10) return "pgcrypto";
  } catch {
    /* fall through to the stand-in */
  }
  await target.exec(`
    create schema if not exists extensions;
    create or replace function extensions.gen_salt(kind text) returns text language sql as $$ select 'stand-in-salt'; $$;
    create or replace function extensions.crypt(password text, salt text) returns text language sql as $$
      select 'stand-in-hash:' || password || ':' || salt;
    $$;
  `);
  return "stand-in";
}

/* ---------------------------------------------------------------- a Supabase-ish environment */
await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create schema storage;

  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  -- The real definition, as Supabase ships it: the sub claim, from either setting.
  create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid;
  $$;

  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  -- Supabase ships this table with RLS already on; the storage policies are what narrow it. Without
  -- this line the policies exist but enforce nothing, and the bucket checks below would pass for
  -- the wrong reason.
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
    select string_to_array(name, '/');
  $$;

  -- What Supabase gives the API roles, including on the tables and functions created later.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

  -- Storage grants the API roles real privileges on storage.objects in Supabase; the policies are
  -- what narrows it to a folder. Without this the stub would answer "permission denied" for the
  -- wrong reason and the bucket tests below would prove nothing.
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on storage.objects to anon, authenticated, service_role;
`);

let pgcrypto = true;
try {
  await db.exec(`create extension if not exists pgcrypto`);
} catch {
  pgcrypto = false;
  console.log("NOTE  pgcrypto is unavailable in this build; gen_random_bytes is not exercised");
}
const cryptKind = await ensureCrypt(db);
console.log(`NOTE  password hashing: ${cryptKind}`);

/**
 * `auth.users` as GoTrue really has it, which is wider than the three columns the signup gate needs.
 * Two of these are the traps a hand-written insert falls into:
 *
 *   * `aud`, `role` and `instance_id` are *nullable* with no default — GoTrue fills all three in code —
 *     and the lookup that matches an email and password goes through all three (see `signInLookup`
 *     below). Leaving one of them NULL means the account exists, the password is right, and every
 *     sign-in is refused as invalid credentials. `instance_id` is the one that actually shipped that
 *     way, which is why the check that strands a row nulls all three.
 *   * `is_sso_user` is NOT NULL with no default, so an insert that does not name it fails with a message
 *     about a column nobody here has heard of; `email_change` is modelled the same way because a NULL
 *     there breaks GoTrue's own scan of the row into a Go string.
 *
 * They are added with defaults so the signup-gate checks below can keep inserting three columns, and
 * the defaults are dropped further down — right before the account-creating checks — so that the
 * function's catalogue-driven fill is exercised against the shape it exists for.
 */
await db.exec(`
  alter table auth.users add column if not exists aud text;
  alter table auth.users add column if not exists "role" text;
  alter table auth.users add column if not exists instance_id uuid;
  alter table auth.users add column if not exists is_sso_user boolean default false;
  alter table auth.users add column if not exists email_change text default '';
  alter table auth.users add column if not exists encrypted_password text;
  alter table auth.users add column if not exists email_confirmed_at timestamptz;
  alter table auth.users add column if not exists raw_app_meta_data jsonb;
  -- The second trap, and the one that hides behind the first: these are NULLable with no default in the
  -- schema, GoTrue writes them itself, and it reads them back into a time.Time and plain strings that
  -- cannot hold NULL. A row missing them is *found* by the lookup and then unreadable, which the grant
  -- reports as "500 Database error querying schema" — a different message from the one a missing
  -- audience gives, which is how the two failures were told apart.
  alter table auth.users add column if not exists updated_at timestamptz;
  alter table auth.users add column if not exists confirmation_token text;
  alter table auth.users add column if not exists recovery_token text;
  alter table auth.users add column if not exists email_change_token_current text;
  alter table auth.users add column if not exists email_change_token_new text;
  alter table auth.users add column if not exists phone_change text;
  alter table auth.users add column if not exists phone_change_token text;
  alter table auth.users add column if not exists reauthentication_token text;
  create table if not exists auth.identities (
    id uuid primary key, user_id uuid, provider_id text, identity_data jsonb,
    provider text, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz
  );
`);

/* ---------------------------------------------------------------- the real files */
const schema = readFileSync("supabase/schema.sql", "utf8");
try {
  await db.exec(schema);
} catch (e) {
  // The only line that needs the extension is the extension itself; the rest uses gen_random_uuid,
  // which is built in from Postgres 13.
  if (pgcrypto || !/pgcrypto/i.test(String(e))) throw e;
  await db.exec(schema.replace(/create extension if not exists "pgcrypto";/, "-- no pgcrypto in this build"));
}
ok("schema.sql applies");

await db.exec(readFileSync("supabase/admin.sql", "utf8"));
ok("admin.sql applies");

await db.exec(readFileSync("supabase/cashflow.sql", "utf8"));
ok("cashflow.sql applies");

await db.exec(readFileSync("supabase/access.sql", "utf8"));
ok("access.sql applies");

// `create-user.sql` replaces the signup trigger, so it runs after `admin.sql` and every gate check
// below is exercising the replacement rather than the original. Its one pgcrypto line is dropped in a
// build without the extension, the same way `schema.sql`'s is, because the stand-in already covers it.
const createUser = readFileSync("supabase/create-user.sql", "utf8");
try {
  await db.exec(createUser);
} catch (e) {
  if (pgcrypto || !/pgcrypto/i.test(String(e.message ?? e))) throw e;
  await db.exec(createUser.replace(/create extension if not exists pgcrypto with schema extensions;/, "-- no pgcrypto in this build"));
}
ok("create-user.sql applies");

/* ---------------------------------------------------------------- the signup gate */
const OWNER = "11111111-1111-1111-1111-111111111111";
const CUSTOMER = "22222222-2222-2222-2222-222222222222";

await refused(
  "signup with no code is refused",
  `insert into auth.users(id, email, raw_user_meta_data) values ('${OWNER}', 'nobody@example.com', '{"display_name":"Nobody"}'::jsonb)`,
  "invitation code is required",
);

await refused(
  "signup with an unknown code is refused",
  `insert into auth.users(id, email, raw_user_meta_data) values ('${OWNER}', 'nobody@example.com', '{"invite_code":"NOTAREALCODE"}'::jsonb)`,
  "not recognised",
);

await db.exec(`insert into public.invite_codes(code, max_uses) values ('BURSA2026', 1)`);
// The code is typed the way a person would type it: lower case, with a dash.
await allowed(
  "a signup with a valid code creates the account",
  `insert into auth.users(id, email, raw_user_meta_data) values ('${OWNER}', 'owner@example.com', '{"display_name":"Owner","invite_code":"bursa-2026"}'::jsonb)`,
);
const ownerProfile = (
  await db.query(`select display_name, is_admin, status, invite_code from public.profiles where id = '${OWNER}'`)
).rows[0];
check("the code is stored normalised", ownerProfile?.invite_code === "BURSA2026", JSON.stringify(ownerProfile));
check("the profile keeps the display name", ownerProfile?.display_name === "Owner", JSON.stringify(ownerProfile));
// The first account on a fresh install is the admin, so a new deployment is never locked out.
check("the first account is promoted to admin", ownerProfile?.is_admin === true);

await refused(
  "a single-use code cannot be used twice",
  `insert into auth.users(id, email, raw_user_meta_data) values ('${CUSTOMER}', 'second@example.com', '{"invite_code":"BURSA2026"}'::jsonb)`,
  "already been used",
);

await db.exec(
  `insert into public.invite_codes(code, note, max_uses, expires_at) values ('COHORT', 'group', 3, current_date + 30)`,
);
await allowed(
  "a multi-use code admits the next account",
  `insert into auth.users(id, email, raw_user_meta_data) values ('${CUSTOMER}', 'second@example.com', '{"display_name":"Second","invite_code":"COHORT"}'::jsonb)`,
);
const customerProfile = (await db.query(`select is_admin, invite_code from public.profiles where id = '${CUSTOMER}'`)).rows[0];
check("only the first account is an admin", customerProfile?.is_admin === false, JSON.stringify(customerProfile));
check("usage is counted", (await db.query(`select used_count from public.invite_codes where code = 'COHORT'`)).rows[0]?.used_count === 1);

/* ---------------------------------------------------------------- the self-promotion hole */
// As the customer, through the API — the role and the claims a PostgREST request arrives with.
{
  await db.exec(`set role authenticated`);
  await db.exec(`select set_config('request.jwt.claims', '{"sub":"${CUSTOMER}"}', false)`);
  try {
    await db.exec(`update public.profiles set is_admin = true where id = '${CUSTOMER}'`);
    bad("a customer cannot make themselves an admin", "it was allowed");
  } catch {
    ok("a customer cannot make themselves an admin");
  }
  // The realistic version of the same request: extend my own access, or clear my own suspension.
  try {
    await db.exec(`update public.profiles set access_until = current_date + 3650 where id = '${CUSTOMER}'`);
    bad("a customer cannot extend their own access", "it was allowed");
  } catch {
    ok("a customer cannot extend their own access");
  }
  try {
    await db.exec(`update public.profiles set status = 'suspended' where id = '${CUSTOMER}'`);
    bad("a customer cannot change their own status", "it was allowed");
  } catch {
    ok("a customer cannot change their own status");
  }
  // The important half: ordinary writes still work, or the settings page stops saving your name.
  try {
    await db.exec(`update public.profiles set display_name = 'Renamed' where id = '${CUSTOMER}'`);
    ok("a customer can rename themselves");
  } catch (e) {
    bad("a customer can rename themselves", String(e.message ?? e));
  }
  // Exactly what the settings page sends: an upsert that lists every payload column.
  try {
    await db.exec(
      `insert into public.profiles(id, display_name) values ('${CUSTOMER}', 'Renamed') on conflict (id) do update set id = excluded.id, display_name = excluded.display_name`,
    );
    ok("the settings upsert still works");
  } catch (e) {
    bad("the settings upsert still works", String(e.message ?? e));
  }
  // And the flag is still out of reach through that same path.
  try {
    await db.exec(
      `insert into public.profiles(id, display_name, is_admin) values ('${CUSTOMER}', 'Renamed', true) on conflict (id) do update set is_admin = excluded.is_admin`,
    );
    bad("an upsert cannot promote either", "it was allowed");
  } catch {
    ok("an upsert cannot promote either");
  }
  await db.exec(`reset role`);
}

/* ---------------------------------------------------------------- the admin functions */
{
  await db.exec(`set role authenticated`);
  await db.exec(`select set_config('request.jwt.claims', '{"sub":"${CUSTOMER}"}', false)`);
  await refused("a customer cannot read the admin overview", `select public.admin_overview()`, "Only an administrator");
  await refused("a customer cannot change access", `select public.admin_set_user('${OWNER}', 'suspended')`, "Only an administrator");
  await refused("a customer cannot mint codes", `select public.admin_create_invite('FREEBIE')`, "Only an administrator");
  const me = (await db.query(`select public.me() as me`)).rows[0]?.me;
  check("me() describes the caller", me?.is_admin === false && me?.status === "active", JSON.stringify(me));
  check("a customer sees no codes", (await db.query(`select count(*)::int as n from public.invite_codes`)).rows[0]?.n === 0);
  await db.exec(`reset role`);
}

{
  await db.exec(`select set_config('request.jwt.claims', '{"sub":"${OWNER}"}', false)`);
  await db.exec(`set role authenticated`);
  const overview = (await db.query(`select public.admin_overview() as o`)).rows[0]?.o;
  check("the admin sees both accounts", overview?.users?.length === 2, JSON.stringify(overview?.stats));
  check("the overview counts trades", overview?.stats?.trades === 0);
  check("the overview counts available codes", overview?.stats?.codes_available === 1, JSON.stringify(overview?.stats));
  check(
    "the overview carries no trade rows",
    JSON.stringify(overview?.users?.[0] ?? {}).includes("gross_pnl") === false,
    "a P&L field appeared",
  );
  await refused("an admin cannot suspend themselves", `select public.admin_set_user('${OWNER}', 'suspended')`, "your own access");
  const created = (await db.query(`select public.admin_create_invite('kursus-2026', 'group', 3, null) as r`)).rows[0]?.r;
  check("a typed code is normalised on creation", created?.code === "KURSUS2026", JSON.stringify(created));
  const clash = (await db.query(`select public.admin_create_invite('KURSUS-2026', null, 3, null) as r`)).rows[0]?.r;
  check("a duplicate code is reported, not ignored", clash?.ok === false, JSON.stringify(clash));
  if (pgcrypto) {
    const generated = (await db.query(`select public.admin_create_invite(null, null, 1, null) as r`)).rows[0]?.r;
    check("an empty code generates one", typeof generated?.code === "string" && generated.code.length === 10, JSON.stringify(generated));
  }
  // Read back as the owner: RLS hides another account's row from an admin too, which is the point —
  // managing someone's access does not come with the right to read their journal.
  const ownerQuery = async (sql) => {
    await db.exec(`reset role`);
    try {
      return await db.query(sql);
    } finally {
      await db.exec(`set role authenticated`);
    }
  };
  await allowed("an admin can suspend an account", `select public.admin_set_user('${CUSTOMER}', 'suspended', null, 'chargeback')`);
  const suspended = (await ownerQuery(`select status, note from public.profiles where id = '${CUSTOMER}'`)).rows[0];
  check("the suspension landed", suspended?.status === "suspended" && suspended?.note === "chargeback", JSON.stringify(suspended));
  await allowed("an admin can set an end date", `select public.admin_set_user('${CUSTOMER}', 'active', current_date + 90, null)`);
  const dated = (await ownerQuery(`select status, access_until, note from public.profiles where id = '${CUSTOMER}'`)).rows[0];
  // The dialog replaces all three fields, so a null note has to clear it rather than be ignored.
  check("the note cleared with the null", dated?.note === null && dated?.status === "active", JSON.stringify(dated));
  check("the end date landed", Boolean(dated?.access_until), JSON.stringify(dated));
  await allowed("an admin can switch a code off", `select public.admin_set_invite('kursus2026', true)`);
}

/* ---------------------------------------------------------------- checking a code without a session */
{
  await db.exec(`select set_config('request.jwt.claims', '', false)`);
  await db.exec(`set role anon`);
  const good = (await db.query(`select public.check_invite('cohort') as r`)).rows[0]?.r;
  check("an anonymous visitor can check a code", good?.ok === true, JSON.stringify(good));
  const off = (await db.query(`select public.check_invite('kursus 2026') as r`)).rows[0]?.r;
  check("a switched-off code is refused", off?.ok === false && String(off?.reason).includes("switched off"), JSON.stringify(off));
  const unknown = (await db.query(`select public.check_invite('nope') as r`)).rows[0]?.r;
  check("an unknown code is refused", unknown?.ok === false, JSON.stringify(unknown));
  // Refused at the *table*, not by a policy: `admin.sql` revokes `invite_codes` from anon outright, so
  // the request stops before the policy that calls `is_admin()` is reached. The two refusals are
  // different on purpose — this one is an error, and the journal tables below are not.
  await refused(
    "an anonymous visitor cannot list codes",
    `select count(*) from public.invite_codes`,
    "permission denied for table",
  );
  // `is_active()` answers *true* for a visitor, and that is correct rather than a hole: with no session
  // there is no profile row, and "no profile row" means allowed — the same rule that keeps a database
  // without `admin.sql` from emptying every journal on it. Pinned here so the fail-open rule is a fact
  // rather than an assumption. (The read it guards is checked further down, where there are rows to
  // see: on an empty table no row is ever evaluated and the check would prove nothing.)
  check(
    "is_active() fails open for a visitor",
    (await db.query(`select public.is_active() as a`)).rows[0]?.a === true,
  );

  await refused("an anonymous visitor cannot call the admin read", `select public.admin_overview()`, "permission denied");
  await refused("me() is not callable by a visitor", `select public.me()`, "permission denied");
  await db.exec(`reset role`);
}

/* ---------------------------------------------------------------- an expired code */
await db.exec(`update public.invite_codes set expires_at = current_date - 1 where code = 'COHORT'`);
await refused(
  "an expired code is refused at signup",
  `insert into auth.users(id, email, raw_user_meta_data) values ('33333333-3333-3333-3333-333333333333', 'late@example.com', '{"invite_code":"COHORT"}'::jsonb)`,
  "no longer valid",
);

/* ---------------------------------------------------------------- access state, enforced by SQL */
//
// Before `access.sql`, a suspended account was refused by the app and welcomed by the API: the auth
// server mints a fresh token for any valid password, and every policy asked only whether the row was
// yours. So there are two halves to check, and the second one matters more — that a blocked account
// is refused by Postgres, and that an ordinary account can still do ordinary things. A mistake in
// that clause would not be a hole; it would be everybody's journal going empty.
{
  const TRADE = "bbbbbbbb-0000-0000-0000-000000000001";
  const ACCOUNT = "aaaaaaaa-0000-0000-0000-000000000001";
  const TAG = "cccccccc-0000-0000-0000-000000000001";
  const PICTURE = `${CUSTOMER}/probe.png`;

  // Every table that carries a per-user policy. The point of listing them is that a row is seeded into
  // each one while the account is active and the same list is read back while it is blocked: a table
  // somebody forgot to rewrite would otherwise pass the block test by being empty either way.
  const TABLES = [
    "trading_accounts",
    "strategies",
    "trades",
    "tags",
    "trade_tags",
    "trade_screenshots",
    "daily_reviews",
    "weekly_reviews",
    "zakat_years",
    "zakat_payments",
    "account_cash_flows",
    "profiles",
  ];
  const visible = async () => {
    const counts = [];
    for (const t of TABLES) counts.push(await countOf(t));
    return counts;
  };

  const rows = async (sql) => (await db.query(sql)).rows;
  const countOf = async (table) => Number((await rows(`select count(*)::int as n from public.${table}`))[0]?.n ?? -1);
  const countIn = async (table) => Number((await rows(`select count(*)::int as n from ${table}`))[0]?.n ?? -1);

  /** Sign in as an account the way a PostgREST request arrives: the role, plus the claims. */
  const signInAs = async (id) => {
    await db.exec(`reset role`);
    await db.exec(`set role authenticated`);
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${id}"}', false)`);
  };
  /** Change an account's access the way the admin page does — or the way only the SQL editor can. */
  const setAccess = async (id, status, until) => {
    await db.exec(`reset role`);
    await db.exec(
      `update public.profiles set status = '${status}', access_until = ${until ?? "null"} where id = '${id}'`,
    );
  };

  const logTrade = (id) =>
    `insert into public.trades(id, user_id, account_id, symbol, direction, entry_at, gross_pnl)` +
    ` values ('${id}', '${CUSTOMER}', '${ACCOUNT}', 'MAYBANK', 'long', now(), 100)`;

  /* --- the ordinary path, with the clause in place ---------------------------------------------- */
  // This is the half that catches a lockout: if the access check is wrong, everything below fails.
  await signInAs(CUSTOMER);
  // And the visitor's half, before the rows exist — pinned again after seeding, below.
  await db.exec(`set role anon`);
  await db.exec(`select set_config('request.jwt.claims', '', false)`);
  check("a visitor sees nothing on an empty journal", (await countOf("trades")) === 0);
  await db.exec(`reset role`);
  await signInAs(CUSTOMER);
  await allowed("an active account can save an account row", `insert into public.trading_accounts(id, user_id, name) values ('${ACCOUNT}', '${CUSTOMER}', 'M+ Global')`);
  await allowed("an active account can log a trade", logTrade(TRADE));
  await allowed("an active account can save a tag", `insert into public.tags(id, user_id, name) values ('${TAG}', '${CUSTOMER}', 'breakout')`);
  await allowed("an active account can link the two", `insert into public.trade_tags(trade_id, tag_id) values ('${TRADE}', '${TAG}')`);
  await allowed("an active account can attach a screenshot row", `insert into public.trade_screenshots(trade_id, user_id, storage_path) values ('${TRADE}', '${CUSTOMER}', '${PICTURE}')`);
  await allowed("an active account can save a strategy", `insert into public.strategies(user_id, name) values ('${CUSTOMER}', 'breakout')`);
  await allowed("an active account can save a review", `insert into public.daily_reviews(user_id, review_date) values ('${CUSTOMER}', current_date)`);
  await allowed("an active account can save a weekly review", `insert into public.weekly_reviews(user_id, week_start) values ('${CUSTOMER}', current_date)`);
  await allowed("an active account can record a zakat year", `insert into public.zakat_years(user_id, year) values ('${CUSTOMER}', 2026)`);
  await allowed("an active account can record a payment", `insert into public.zakat_payments(user_id, year, amount) values ('${CUSTOMER}', 2026, 500)`);
  await allowed("an active account can record a deposit", `insert into public.account_cash_flows(user_id, account_id, kind, amount) values ('${CUSTOMER}', '${ACCOUNT}', 'deposit', 1000)`);
  await allowed("an active account can upload into its own folder", `insert into storage.objects(id, bucket_id, name) values (gen_random_uuid(), 'trade-screenshots', '${PICTURE}')`);
  await allowed("an active account can edit its trade", `update public.trades set symbol = 'MAYBANK' where id = '${TRADE}'`);
  {
    const counts = await visible();
    check(
      "an active account sees its own row in all 12 tables",
      counts.every((n) => n >= 1),
      TABLES.map((t, i) => `${t}=${counts[i]}`).join(" "),
    );
    check("and exactly one trade", (await countOf("trades")) === 1);
  }
  // Now there are rows, so a visitor's read is a real test: with the grant in place the policy runs and
  // refuses them, and the answer is an empty list rather than an error.
  await db.exec(`set role anon`);
  await db.exec(`select set_config('request.jwt.claims', '', false)`);
  check("a visitor reads nothing once there is something to read", (await countOf("trades")) === 0);
  await db.exec(`reset role`);
  await signInAs(CUSTOMER);
  // The policy still keeps the tenant isolation it had before the access clause — the user_id half
  // is not decoration, and a scalar sub-select in the qual must not have swallowed it.
  await refused(
    "a customer still cannot log a trade for someone else",
    `insert into public.trades(user_id, symbol, direction, entry_at) values ('${OWNER}', 'FAKE', 'long', now())`,
    "row-level security",
  );
  check("that row was not created", (await countOf("trades")) === 1);
  // A policy hides rows rather than refusing the request, so a cross-tenant read is answered by the
  // count: no error, no rows. If the user_id half had been lost to the scalar sub-select, this is
  // the check that would notice.
  check(
    "a customer still cannot see another account's profile",
    (await rows(`select * from public.profiles where id = '${OWNER}'`)).length === 0,
  );
  await db.exec(`reset role`);

  // The claim the parentheses in `access.sql` are there for: evaluated once per query, not per row.
  {
    await signInAs(CUSTOMER);
    const plan = (await rows(`explain select count(*) from public.trades`)).map((r) => Object.values(r)[0]).join("\n");
    check("the access clause is an InitPlan, so it is evaluated once", plan.includes("InitPlan"), plan.split("\n")[0]);
    await db.exec(`reset role`);
  }

  /* --- suspended -------------------------------------------------------------------------------- */
  await setAccess(CUSTOMER, "suspended", null);
  await signInAs(CUSTOMER);
  {
    const counts = await visible();
    check(
      "a suspended account reads nothing in any of the 12 tables",
      counts.every((n) => n === 0),
      TABLES.map((t, i) => `${t}=${counts[i]}`).join(" "),
    );
  }
  // The grants in `access.sql` are load-bearing, and this is the check that proves it: the policy runs
  // as the caller, so without EXECUTE the read dies with a permission error instead of hiding the row.
  // It only errors because the rows above exist — on an empty table no row is evaluated and the same
  // missing grant looks harmless, which is the trap this check exists to document.
  await db.exec(`reset role`);
  await db.exec(`revoke execute on function public.is_active() from authenticated`);
  await signInAs(CUSTOMER);
  await refused(
    "without the grant a suspended read errors instead of hiding the row",
    `select count(*) from public.trades`,
    "permission denied for function is_active",
  );
  await db.exec(`reset role`);
  await db.exec(`grant execute on function public.is_active() to authenticated`);
  await signInAs(CUSTOMER);
  check("…and with it back the account is hidden again, not errored", (await countOf("trades")) === 0);
  await refused("a suspended account cannot log a trade", logTrade("bbbbbbbb-0000-0000-0000-0000000000fe"), "row-level security");
  await refused("a suspended account cannot save a tag", `insert into public.tags(user_id, name) values ('${CUSTOMER}', 'sneaky')`, "row-level security");
  await refused("a suspended account cannot record a payment", `insert into public.zakat_payments(user_id, year, amount) values ('${CUSTOMER}', 2026, 1)`, "row-level security");
  await refused("a suspended account cannot record a deposit", `insert into public.account_cash_flows(user_id, account_id, kind, amount) values ('${CUSTOMER}', '${ACCOUNT}', 'deposit', 1)`, "row-level security");
  await refused("a suspended account cannot upload a screenshot", `insert into storage.objects(id, bucket_id, name) values (gen_random_uuid(), 'trade-screenshots', '${CUSTOMER}/after.png')`, "row-level security");
  check("a suspended account cannot read its screenshots back", (await countIn("storage.objects")) === 0);
  check("a suspended account cannot rename itself", (await rows(`update public.profiles set display_name = 'Nope' where id = '${CUSTOMER}' returning 1 as n`)).length === 0);
  check("a suspended account cannot edit its trade", (await rows(`update public.trades set gross_pnl = 999 where id = '${TRADE}' returning 1 as n`)).length === 0);
  check("a suspended account cannot delete its trade", (await rows(`delete from public.trades where id = '${TRADE}' returning 1 as n`)).length === 0);
  // The blocked screen is built from this call, so it has to keep answering — otherwise a suspended
  // customer can be told nothing at all about why their journal is gone.
  const suspendedMe = (await rows(`select public.me() as me`))[0]?.me;
  check("me() still explains a suspended account", suspendedMe?.status === "suspended", JSON.stringify(suspendedMe));
  await db.exec(`reset role`);
  // As the owner rather than the role: RLS is bypassed for the table owner, which is what makes this
  // a real check that the row is still there — and `is_admin()` reads the claims, so the admin
  // functions below need the admin's claims rather than whichever role happens to be active.
  check("the trade survived the refused delete", (await countOf("trades")) === 1);
  await signInAs(OWNER);
  check("a customer's suspension leaves the admin's own access alone", (await rows(`select public.admin_overview() as o`))[0]?.o?.stats?.users === 2);
  await db.exec(`reset role`);

  /* --- expired, and the last day of it ---------------------------------------------------------- */
  await setAccess(CUSTOMER, "active", "current_date - 1");
  await signInAs(CUSTOMER);
  {
    const counts = await visible();
    check(
      "an expired account reads nothing either",
      counts.every((n) => n === 0),
      TABLES.map((t, i) => `${t}=${counts[i]}`).join(" "),
    );
  }
  await refused("an expired account cannot log a trade", logTrade("bbbbbbbb-0000-0000-0000-0000000000fd"), "row-level security");
  await db.exec(`reset role`);
  // The day itself still counts, which is what the admin page's "ends today" means.
  await setAccess(CUSTOMER, "active", "current_date");
  await signInAs(CUSTOMER);
  check("the last day of access still works", (await countOf("trades")) === 1);
  check("…and the whole journal came back with it", (await visible()).every((n) => n >= 1));
  await db.exec(`reset role`);

  /* --- an admin outranks its own status --------------------------------------------------------- */
  await setAccess(OWNER, "suspended", null);
  await signInAs(OWNER);
  check("a suspended admin can still read the admin page", (await rows(`select public.admin_overview() as o`))[0]?.o?.stats?.users === 2);
  await allowed("a suspended admin can still write to its own journal", `insert into public.tags(user_id, name) values ('${OWNER}', 'owner tag')`);
  check("a suspended admin sees its own rows", (await countOf("tags")) === 1);
  await db.exec(`reset role`);
  await setAccess(OWNER, "active", null);

  /* --- no profile row is not a locked journal -------------------------------------------------- */
  await db.exec(`delete from public.profiles where id = '${CUSTOMER}'`);
  await signInAs(CUSTOMER);
  check("a missing profile row does not empty a working journal", (await countOf("trades")) === 1);
  await db.exec(`reset role`);
  await db.exec(`insert into public.profiles(id, display_name) values ('${CUSTOMER}', 'Second')`);

  /* --- and a visitor with no session at all ----------------------------------------------------- */
  await db.exec(`set role anon`);
  await db.exec(`select set_config('request.jwt.claims', '', false)`);
  check("a visitor gets an empty journal rather than an error", (await countOf("trades")) === 0);
  await refused("a visitor cannot log a trade", `insert into public.trades(user_id, symbol, direction, entry_at) values ('${CUSTOMER}', 'X', 'long', now())`, "row-level security");
  await db.exec(`reset role`);
}

/* ---------------------------------------------------------------- accounts an administrator creates */
//
// The signup gate is invite-only, and the administrator needs a way past it for accounts nobody is
// confirming an email for: a test or demo login, or a customer being onboarded by hand. Two things
// have to hold at once, and they pull in opposite directions — the exemption has to work for the
// admin, and it must not become a way for anybody else to skip the invitation.
{
  const signInAs = async (id) => {
    await db.exec(`reset role`);
    await db.exec(`set role authenticated`);
    await db.exec(`select set_config('request.jwt.claims', '{"sub":"${id}"}', false)`);
  };
  const signOut = async () => {
    await db.exec(`reset role`);
    await db.exec(`select set_config('request.jwt.claims', '', false)`);
  };
  const asAdmin = () => signInAs(OWNER);
  const asCustomer = () => signInAs(CUSTOMER);
  /**
   * Read a row as the database owner, not as the signed-in role: the assertions are about what the
   * function actually wrote, and the `auth` schema is not the API's to read at all. The role is reset
   * first, so a caller has to say which role it wants before the next request.
   */
  const raw = async (sql) => {
    await db.exec(`reset role`);
    return (await db.query(sql)).rows;
  };
  const rpc = async (sql) => (await db.query(sql)).rows;

  // The columns that are NULLable with no default, now that the signup-gate checks are done with the
  // stub: from here an insert that does not name them leaves them NULL, as the real schema would. The
  // two NOT NULL ones lose their defaults so that an insert omitting them fails outright; `created_at`
  // keeps its default until here because the signup-gate inserts above only name three columns.
  await db.exec(`
    update auth.users set is_sso_user = false, email_change = '';
    alter table auth.users alter column is_sso_user drop default;
    alter table auth.users alter column email_change drop default;
    alter table auth.users alter column is_sso_user set not null;
    alter table auth.users alter column email_change set not null;
    alter table auth.users alter column created_at drop default;
    alter table auth.users alter column created_at drop not null;
    -- Rows left without an audience, the state the first version of the file produced.
    update auth.users set aud = null, "role" = null;
  `);

  const codesBefore = Number((await raw(`select coalesce(sum(used_count), 0)::int as n from public.invite_codes`))[0]?.n ?? -1);

  // GoTrue's password grant looks a user up with exactly this predicate — `FindUserByEmailAndAudience`
  // in GoTrue's `internal/models/user.go` — so it is written out verbatim rather than approximated.
  // The columns it names are the columns a hand-written insert has to get right, and three of them
  // (`instance_id`, `aud`, `is_sso_user`) are precisely the ones a naive insert never mentions.
  const signInLookup = (email) =>
    `select id from auth.users where instance_id = '00000000-0000-0000-0000-000000000000'` +
    ` and lower(email) = '${email}' and aud = 'authenticated' and is_sso_user = false`;

  await asAdmin();
  const created = (await rpc(`select public.admin_create_user('Demo@Example.com', 'abcd1234', 'Demo', '2026-12-31', 'testing') as r`))[0]?.r;
  check("an administrator can create an account", created?.ok === true, JSON.stringify(created));

  const row = (await raw(`select id, email, email_confirmed_at, encrypted_password, raw_app_meta_data, aud, "role", instance_id, is_sso_user, email_change from auth.users where email = 'demo@example.com'`))[0];
  check("the address is stored the way sign-in looks it up", row?.email === "demo@example.com", JSON.stringify(row?.email));
  // This is the line that removes the email round trip: a set confirmation date is what lets GoTrue
  // mint a session without one.
  check("the account is already confirmed", Boolean(row?.email_confirmed_at), JSON.stringify(row?.email_confirmed_at));
  check("the password was hashed, not stored", String(row?.encrypted_password ?? "").length > 10 && row?.encrypted_password !== "abcd1234", JSON.stringify(String(row?.encrypted_password).slice(0, 12)));
  check("the provider metadata is set", row?.raw_app_meta_data?.providers?.[0] === "email", JSON.stringify(row?.raw_app_meta_data));
  // The audience GoTrue looks an account up by. Without it the password is right and the sign-in is
  // still refused, which is exactly what a first version of this file shipped.
  check(
    "the account carries the audience sign-in looks it up by",
    row?.aud === "authenticated" && row?.role === "authenticated",
    JSON.stringify({ aud: row?.aud, role: row?.role }),
  );
  // "The column is set" and "the lookup finds it" are only the same thing as long as this stays true.
  const lookedUp = (await raw(signInLookup("demo@example.com")))[0];
  check("and the lookup a password grant runs finds it", lookedUp?.id === row?.id, JSON.stringify(lookedUp));

  // The other half of the same bug, one step later in the request: GoTrue reads these into a time.Time
  // and plain strings, so a NULL does not hide the account — it makes reading it fail, and the grant
  // answers "500 Database error querying schema" on a row that is otherwise perfect. Checked one column
  // at a time, because "the row has no NULL somewhere" would not say which one is missing.
  const canonical = (await raw(`select created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_current, email_change_token_new, phone_change, phone_change_token, reauthentication_token from auth.users where email = 'demo@example.com'`))[0];
  const nullCanonical = Object.entries(canonical ?? {}).filter(([, v]) => v === null).map(([k]) => k);
  check(
    "the columns GoTrue reads the row back into are all filled",
    nullCanonical.length === 0,
    `NULL in: ${nullCanonical.join(', ')}`,
  );

  // The row the first version of the file left behind: created, confirmed, password hashed — and
  // invisible to sign-in, because the columns GoTrue fills in code were never filled. This is the bug
  // that shipped, reproduced, so the repair below is measured against the real failure rather than
  // against a description of it. All three lookup columns and the columns the row is read back through
  // are nulled, because all of them were missing from that version's insert.
  await raw(`update auth.users set aud = null, "role" = null, instance_id = null, created_at = null, updated_at = null, confirmation_token = null, recovery_token = null, email_change_token_new = null where email = 'demo@example.com'`);
  const invisible = (await raw(signInLookup("demo@example.com"))).length;
  check("an account created by the first version is invisible to sign-in", invisible === 0, `${invisible} rows found by the lookup`);
  const stranded = (await raw(`select created_at, confirmation_token, email_change_token_new from auth.users where email = 'demo@example.com'`))[0];
  check(
    "and the columns GoTrue reads it back through were left NULL too",
    stranded?.created_at === null && stranded?.confirmation_token === null && stranded?.email_change_token_new === null,
    JSON.stringify(stranded),
  );
  // Columns the insert never names: one required with no default, one optional that must not be left
  // NULL. Both come from the catalogue rather than from a list somebody guessed.
  check(
    "required columns the insert did not name were filled",
    row?.is_sso_user === false && row?.email_change === "" && row?.instance_id === "00000000-0000-0000-0000-000000000000",
    JSON.stringify({ is_sso_user: row?.is_sso_user, email_change: row?.email_change, instance_id: row?.instance_id }),
  );


  // GoTrue signs a password grant in against an identity row, not just the user row: without this the
  // account exists, the password is right, and every sign-in is refused as invalid credentials.
  const identity = (await raw(`select provider, identity_data from auth.identities where user_id = '${row?.id}'`))[0];
  check("an identity row is created for the password grant", identity?.provider === "email", JSON.stringify(identity?.provider));
  check("its subject is the user id", identity?.identity_data?.sub === row?.id, JSON.stringify(identity?.identity_data));

  const profile = (await raw(`select display_name, status, access_until, invite_code, is_admin from public.profiles where id = '${row?.id}'`))[0];
  check("the profile carries the name", profile?.display_name === "Demo", JSON.stringify(profile?.display_name));
  // A date column comes back from PGlite as a Date, so it is compared by its day rather than by type.
  check("the end date was set at creation", new Date(profile?.access_until).toISOString().slice(0, 10) === "2026-12-31", JSON.stringify(profile?.access_until));
  check("the account starts active", profile?.status === "active");
  check("it is not an administrator itself", profile?.is_admin === false);
  // No invitation code was needed, so none may be spent: the count is the assertion that the exemption
  // did not quietly consume somebody's seat.
  check(
    "no invitation code was consumed",
    Number((await raw(`select coalesce(sum(used_count), 0)::int as n from public.invite_codes`))[0]?.n ?? -1) === codesBefore,
  );

  // Refusals a person causes come back as a sentence the dialog can show, not as a database error.
  await asAdmin();
  const duplicate = (await rpc(`select public.admin_create_user('demo@example.com', 'abcd1234') as r`))[0]?.r;
  check("a duplicate address is refused with a reason", duplicate?.ok === false && /already has an account/.test(duplicate?.reason ?? ""), JSON.stringify(duplicate));
  const weak = (await rpc(`select public.admin_create_user('weak@example.com', 'short') as r`))[0]?.r;
  check("a short password is refused with a reason", weak?.ok === false && /at least 8/.test(weak?.reason ?? ""), JSON.stringify(weak));
  const junk = (await rpc(`select public.admin_create_user('not an address', 'abcd1234') as r`))[0]?.r;
  check("a malformed address is refused", junk?.ok === false, JSON.stringify(junk));
  check(
    "a refused call created nothing",
    Number((await raw(`select count(*)::int as n from auth.users where email in ('weak@example.com', 'not an address')`))[0]?.n) === 0,
  );

  // The repair statement the file ships, run against that row.
  const repair = readFileSync("supabase/create-user.sql", "utf8").match(/update auth\.users[\s\S]*?or reauthentication_token is null;/i)?.[0];
  check("the file carries the repair", Boolean(repair), "no repair statement found");
  await db.exec(repair);
  const repaired = (await raw(`select aud, "role", instance_id, created_at, confirmation_token, email_change_token_new from auth.users where email = 'demo@example.com'`))[0];
  check(
    "and the repair puts back every column sign-in looks through",
    repaired?.aud === "authenticated" &&
      repaired?.role === "authenticated" &&
      repaired?.instance_id === "00000000-0000-0000-0000-000000000000",
    JSON.stringify(repaired),
  );
  check(
    "and the columns the row is read back through",
    repaired?.created_at !== null &&
      repaired?.confirmation_token === "" &&
      repaired?.email_change_token_new === "",
    JSON.stringify({ created_at: repaired?.created_at, confirmation_token: repaired?.confirmation_token, email_change_token_new: repaired?.email_change_token_new }),
  );
  check(
    "so the repaired account is findable again",
    (await raw(signInLookup("demo@example.com")))[0]?.id === row?.id,
    JSON.stringify(await raw(signInLookup("demo@example.com"))),
  );

  // The file's own report, so the query an operator runs to ask "is anything still stranded?" is itself
  // tested: after the repair it must come back empty, and it only looks at accounts this file made.
  const strandedQuery = readFileSync("supabase/create-user.sql", "utf8").match(/select u\.email,[\s\S]*?or u\.reauthentication_token is null\);/i)?.[0];
  check("the file carries a stranded-account check", Boolean(strandedQuery), "no check found");
  const leftStranded = (await raw(strandedQuery)).length;
  check("and it finds nothing left to repair", leftStranded === 0, `${leftStranded} accounts still stranded`);

  /* --- the exemption cannot be borrowed -------------------------------------------------------- */
  await asCustomer();
  await refused("a customer cannot create accounts", `select public.admin_create_user('sneak@example.com', 'abcd1234')`, "Only an administrator");

  // `created_by_admin` is a value in the signup metadata, and any signup form — or anybody posting
  // straight at the auth API — can send it. So the gate is tested the way it really arrives: the auth
  // server performs the insert, carrying whatever claims the request had. Only the last one, with an
  // administrator behind it, is allowed through without a code.
  // Everything the auth server itself supplies is named here, so the only thing left that can refuse
  // the row is the trigger — which is what these three checks are about.
  const signupRow = (email, metadata) =>
    `insert into auth.users(id, email, raw_user_meta_data, aud, "role", instance_id, is_sso_user, email_change) values (gen_random_uuid(), '${email}', '${metadata}'::jsonb, 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', false, '')`;
  /** The auth server writes `auth.users`, and it does so with the caller's claims attached. */
  const asAuthServer = async (id) => {
    await db.exec(`reset role`);
    await db.exec(`select set_config('request.jwt.claims', ${id ? `'{"sub":"${id}"}'` : "''"}, false)`);
  };

  await asAuthServer(CUSTOMER);
  await refused(
    "a customer cannot claim to be the administrator in signup metadata",
    signupRow("sneaky@example.com", '{"created_by_admin":true}'),
    "invitation code is required",
  );
  await asAuthServer(null);
  await refused(
    "and neither can a server-side insert with no session",
    signupRow("server@example.com", '{"created_by_admin":true}'),
    "invitation code is required",
  );

  // The other half: with an administrator behind it, the flag is honoured and no code is touched.
  await asAuthServer(OWNER);
  await allowed(
    "an administrator's flag is honoured",
    signupRow("byadmin@example.com", '{"created_by_admin":true,"display_name":"By Admin"}'),
  );
  const byAdmin = (await raw(`select p.invite_code, p.display_name from public.profiles p join auth.users u on u.id = p.id where u.email = 'byadmin@example.com'`))[0];
  check("and its profile carries no invitation code", byAdmin?.invite_code === null, JSON.stringify(byAdmin));
  check("while the name still comes through", byAdmin?.display_name === "By Admin", JSON.stringify(byAdmin?.display_name));

  /* --- an older identities table --------------------------------------------------------------- */
  // `provider_id` was split out of the identity id in a later GoTrue. The function checks which shape
  // it is talking to, so both are exercised: this drops the column and puts the id back to text, the
  // way the older schema had it.
  await db.exec(`reset role`);
  await db.exec(`alter table auth.identities drop column provider_id`);
  await db.exec(`alter table auth.identities alter column id type text`);
  await asAdmin();
  const legacy = (await rpc(`select public.admin_create_user('legacy@example.com', 'abcd1234', 'Legacy') as r`))[0]?.r;
  check("an older identities table still works", legacy?.ok === true, JSON.stringify(legacy));
  const legacyIdentity = (await raw(`select i.id, i.identity_data from auth.identities i join auth.users u on u.id = i.user_id where u.email = 'legacy@example.com'`))[0];
  check("the legacy identity is keyed on the user id", legacyIdentity?.id === legacy?.id, JSON.stringify(legacyIdentity?.id));

  await signOut();
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nThe SQL does what it says");
process.exit(failures ? 1 : 0);
