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

console.log(failures ? `\n${failures} FAILURE(S)` : "\nThe SQL does what it says");
process.exit(failures ? 1 : 0);
