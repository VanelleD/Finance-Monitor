/** Every SQL statement in the app lives here. Rows in, shared types out. */

import type { Db, Row } from "./driver.js";
import type {
  Account, Asset, Category, Entry, Liability, Source, Target,
} from "../../shared/types.js";

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

const nowISO = () => new Date().toISOString();

/* ------------------------------- row mapping ------------------------------- */

const str = (v: unknown): string => (typeof v === "string" ? v : String(v ?? ""));
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));
const nullableStr = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const nullableNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown): boolean => v === 1 || v === true || v === "1";

const toAccount = (r: Row): Account => ({
  id: str(r.id),
  name: str(r.name),
  kind: str(r.kind) as Account["kind"],
  currency: str(r.currency),
  openingCents: num(r.opening_cents),
  archived: bool(r.archived),
});

const toSource = (r: Row): Source => ({
  id: str(r.id), name: str(r.name), archived: bool(r.archived),
});

const toCategory = (r: Row): Category => ({
  id: str(r.id),
  name: str(r.name),
  direction: str(r.direction) as Category["direction"],
  archived: bool(r.archived),
});

const toEntry = (r: Row): Entry => ({
  id: str(r.id),
  direction: str(r.direction) as Entry["direction"],
  amountCents: num(r.amount_cents),
  occurredOn: str(r.occurred_on),
  payee: str(r.payee),
  reason: str(r.reason),
  accountId: nullableStr(r.account_id),
  toAccountId: nullableStr(r.to_account_id),
  categoryId: nullableStr(r.category_id),
  sourceId: nullableStr(r.source_id),
  targetId: nullableStr(r.target_id),
  repeatRule: nullableStr(r.repeat_rule) as Entry["repeatRule"],
});

const toAsset = (r: Row): Asset => ({
  id: str(r.id),
  name: str(r.name),
  kind: str(r.kind) as Asset["kind"],
  valueCents: num(r.value_cents),
  valuedOn: str(r.valued_on),
  accountId: nullableStr(r.account_id),
  archived: bool(r.archived),
});

const toLiability = (r: Row): Liability => ({
  id: str(r.id),
  name: str(r.name),
  kind: str(r.kind) as Liability["kind"],
  balanceCents: num(r.balance_cents),
  aprBps: nullableNum(r.apr_bps),
  minPaymentCents: nullableNum(r.min_payment_cents),
  dueDay: nullableNum(r.due_day),
  archived: bool(r.archived),
});

const toTarget = (r: Row): Target => ({
  id: str(r.id),
  name: str(r.name),
  kind: str(r.kind) as Target["kind"],
  amountCents: num(r.amount_cents),
  deadline: nullableStr(r.deadline),
  accountId: nullableStr(r.account_id),
  liabilityId: nullableStr(r.liability_id),
  categoryId: nullableStr(r.category_id),
  baselineCents: num(r.baseline_cents),
  archived: bool(r.archived),
});

/* --------------------------------- reads ---------------------------------- */

export const listAccounts = (db: Db) =>
  db.all(`SELECT * FROM accounts ORDER BY archived, name`).then((rs) => rs.map(toAccount));

export const listSources = (db: Db) =>
  db.all(`SELECT * FROM sources ORDER BY archived, name`).then((rs) => rs.map(toSource));

export const listCategories = (db: Db) =>
  db.all(`SELECT * FROM categories ORDER BY direction, archived, name`).then((rs) => rs.map(toCategory));

export const listAssets = (db: Db) =>
  db.all(`SELECT * FROM assets ORDER BY archived, value_cents DESC`).then((rs) => rs.map(toAsset));

export const listLiabilities = (db: Db) =>
  db.all(`SELECT * FROM liabilities ORDER BY archived, balance_cents DESC`).then((rs) => rs.map(toLiability));

export const listTargets = (db: Db) =>
  db.all(`SELECT * FROM targets ORDER BY archived, created_at`).then((rs) => rs.map(toTarget));

export const getEntry = (db: Db, id: string) =>
  db.get(`SELECT * FROM entries WHERE id = ?`, [id]).then((r) => (r ? toEntry(r) : undefined));

