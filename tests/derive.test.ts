import { describe, expect, it } from "vitest";
import {
  accountBalanceCents, byCarryingCost, categoryTotals, flowForMonth, flowSeries,
  netWorthCents, netWorthFrom, netWorthTrend, ownedCents, targetProgress,
  totalAssetsCents, withOther,
} from "../src/shared/derive.js";
import type { Account, Asset, Entry, Liability, Target } from "../src/shared/types.js";

const TODAY = "2026-09-17";

function account(id: string, openingCents = 0): Account {
  return { id, name: id, kind: "checking", currency: "USD", openingCents, archived: false };
}

function entry(partial: Partial<Entry> & Pick<Entry, "direction" | "amountCents" | "occurredOn">): Entry {
  return {
    id: Math.random().toString(36).slice(2),
    payee: "", reason: "", accountId: null, toAccountId: null,
    categoryId: null, sourceId: null, targetId: null, repeatRule: null,
    isAdjustment: false, scheduleId: null,
    ...partial,
  };
}

function asset(valueCents: number, archived = false): Asset {
  return {
    id: Math.random().toString(36).slice(2), name: "a", kind: "cash",
    valueCents, valuedOn: TODAY, accountId: null, archived,
  };
}

function liability(partial: Partial<Liability> = {}): Liability {
  return {
    id: "l1", name: "card", kind: "credit_card", balanceCents: 0,
    aprBps: null, minPaymentCents: null, dueDay: null, archived: false, ...partial,
  };
}

describe("netWorthCents", () => {
  it("is what you own minus what you owe", () => {
    const assets = [asset(6231044), asset(3175000), asset(1840000)];
    const liabilities = [liability({ balanceCents: 1894000 }), liability({ balanceCents: 214088 })];
    expect(totalAssetsCents(assets)).toBe(11246044);
    expect(netWorthCents(assets, liabilities)).toBe(11246044 - 2108088);
  });

  it("can go negative", () => {
    expect(netWorthCents([asset(100000)], [liability({ balanceCents: 500000 })])).toBe(-400000);
  });

  it("ignores archived rows on both sides", () => {
    const assets = [asset(100000), asset(999999, true)];
    const liabilities = [liability({ balanceCents: 20000 }), liability({ balanceCents: 777, archived: true })];
    expect(netWorthCents(assets, liabilities)).toBe(80000);
  });

  it("is zero for an empty ledger rather than NaN", () => {
    expect(netWorthCents([], [])).toBe(0);
  });
});

