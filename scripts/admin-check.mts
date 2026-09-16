/**
 * Who is allowed in, and which invitation codes still work.
 *
 * The rules behind the sign-up gate and the admin page. They are worth testing because each of them
 * fails in the same quiet way: an off-by-one on an end date locks a paying customer out a day early,
 * a normaliser that keeps dashes rejects a code somebody typed from a screenshot, and a wrong reading
 * of `used_count` hands out a seat twice.
 *
 *   npm run test:access
 */
import { readFileSync } from "node:fs";
import {
  accessState,
  dayGap,
  daysLeft,
  inviteState,
  isoDay,
  normalizeInviteCode,
  suggestInviteCode,
} from "../lib/access.ts";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${actual} expected ${expected}`);
}

/* ---------------------------------------------------------------- code normalising */
// A code is stored upper-case, letters and digits only, so the same code typed four ways is one code.
check("a lowercase code", normalizeInviteCode("bursa2026"), "BURSA2026");
check("a code typed with dashes", normalizeInviteCode("BUR-2026"), "BUR2026");
check("a code typed with spaces", normalizeInviteCode("  bursa 2026 "), "BURSA2026");
check("an empty code", normalizeInviteCode("   "), "");
check("no code at all", normalizeInviteCode(null), "");
check("a code that is only punctuation", normalizeInviteCode("---"), "");

/* ---------------------------------------------------------------- generated codes */
// 32 characters of alphabet, so every byte maps to a distinct character with no modulo bias.
check("a generated code is 8 characters", suggestInviteCode([0, 1, 2, 3, 4, 5, 6, 7]).length, 8);
check("a letter from the middle of the alphabet", suggestInviteCode([23], 1), "Z");
check("the digits follow the letters", suggestInviteCode([27], 1), "5");
check("the first byte picks the first letter", suggestInviteCode([0], 1), "A");
check("the last byte picks the last character", suggestInviteCode([31], 1), "9");
// 32 characters is a divisor of 256, so the wrap is even rather than biased. 32 + 0 lands on "A"
// exactly as 0 does; with a 30-character alphabet the low characters would come up more often.
check("the alphabet wraps rather than overflowing", suggestInviteCode([32], 1), "A");
check("the alphabet really is 32 long", suggestInviteCode([0, 32, 64, 96, 128, 160, 192, 224], 8), "AAAAAAAA");
check("no ambiguous characters", /^[^IO01]+$/.test(suggestInviteCode([10, 14, 26, 30, 24, 8, 3, 19])), "true");
check("a shorter code when asked", suggestInviteCode([0, 0, 0, 0], 4), "AAAA");

/* ---------------------------------------------------------------- dates */
check("a plain day", isoDay("2026-05-31"), "2026-05-31");
check("a timestamp keeps its day", isoDay("2026-05-31T14:00:00Z"), "2026-05-31");
check("junk is not a day", isoDay("next tuesday"), "null");
check("a missing date", isoDay(null), "null");
check("a day later in the month", dayGap("2026-05-01", "2026-05-31"), 30);
check("a day earlier in the month", dayGap("2026-05-31", "2026-05-01"), -30);
check("across a year boundary", dayGap("2026-12-31", "2027-01-01"), 1);
check("across a leap day", dayGap("2028-02-28", "2028-03-01"), 2);
check("the same day", dayGap("2026-05-31", "2026-05-31"), 0);

/* ---------------------------------------------------------------- access */
const TODAY = "2026-09-16";
check("a fresh account is allowed in", accessState({ status: "active", access_until: null }, TODAY).ok, "true");
check("no profile is not a block", accessState(null, TODAY).ok, "true");
check("a missing profile is assumed active", accessState({}, TODAY).label, "Active");
// An end date is inclusive: the last day still works, the next morning does not.
check("access on its last day", accessState({ status: "active", access_until: TODAY }, TODAY).ok, "true");
check("access the day after it ends", accessState({ status: "active", access_until: "2026-09-15" }, TODAY).reason, "expired");
check("a suspension outranks a valid end date", accessState({ status: "suspended", access_until: "2027-01-01" }, TODAY).reason, "suspended");
// The account that runs the install cannot lock itself out of the page that unlocks everyone else.
check("an admin is never blocked", accessState({ status: "suspended", is_admin: true }, TODAY).ok, "true");
check("an admin reads as admin", accessState({ status: "active", is_admin: true }, TODAY).label, "Admin");
// A blocked screen has to say something; an empty reason would render a blank card.
check("a suspension explains itself", accessState({ status: "suspended" }, TODAY).detail.length > 20, "true");
check("an expiry names the date", accessState({ access_until: "2026-01-05" }, TODAY).detail.includes("2026-01-05"), "true");
check("days left on an open-ended account", daysLeft(null, TODAY), "null");
check("days left with a month to go", daysLeft("2026-10-16", TODAY), 30);
check("days left after the end", daysLeft("2026-09-01", TODAY), -15);

/* ---------------------------------------------------------------- invites */
const invite = (over: Partial<Parameters<typeof inviteState>[0]> = {}) => ({
  disabled: false,
  expires_at: null,
  used_count: 0,
  max_uses: 1,
  ...over,
});
check("a fresh single-use code", inviteState(invite(), TODAY).label, "Available");
check("a used single-use code", inviteState(invite({ used_count: 1 }), TODAY).key, "used");
check("a multi-use code keeps counting", inviteState(invite({ used_count: 2, max_uses: 5 }), TODAY).label, "Available 2/5");
check("a full multi-use code", inviteState(invite({ used_count: 5, max_uses: 5 }), TODAY).label, "Used 5/5");
check("a code switched off", inviteState(invite({ disabled: true }), TODAY).key, "disabled");
check("a code past its date", inviteState(invite({ expires_at: "2026-09-15" }), TODAY).key, "expired");
check("a code on its last day", inviteState(invite({ expires_at: TODAY }), TODAY).key, "available");
// Switched off wins: that is the state an admin chose, and the one they would undo.
check("off outranks expired", inviteState(invite({ disabled: true, expires_at: "2026-01-01" }), TODAY).key, "disabled");
check("used outranks a future date", inviteState(invite({ used_count: 1, expires_at: "2027-01-01" }), TODAY).key, "used");

/* ---------------------------------------------------------------- the SQL agrees */
// The form normalises a code and the database normalises it again; if the two rules drift, a code the
// form accepts is refused by the trigger — the worst kind of failure, because it happens at signup.
const sql = readFileSync(new URL("../supabase/admin.sql", import.meta.url), "utf8");
check("the database strips the same characters", sql.includes("'[^A-Za-z0-9]', '', 'g'"), "true");
check("the database upper-cases too", (sql.match(/upper\(regexp_replace/g) ?? []).length >= 4, "true");
// The gate has to be in the trigger, not only in the form: a form can be edited by anyone.
check("signup is gated in the trigger", sql.includes("An invitation code is required to create an account"), "true");
// Every admin entry point checks who is calling it.
check("admin reads check the caller", sql.includes("if not public.is_admin() then\n    raise exception 'Only an administrator can read the admin overview.'"), "true");
check("admin writes check the caller", (sql.match(/if not public\.is_admin\(\) then/g) ?? []).length >= 4, "true");
// Without these the whole admin design is decoration: any user could set is_admin on their own row.
// The guard is checked from its own text, because the two ways it can be disarmed are both silent.
const guard = sql.slice(
  sql.indexOf("create or replace function public.guard_profile_columns()"),
  sql.indexOf("drop trigger if exists profiles_guard_columns"),
);
check("the guard runs before both writes", sql.includes("before insert or update on public.profiles"), "true");
// A security definer guard would see the owner as `current_user` and return early for everyone.
check("the guard sees the real caller", guard.includes("security definer"), "false");
// The roles our own code runs as are exempt — that exemption is what lets signup stamp a new account.
check("our own roles are exempt", guard.includes("'postgres', 'supabase_admin', 'supabase_auth_admin', 'service_role'"), "true");
check("an admin is exempt", guard.includes("if public.is_admin() then"), "true");
// Every column the admin page can move has to be in the list, or it is a way back in.
for (const column of ["is_admin", "status", "access_until", "note", "invite_code"]) {
  check(`the guard protects ${column}`, guard.includes(`new.${column}`) || guard.includes(`new.${column} `), "true");
}
// An admin suspending themselves would leave nobody who can undo it.
check("an admin cannot suspend themselves", sql.includes("You cannot change your own access here."), "true");
// The sign-up form has to be able to ask about a code before an account exists.
check("checking a code needs no session", sql.includes("grant execute on function public.check_invite(text) to anon, authenticated"), "true");
check("admin functions are not callable by anonymous visitors", sql.includes("from public, anon"), "true");

console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll access checks passed");
process.exit(failures ? 1 : 0);
