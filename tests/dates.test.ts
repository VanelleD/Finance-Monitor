import { describe, expect, it } from "vitest";
import {
  addMonths, currentMonth, daysInMonth, daysLeftInMonth, formatDate, formatMonth,
  monthOf, monthsEnding, monthsUntil,
} from "../src/shared/dates.js";

describe("month arithmetic", () => {
  it("crosses year boundaries in both directions", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-09", -12)).toBe("2025-09");
    expect(addMonths("2026-09", 16)).toBe("2028-01");
  });

  it("lists a trailing window oldest first", () => {
    expect(monthsEnding("2026-09", 6)).toEqual([
      "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    ]);
  });

  it("counts whole months until a deadline, never negative", () => {
    expect(monthsUntil("2026-09-17", "2027-06-01")).toBe(9);
    expect(monthsUntil("2026-09-17", "2026-09-30")).toBe(0);
    expect(monthsUntil("2026-09-17", "2025-01-01")).toBe(0);
  });

  it("knows month lengths including leap years", () => {
    expect(daysInMonth("2026-09")).toBe(30);
    expect(daysInMonth("2026-02")).toBe(28);
    expect(daysInMonth("2028-02")).toBe(29);
    expect(daysInMonth("2026-12")).toBe(31);
  });

  it("counts the days left in a month inclusively", () => {
    expect(daysLeftInMonth("2026-09-17")).toBe(14);
    expect(daysLeftInMonth("2026-09-30")).toBe(1);
    expect(daysLeftInMonth("2026-09-01")).toBe(30);
  });
});

describe("formatting", () => {
  it("renders months and dates", () => {
    expect(monthOf("2026-09-17")).toBe("2026-09");
    expect(formatMonth("2026-09")).toBe("September 2026");
    expect(formatMonth("2026-09", true)).toBe("Sep 2026");
    expect(formatDate("2026-09-17")).toBe("17 Sep 2026");
    expect(formatDate("2026-09-17", true)).toBe("Sep 17");
  });

  it("derives the current month from an injected clock", () => {
    expect(currentMonth(new Date("2026-09-17T12:00:00Z"))).toBe("2026-09");
  });
});
