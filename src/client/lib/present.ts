/** Presentation helpers: the mapping from data to the design system's vocabulary. */

import type { AssetKind, Direction, LiabilityKind, TargetKind, TargetStatus } from "@shared/types.js";
import type { IconName } from "./icons.js";

/**
 * The categorical slots, in the fixed order they were validated in. Assigned in
 * sequence and never cycled: a ninth series folds into "Other" instead.
 */
export const SERIES = [
  "var(--series-1)", "var(--series-2)", "var(--series-3)",
  "var(--series-4)", "var(--series-5)", "var(--series-6)",
] as const;

export const COLOR = {
  in: "var(--series-1)",
  out: "var(--series-2)",
  transfer: "var(--ink-3)",
  investment: "var(--series-3)",
  cash: "var(--series-4)",
  property: "var(--series-5)",
  liability: "var(--series-6)",
} as const;

export function seriesColor(index: number): string {
  return SERIES[index % SERIES.length] ?? SERIES[0];
}

/** A dimmed step of a fill's own hue, for the unfilled part of a meter or bar track. */
export function track(color: string): string {
  return `color-mix(in srgb, ${color} 20%, var(--card))`;
}

/** A soft wash of a hue, for icon tiles and status chips. */
export function wash(color: string): string {
  return `color-mix(in srgb, ${color} 18%, var(--card))`;
}

export function directionColor(direction: Direction): string {
  return COLOR[direction];
}

export function directionIcon(direction: Direction): IconName {
  return direction === "in" ? "upRight" : direction === "out" ? "downLeft" : "repeat";
}

/** Status is never colour alone: every one of these ships with an icon and a word. */
export function statusChip(status: TargetStatus): { label: string; color: string; icon: IconName } {
  switch (status) {
    case "reached":
      return { label: "Reached", color: "var(--up)", icon: "check" };
    case "on_track":
      return { label: "On track", color: "var(--up)", icon: "check" };
    case "attention":
      return { label: "Needs attention", color: "var(--warn)", icon: "alert" };
    case "over":
      return { label: "Over", color: "var(--down)", icon: "alert" };
  }
}

const TARGET_LABELS: Record<TargetKind, { label: string; icon: IconName; color: string }> = {
  save_to: { label: "Save to a target", icon: "seed", color: "var(--series-1)" },
  pay_off: { label: "Clear a debt", icon: "card", color: "var(--series-2)" },
  spend_under: { label: "Stay under a monthly cap", icon: "tag", color: "var(--warn)" },
  net_worth: { label: "Grow net worth", icon: "target", color: "var(--series-3)" },
};

export function targetKind(kind: TargetKind) {
  return TARGET_LABELS[kind];
}

const ASSET_ICONS: Record<AssetKind, IconName> = {
  cash: "wallet",
  investment: "chart",
  property: "home",
  vehicle: "car",
  other: "tag",
};

export function assetIcon(kind: AssetKind): IconName {
  return ASSET_ICONS[kind];
}

const LIABILITY_ICONS: Record<LiabilityKind, IconName> = {
  credit_card: "card",
  bnpl: "repeat",
  loan: "bank",
  mortgage: "home",
  line_of_credit: "card",
  person: "note",
  other: "tag",
};

export function liabilityIcon(kind: LiabilityKind): IconName {
  return LIABILITY_ICONS[kind];
}

export const ASSET_KIND_LABELS: Record<AssetKind, string> = {
  cash: "Cash",
  investment: "Investment",
  property: "Property",
  vehicle: "Vehicle",
  other: "Other",
};

export const LIABILITY_KIND_LABELS: Record<LiabilityKind, string> = {
  credit_card: "Credit card",
  bnpl: "Buy now, pay later",
  loan: "Loan",
  mortgage: "Mortgage",
  line_of_credit: "Line of credit",
  person: "Owed to a person or app",
  other: "Other",
};

export const CADENCE_LABELS = {
  weekly: "Every week",
  biweekly: "Every two weeks",
  monthly: "Every month",
} as const;

/** "That is about $217 a month" — the figure that makes two cadences comparable. */
export function monthlyHint(amountCents: number, cadence: keyof typeof CADENCE_LABELS): string {
  const perMonth =
    cadence === "weekly"
      ? Math.round((amountCents * 52) / 12)
      : cadence === "biweekly"
        ? Math.round((amountCents * 26) / 12)
        : amountCents;
  const dollars = (perMonth / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return cadence === "monthly" ? "" : `About $${dollars} a month.`;
}

export const CADENCE_SHORT = {
  weekly: "weekly",
  biweekly: "every 2 weeks",
  monthly: "monthly",
} as const;

export const ACCOUNT_KIND_LABELS = {
  checking: "Checking",
  savings: "Savings",
  cash: "Cash",
  brokerage: "Brokerage",
  credit_card: "Credit card",
} as const;

export const DIRECTION_LABELS: Record<Direction, string> = {
  in: "Money in",
  out: "Money out",
  transfer: "Transfer",
};

/** 0.745 -> "75%". Rounds for display only. */
export function percent(fraction: number | null, digits = 0): string {
  if (fraction === null || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Group which asset kinds share a colour slot in the composition bar. */
export function assetGroup(kind: AssetKind): { label: string; color: string } {
  switch (kind) {
    case "investment":
      return { label: "Investments", color: COLOR.investment };
    case "cash":
      return { label: "Cash", color: COLOR.cash };
    case "property":
    case "vehicle":
      return { label: "Property & vehicles", color: COLOR.property };
    default:
      return { label: "Other", color: "var(--ink-3)" };
  }
}
