/**
 * Fills a local database with six months of plausible sample data, so you can
 * see the app populated before typing your own figures in.
 *
 * It writes straight to SQLite, so it does not need a passphrase. It refuses to
 * run against a database that already holds entries.
 *
 *   npm run seed            # fill
 *   npm run seed -- --reset # wipe what's there first
 */

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import type { Db } from "../src/server/db/driver.js";
import { ensureSchema } from "../src/server/db/migrations.js";
import * as repo from "../src/server/db/repo.js";
import { addMonths, currentMonth } from "../src/shared/dates.js";

try {
  process.loadEnvFile(".env");
} catch {
  // Defaults below are fine.
}

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FILE = resolve(ROOT, process.env.DATABASE_FILE ?? "./data/finance.sqlite");
const reset = process.argv.includes("--reset");

mkdirSync(dirname(FILE), { recursive: true });
const sqlite = new Database(FILE);
sqlite.pragma("foreign_keys = ON");

const db: Db = {
  async all<T>(sql: string, params: unknown[] = []) {
    return sqlite.prepare(sql).all(...normalise(params)) as T[];
  },
  async get<T>(sql: string, params: unknown[] = []) {
    return sqlite.prepare(sql).get(...normalise(params)) as T | undefined;
  },
  async run(sql: string, params: unknown[] = []) {
    sqlite.prepare(sql).run(...normalise(params));
  },
};

function normalise(params: unknown[]): unknown[] {
  return params.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
}

await ensureSchema(db);

if (reset) {
  for (const table of ["entries", "targets", "assets", "liabilities", "accounts", "sources"]) {
    await db.run(`DELETE FROM ${table}`);
  }
  console.log("Cleared existing data.");
}

const existing = await repo.countEntries(db);
if (existing > 0) {
  console.error(
    `\nThis database already has ${existing} entries. Run \`npm run seed -- --reset\` to replace them.\n`,
  );
  process.exit(1);
}

const month = currentMonth();
const day = (monthOffset: number, dayOfMonth: number) =>
  `${addMonths(month, monthOffset)}-${String(dayOfMonth).padStart(2, "0")}`;

/* -------------------------------- accounts -------------------------------- */

const checking = await repo.createAccount(db, {
  name: "Chase Checking", kind: "checking", currency: "USD", openingCents: 482015, archived: false,
});
const savings = await repo.createAccount(db, {
  name: "Capital One 360 Savings", kind: "savings", currency: "USD", openingCents: 1240000, archived: false,
});
const brokerage = await repo.createAccount(db, {
  name: "Fidelity Brokerage", kind: "brokerage", currency: "USD", openingCents: 0, archived: false,
});
const cash = await repo.createAccount(db, {
  name: "Cash on hand", kind: "cash", currency: "USD", openingCents: 34000, archived: false,
});

const salary = await repo.createSource(db, "Job");
const freelance = await repo.createSource(db, "Content");
const dividends = await repo.createSource(db, "Fidelity");

/* ----------------------------- what you own/owe ---------------------------- */

await repo.createAsset(db, {
  name: "Fidelity Brokerage", kind: "investment", valueCents: 6231044,
  valuedOn: day(0, 15), accountId: brokerage.id, archived: false,
});
await repo.createAsset(db, {
  name: "Roth IRA", kind: "investment", valueCents: 3175000, valuedOn: day(0, 15),
  accountId: null, archived: false,
});
await repo.createAsset(db, {
  name: "Capital One 360 Savings", kind: "cash", valueCents: 1840000, valuedOn: day(0, 16),
  accountId: savings.id, archived: false,
});
await repo.createAsset(db, {
  name: "2019 Honda Civic", kind: "vehicle", valueCents: 1420000, valuedOn: day(-1, 1),
  accountId: null, archived: false,
});
await repo.createAsset(db, {
  name: "Chase Checking", kind: "cash", valueCents: 482015, valuedOn: day(0, 17),
  accountId: checking.id, archived: false,
});
await repo.createAsset(db, {
  name: "Cash on hand", kind: "cash", valueCents: 34000, valuedOn: day(0, 17),
  accountId: cash.id, archived: false,
});

const studentLoan = await repo.createLiability(db, {
  name: "Student loan — Nelnet", kind: "loan", balanceCents: 1894000,
  aprBps: 499, minPaymentCents: 21200, dueDay: 15, archived: false,
});
await repo.createLiability(db, {
  name: "Auto loan — Honda", kind: "loan", balanceCents: 731000,
  aprBps: 340, minPaymentCents: 28800, dueDay: 7, archived: false,
});
const card = await repo.createLiability(db, {
  name: "Sapphire credit card", kind: "credit_card", balanceCents: 214088,
  aprBps: 2124, minPaymentCents: 6500, dueDay: 3, archived: false,
});
await repo.createLiability(db, {
  name: "Capital One Quicksilver", kind: "credit_card", balanceCents: 87450,
  aprBps: 2699, minPaymentCents: 3500, dueDay: 18, archived: false,
});
await repo.createLiability(db, {
  name: "Afterpay", kind: "bnpl", balanceCents: 21600,
  aprBps: null, minPaymentCents: 5400, dueDay: 12, archived: false,
});
await repo.createLiability(db, {
  name: "Cash App borrow", kind: "person", balanceCents: 7500,
  aprBps: null, minPaymentCents: null, dueDay: null, archived: false,
});

