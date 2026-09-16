/**
 * Who is allowed in, and which invitation codes still work.
 *
 * These are the rules the app turns on — the shell blocking a suspended account, the sign-up form
 * accepting a code, the admin page labelling a listing — kept in one file with no Supabase import so
 * they can be exercised directly (`npm run test:access`). A rule that decides whether someone can use
 * the journal should be checkable without a database and a browser.
 *
 * The database enforces the same rules again: `check_invite()` and `handle_new_user` in
 * `supabase/admin.sql` normalise a code identically, so what the form approves is what the trigger
 * accepts. The test script asserts the two normalisations still match.
 *
 * `accessState` is mirrored a third time, in SQL: `public.is_active()` in `supabase/access.sql` is the
 * same predicate, and it sits inside every RLS policy — so a suspended or expired account is refused
 * by Postgres as well as by this file. `scripts/sql-check.mjs` executes it, and the two have to keep
 * agreeing: what this file shows a customer is what the database will actually let them do.
 */

/** Letters and digits only, upper case. What the database stores, and what a typed code becomes. */
export function normalizeInviteCode(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * The alphabet a generated code is drawn from: letters and digits with the pairs that get misread
 * aloud removed (I/1, O/0). Thirty-two characters exactly, which is a divisor of 256 — so taking a
 * byte modulo the alphabet length is uniform and no character is favoured the way it would be with a
 * non-power-of-two alphabet.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A fresh code from caller-supplied bytes (`crypto.getRandomValues` in the page, fixed values in the
 * test). Eight characters is 40 bits — not a guessable namespace, and still short enough to read over
 * the phone.
 */
export function suggestInviteCode(bytes: ArrayLike<number>, length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[(bytes[i] ?? 0) % CODE_ALPHABET.length];
  return out;
}

/** "2026-05-31" → the same string; anything else (a full timestamp, junk, null) → null. */
export function isoDay(value: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

/** Days from `from` to `to`, both `YYYY-MM-DD`; negative when `to` has already passed. */
export function dayGap(from: string, to: string): number {
  const a = isoDay(from);
  const b = isoDay(to);
  if (!a || !b) return 0;
  const at = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const bt = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.round((bt - at) / 86_400_000);
}

/** How many days of access are left, or null when the account has no end date. */
export function daysLeft(accessUntil: string | null | undefined, today: string): number | null {
  const until = isoDay(accessUntil);
  return until ? dayGap(today, until) : null;
}

export type AccessAccount = {
  status?: string | null;
  access_until?: string | null;
  is_admin?: boolean | null;
};

export type AccessState = {
  /** False when the account must not see the journal. */
  ok: boolean;
  reason: "suspended" | "expired" | null;
  /** Short word for a badge: Active, Admin, Suspended, Expired. */
  label: string;
  /** A sentence for the blocked screen and the sign-in error. */
  detail: string;
};

/**
 * Is this account allowed in?
 *
 * A missing profile (the function not deployed, or a row that has not been created yet) is *allowed*:
 * failing closed would lock the owner out of their own journal the moment a migration lagged, and the
 * database is the place that actually refuses a suspended signup. `is_admin` wins outright — the
 * account that runs the install cannot lock itself out of the page that unlocks everyone else.
 *
 * An end date is inclusive: the day itself still works, and the account expires the next day.
 */
export function accessState(account: AccessAccount | null | undefined, today: string): AccessState {
  if (!account) return { ok: true, reason: null, label: "Active", detail: "" };
  if (account.is_admin) return { ok: true, reason: null, label: "Admin", detail: "" };
  if ((account.status ?? "active") === "suspended") {
    return {
      ok: false,
      reason: "suspended",
      label: "Suspended",
      detail: "This account has been suspended. Reply to the email you signed up with if that is a surprise.",
    };
  }
  const until = isoDay(account.access_until);
  if (until && dayGap(today, until) < 0) {
    return {
      ok: false,
      reason: "expired",
      label: "Expired",
      detail: `Access to this account ended on ${until}. Renewing it is a one-line change on our side.`,
    };
  }
  return { ok: true, reason: null, label: "Active", detail: "" };
}

/**
 * How many days before the end date a customer starts being told about it. Two weeks is long enough to
 * renew without hurrying and short enough that the notice still reads as news rather than decoration —
 * an account with a year of access should not wear a permanent warning band.
 */
export const EXPIRY_WARNING_DAYS = 14;

export type AccessNotice = {
  /**
   * `due-soon` is the one that earns a band in the shell. `scheduled` is for the settings page, and
   * `expired` is for the blocked screen — an expired account never sees the band, because the journal
   * is already closed to it.
   */
  key: "expired" | "due-soon" | "scheduled";
  /** The last day of access, `YYYY-MM-DD`. */
  until: string;
  /** Whole days from today to that day; negative once it has passed. */
  days: number;
  /** Short heading: "Your access ends in 5 days". */
  label: string;
  /** One sentence naming the date, for the line under the heading. */
  detail: string;
};

/**
 * What (if anything) to tell an account about its own end date.
 *
 * Separate from `accessState` on purpose: that answers "may this account in?" and is a full stop, while
 * this answers "how long have I got?" and is a nudge. An account can be perfectly allowed in and still
 * have three days left — which is exactly the customer who needs telling, and the one the blocked
 * screen cannot reach, because it only exists once access is already gone.
 *
 * Open-ended accounts and admins never get a notice: there is no date to count down, and an admin
 * locking themselves out is not something a banner should be warning about.
 *
 * The date is written by `formatDate`, which defaults to the raw `YYYY-MM-DD` so this file stays free
 * of imports and the tests can assert on a fixed string. The app passes the same `dateLabel()` the
 * rest of the pages use, because a sentence a customer reads should not contain "2026-09-30".
 */
export function expiryNotice(
  account: AccessAccount | null | undefined,
  today: string,
  { withinDays = EXPIRY_WARNING_DAYS, formatDate = (iso: string) => iso }: { withinDays?: number; formatDate?: (iso: string) => string } = {},
): AccessNotice | null {
  if (!account || account.is_admin) return null;
  const until = isoDay(account.access_until);
  if (!until) return null;
  const days = dayGap(today, until);
  const last = `After ${formatDate(until)} the journal stops opening until access is renewed.`;
  if (days < 0) {
    return {
      key: "expired",
      until,
      days,
      label: "Your access has ended",
      detail: `Access ended on ${formatDate(until)}. Renewing it is a one-line change on our side.`,
    };
  }
  if (days === 0) {
    return { key: "due-soon", until, days, label: "Your access ends today", detail: `Today is the last day. ${last}` };
  }
  if (days <= withinDays) {
    return {
      key: "due-soon",
      until,
      days,
      label: `Your access ends in ${days} day${days === 1 ? "" : "s"}`,
      detail: `${formatDate(until)} is the last day. ${last}`,
    };
  }
  return { key: "scheduled", until, days, label: `Access ends ${formatDate(until)}`, detail: `${days} days left.` };
}

/**
 * A password for an account somebody else is being handed: an onboarding, or a test login.
 *
 * Drawn from the same alphabet as an invitation code, and for the same reason — a password read off a
 * screen or passed on the phone should not contain `I`, `l`, `0` and `O`. Fourteen characters is 70
 * bits, which is not a password anybody is going to guess, and it is still short enough to type.
 *
 * It is offered as a starting point, not imposed: the administrator can type their own.
 */
export function suggestPassword(bytes: ArrayLike<number>, length = 14): string {
  return suggestInviteCode(bytes, length);
}

export type InviteTone = "ok" | "warn" | "danger";

export type InviteState = {
  key: "available" | "used" | "expired" | "disabled";
  label: string;
  tone: InviteTone;
};

export type InviteLike = {
  disabled?: boolean | null;
  expires_at?: string | null;
  used_count?: number | null;
  max_uses?: number | null;
};

/**
 * What a code is currently good for. The order matters: a switched-off code reads as switched off
 * even if it is also expired — that is the state an admin chose, and the one they would undo.
 */
export function inviteState(invite: InviteLike, today: string): InviteState {
  const used = Number(invite.used_count ?? 0);
  const max = Math.max(1, Number(invite.max_uses ?? 1));
  if (invite.disabled) return { key: "disabled", label: "Switched off", tone: "danger" };
  const until = isoDay(invite.expires_at);
  if (until && dayGap(today, until) < 0) return { key: "expired", label: "Expired", tone: "warn" };
  const count = max > 1 ? `${used}/${max}` : "";
  if (used >= max) return { key: "used", label: count ? `Used ${count}` : "Used", tone: "warn" };
  return { key: "available", label: count ? `Available ${count}` : "Available", tone: "ok" };
}
