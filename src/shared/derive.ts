/**
 * Every number the app shows that isn't typed in by hand is computed here.
 *
 * These functions are pure and take plain arrays, so they run identically on the
 * server, in the browser, and in tests. Nothing derived is ever stored: net worth,
 * balances and target progress are always recomputed from entries, assets and
 * liabilities, which means they can't drift out of sync with the ledger.
 */

import type {
  Account, Asset, Entry, Liability, MonthFlow, Target, TargetProgress, TargetStatus,
} from "./types.js";
import { monthOf, monthsUntil, addMonths } from "./dates.js";

/**
 * How full a monthly spending cap has to be before it is flagged.
 * Set below 0.8 deliberately: a warning only helps if it arrives while you
 * still have room to change what you spend.
 */
export const SPEND_CAP_WARNING = 0.75;

/** Assets minus liabilities. */
export function netWorthCents(assets: Asset[], liabilities: Liability[]): number {
  const owned = sum(assets.filter(live).map((a) => a.valueCents));
  const owed = sum(liabilities.filter(live).map((l) => l.balanceCents));
  return owned - owed;
}

export function totalAssetsCents(assets: Asset[]): number {
  return sum(assets.filter(live).map((a) => a.valueCents));
}

export function totalLiabilitiesCents(liabilities: Liability[]): number {
  return sum(liabilities.filter(live).map((l) => l.balanceCents));
}

/**
 * Money in and out for one month.
 *
 * Transfers are deliberately excluded from both sides. Moving $600 from checking
 * into savings is not income and not spending; counting it either way would
 * corrupt the savings rate, which is the whole point of tracking this.
 */
export function flowForMonth(entries: Entry[], month: string): MonthFlow {
  let inCents = 0;
  let outCents = 0;
  for (const e of entries) {
    if (monthOf(e.occurredOn) !== month) continue;
    if (e.direction === "in") inCents += e.amountCents;
    else if (e.direction === "out") outCents += e.amountCents;
  }
  const netCents = inCents - outCents;
  return {
    month,
    inCents,
    outCents,
    netCents,
    savingsRate: inCents === 0 ? null : netCents / inCents,
  };
}

export function flowSeries(entries: Entry[], months: string[]): MonthFlow[] {
  return months.map((m) => flowForMonth(entries, m));
}

/** Spending per category for one month, largest first. Only `out` entries count. */
export function categoryTotals(
  entries: Entry[],
  month: string,
  direction: "in" | "out" = "out",
): Array<{ categoryId: string | null; cents: number }> {
  const totals = new Map<string | null, number>();
  for (const e of entries) {
    if (e.direction !== direction) continue;
    if (monthOf(e.occurredOn) !== month) continue;
    totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amountCents);
  }
  return [...totals.entries()]
    .map(([categoryId, cents]) => ({ categoryId, cents }))
    .sort((a, b) => b.cents - a.cents);
}

/**
 * Collapse a long tail into one "Other" bucket, so a chart never needs a
 * generated colour for its ninth series.
 */
export function withOther<T extends { cents: number }>(
  rows: T[],
  keep: number,
): { top: T[]; otherCents: number } {
  if (rows.length <= keep) return { top: rows, otherCents: 0 };
  return { top: rows.slice(0, keep), otherCents: sum(rows.slice(keep).map((r) => r.cents)) };
}

/**
 * An account's balance: its opening figure, plus everything that landed in it,
 * minus everything that left it. Transfers move between two accounts, so they
 * subtract from one side and add to the other.
 */
export function accountBalanceCents(account: Account, entries: Entry[], asOf?: string): number {
  let balance = account.openingCents;
  for (const e of entries) {
    if (asOf && e.occurredOn > asOf) continue;
    if (e.direction === "in" && e.accountId === account.id) balance += e.amountCents;
    else if (e.direction === "out" && e.accountId === account.id) balance -= e.amountCents;
    else if (e.direction === "transfer") {
      if (e.accountId === account.id) balance -= e.amountCents;
      if (e.toAccountId === account.id) balance += e.amountCents;
    }
  }
  return balance;
}

export interface ProgressContext {
  entries: Entry[];
  assets: Asset[];
  liabilities: Liability[];
  accounts: Account[];
  /** Today, as YYYY-MM-DD. Passed in so results are deterministic and testable. */
  today: string;
}

/**
 * How far along a target is, and whether the current pace gets there in time.
 *
 * `pacePerMonthCents` is the average progress over the last three complete
 * months. `requiredPerMonthCents` is what's left divided by the months left. A
 * target is flagged for attention when the first is below the second.
 */
