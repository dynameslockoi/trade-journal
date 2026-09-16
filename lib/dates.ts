import { MY_TIME_ZONE, myParts } from "./trading";

/**
 * The date fields in the journal carry plain strings, not `Date` objects, because that is what both
 * the form state and Supabase want: `"YYYY-MM-DD"` for a date and `"YYYY-MM-DDTHH:mm"` for a
 * date-time (the same shape `datetime-local` produced before the pickers replaced it).
 *
 * They are Malaysian calendar days, because the journal is a Bursa record: the date you pick is the
 * date the trade happened in Kuala Lumpur, whatever the clock of the machine you picked it on. Two
 * things follow. `new Date("2026-09-16")` is never used — it parses as UTC midnight, which is the
 * 15th in Malaysia — and every `Date` these helpers hand back is anchored at midday in Malaysia, so
 * no viewer's timezone can shift it onto a neighbouring day.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** The instant a Malaysian calendar day starts, expressed as midday to keep a day's distance either side. */
const dayAnchor = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day, 4));

/** "2026-09-16" → the date it names in Malaysia, or undefined when the string is absent or malformed. */
export function parseISODate(value?: string | null): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? "");
  if (!m) return undefined;
  const d = dayAnchor(Number(m[1]), Number(m[2]), Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/** A Date → "2026-09-16", read as the Malaysian calendar day rather than the viewer's. */
export function toISODate(date: Date): string {
  const parts = myParts(date);
  return parts ? `${parts.year}-${pad(parts.month)}-${pad(parts.day)}` : "";
}

/** The trigger's label for a date field: "16 Sept 2026" — short enough for a narrow field. */
export function dateLabel(value?: string | null): string {
  const d = parseISODate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: MY_TIME_ZONE });
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

/** Today in Malaysia — the starting month for a picker with no value. */
export function today(): Date {
  const parts = myParts(new Date());
  return parts ? dayAnchor(parts.year, parts.month, parts.day) : new Date();
}

/** The Malaysian wall clock of an instant as the two strings the date-time field edits. */
export function wallClock(date: Date): { date: string; time: string } {
  const parts = myParts(date);
  if (!parts) return { date: "", time: "09:00" };
  return { date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`, time: `${pad(parts.hours)}:${pad(parts.minutes)}` };
}
