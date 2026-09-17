/** Calendar helpers. Dates are ISO strings (YYYY-MM-DD); months are YYYY-MM. */

export function monthOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function todayISO(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function currentMonth(now: Date = new Date()): string {
  return todayISO(now).slice(0, 7);
}

/** Shift a YYYY-MM month by n months. addMonths("2026-01", -1) === "2025-12". */
export function addMonths(month: string, n: number): string {
  const year = Number(month.slice(0, 4));
  const monthIndex = Number(month.slice(5, 7)) - 1 + n;
  const y = year + Math.floor(monthIndex / 12);
  const m = ((monthIndex % 12) + 12) % 12;
  return `${String(y).padStart(4, "0")}-${String(m + 1).padStart(2, "0")}`;
}

/** The n months ending at `month`, oldest first. */
export function monthsEnding(month: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addMonths(month, i - (n - 1)));
}

export function daysInMonth(month: string): number {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** Whole months from `fromISO` until `toISO`, floored at 0. */
export function monthsUntil(fromISO: string, toISO: string): number {
  const a = monthOf(fromISO);
  const b = monthOf(toISO);
  const months =
    (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
    (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
  return Math.max(0, months);
}

/** Days left in the month containing `isoDate`, including today. */
export function daysLeftInMonth(isoDate: string): number {
  const total = daysInMonth(monthOf(isoDate));
  return total - Number(isoDate.slice(8, 10)) + 1;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatMonth(month: string, short = false): string {
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
  return `${short ? name.slice(0, 3) : name} ${month.slice(0, 4)}`;
}

export function formatDate(isoDate: string, short = false): string {
  const name = MONTH_NAMES[Number(isoDate.slice(5, 7)) - 1] ?? "";
  const day = Number(isoDate.slice(8, 10));
  return short ? `${name.slice(0, 3)} ${day}` : `${day} ${name.slice(0, 3)} ${isoDate.slice(0, 4)}`;
}
