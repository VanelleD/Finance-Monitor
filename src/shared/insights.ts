/**
 * Observations drawn from your own numbers.
 *
 * These are facts about the ledger, not advice: what a debt costs to carry, how
 * close a cap is, what is due soon. Everything here is computed locally from
 * data the app already holds — nothing is sent anywhere, and the same input
 * always produces the same output.
 */

import type {
  Account, Category, DueOccurrence, Entry, Liability, Target,
} from "./types.js";
import { byCarryingCost, flowForMonth, targetProgress } from "./derive.js";
import { addMonths, daysLeftInMonth, monthOf } from "./dates.js";
import { formatCents } from "./money.js";

export type Tone = "urgent" | "watch" | "good" | "neutral";

export interface Insight {
  id: string;
  tone: Tone;
  text: string;
}

export interface InsightContext {
  today: string;
  entries: Entry[];
  accounts: Account[];
  balances: Record<string, number>;
  liabilities: Liability[];
  targets: Target[];
  categories: Category[];
  due: DueOccurrence[];
}

/** Most pressing first, so a short list still shows what matters. */
const TONE_ORDER: Record<Tone, number> = { urgent: 0, watch: 1, good: 2, neutral: 3 };

export function insightsFor(ctx: InsightContext, limit = 3): Insight[] {
  const found: Insight[] = [
    ...capsUnderPressure(ctx),
    ...paymentsComingUp(ctx),
    ...spendingMoreThanCameIn(ctx),
    ...accountRunningLow(ctx),
    ...costliestDebt(ctx),
    ...targetsReached(ctx),
    ...savingsRateMoved(ctx),
  ];

  return found
    .sort((a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone])
    .slice(0, limit);
}

/** A monthly cap that is close to spent, with the days left to judge it by. */
function capsUnderPressure(ctx: InsightContext): Insight[] {
  return ctx.targets
    .filter((target) => !target.archived && target.kind === "spend_under")
    .flatMap((target): Insight[] => {
      const progress = targetProgress(target, { ...ctx, assets: [] });
      if (progress.status === "on_track") return [];

      const daysLeft = daysLeftInMonth(ctx.today);
      const over = progress.ratio > 1;
      return [{
        id: `cap:${target.id}`,
        tone: over ? ("urgent" as const) : ("watch" as const),
        text: over
          ? `You're ${formatCents(progress.currentCents - progress.goalCents)} over your ${target.name.toLowerCase()}, with ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in the month.`
          : `${formatCents(progress.remainingCents)} left on your ${target.name.toLowerCase()} — ${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go.`,
      }];
    });
}

/** A minimum payment falling due within the next few days. */
function paymentsComingUp(ctx: InsightContext): Insight[] {
  const dayOfMonth = Number(ctx.today.slice(8, 10));

  return ctx.liabilities
    .filter((l) => !l.archived && l.dueDay !== null && l.minPaymentCents !== null)
    .flatMap((liability): Insight[] => {
      const daysAway = liability.dueDay! - dayOfMonth;
      if (daysAway < 0 || daysAway > 5) return [];
      return [{
        id: `due:${liability.id}`,
        tone: daysAway <= 2 ? ("urgent" as const) : ("watch" as const),
        text:
          daysAway === 0
            ? `${liability.name}'s ${formatCents(liability.minPaymentCents!)} minimum is due today.`
            : `${liability.name}'s ${formatCents(liability.minPaymentCents!)} minimum is due in ${daysAway} ${daysAway === 1 ? "day" : "days"}.`,
      }];
    });
}

function spendingMoreThanCameIn(ctx: InsightContext): Insight[] {
  const month = monthOf(ctx.today);
  const flow = flowForMonth(ctx.entries, month);
  if (flow.netCents >= 0 || flow.inCents === 0) return [];

  return [{
    id: "overspent",
    tone: "urgent",
    text: `You've spent ${formatCents(-flow.netCents)} more than came in this month.`,
  }];
}

/** Under a week of typical spending left in an account. */
function accountRunningLow(ctx: InsightContext): Insight[] {
  const month = monthOf(ctx.today);
  const spentThisMonth = flowForMonth(ctx.entries, month).outCents;
  if (spentThisMonth === 0) return [];
  const weekly = Math.round(spentThisMonth / 4);

  return ctx.accounts
    .filter((a) => !a.archived && a.kind !== "credit_card")
    .flatMap((account): Insight[] => {
      const balance = ctx.balances[account.id] ?? account.openingCents;
      if (balance < 0) {
        return [{
          id: `overdrawn:${account.id}`,
          tone: "urgent" as const,
          text: `${account.name} is overdrawn by ${formatCents(-balance)}.`,
        }];
      }
      if (weekly === 0 || balance >= weekly) return [];
      return [{
        id: `low:${account.id}`,
        tone: "watch" as const,
        text: `${account.name} is down to ${formatCents(balance)} — under a week at your usual rate.`,
      }];
    });
}

/** Which debt costs the most to carry, which is the one worth clearing first. */
function costliestDebt(ctx: InsightContext): Insight[] {
  const ranked = byCarryingCost(ctx.liabilities);
  const worst = ranked[0];
  if (!worst || worst.monthlyInterestCents < 100) return [];
  if (ranked.length < 2) return [];

  return [{
    id: `carry:${worst.id}`,
    tone: "neutral",
    text: `${worst.name} costs ${formatCents(worst.monthlyInterestCents)} a month in interest — more than any other debt you have.`,
  }];
}

function targetsReached(ctx: InsightContext): Insight[] {
  return ctx.targets
    .filter((t) => !t.archived && t.kind !== "spend_under")
    .flatMap((target): Insight[] => {
      const progress = targetProgress(target, { ...ctx, assets: [] });
      if (progress.status !== "reached") return [];
      return [{
        id: `reached:${target.id}`,
        tone: "good" as const,
        text: `${target.name} has hit its target.`,
      }];
    });
}

/** How much of what came in you kept, against last month. */
function savingsRateMoved(ctx: InsightContext): Insight[] {
  const month = monthOf(ctx.today);
  const now = flowForMonth(ctx.entries, month);
  const before = flowForMonth(ctx.entries, addMonths(month, -1));
  if (now.savingsRate === null || before.savingsRate === null) return [];

  const points = Math.round((now.savingsRate - before.savingsRate) * 100);
  if (Math.abs(points) < 5) return [];

  return [{
    id: "savings-rate",
    tone: points > 0 ? "good" : "watch",
    text:
      points > 0
        ? `You've kept ${Math.round(now.savingsRate * 100)}% of what came in — ${points} points better than last month.`
        : `You've kept ${Math.round(now.savingsRate * 100)}% of what came in — ${Math.abs(points)} points down on last month.`,
  }];
}

/** Morning until noon, afternoon until six, evening after that. */
export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