export function targetProgress(target: Target, ctx: ProgressContext): TargetProgress {
  const thisMonth = monthOf(ctx.today);

  let currentCents: number;
  let goalCents = target.amountCents;

  switch (target.kind) {
    case "save_to":
      currentCents = savedToward(target, ctx);
      break;
    case "pay_off": {
      const liability = ctx.liabilities.find((l) => l.id === target.liabilityId);
      const baseline = target.baselineCents > 0 ? target.baselineCents : target.amountCents;
      currentCents = baseline - (liability?.balanceCents ?? 0);
      goalCents = baseline;
      break;
    }
    case "spend_under":
      currentCents = spentInCategory(target, ctx, thisMonth);
      break;
    case "net_worth":
      currentCents = netWorthCents(ctx.assets, ctx.liabilities);
      break;
  }

  const ratioValue = goalCents === 0 ? 0 : currentCents / goalCents;
  const fraction = Math.max(0, Math.min(1, ratioValue));
  const remainingCents = Math.max(0, goalCents - currentCents);

  const monthsRemaining = target.deadline ? monthsUntil(ctx.today, target.deadline) : null;
  const requiredPerMonthCents =
    monthsRemaining === null
      ? null
      : remainingCents === 0
        ? 0
        : Math.ceil(remainingCents / Math.max(1, monthsRemaining));

  const pacePerMonthCents =
    target.kind === "spend_under" ? null : recentPacePerMonth(target, ctx, thisMonth);

  return {
    targetId: target.id,
    currentCents,
    goalCents,
    remainingCents,
    fraction,
    ratio: ratioValue,
    status: statusFor(target, ratioValue, requiredPerMonthCents, pacePerMonthCents),
    requiredPerMonthCents,
    pacePerMonthCents,
    monthsRemaining,
  };
}

function statusFor(
  target: Target,
  ratioValue: number,
  required: number | null,
  pace: number | null,
): TargetStatus {
  if (target.kind === "spend_under") {
    if (ratioValue > 1) return "over";
    if (ratioValue >= SPEND_CAP_WARNING) return "attention";
    return "on_track";
  }
  if (ratioValue >= 1) return "reached";
  if (required !== null && pace !== null && pace < required) return "attention";
  return "on_track";
}

/**
 * How much has been saved toward a target.
 *
 * A linked account wins: if you said "this goal lives in my savings account",
 * that account's balance *is* the progress, including money that was there
 * before the goal existed. Tagged entries are the fallback for a goal with no
 * account of its own, and they still drive the pace calculation either way.
 */
function savedToward(target: Target, ctx: ProgressContext): number {
  const account = ctx.accounts.find((a) => a.id === target.accountId);
  if (account) return accountBalanceCents(account, ctx.entries, ctx.today);

  const tagged = ctx.entries.filter((e) => e.targetId === target.id);
  if (tagged.length > 0) return sum(tagged.map(contributionOf));
  return 0;
}

/** A tagged entry adds when money arrives or moves in, and subtracts when it leaves. */
function contributionOf(entry: Entry): number {
  return entry.direction === "out" ? -entry.amountCents : entry.amountCents;
}

function spentInCategory(target: Target, ctx: ProgressContext, month: string): number {
  return sum(
    ctx.entries
      .filter(
        (e) =>
          e.direction === "out" &&
          e.categoryId === target.categoryId &&
          monthOf(e.occurredOn) === month,
      )
      .map((e) => e.amountCents),
  );
}

/** Average monthly progress over the three complete months before this one. */
function recentPacePerMonth(target: Target, ctx: ProgressContext, thisMonth: string): number | null {
  const window = [addMonths(thisMonth, -3), addMonths(thisMonth, -2), addMonths(thisMonth, -1)];

  if (target.kind === "net_worth") {
    // Net worth history isn't stored, so pace comes from what you kept each month.
    const kept = window.map((m) => flowForMonth(ctx.entries, m).netCents);
    return kept.some((n) => n !== 0) ? Math.round(sum(kept) / window.length) : null;
  }

  const relevant = ctx.entries.filter((e) => {
    if (!window.includes(monthOf(e.occurredOn))) return false;
    if (e.targetId === target.id) return true;
    if (target.kind === "save_to" && target.accountId) {
      return e.direction === "transfer" && e.toAccountId === target.accountId;
    }
    if (target.kind === "pay_off" && target.liabilityId) {
      return e.direction === "out" && e.targetId === target.id;
    }
    return false;
  });

  if (relevant.length === 0) return null;
  return Math.round(sum(relevant.map((e) => Math.abs(contributionOf(e)))) / window.length);
}

/**
 * An estimated net-worth trend.
 *
 * Nothing stores historical net worth, so the line is traced backwards from
 * today's figure through each month's net flow. That captures money saved and
 * money spent, but NOT revaluations — a portfolio that rose on its own, or a car
 * that depreciated, is invisible to it. Label it as an estimate wherever it is
 * shown, and treat the last point (today, measured directly) as the only exact one.
 */
export function netWorthTrend(
  currentNetWorthCents: number,
  entries: Entry[],
  months: string[],
): number[] {
  const trend = new Array<number>(months.length);
  let running = currentNetWorthCents;
  for (let i = months.length - 1; i >= 0; i--) {
    trend[i] = running;
    running -= flowForMonth(entries, months[i]!).netCents;
  }
  return trend;
}

/** Liabilities ordered by what they cost to carry — the cheapest way to pick what to clear first. */
export function byCarryingCost(liabilities: Liability[]): Array<Liability & { monthlyInterestCents: number }> {
  return liabilities
    .filter(live)
    .map((l) => ({
      ...l,
      monthlyInterestCents: l.aprBps === null
        ? 0
        : Math.round((l.balanceCents * l.aprBps) / 10_000 / 12),
    }))
    .sort((a, b) => b.monthlyInterestCents - a.monthlyInterestCents);
}

function live(x: { archived: boolean }): boolean {
  return !x.archived;
}

function sum(numbers: number[]): number {
  return numbers.reduce((total, n) => total + n, 0);
}
