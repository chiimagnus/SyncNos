const MILLISECONDS_PER_UTC_DAY = 24 * 60 * 60 * 1000;

function toValidLocalDate(timestamp: unknown): Date | null {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function startOfLocalCalendarDay(timestamp: unknown): number {
  const date = toValidLocalDate(timestamp);
  if (!date) return Number.NaN;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function localCalendarDayOrdinal(timestamp: unknown): number {
  const date = toValidLocalDate(timestamp);
  if (!date) return Number.NaN;

  const utcCalendarDate = new Date(0);
  utcCalendarDate.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  utcCalendarDate.setUTCHours(0, 0, 0, 0);
  return Math.trunc(utcCalendarDate.getTime() / MILLISECONDS_PER_UTC_DAY);
}

export function differenceInLocalCalendarDays(laterTimestamp: unknown, earlierTimestamp: unknown): number {
  const laterOrdinal = localCalendarDayOrdinal(laterTimestamp);
  const earlierOrdinal = localCalendarDayOrdinal(earlierTimestamp);
  if (!Number.isFinite(laterOrdinal) || !Number.isFinite(earlierOrdinal)) return Number.NaN;
  return laterOrdinal - earlierOrdinal;
}

export function shiftLocalCalendarDays(timestamp: unknown, dayDelta: number): number {
  const start = startOfLocalCalendarDay(timestamp);
  if (!Number.isFinite(start)) return Number.NaN;
  const delta = Number(dayDelta);
  if (!Number.isSafeInteger(delta)) return Number.NaN;

  const date = new Date(start);
  date.setDate(date.getDate() + delta);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
