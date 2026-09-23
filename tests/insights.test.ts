import { describe, expect, it } from "vitest";
import { greetingFor, insightsFor, type InsightContext } from "../src/shared/insights.js";
import type { Account, Entry, Liability, Target } from "../src/shared/types.js";

const TODAY = "2026-09-23";

function base(partial: Partial<InsightContext> = {}): InsightContext {
  return {
    today: TODAY,
    entries: [], accounts: [], balances: {}, liabilities: [],
    targets: [], categories: [], due: [],
    ...partial,
  };
}

function entry(p: Partial<Entry> & Pick<Entry, "direction" | "amountCents" | "occurredOn">): Entry {
  return {
    id: Math.random().toString(36).slice(2), payee: "", reason: "", accountId: null,
    toAccountId: null, categoryId: null, sourceId: null, targetId: null,
    repeatRule: null, isAdjustment: false, scheduleId: null, ...p,
  };
}

function liability(p: Partial<Liability> = {}): Liability {
  return {
    id: "l1", name: "Card", kind: "credit_card", balanceCents: 0, aprBps: null,
    minPaymentCents: null, dueDay: null, archived: false, ...p,
  };
}

function target(p: Partial<Target> & Pick<Target, "kind" | "amountCents">): Target {
  return {
    id: "t1", name: "Target", deadline: null, accountId: null, liabilityId: null,
    categoryId: null, baselineCents: 0, archived: false, ...p,
  };
}

function account(id: string, kind: Account["kind"] = "checking"): Account {
  return { id, name: id, kind, currency: "USD", openingCents: 0, archived: false };
}

describe("greetingFor", () => {
  it("changes with the hour", () => {
    expect(greetingFor(new Date(2026, 8, 23, 6, 0))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 8, 23, 11, 59))).toBe("Good morning");
    expect(greetingFor(new Date(2026, 8, 23, 12, 0))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 8, 23, 17, 59))).toBe("Good afternoon");
    expect(greetingFor(new Date(2026, 8, 23, 18, 0))).toBe("Good evening");
    expect(greetingFor(new Date(2026, 8, 23, 23, 30))).toBe("Good evening");
  });
});