/* --------------------------------- targets -------------------------------- */

const emergencyFund = await repo.createTarget(db, {
  name: "Emergency fund", kind: "save_to", amountCents: 2500000,
  deadline: `${addMonths(month, 9)}-01`, accountId: savings.id,
  liabilityId: null, categoryId: null, baselineCents: 0, archived: false,
});
const clearCard = await repo.createTarget(db, {
  name: "Pay off the Sapphire card", kind: "pay_off", amountCents: 490000,
  deadline: `${addMonths(month, 6)}-01`, accountId: null,
  liabilityId: card.id, categoryId: null, baselineCents: 490000, archived: false,
});
await repo.createTarget(db, {
  name: "Dining-out cap", kind: "spend_under", amountCents: 40000, deadline: null,
  accountId: null, liabilityId: null, categoryId: "cat_dining", baselineCents: 0, archived: false,
});
await repo.createTarget(db, {
  name: "Reach $150,000 net worth", kind: "net_worth", amountCents: 15000000,
  deadline: `${addMonths(month, 27)}-01`, accountId: null,
  liabilityId: null, categoryId: null, baselineCents: 0, archived: false,
});

/* ------------------------------ recurring rules --------------------------- */

// Two separate Fidelity pulls: a fixed fifty every fortnight that the broker
// takes by itself, and a weekly one whose size changes, so it waits to be told.
await repo.createSchedule(db, {
  name: "Fidelity \u2014 $50 automatic", direction: "transfer", amountCents: 5000,
  cadence: "biweekly", anchorDate: day(-1, 4), nextDue: day(0, 4), autoPost: true,
  payee: "Fidelity", reason: "Automatic investment",
  accountId: checking.id, toAccountId: brokerage.id,
  categoryId: null, sourceId: null, targetId: null, liabilityId: null, archived: false,
});
await repo.createSchedule(db, {
  name: "Fidelity \u2014 weekly transfer", direction: "transfer", amountCents: null,
  cadence: "weekly", anchorDate: day(0, 7), nextDue: day(0, 7), autoPost: false,
  payee: "Fidelity", reason: "Whatever is spare that week",
  accountId: checking.id, toAccountId: brokerage.id,
  categoryId: null, sourceId: null, targetId: null, liabilityId: null, archived: false,
});
await repo.createSchedule(db, {
  name: "Paycheque", direction: "in", amountCents: 371000,
  cadence: "biweekly", anchorDate: day(-1, 2), nextDue: day(0, 16), autoPost: true,
  payee: "Job", reason: "Salary",
  accountId: checking.id, toAccountId: null,
  categoryId: "cat_salary", sourceId: salary.id, targetId: null, liabilityId: null, archived: false,
});
await repo.createSchedule(db, {
  name: "Rent", direction: "out", amountCents: 185000,
  cadence: "monthly", anchorDate: day(-1, 11), nextDue: day(0, 11), autoPost: false,
  payee: "Rent \u2014 Halsey St", reason: "Monthly rent",
  accountId: checking.id, toAccountId: null,
  categoryId: "cat_housing", sourceId: null, targetId: null, liabilityId: null, archived: false,
});
await repo.createSchedule(db, {
  name: "Emergency fund top-up", direction: "transfer", amountCents: 60000,
  cadence: "monthly", anchorDate: day(-1, 15), nextDue: day(0, 15), autoPost: true,
  payee: "Capital One 360", reason: "Monthly top-up",
  accountId: checking.id, toAccountId: savings.id,
  categoryId: null, sourceId: null, targetId: emergencyFund.id, liabilityId: null, archived: false,
});

/* --------------------------------- entries -------------------------------- */

interface Seed {
  direction: "in" | "out" | "transfer";
  cents: number;
  dayOfMonth: number;
  payee: string;
  reason: string;
  categoryId?: string;
  accountId?: string;
  toAccountId?: string;
  sourceId?: string;
  targetId?: string;
  repeat?: "monthly";
}

