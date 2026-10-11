import { describe, expect, it } from "vitest";
import { calendarDate, calendarInstant, calendarMonth, calendarTime } from "@/lib/calendar";

describe("workspace calendar", () => {
  it("keeps India calendar times independent of the server/browser timezone", () => {
    const date = calendarInstant("2026-11-01", "09:15", "Asia/Kolkata");
    expect(date.toISOString()).toBe("2026-11-01T03:45:00.000Z");
    expect(calendarTime(date, "Asia/Kolkata")).toBe("09:15");
  });
  it("includes UTC dates which fall in the next local month", () => {
    const now = new Date("2026-10-31T21:00:00Z");
    expect(calendarDate(now, "Asia/Kolkata")).toBe("2026-11-01");
    expect(calendarMonth(undefined, "Asia/Kolkata", now)).toEqual({ year: 2026, month: 10 });
  });
  it("handles a daylight saving offset change", () => {
    expect(calendarInstant("2026-03-07", "09:00", "America/New_York").toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(calendarInstant("2026-03-09", "09:00", "America/New_York").toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });
  it("rejects nonexistent local times and invalid calendar dates", () => {
    expect(() => calendarInstant("2026-03-08", "02:30", "America/New_York")).toThrow("does not exist");
    expect(() => calendarInstant("2026-02-31", "09:00", "UTC")).toThrow("valid date");
    expect(() => calendarInstant("2026-11-01", "25:00", "UTC")).toThrow();
  });
  it("falls back for malformed and unbounded month parameters", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    for (const month of ["NaN-NaN", "9999-01", "2026-00", "2026-13"])
      expect(calendarMonth(month, "UTC", now)).toEqual({ year: 2026, month: 9 });
  });
});