describe("insightsFor", () => {
  it("says nothing when there is nothing to say", () => {
    expect(insightsFor(base())).toEqual([]);
  });

  it("flags a spending cap running out, with the days left", () => {
    const ctx = base({
      targets: [target({ kind: "spend_under", amountCents: 40000, categoryId: "cat_dining", name: "Dining-out cap" })],
      entries: [entry({ direction: "out", amountCents: 38100, occurredOn: "2026-09-04", categoryId: "cat_dining" })],
    });
    const [first] = insightsFor(ctx);
    expect(first?.tone).toBe("watch");
    expect(first?.text).toContain("$19.00 left");
    expect(first?.text).toContain("8 days to go");
  });

  it("escalates once a cap is blown", () => {
    const ctx = base({
      targets: [target({ kind: "spend_under", amountCents: 40000, categoryId: "cat_dining", name: "Dining-out cap" })],
      entries: [entry({ direction: "out", amountCents: 47500, occurredOn: "2026-09-04", categoryId: "cat_dining" })],
    });
    const [first] = insightsFor(ctx);
    expect(first?.tone).toBe("urgent");
    expect(first?.text).toContain("$75.00 over");
  });

  it("warns about a minimum payment only when it is close", () => {
    const soon = insightsFor(base({
      liabilities: [liability({ name: "Afterpay", kind: "bnpl", minPaymentCents: 5400, dueDay: 25 })],
    }));
    expect(soon[0]?.text).toBe("Afterpay's $54.00 minimum is due in 2 days.");
    expect(soon[0]?.tone).toBe("urgent");

    const faraway = insightsFor(base({
      liabilities: [liability({ name: "Afterpay", minPaymentCents: 5400, dueDay: 30 })],
    }));
    expect(faraway).toEqual([]);

    const past = insightsFor(base({
      liabilities: [liability({ name: "Afterpay", minPaymentCents: 5400, dueDay: 3 })],
    }));
    expect(past).toEqual([]);
  });

  it("names the debt that costs the most to carry, once there is a choice", () => {
    const one = insightsFor(base({
      liabilities: [liability({ name: "Card", balanceCents: 214088, aprBps: 2124 })],
    }));
    expect(one).toEqual([]); // nothing to compare it against

    const several = insightsFor(base({
      liabilities: [
        liability({ id: "a", name: "Sapphire", balanceCents: 214088, aprBps: 2124 }),
        liability({ id: "b", name: "Afterpay", kind: "bnpl", balanceCents: 21600, aprBps: 0 }),
      ],
    }));
    expect(several[0]?.text).toContain("Sapphire costs $37.89 a month in interest");
  });

  it("notices spending more than came in", () => {
    const ctx = base({
      entries: [
        entry({ direction: "in", amountCents: 100000, occurredOn: "2026-09-02" }),
        entry({ direction: "out", amountCents: 145000, occurredOn: "2026-09-10" }),
      ],
    });
    const found = insightsFor(ctx);
    expect(found[0]?.tone).toBe("urgent");
    expect(found[0]?.text).toBe("You've spent $450.00 more than came in this month.");
  });

  it("flags an overdrawn account", () => {
    const ctx = base({
      accounts: [account("checking")],
      balances: { checking: -4200 },
      entries: [entry({ direction: "out", amountCents: 80000, occurredOn: "2026-09-10" })],
    });
    expect(insightsFor(ctx).some((i) => i.text.includes("overdrawn by $42.00"))).toBe(true);
  });

  it("ignores a credit card when looking for a low balance", () => {
    const ctx = base({
      accounts: [account("card", "credit_card")],
      balances: { card: -50000 },
      entries: [entry({ direction: "out", amountCents: 80000, occurredOn: "2026-09-10" })],
    });
    expect(insightsFor(ctx).some((i) => i.id.startsWith("overdrawn"))).toBe(false);
  });

  it("congratulates a target that got there", () => {
    const ctx = base({
      targets: [target({ kind: "save_to", amountCents: 100000, name: "Emergency fund", accountId: "savings" })],
      accounts: [account("savings", "savings")],
      balances: { savings: 120000 },
    });
    expect(insightsFor(ctx)[0]?.text).toBe("Emergency fund has hit its target.");
  });

  it("reports a savings rate that moved, and stays quiet when it barely did", () => {
    const moved = insightsFor(base({
      entries: [
        entry({ direction: "in", amountCents: 100000, occurredOn: "2026-08-02" }),
        entry({ direction: "out", amountCents: 80000, occurredOn: "2026-08-10" }), // kept 20%
        entry({ direction: "in", amountCents: 100000, occurredOn: "2026-09-02" }),
        entry({ direction: "out", amountCents: 40000, occurredOn: "2026-09-10" }), // kept 60%
      ],
    }));
    expect(moved.some((i) => i.text.includes("40 points better than last month"))).toBe(true);

    const flat = insightsFor(base({
      entries: [
        entry({ direction: "in", amountCents: 100000, occurredOn: "2026-08-02" }),
        entry({ direction: "out", amountCents: 80000, occurredOn: "2026-08-10" }),
        entry({ direction: "in", amountCents: 100000, occurredOn: "2026-09-02" }),
        entry({ direction: "out", amountCents: 78000, occurredOn: "2026-09-10" }),
      ],
    }));
    expect(flat.some((i) => i.id === "savings-rate")).toBe(false);
  });

  it("puts the most pressing first and keeps the list short", () => {
    const ctx = base({
      liabilities: [
        liability({ id: "a", name: "Afterpay", kind: "bnpl", minPaymentCents: 5400, dueDay: 24 }),
        liability({ id: "b", name: "Sapphire", balanceCents: 214088, aprBps: 2124 }),
        liability({ id: "c", name: "Quicksilver", balanceCents: 87450, aprBps: 2699 }),
      ],
      targets: [target({ kind: "spend_under", amountCents: 40000, categoryId: "cat_dining", name: "Dining-out cap" })],
      entries: [
        entry({ direction: "out", amountCents: 47500, occurredOn: "2026-09-04", categoryId: "cat_dining" }),
        entry({ direction: "in", amountCents: 100000, occurredOn: "2026-09-02" }),
      ],
    });
    const found = insightsFor(ctx);
    expect(found).toHaveLength(3);
    expect(found[0]?.tone).toBe("urgent");
    expect(found.map((i) => i.tone)).toEqual([...found.map((i) => i.tone)].sort(
      (a, b) => ["urgent", "watch", "good", "neutral"].indexOf(a) - ["urgent", "watch", "good", "neutral"].indexOf(b),
    ));
  });

  it("never invents a figure — every insight cites one from the ledger", () => {
    const ctx = base({
      liabilities: [liability({ name: "Afterpay", kind: "bnpl", minPaymentCents: 5400, dueDay: 25 })],
    });
    for (const insight of insightsFor(ctx)) {
      expect(insight.text).toMatch(/\$[\d,]+\.\d{2}|\d+ (day|days|points|%)/);
    }
  });
});