/** One month's rhythm, varied slightly per month so the charts aren't flat. */
function monthOfEntries(nudge: number): Seed[] {
  return [
    { direction: "in", cents: 371000, dayOfMonth: 16, payee: "Northwind Labs", reason: "Salary — second half", categoryId: "cat_salary", accountId: checking.id, sourceId: salary.id, repeat: "monthly" },
    { direction: "in", cents: 371000, dayOfMonth: 2, payee: "Northwind Labs", reason: "Salary — first half", categoryId: "cat_salary", accountId: checking.id, sourceId: salary.id, repeat: "monthly" },
    { direction: "in", cents: 120000 + nudge * 1000, dayOfMonth: 14, payee: "Meridian Studio", reason: "Design retainer", categoryId: "cat_freelance", accountId: checking.id, sourceId: freelance.id },
    { direction: "in", cents: 21432, dayOfMonth: 10, payee: "Fidelity", reason: "Dividend distribution", categoryId: "cat_dividends", accountId: brokerage.id, sourceId: dividends.id },
    { direction: "out", cents: 185000, dayOfMonth: 11, payee: "Rent — Halsey St", reason: "Monthly rent", categoryId: "cat_housing", accountId: checking.id, repeat: "monthly" },
    { direction: "out", cents: 14218 + nudge * 400, dayOfMonth: 17, payee: "Whole Foods Market", reason: "Weekly shop", categoryId: "cat_groceries", accountId: checking.id },
    { direction: "out", cents: 8742, dayOfMonth: 8, payee: "Trader Joe's", reason: "Groceries for the week", categoryId: "cat_groceries", accountId: checking.id },
    { direction: "out", cents: 21200, dayOfMonth: 15, payee: "Nelnet", reason: "Student loan payment", categoryId: "cat_debt", accountId: checking.id, targetId: undefined, repeat: "monthly" },
    { direction: "out", cents: 28800, dayOfMonth: 7, payee: "Honda Financial", reason: "Auto loan payment", categoryId: "cat_debt", accountId: checking.id, repeat: "monthly" },
    { direction: "out", cents: 35300 + nudge * 900, dayOfMonth: 9, payee: "Sapphire Card", reason: "Statement payment", categoryId: "cat_debt", accountId: checking.id, targetId: clearCard.id },
    { direction: "out", cents: 9675, dayOfMonth: 12, payee: "Con Edison", reason: "Electricity", categoryId: "cat_utilities", accountId: checking.id, repeat: "monthly" },
    { direction: "out", cents: 11000, dayOfMonth: 6, payee: "Verizon", reason: "Phone and home internet", categoryId: "cat_utilities", accountId: checking.id, repeat: "monthly" },
    { direction: "out", cents: 5840 + nudge * 300, dayOfMonth: 13, payee: "Shell — Atlantic Ave", reason: "Fuel", categoryId: "cat_transport", accountId: checking.id },
    { direction: "out", cents: 12000, dayOfMonth: 4, payee: "MTA", reason: "Monthly transit pass", categoryId: "cat_transport", accountId: checking.id, repeat: "monthly" },
    { direction: "out", cents: 1999, dayOfMonth: 17, payee: "Spotify", reason: "Family plan", categoryId: "cat_subscriptions", accountId: checking.id, repeat: "monthly" },
    { direction: "out", cents: 31800 + nudge * 2100, dayOfMonth: 5, payee: "Restaurants", reason: "Eating out this month", categoryId: "cat_dining", accountId: checking.id },
    { direction: "out", cents: 24000 + nudge * 1500, dayOfMonth: 3, payee: "Sundries", reason: "Bits and pieces", categoryId: "cat_other_out", accountId: checking.id },
    { direction: "transfer", cents: 60000 + nudge * 2000, dayOfMonth: 15, payee: "Ally Savings", reason: "Emergency fund top-up", accountId: checking.id, toAccountId: savings.id, targetId: emergencyFund.id, repeat: "monthly" },
  ];
}

let created = 0;
// Oldest month first, and skip days that haven't happened yet in the current month.
const todayDayOfMonth = new Date().getUTCDate();

for (let offset = 5; offset >= 0; offset--) {
  const nudge = [3, -2, 5, -1, 2, 0][offset] ?? 0;
  for (const seed of monthOfEntries(nudge)) {
    if (offset === 0 && seed.dayOfMonth > todayDayOfMonth) continue;
    await repo.createEntry(db, {
      direction: seed.direction,
      amountCents: Math.max(1, seed.cents),
      occurredOn: day(-offset, seed.dayOfMonth),
      payee: seed.payee,
      reason: seed.reason,
      accountId: seed.accountId ?? null,
      toAccountId: seed.toAccountId ?? null,
      categoryId: seed.direction === "transfer" ? null : (seed.categoryId ?? null),
      sourceId: seed.sourceId ?? null,
      targetId: seed.targetId ?? null,
      repeatRule: seed.repeat ?? null,
      isAdjustment: false,
      scheduleId: null,
    });
    created++;
  }
}

void studentLoan;

console.log(`\nSeeded ${created} entries across 6 months, 4 accounts, 6 assets, 6 debts, 4 targets, 5 recurring rules.`);
console.log(`Database: ${FILE}`);
console.log(`\nNow run \`npm run dev\` and set a passphrase.\n`);