export interface EntryQuery {
  /** Inclusive ISO date bounds. */
  from?: string;
  to?: string;
  direction?: Entry["direction"];
  categoryId?: string;
  accountId?: string;
  /** Free-text match against payee and reason. */
  search?: string;
  limit?: number;
  offset?: number;
}

function entryWhere(query: EntryQuery): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (query.from) { parts.push(`occurred_on >= ?`); params.push(query.from); }
  if (query.to) { parts.push(`occurred_on <= ?`); params.push(query.to); }
  if (query.direction) { parts.push(`direction = ?`); params.push(query.direction); }
  if (query.categoryId) { parts.push(`category_id = ?`); params.push(query.categoryId); }
  if (query.accountId) {
    parts.push(`(account_id = ? OR to_account_id = ?)`);
    params.push(query.accountId, query.accountId);
  }
  if (query.search) {
    parts.push(`(payee LIKE ? ESCAPE '\\' OR reason LIKE ? ESCAPE '\\')`);
    const like = `%${escapeLike(query.search)}%`;
    params.push(like, like);
  }
  return { clause: parts.length ? `WHERE ${parts.join(" AND ")}` : "", params };
}

/** LIKE treats these as wildcards, so a search for "50%" must not match everything. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listEntries(db: Db, query: EntryQuery = {}): Promise<Entry[]> {
  const { clause, params } = entryWhere(query);
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 1000);
  const offset = Math.max(query.offset ?? 0, 0);
  const rows = await db.all(
    `SELECT * FROM entries ${clause} ORDER BY occurred_on DESC, created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  return rows.map(toEntry);
}

export async function countEntries(db: Db, query: EntryQuery = {}): Promise<number> {
  const { clause, params } = entryWhere(query);
  const row = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM entries ${clause}`, params);
  return num(row?.n);
}

/* -------------------------------- settings -------------------------------- */

