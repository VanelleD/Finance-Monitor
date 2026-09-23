import { describe, expect, it } from "vitest";
import {
  allDue, dueOccurrences, monthlyEquivalentCents, nextDueAfter, occurrenceDate,
} from "../src/shared/derive.js";
import { addDays, addMonthsToDate } from "../src/shared/dates.js";
import type { Schedule } from "../src/shared/types.js";

function schedule(partial: Partial<Schedule> & Pick<Schedule, "cadence" | "anchorDate">): Schedule {
  return {
    id: "sch_1",
    name: "Rule",
    direction: "out",
    amountCents: 5000,
    nextDue: partial.anchorDate,
    autoPost: false,
    payee: "",
    reason: "",
    accountId: null,
    toAccountId: null,
    categoryId: null,
    sourceId: null,
    targetId: null,
    liabilityId: null,
    archived: false,
    ...partial,
  };
}

describe("date shifting", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29"); // leap year
  });

  it("clamps a month shift to the end of a short month", () => {
    expect(addMonthsToDate("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToDate("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonthsToDate("2026-08-31", 1)).toBe("2026-09-30");
    expect(addMonthsToDate("2026-12-15", 1)).toBe("2027-01-15");
  });
});

describe("occurrenceDate", () => {
  it("steps weekly and biweekly from the anchor", () => {
    expect(occurrenceDate("2026-09-04", "weekly", 0)).toBe("2026-09-04");
    expect(occurrenceDate("2026-09-04", "weekly", 3)).toBe("2026-09-25");
    expect(occurrenceDate("2026-09-04", "biweekly", 1)).toBe("2026-09-18");
    expect(occurrenceDate("2026-09-04", "biweekly", 3)).toBe("2026-10-16");
  });

  it("does not let a clamped month drift permanently", () => {
    // Counting from the anchor each time, the 31st comes back after February.
    // Stepping from the previous occurrence would have stuck on the 28th.
    expect(occurrenceDate("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(occurrenceDate("2026-01-31", "monthly", 2)).toBe("2026-03-31");
    expect(occurrenceDate("2026-01-31", "monthly", 3)).toBe("2026-04-30");
    expect(occurrenceDate("2026-01-31", "monthly", 4)).toBe("2026-05-31");
  });
});

describe("dueOccurrences", () => {
  it("lists every missed occurrence up to today, oldest first", () => {
    // Anchored four weeks back, nothing posted yet.
    const weekly = schedule({ cadence: "weekly", anchorDate: "2026-09-01", nextDue: "2026-09-01" });
    const due = dueOccurrences(weekly, "2026-09-23");
    expect(due.map((d) => d.occurredOn)).toEqual([
      "2026-09-01", "2026-09-08", "2026-09-15", "2026-09-22",
    ]);
  });

  it("never returns anything dated in the future", () => {
    const weekly = schedule({ cadence: "weekly", anchorDate: "2026-09-01", nextDue: "2026-09-01" });
    for (const occurrence of dueOccurrences(weekly, "2026-09-23")) {
      expect(occurrence.occurredOn <= "2026-09-23").toBe(true);
    }
  });

  it("skips occurrences already recorded", () => {
    const weekly = schedule({ cadence: "weekly", anchorDate: "2026-09-01", nextDue: "2026-09-15" });
    expect(dueOccurrences(weekly, "2026-09-23").map((d) => d.occurredOn)).toEqual([
      "2026-09-15", "2026-09-22",
    ]);
  });

  it("returns nothing when nothing is due yet", () => {
    const monthly = schedule({ cadence: "monthly", anchorDate: "2026-10-01", nextDue: "2026-10-01" });
    expect(dueOccurrences(monthly, "2026-09-23")).toEqual([]);
  });

  it("ignores an archived rule", () => {
    const archived = schedule({ cadence: "weekly", anchorDate: "2026-09-01", archived: true });
    expect(dueOccurrences(archived, "2026-09-23")).toEqual([]);
  });

  it("carries a null amount through, rather than inventing one", () => {
    const variable = schedule({ cadence: "weekly", anchorDate: "2026-09-15", amountCents: null });
    const due = dueOccurrences(variable, "2026-09-23");
    expect(due).toHaveLength(2);
    expect(due[0]?.amountCents).toBeNull();
  });

  it("stays bounded when a rule is anchored far in the past", () => {
    const ancient = schedule({ cadence: "weekly", anchorDate: "2000-01-01", nextDue: "2000-01-01" });
    const due = dueOccurrences(ancient, "2026-09-23");
    expect(due.length).toBeLessThanOrEqual(120);
    expect(due.length).toBeGreaterThan(0);
  });
});

describe("nextDueAfter", () => {
  it("moves to the first occurrence strictly after the one recorded", () => {
    const weekly = schedule({ cadence: "weekly", anchorDate: "2026-09-01" });
    expect(nextDueAfter(weekly, "2026-09-15")).toBe("2026-09-22");
  });

  it("does not stall on the date just posted", () => {
    const biweekly = schedule({ cadence: "biweekly", anchorDate: "2026-09-04" });
    const next = nextDueAfter(biweekly, "2026-09-04");
    expect(next).toBe("2026-09-18");
    expect(next > "2026-09-04").toBe(true);
  });

  it("lands on a real occurrence when given a date between two", () => {
    const monthly = schedule({ cadence: "monthly", anchorDate: "2026-01-15" });
    expect(nextDueAfter(monthly, "2026-03-20")).toBe("2026-04-15");
  });
});

describe("allDue", () => {
  it("merges several rules into one list in date order", () => {
    // The two Fidelity pulls: fifty dollars every two weeks, and a weekly
    // transfer whose amount varies.
    const fifty = schedule({
      id: "sch_fifty", name: "Fidelity $50", cadence: "biweekly",
      anchorDate: "2026-09-04", nextDue: "2026-09-04", amountCents: 5000, autoPost: true,
    });
    const weekly = schedule({
      id: "sch_weekly", name: "Fidelity weekly", cadence: "weekly",
      anchorDate: "2026-09-07", nextDue: "2026-09-07", amountCents: null,
    });

    const due = allDue([fifty, weekly], "2026-09-23");
    expect(due.map((d) => `${d.schedule.id} ${d.occurredOn}`)).toEqual([
      "sch_fifty 2026-09-04",
      "sch_weekly 2026-09-07",
      "sch_weekly 2026-09-14",
      "sch_fifty 2026-09-18",
      "sch_weekly 2026-09-21",
    ]);
  });
});

describe("monthlyEquivalentCents", () => {
  it("converts each cadence onto a monthly footing", () => {
    expect(monthlyEquivalentCents(schedule({ cadence: "monthly", anchorDate: "2026-09-01", amountCents: 20000 }))).toBe(20000);
    // $50 every two weeks is 26 payments a year, not 24.
    expect(monthlyEquivalentCents(schedule({ cadence: "biweekly", anchorDate: "2026-09-01", amountCents: 5000 }))).toBe(10833);
    expect(monthlyEquivalentCents(schedule({ cadence: "weekly", anchorDate: "2026-09-01", amountCents: 2500 }))).toBe(10833);
  });

  it("counts a variable amount as nothing, rather than guessing", () => {
    expect(monthlyEquivalentCents(schedule({ cadence: "weekly", anchorDate: "2026-09-01", amountCents: null }))).toBe(0);
  });
});
