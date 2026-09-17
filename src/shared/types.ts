/** Shared shapes. Every monetary value in this app is an integer number of cents. */

export type Direction = "in" | "out" | "transfer";

export type AccountKind = "checking" | "savings" | "cash" | "brokerage" | "credit_card";
export type AssetKind = "cash" | "investment" | "property" | "vehicle" | "other";
export type LiabilityKind = "credit_card" | "loan" | "mortgage" | "other";
export type TargetKind = "save_to" | "pay_off" | "spend_under" | "net_worth";

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  currency: string;
  openingCents: number;
  archived: boolean;
}

export interface Source {
  id: string;
  name: string;
  archived: boolean;
}

export interface Category {
  id: string;
  name: string;
  direction: Exclude<Direction, "transfer">;
  archived: boolean;
}

export interface Entry {
  id: string;
  direction: Direction;
  amountCents: number;
  /** ISO calendar date, YYYY-MM-DD. */
  occurredOn: string;
  payee: string;
  reason: string;
  /** `out`: paid from. `in`: deposited into. `transfer`: moved from. */
  accountId: string | null;
  /** `transfer` only: moved into. */
  toAccountId: string | null;
  categoryId: string | null;
  sourceId: string | null;
  /** Optional target this entry counts toward. */
  targetId: string | null;
  repeatRule: "monthly" | "weekly" | "yearly" | null;
}

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  valueCents: number;
  valuedOn: string;
  /** Set when this asset simply *is* an account's balance, so it is never double-counted. */
  accountId: string | null;
  archived: boolean;
}

export interface Liability {
  id: string;
  name: string;
  kind: LiabilityKind;
  balanceCents: number;
  /** Basis points, so 21.24% is 2124. Avoids floats on rates too. */
  aprBps: number | null;
  minPaymentCents: number | null;
  dueDay: number | null;
  archived: boolean;
}

export interface Target {
  id: string;
  name: string;
  kind: TargetKind;
  /** save_to / net_worth: the figure to reach. pay_off: the balance to clear. spend_under: the monthly cap. */
  amountCents: number;
  deadline: string | null;
  accountId: string | null;
  liabilityId: string | null;
  categoryId: string | null;
  /** pay_off only: what the balance was when you started, so progress has a denominator. */
  baselineCents: number;
  archived: boolean;
}

export type TargetStatus = "reached" | "on_track" | "attention" | "over";

export interface TargetProgress {
  targetId: string;
  currentCents: number;
  goalCents: number;
  remainingCents: number;
  /** 0..1, clamped. `ratio` is the unclamped version. */
  fraction: number;
  ratio: number;
  status: TargetStatus;
  requiredPerMonthCents: number | null;
  pacePerMonthCents: number | null;
  monthsRemaining: number | null;
}

export interface MonthFlow {
  month: string;
  inCents: number;
  outCents: number;
  netCents: number;
  /** Share of money in that you kept, 0..1. Negative when you overspent. Null when nothing came in. */
  savingsRate: number | null;
}