export async function getSetting(db: Db, key: string): Promise<string | undefined> {
  const row = await db.get<{ value: string }>(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row?.value;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

export async function deleteSetting(db: Db, key: string): Promise<void> {
  await db.run(`DELETE FROM settings WHERE key = ?`, [key]);
}

/* --------------------------------- writes --------------------------------- */

export type NewEntry = Omit<Entry, "id">;

export async function createEntry(db: Db, input: NewEntry): Promise<Entry> {
  const id = newId("ent");
  const at = nowISO();
  await db.run(
    `INSERT INTO entries (
       id, direction, amount_cents, occurred_on, payee, reason,
       account_id, to_account_id, category_id, source_id, target_id, repeat_rule,
       created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.direction, input.amountCents, input.occurredOn, input.payee, input.reason,
      input.accountId, input.toAccountId, input.categoryId, input.sourceId, input.targetId,
      input.repeatRule, at, at,
    ],
  );
  return { id, ...input };
}

const ENTRY_COLUMNS: Record<keyof NewEntry, string> = {
  direction: "direction",
  amountCents: "amount_cents",
  occurredOn: "occurred_on",
  payee: "payee",
  reason: "reason",
  accountId: "account_id",
  toAccountId: "to_account_id",
  categoryId: "category_id",
  sourceId: "source_id",
  targetId: "target_id",
  repeatRule: "repeat_rule",
};

export async function updateEntry(db: Db, id: string, patch: Partial<NewEntry>): Promise<Entry | undefined> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(ENTRY_COLUMNS)) {
    const value = patch[key as keyof NewEntry];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return getEntry(db, id);
  sets.push(`updated_at = ?`);
  params.push(nowISO(), id);
  await db.run(`UPDATE entries SET ${sets.join(", ")} WHERE id = ?`, params);
  return getEntry(db, id);
}

export async function deleteEntry(db: Db, id: string): Promise<void> {
  await db.run(`DELETE FROM entries WHERE id = ?`, [id]);
}

export async function createAccount(db: Db, input: Omit<Account, "id">): Promise<Account> {
  const id = newId("acc");
  await db.run(
    `INSERT INTO accounts (id, name, kind, currency, opening_cents, archived, created_at)
     VALUES (?,?,?,?,?,?,?)`,
    [id, input.name, input.kind, input.currency, input.openingCents, input.archived ? 1 : 0, nowISO()],
  );
  return { id, ...input };
}

export async function createSource(db: Db, name: string): Promise<Source> {
  const id = newId("src");
  await db.run(`INSERT INTO sources (id, name, archived, created_at) VALUES (?,?,0,?)`, [id, name, nowISO()]);
  return { id, name, archived: false };
}

export async function createCategory(db: Db, input: Omit<Category, "id">): Promise<Category> {
  const id = newId("cat");
  await db.run(`INSERT INTO categories (id, name, direction, archived) VALUES (?,?,?,?)`, [
    id, input.name, input.direction, input.archived ? 1 : 0,
  ]);
  return { id, ...input };
}

export async function createAsset(db: Db, input: Omit<Asset, "id">): Promise<Asset> {
  const id = newId("ast");
  await db.run(
    `INSERT INTO assets (id, name, kind, value_cents, valued_on, account_id, archived, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [id, input.name, input.kind, input.valueCents, input.valuedOn, input.accountId, input.archived ? 1 : 0, nowISO()],
  );
  return { id, ...input };
}

export async function updateAsset(db: Db, id: string, patch: Partial<Omit<Asset, "id">>): Promise<void> {
  const columns: Record<string, string> = {
    name: "name", kind: "kind", valueCents: "value_cents",
    valuedOn: "valued_on", accountId: "account_id", archived: "archived",
  };
  await patchRow(db, "assets", columns, id, patch);
}

export async function createLiability(db: Db, input: Omit<Liability, "id">): Promise<Liability> {
  const id = newId("lia");
  await db.run(
    `INSERT INTO liabilities (id, name, kind, balance_cents, apr_bps, min_payment_cents, due_day, archived, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      id, input.name, input.kind, input.balanceCents, input.aprBps,
      input.minPaymentCents, input.dueDay, input.archived ? 1 : 0, nowISO(),
    ],
  );
  return { id, ...input };
}

export async function updateLiability(db: Db, id: string, patch: Partial<Omit<Liability, "id">>): Promise<void> {
  const columns: Record<string, string> = {
    name: "name", kind: "kind", balanceCents: "balance_cents", aprBps: "apr_bps",
    minPaymentCents: "min_payment_cents", dueDay: "due_day", archived: "archived",
  };
  await patchRow(db, "liabilities", columns, id, patch);
}

export async function createTarget(db: Db, input: Omit<Target, "id">): Promise<Target> {
  const id = newId("tgt");
  await db.run(
    `INSERT INTO targets (id, name, kind, amount_cents, deadline, account_id, liability_id, category_id, baseline_cents, archived, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.name, input.kind, input.amountCents, input.deadline, input.accountId,
      input.liabilityId, input.categoryId, input.baselineCents, input.archived ? 1 : 0, nowISO(),
    ],
  );
  return { id, ...input };
}

export async function updateTarget(db: Db, id: string, patch: Partial<Omit<Target, "id">>): Promise<void> {
  const columns: Record<string, string> = {
    name: "name", kind: "kind", amountCents: "amount_cents", deadline: "deadline",
    accountId: "account_id", liabilityId: "liability_id", categoryId: "category_id",
    baselineCents: "baseline_cents", archived: "archived",
  };
  await patchRow(db, "targets", columns, id, patch);
}

export async function deleteRow(db: Db, table: "assets" | "liabilities" | "targets" | "accounts" | "sources", id: string): Promise<void> {
  await db.run(`DELETE FROM ${table} WHERE id = ?`, [id]);
}

/** Shared PATCH builder. `columns` is the allow-list, so no caller can name an arbitrary column. */
async function patchRow(
  db: Db,
  table: string,
  columns: Record<string, string>,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column] of Object.entries(columns)) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    params.push(typeof value === "boolean" ? (value ? 1 : 0) : value);
  }
  if (sets.length === 0) return;
  params.push(id);
  await db.run(`UPDATE ${table} SET ${sets.join(", ")} WHERE id = ?`, params);
}
