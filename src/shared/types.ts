/** Shared shapes. Every monetary value in this app is an integer number of cents. */

export type Direction = "in" | "out" | "transfer";

export type AccountKind = "checking" | "savings" | "cash" | "brokerage" | "credit_card";
export type AssetKind = "cash" | "investment" | "property" | "vehicle" | "other";
export type LiabilityKind =
  | "credit_card"
  | "bnpl"
  | "loan"
  | "mortgage"
  | "line_of_credit"
  | "person"
  | "other";

/** How often a recurring rule fires. */
export type Cadence = "weekly" | "biweekly" | "monthly";
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
  /**
   * True when this entry exists only to make a stated balance true. It moves the
   * account balance but is neither income nor spending, so cash flow ignores it.
   */
  isAdjustment: boolean;
  /** The recurring rule that produced this entry, if any. */
  scheduleId: string | null;
}

/**
 * A recurring movement of money: a paycheque, a standing transfer, a bill.
 *
 * `amountCents` is null when the amount varies — then the occurrence still comes
 * due, but it waits for you to type the figure rather than inventing one.
 */
export interface Schedule {
  id: string;
  name: string;
  direction: Direction;
  amountCents: number | null;
  cadence: Cadence;
  /** The first occurrence. Every later one is counted from here, never from the last. */
  anchorDate: string;
  nextDue: string;
  /** True for transfers the bank makes by itself, which need no confirmation. */
  autoPost: boolean;
  payee: string;
  reason: string;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  sourceId: string | null;
  targetId: string | null;
  liabilityId: string | null;
  archived: boolean;
}

/** One occurrence of a schedule that is due but has not been recorded yet. */
export interface DueOccurrence {
  schedule: Schedule;
  occurredOn: string;
  /** Null when the schedule's amount varies and needs typing in. */
  amountCents: number | null;
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
