/** Calendar dates are always interpreted in the workspace timezone. */
export function calendarDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function calendarTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** Reject nonexistent DST wall times rather than silently publishing at another hour. */
export function calendarInstant(date: string, time: string, timezone: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw new Error("Choose a valid date and time");
  const wall = new Date(`${date}T${time}:00Z`);
  if (!Number.isFinite(wall.getTime())) throw new Error("Choose a valid date and time");
  if (wall.toISOString().slice(0, 16) !== `${date}T${time}`) throw new Error("Choose a valid date and time");
  const desired = wall.getTime();
  let candidate = desired;
  for (let i = 0; i < 5; i++) {
    const current = new Date(candidate);
    const actual = new Date(`${calendarDate(current, timezone)}T${calendarTime(current, timezone)}:00Z`).getTime();
    if (actual === desired) return current;
    candidate += desired - actual;
  }
  throw new Error("This time does not exist in your workspace timezone. Choose another time.");
}

export function calendarMonth(value: string | undefined, timezone: string, now = new Date()) {
  const fallback = calendarDate(now, timezone).slice(0, 7);
  const valid =
    value &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value) &&
    Number(value.slice(0, 4)) >= 2000 &&
    Number(value.slice(0, 4)) <= 2100;
  const [year, month] = (valid ? value : fallback).split("-").map(Number);
  return { year: year!, month: month! - 1 };
}