describe("flowForMonth", () => {
  const entries = [
    entry({ direction: "in", amountCents: 371000, occurredOn: "2026-09-16" }),
    entry({ direction: "in", amountCents: 120000, occurredOn: "2026-09-14" }),
    entry({ direction: "out", amountCents: 14218, occurredOn: "2026-09-17" }),
    entry({ direction: "out", amountCents: 185000, occurredOn: "2026-09-11" }),
    entry({ direction: "out", amountCents: 500000, occurredOn: "2026-08-11" }),
  ];

  it("sums only the month asked for", () => {
    const flow = flowForMonth(entries, "2026-09");
    expect(flow.inCents).toBe(491000);
    expect(flow.outCents).toBe(199218);
    expect(flow.netCents).toBe(291782);
  });

  it("excludes transfers from both sides, so the savings rate stays honest", () => {
    const withTransfer = [
      ...entries,
      entry({ direction: "transfer", amountCents: 60000, occurredOn: "2026-09-15" }),
    ];
    const before = flowForMonth(entries, "2026-09");
    const after = flowForMonth(withTransfer, "2026-09");
    expect(after.inCents).toBe(before.inCents);
    expect(after.outCents).toBe(before.outCents);
    expect(after.savingsRate).toBe(before.savingsRate);
  });

  it("reports the share of income kept", () => {
    const flow = flowForMonth(
      [
        entry({ direction: "in", amountCents: 100000, occurredOn: "2026-09-01" }),
        entry({ direction: "out", amountCents: 25000, occurredOn: "2026-09-02" }),
      ],
      "2026-09",
    );
    expect(flow.savingsRate).toBeCloseTo(0.75, 10);
  });

  it("returns null savings rate when nothing came in, instead of dividing by zero", () => {
    const flow = flowForMonth(
      [entry({ direction: "out", amountCents: 5000, occurredOn: "2026-09-02" })],
      "2026-09",
    );
    expect(flow.savingsRate).toBeNull();
    expect(flow.netCents).toBe(-5000);
  });

  it("goes negative when you overspend", () => {
    const flow = flowForMonth(
      [
        entry({ direction: "in", amountCents: 10000, occurredOn: "2026-09-01" }),
        entry({ direction: "out", amountCents: 15000, occurredOn: "2026-09-02" }),
      ],
      "2026-09",
    );
    expect(flow.netCents).toBe(-5000);
    expect(flow.savingsRate).toBeCloseTo(-0.5, 10);
  });

  it("fills a series with zeroed months rather than gaps", () => {
    const series = flowSeries(entries, ["2026-07", "2026-08", "2026-09"]);
    expect(series.map((f) => f.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(series[0]).toMatchObject({ inCents: 0, outCents: 0, savingsRate: null });
    expect(series[1]?.outCents).toBe(500000);
  });
});

describe("categoryTotals", () => {
  const entries = [
    entry({ direction: "out", amountCents: 185000, occurredOn: "2026-09-11", categoryId: "housing" }),
    entry({ direction: "out", amountCents: 14218, occurredOn: "2026-09-17", categoryId: "groceries" }),
    entry({ direction: "out", amountCents: 8742, occurredOn: "2026-09-08", categoryId: "groceries" }),
    entry({ direction: "out", amountCents: 5840, occurredOn: "2026-09-13", categoryId: null }),
    entry({ direction: "in", amountCents: 371000, occurredOn: "2026-09-16", categoryId: "salary" }),
  ];

  it("groups spending by category, largest first", () => {
    expect(categoryTotals(entries, "2026-09")).toEqual([
      { categoryId: "housing", cents: 185000 },
      { categoryId: "groceries", cents: 22960 },
      { categoryId: null, cents: 5840 },
    ]);
  });

  it("can group income instead", () => {
    expect(categoryTotals(entries, "2026-09", "in")).toEqual([
      { categoryId: "salary", cents: 371000 },
    ]);
  });

  it("folds the tail into one Other bucket", () => {
    const rows = [{ cents: 500 }, { cents: 400 }, { cents: 300 }, { cents: 200 }, { cents: 100 }];
    expect(withOther(rows, 3)).toEqual({ top: rows.slice(0, 3), otherCents: 300 });
    expect(withOther(rows, 9)).toEqual({ top: rows, otherCents: 0 });
  });
});

describe("accountBalanceCents", () => {
  const checking = account("checking", 100000);
  const savings = account("savings", 0);
  const entries = [
    entry({ direction: "in", amountCents: 371000, occurredOn: "2026-09-16", accountId: "checking" }),
    entry({ direction: "out", amountCents: 14218, occurredOn: "2026-09-17", accountId: "checking" }),
    entry({ direction: "transfer", amountCents: 60000, occurredOn: "2026-09-15", accountId: "checking", toAccountId: "savings" }),
    entry({ direction: "out", amountCents: 9999, occurredOn: "2026-09-13", accountId: "other" }),
  ];

  it("adds deposits, subtracts payments, and ignores other accounts", () => {
    expect(accountBalanceCents(checking, entries)).toBe(100000 + 371000 - 14218 - 60000);
  });

  it("moves a transfer out of one account and into the other", () => {
    expect(accountBalanceCents(savings, entries)).toBe(60000);
    const total =
      accountBalanceCents(checking, entries) + accountBalanceCents(savings, entries);
    const withoutTransfer = 100000 + 371000 - 14218;
    expect(total).toBe(withoutTransfer); // a transfer nets to zero across accounts
  });

  it("can be taken as of an earlier date", () => {
    expect(accountBalanceCents(checking, entries, "2026-09-15")).toBe(100000 - 60000);
  });
});

describe("targetProgress", () => {
  const base = { entries: [] as Entry[], assets: [] as Asset[], liabilities: [] as Liability[], accounts: [] as Account[], today: TODAY };

  function target(partial: Partial<Target> & Pick<Target, "kind" | "amountCents">): Target {
    return {
      id: "t1", name: "t", deadline: null, accountId: null, liabilityId: null,
      categoryId: null, baselineCents: 0, archived: false, ...partial,
    };
  }

  it("measures a savings target from tagged contributions", () => {
    const t = target({ kind: "save_to", amountCents: 2500000, deadline: "2027-06-01" });
    const entries = [
      entry({ direction: "transfer", amountCents: 600000, occurredOn: "2026-07-15", targetId: "t1" }),
      entry({ direction: "transfer", amountCents: 700000, occurredOn: "2026-08-15", targetId: "t1" }),
      entry({ direction: "transfer", amountCents: 600000, occurredOn: "2026-09-15", targetId: "t1" }),
    ];
    const p = targetProgress(t, { ...base, entries });
    expect(p.currentCents).toBe(1900000);
    expect(p.remainingCents).toBe(600000);
    expect(p.fraction).toBeCloseTo(0.76, 10);
    expect(p.monthsRemaining).toBe(9);
    expect(p.requiredPerMonthCents).toBe(Math.ceil(600000 / 9));
    expect(p.status).toBe("on_track");
  });

  it("flags a savings target whose pace is too slow for the deadline", () => {
    const t = target({ kind: "save_to", amountCents: 2500000, deadline: "2026-11-01" });
    const entries = [
      entry({ direction: "transfer", amountCents: 10000, occurredOn: "2026-07-15", targetId: "t1" }),
      entry({ direction: "transfer", amountCents: 10000, occurredOn: "2026-08-15", targetId: "t1" }),
    ];
    const p = targetProgress(t, { ...base, entries });
    expect(p.status).toBe("attention");
    expect(p.pacePerMonthCents).toBeLessThan(p.requiredPerMonthCents!);
  });

  it("uses the linked account balance when there is one", () => {
    const t = target({ kind: "save_to", amountCents: 2500000, accountId: "savings" });
    const accounts = [account("savings", 1840000)];
    const p = targetProgress(t, { ...base, accounts });
    expect(p.currentCents).toBe(1840000);
  });

  it("lets a linked account outrank tagged entries", () => {
    // The account held money before the goal existed, so its balance is the truth;
    // the tagged transfers are only part of how it got there.
    const t = target({ kind: "save_to", amountCents: 2500000, accountId: "savings" });
    const accounts = [account("savings", 1240000)];
    const entries = [
      entry({ direction: "transfer", amountCents: 600000, occurredOn: "2026-09-15", toAccountId: "savings", targetId: "t1" }),
    ];
    const p = targetProgress(t, { ...base, accounts, entries });
    expect(p.currentCents).toBe(1840000); // 12,400 already there + 6,000 moved in
  });

  it("measures a payoff target as ground cleared from the original balance", () => {
    const t = target({ kind: "pay_off", amountCents: 490000, baselineCents: 490000, liabilityId: "l1" });
    const liabilities = [liability({ id: "l1", balanceCents: 214088 })];
    const p = targetProgress(t, { ...base, liabilities });
    expect(p.currentCents).toBe(275912);
    expect(p.goalCents).toBe(490000);
    expect(p.fraction).toBeCloseTo(275912 / 490000, 10);
  });

  it("calls a payoff target reached once the balance hits zero", () => {
    const t = target({ kind: "pay_off", amountCents: 490000, baselineCents: 490000, liabilityId: "l1" });
    const p = targetProgress(t, { ...base, liabilities: [liability({ id: "l1", balanceCents: 0 })] });
    expect(p.status).toBe("reached");
    expect(p.fraction).toBe(1);
  });

  it("treats a spend cap as something to stay under, not to fill", () => {
    const t = target({ kind: "spend_under", amountCents: 40000, categoryId: "dining" });
    const entries = [
      entry({ direction: "out", amountCents: 31800, occurredOn: "2026-09-04", categoryId: "dining" }),
      entry({ direction: "out", amountCents: 99999, occurredOn: "2026-08-04", categoryId: "dining" }),
      entry({ direction: "out", amountCents: 5000, occurredOn: "2026-09-04", categoryId: "groceries" }),
    ];
    const p = targetProgress(t, { ...base, entries });
    expect(p.currentCents).toBe(31800); // only this month, only this category
    expect(p.status).toBe("attention"); // 79.5% of the cap, past the 75% warning
  });

  it("escalates a spend cap from on track to attention to over", () => {
    const t = target({ kind: "spend_under", amountCents: 40000, categoryId: "dining" });
    const at = (cents: number) =>
      targetProgress(t, {
        ...base,
        entries: [entry({ direction: "out", amountCents: cents, occurredOn: "2026-09-04", categoryId: "dining" })],
      }).status;
    expect(at(10000)).toBe("on_track");  // 25%
    expect(at(29000)).toBe("on_track");  // 72.5%, just under the warning
    expect(at(31800)).toBe("attention"); // 79.5%
    expect(at(40000)).toBe("attention"); // exactly at the cap is not yet over it
    expect(at(41000)).toBe("over");      // 102.5%
  });

  it("measures a net-worth target against assets minus liabilities", () => {
    const t = target({ kind: "net_worth", amountCents: 15000000, deadline: "2028-12-01" });
    const p = targetProgress(t, {
      ...base,
      assets: [asset(13182059)],
      liabilities: [liability({ balanceCents: 2839088 })],
    });
    expect(p.currentCents).toBe(10342971);
    expect(p.fraction).toBeCloseTo(10342971 / 15000000, 10);
  });

  it("clamps the bar but keeps the true ratio when a target is overshot", () => {
    const t = target({ kind: "save_to", amountCents: 100000 });
    const entries = [entry({ direction: "in", amountCents: 250000, occurredOn: "2026-09-01", targetId: "t1" })];
    const p = targetProgress(t, { ...base, entries });
    expect(p.fraction).toBe(1);
    expect(p.ratio).toBe(2.5);
    expect(p.remainingCents).toBe(0);
    expect(p.status).toBe("reached");
  });

  it("has no deadline maths when there is no deadline", () => {
    const p = targetProgress(target({ kind: "save_to", amountCents: 100000 }), base);
    expect(p.monthsRemaining).toBeNull();
    expect(p.requiredPerMonthCents).toBeNull();
  });
});

describe("byCarryingCost", () => {
  it("ranks debts by what they actually cost each month, not by size", () => {
    const debts = [
      liability({ id: "loan", name: "Student loan", kind: "loan", balanceCents: 1894000, aprBps: 499 }),
      liability({ id: "card", name: "Credit card", balanceCents: 214088, aprBps: 2124 }),
      liability({ id: "auto", name: "Auto loan", kind: "loan", balanceCents: 731000, aprBps: 340 }),
    ];
    const ranked = byCarryingCost(debts);
    expect(ranked.map((l) => l.id)).toEqual(["loan", "card", "auto"]);
    // The small card at 21.24% costs $37.89/mo; the big loan at 4.99% costs $78.76.
    expect(ranked.find((l) => l.id === "card")?.monthlyInterestCents).toBe(3789);
    expect(ranked.find((l) => l.id === "loan")?.monthlyInterestCents).toBe(7876);
  });

  it("treats a missing rate as costing nothing rather than crashing", () => {
    const ranked = byCarryingCost([liability({ balanceCents: 50000, aprBps: null })]);
    expect(ranked[0]?.monthlyInterestCents).toBe(0);
  });
});

describe("netWorthTrend", () => {
  it("traces backwards from today through each month's net flow", () => {
    const entries = [
      entry({ direction: "in", amountCents: 100000, occurredOn: "2026-08-01" }),
      entry({ direction: "out", amountCents: 40000, occurredOn: "2026-08-02" }),
      entry({ direction: "in", amountCents: 100000, occurredOn: "2026-09-01" }),
      entry({ direction: "out", amountCents: 70000, occurredOn: "2026-09-02" }),
    ];
    // September kept 30,000; August kept 60,000.
    const trend = netWorthTrend(1000000, entries, ["2026-07", "2026-08", "2026-09"]);
    expect(trend).toEqual([910000, 970000, 1000000]);
  });

  it("stays flat across months with no entries", () => {
    expect(netWorthTrend(500000, [], ["2026-07", "2026-08", "2026-09"])).toEqual([
      500000, 500000, 500000,
    ]);
  });

  it("ignores transfers, which move money without changing net worth", () => {
    const entries = [
      entry({ direction: "transfer", amountCents: 250000, occurredOn: "2026-09-05" }),
    ];
    expect(netWorthTrend(800000, entries, ["2026-08", "2026-09"])).toEqual([800000, 800000]);
  });
});

describe("net worth from live account balances", () => {
  function acct(id: string, openingCents = 0, archived = false): Account {
    return { id, name: id, kind: "checking", currency: "USD", openingCents, archived };
  }

  it("counts what is in each account, plus anything owned outside one", () => {
    const accounts = [acct("checking"), acct("savings")];
    const balances = { checking: 482015, savings: 1840000 };
    const car: Asset = { ...asset(1420000), kind: "vehicle", accountId: null };

    expect(ownedCents(accounts, balances, [car])).toBe(482015 + 1840000 + 1420000);
  });

  it("never counts an account twice when an asset row mirrors it", () => {
    // The seeded data does exactly this: Ally Savings as both an account and an
    // asset. The account balance is the live one, so the asset row is skipped.
    const accounts = [acct("savings")];
    const balances = { savings: 1840000 };
    const mirror: Asset = { ...asset(1240000), kind: "cash", accountId: "savings" };

    expect(ownedCents(accounts, balances, [mirror])).toBe(1840000);
  });

  it("falls back to the opening figure for an account with no balance yet", () => {
    expect(ownedCents([acct("cash", 34000)], {}, [])).toBe(34000);
  });

  it("subtracts every debt, including the newer kinds", () => {
    const worth = netWorthFrom({
      accounts: [acct("checking")],
      balances: { checking: 500000 },
      assets: [],
      liabilities: [
        liability({ id: "card", kind: "credit_card", balanceCents: 214088 }),
        liability({ id: "afterpay", kind: "bnpl", balanceCents: 12000 }),
        liability({ id: "cashapp", kind: "person", balanceCents: 5000 }),
      ],
    });
    expect(worth).toBe(500000 - 214088 - 12000 - 5000);
  });

  it("ignores archived accounts", () => {
    const accounts = [acct("open"), acct("closed", 0, true)];
    expect(ownedCents(accounts, { open: 10000, closed: 999999 }, [])).toBe(10000);
  });
});

describe("targets read the balance the server worked out", () => {
  const base = {
    entries: [] as Entry[], assets: [] as Asset[], liabilities: [] as Liability[],
    accounts: [] as Account[], today: TODAY,
  };

  it("prefers the full-ledger balance over recomputing from a loaded window", () => {
    // The window holds one recent deposit; the real account holds far more.
    const savings: Account = { id: "savings", name: "HYSA", kind: "savings", currency: "USD", openingCents: 0, archived: false };
    const windowed = [entry({ direction: "in", amountCents: 50000, occurredOn: "2026-09-01", accountId: "savings" })];

    const target: Target = {
      id: "t1", name: "Emergency fund", kind: "save_to", amountCents: 2500000,
      deadline: null, accountId: "savings", liabilityId: null, categoryId: null,
      baselineCents: 0, archived: false,
    };

    const withoutBalances = targetProgress(target, { ...base, accounts: [savings], entries: windowed });
    expect(withoutBalances.currentCents).toBe(50000); // only what the window shows

    const withBalances = targetProgress(target, {
      ...base, accounts: [savings], entries: windowed, balances: { savings: 1840000 },
    });
    expect(withBalances.currentCents).toBe(1840000); // the truth
  });
});
