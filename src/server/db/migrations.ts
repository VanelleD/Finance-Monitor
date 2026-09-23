/**
 * Schema, as an ordered list of named steps.
 *
 * Kept in TypeScript rather than loose .sql files so the Worker bundle carries
 * it too (there is no filesystem up there). `ensureSchema` is idempotent, so it
 * is safe to call on every cold start and safe if two requests race.
 */

import type { Db } from "./driver.js";

export interface Migration {
  name: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    name: "0001_core",
    statements: [
      `CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('checking','savings','cash','brokerage','credit_card')),
        currency TEXT NOT NULL DEFAULT 'USD',
        opening_cents INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in','out')),
        archived INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('cash','investment','property','vehicle','other')),
        value_cents INTEGER NOT NULL,
        valued_on TEXT NOT NULL,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS liabilities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('credit_card','loan','mortgage','other')),
        balance_cents INTEGER NOT NULL,
        apr_bps INTEGER,
        min_payment_cents INTEGER,
        due_day INTEGER CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31)),
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS targets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('save_to','pay_off','spend_under','net_worth')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        deadline TEXT,
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        liability_id TEXT REFERENCES liabilities(id) ON DELETE SET NULL,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        baseline_cents INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY,
        direction TEXT NOT NULL CHECK (direction IN ('in','out','transfer')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        occurred_on TEXT NOT NULL,
        payee TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
        repeat_rule TEXT CHECK (repeat_rule IS NULL OR repeat_rule IN ('weekly','monthly','yearly')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        -- A transfer needs somewhere to go, and cannot go where it came from.
        CHECK (direction <> 'transfer' OR (to_account_id IS NOT NULL AND to_account_id <> account_id))
      )`,
      `CREATE INDEX IF NOT EXISTS entries_occurred_on ON entries (occurred_on DESC)`,
      `CREATE INDEX IF NOT EXISTS entries_direction ON entries (direction)`,
      `CREATE INDEX IF NOT EXISTS entries_category ON entries (category_id)`,
      `CREATE INDEX IF NOT EXISTS entries_account ON entries (account_id)`,
      `CREATE INDEX IF NOT EXISTS entries_target ON entries (target_id)`,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    name: "0002_default_categories",
    statements: [
      ...[
        ["cat_salary", "Salary", "in"],
        ["cat_freelance", "Freelance", "in"],
        ["cat_dividends", "Dividends", "in"],
        ["cat_interest", "Interest", "in"],
        ["cat_gift", "Gift", "in"],
        ["cat_refund", "Refund", "in"],
        ["cat_other_in", "Other income", "in"],
        ["cat_housing", "Housing", "out"],
        ["cat_groceries", "Groceries", "out"],
        ["cat_transport", "Transport", "out"],
        ["cat_utilities", "Utilities", "out"],
        ["cat_dining", "Dining out", "out"],
        ["cat_debt", "Debt payment", "out"],
        ["cat_health", "Health", "out"],
        ["cat_subscriptions", "Subscriptions", "out"],
        ["cat_shopping", "Shopping", "out"],
        ["cat_fun", "Fun", "out"],
        ["cat_other_out", "Other", "out"],
      ].map(
        ([id, name, direction]) =>
          `INSERT OR IGNORE INTO categories (id, name, direction, archived) VALUES ('${id}', '${name}', '${direction}', 0)`,
      ),
    ],
  },
  {
    name: "0003_accounts_debts_and_schedules",
    statements: [
      // SQLite cannot widen a CHECK constraint in place, so the table is rebuilt.
      // Adds the debts people actually carry: buy-now-pay-later, a line of
      // credit, and money owed to a person or a cash app.
      `CREATE TABLE IF NOT EXISTS liabilities_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('credit_card','bnpl','loan','mortgage','line_of_credit','person','other')),
        balance_cents INTEGER NOT NULL,
        apr_bps INTEGER,
        min_payment_cents INTEGER,
        due_day INTEGER CHECK (due_day IS NULL OR (due_day >= 1 AND due_day <= 31)),
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `INSERT INTO liabilities_new (id, name, kind, balance_cents, apr_bps, min_payment_cents, due_day, archived, created_at)
         SELECT id, name, kind, balance_cents, apr_bps, min_payment_cents, due_day, archived, created_at FROM liabilities`,
      `DROP TABLE liabilities`,
      `ALTER TABLE liabilities_new RENAME TO liabilities`,

      // A balance correction moves an account's balance without being income or
      // spending. Flagged so the savings rate cannot be distorted by one.
      `ALTER TABLE entries ADD COLUMN is_adjustment INTEGER NOT NULL DEFAULT 0`,

      // Which recurring rule produced this entry, if any.
      `ALTER TABLE entries ADD COLUMN schedule_id TEXT`,

      `CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('in','out','transfer')),
        -- NULL means the amount varies, so each occurrence is filled in by hand.
        amount_cents INTEGER CHECK (amount_cents IS NULL OR amount_cents > 0),
        cadence TEXT NOT NULL CHECK (cadence IN ('weekly','biweekly','monthly')),
        -- The first occurrence. Biweekly and semimonthly are both counted from here.
        anchor_date TEXT NOT NULL,
        next_due TEXT NOT NULL,
        -- On for a transfer the bank makes by itself; off for anything you decide.
        auto_post INTEGER NOT NULL DEFAULT 0,
        payee TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '',
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        source_id TEXT REFERENCES sources(id) ON DELETE SET NULL,
        target_id TEXT REFERENCES targets(id) ON DELETE SET NULL,
        liability_id TEXT REFERENCES liabilities(id) ON DELETE SET NULL,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS schedules_next_due ON schedules (next_due)`,
      `CREATE INDEX IF NOT EXISTS entries_schedule ON entries (schedule_id)`,
      `CREATE INDEX IF NOT EXISTS entries_adjustment ON entries (is_adjustment)`,
    ],
  },
];

/**
 * Bring the database up to date. Idempotent: every statement is guarded, and an
 * already-applied step is skipped. Cheap enough to call on each cold start.
 */
export async function ensureSchema(db: Db): Promise<void> {
  await db.run(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    (await db.all<{ name: string }>(`SELECT name FROM _migrations`)).map((r) => r.name),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    for (const statement of migration.statements) {
      await db.run(statement);
    }
    await db.run(`INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)`, [
      migration.name,
      new Date().toISOString(),
    ]);
  }
}
