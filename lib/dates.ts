/**
 * The date fields in the journal carry plain strings, not `Date` objects, because that is what both
 * the form state and Supabase want: `"YYYY-MM-DD"` for a date and `"YYYY-MM-DDTHH:mm"` for a
 * date-time (the same shape `datetime-local` produced before the pickers replaced it).
 *
 * Everything here is deliberately local-time. `new Date("2026-09-16")` parses as UTC midnight, which
 * shows up as the 15th in a +08 timezone, and `toISOString()` would write the same off-by-one back —
 * so the pickers only ever build or read dates from the numeric parts.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-09-16" → a local-midnight Date, or undefined when the string is absent or malformed. */
export function parseISODate(value?: string | null): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return undefined;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/** A Date → "2026-09-16", read from its local parts rather than its UTC ones. */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The trigger's label for a date field: "16 Sept 2026" — short enough for a narrow field. */
export function dateLabel(value?: string | null): string {
  const d = parseISODate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" });
}

/** Splits a date-time string into the two parts the picker edits separately. */
export function splitDateTime(value?: string | null): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(value ?? "");
  return { date: m?.[1] ?? "", time: m?.[2] ?? "09:00" };
}

/** Rebuilds the date-time string from the picker's two halves; empty when there is no date yet. */
export function joinDateTime(date: string, time: string): string {
  return date ? `${date}T${time || "09:00"}` : "";
}

/** The trigger's label for a date-time field: "16 Sept 2026, 10:13 am". */
export function dateTimeLabel(value?: string | null): string {
  const { date, time } = splitDateTime(value);
  if (!date) return "";
  const label = dateLabel(date);
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${label}, ${hour12}:${pad(m)} ${suffix}`;
}

/** Hours offered by the time control — every hour, so no trade time is unrepresentable. */
export const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
/** Minutes likewise. A 5-minute grid would round a 10:13 entry, and the diary has such times. */
export const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

/** Today at local midnight — the starting month for a picker with no value. */
export function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
