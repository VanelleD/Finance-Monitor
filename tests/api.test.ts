/**
 * Integration tests: the real Hono app over a real (in-memory) SQLite database.
 * Nothing is mocked, so these cover routing, auth, validation and SQL together.
 */

import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp, type AppType } from "../src/server/app.js";
import type { Db } from "../src/server/db/driver.js";
import { ensureSchema } from "../src/server/db/migrations.js";
import { accountBalanceCents, flowForMonth, netWorthCents } from "../src/shared/derive.js";
import type { Snapshot } from "../src/client/lib/api.js";

const SECRET = "test-secret-not-used-anywhere-real";
const PASSPHRASE = "correct horse battery staple";

function makeDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const normalise = (params: unknown[]) =>
    params.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  return {
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
}

/** Mirrors what the browser does before it ever talks to the server. */
async function deriveKey(passphrase: string, saltB64: string, iterations: number): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  const bytes = new Uint8Array(bits);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

class Client {
  private cookie: string | null = null;

  constructor(private readonly app: AppType) {}

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body) headers.set("content-type", "application/json");
    if (this.cookie) headers.set("cookie", this.cookie);

    const response = await this.app.request(`http://test${path}`, { ...init, headers });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0] ?? null;
    return response;
  }

  get = (path: string) => this.request(path);
  post = (path: string, body: unknown) =>
    this.request(path, { method: "POST", body: JSON.stringify(body) });
  patch = (path: string, body: unknown) =>
    this.request(path, { method: "PATCH", body: JSON.stringify(body) });
  del = (path: string) => this.request(path, { method: "DELETE" });

  forgetCookie() {
    this.cookie = null;
  }
}

let app: AppType;
let client: Client;

async function signIn(): Promise<void> {
  const params = (await (await client.get("/api/auth/params")).json()) as {
    salt: string;
    iterations: number;
  };
  const derivedKey = await deriveKey(PASSPHRASE, params.salt, params.iterations);
  const response = await client.post("/api/auth/setup", { derivedKey });
  expect(response.status).toBe(200);
}

beforeEach(async () => {
  const db = makeDb();
  await ensureSchema(db);
  app = createApp(async (c, next) => {
    c.set("db", db);
    c.set("sessionSecret", SECRET);
    c.set("secureCookies", false);
    return next();
  });
  client = new Client(app);
});

describe("health and schema", () => {
  it("answers health without a session", async () => {
    const response = await client.get("/api/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("seeds the default categories", async () => {
    await signIn();
    const snapshot = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    expect(snapshot.categories.length).toBeGreaterThan(10);
    expect(snapshot.categories.some((c) => c.name === "Groceries" && c.direction === "out")).toBe(true);
    expect(snapshot.categories.some((c) => c.name === "Salary" && c.direction === "in")).toBe(true);
  });

  it("is idempotent when the schema is applied twice", async () => {
    const db = makeDb();
    await ensureSchema(db);
    await expect(ensureSchema(db)).resolves.toBeUndefined();
    const categories = await db.all(`SELECT id FROM categories WHERE id = 'cat_groceries'`);
    expect(categories).toHaveLength(1);
  });
});

describe("auth", () => {
  it("locks everything behind a session", async () => {
    for (const path of ["/api/snapshot", "/api/entries", "/api/export.csv"]) {
      expect((await client.get(path)).status, path).toBe(401);
    }
    expect((await client.post("/api/entries", {})).status).toBe(401);
  });

  it("reports whether a passphrase has been set", async () => {
    await expect((await client.get("/api/auth/state")).json()).resolves.toEqual({
      configured: false,
      authenticated: false,
    });
    await signIn();
    await expect((await client.get("/api/auth/state")).json()).resolves.toEqual({
      configured: true,
      authenticated: true,
    });
  });

  it("signs in with the right passphrase and refuses the wrong one", async () => {
    await signIn();
    client.forgetCookie();

    const params = (await (await client.get("/api/auth/params")).json()) as {
      salt: string;
      iterations: number;
    };

    const wrong = await deriveKey("not the passphrase", params.salt, params.iterations);
    expect((await client.post("/api/auth/login", { derivedKey: wrong })).status).toBe(401);
    expect((await client.get("/api/snapshot")).status).toBe(401);

    const right = await deriveKey(PASSPHRASE, params.salt, params.iterations);
    expect((await client.post("/api/auth/login", { derivedKey: right })).status).toBe(200);
    expect((await client.get("/api/snapshot")).status).toBe(200);
  });

  it("refuses to overwrite an existing passphrase", async () => {
    await signIn();
    const params = (await (await client.get("/api/auth/params")).json()) as {
      salt: string;
      iterations: number;
    };
    const other = await deriveKey("a completely different phrase", params.salt, params.iterations);
    expect((await client.post("/api/auth/setup", { derivedKey: other })).status).toBe(409);
  });

  it("locks out after repeated failures", async () => {
    await signIn();
    client.forgetCookie();
    const params = (await (await client.get("/api/auth/params")).json()) as {
      salt: string;
      iterations: number;
    };
    const wrong = await deriveKey("wrong", params.salt, params.iterations);

    let lockedOut = false;
    for (let attempt = 0; attempt < 9; attempt++) {
      const response = await client.post("/api/auth/login", { derivedKey: wrong });
      const payload = (await response.json()) as { error: string };
      if (/too many attempts/i.test(payload.error)) lockedOut = true;
    }
    expect(lockedOut).toBe(true);

    // The correct passphrase is refused too while the lockout holds.
    const right = await deriveKey(PASSPHRASE, params.salt, params.iterations);
    const blocked = await client.post("/api/auth/login", { derivedKey: right });
    expect(blocked.status).toBe(401);
    await expect(blocked.json()).resolves.toMatchObject({ error: expect.stringMatching(/too many/i) });
  });

  it("clears the session on sign out", async () => {
    await signIn();
    expect((await client.get("/api/snapshot")).status).toBe(200);
    await client.post("/api/auth/logout", {});
    client.forgetCookie();
    expect((await client.get("/api/snapshot")).status).toBe(401);
  });

  it("rejects a tampered session cookie", async () => {
    await signIn();
    const response = await app.request("http://test/api/snapshot", {
      headers: { cookie: "fm_session=eyJleHAiOjk5OTk5OTk5OTl9.forged-signature" },
    });
    expect(response.status).toBe(401);
  });
});

describe("entries", () => {
  beforeEach(signIn);

  async function makeAccount(name: string, openingCents = 0): Promise<string> {
    const response = await client.post("/api/accounts", {
      name, kind: "checking", currency: "USD", openingCents,
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  }

  it("stores and returns an entry", async () => {
    const accountId = await makeAccount("Checking", 100000);
    const response = await client.post("/api/entries", {
      direction: "out",
      amountCents: 14218,
      occurredOn: "2026-09-17",
      payee: "Whole Foods Market",
      reason: "Weekly shop",
      accountId,
      categoryId: "cat_groceries",
    });
    expect(response.status).toBe(201);
    const entry = (await response.json()) as { id: string; amountCents: number };
    expect(entry.amountCents).toBe(14218);

    const listed = (await (await client.get("/api/entries?month=2026-09")).json()) as {
      entries: Array<{ id: string; payee: string }>;
      total: number;
    };
    expect(listed.total).toBe(1);
    expect(listed.entries[0]?.payee).toBe("Whole Foods Market");
  });

  it("rejects amounts and dates that make no sense", async () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ["zero amount", { direction: "out", amountCents: 0, occurredOn: "2026-09-17" }],
      ["negative amount", { direction: "out", amountCents: -500, occurredOn: "2026-09-17" }],
      ["fractional cents", { direction: "out", amountCents: 10.5, occurredOn: "2026-09-17" }],
      ["impossible date", { direction: "out", amountCents: 100, occurredOn: "2026-02-31" }],
      ["malformed date", { direction: "out", amountCents: 100, occurredOn: "17/09/2026" }],
      ["unknown direction", { direction: "sideways", amountCents: 100, occurredOn: "2026-09-17" }],
    ];
    for (const [label, payload] of cases) {
      const response = await client.post("/api/entries", payload);
      expect(response.status, label).toBe(422);
    }
  });

  it("requires a transfer to have a distinct destination", async () => {
    const from = await makeAccount("Checking");
    const to = await makeAccount("Savings");

    const missing = await client.post("/api/entries", {
      direction: "transfer", amountCents: 60000, occurredOn: "2026-09-15", accountId: from,
    });
    expect(missing.status).toBe(422);
    await expect(missing.json()).resolves.toMatchObject({
      fields: { toAccountId: expect.stringContaining("destination") },
    });

    const sameAccount = await client.post("/api/entries", {
      direction: "transfer", amountCents: 60000, occurredOn: "2026-09-15",
      accountId: from, toAccountId: from,
    });
    expect(sameAccount.status).toBe(422);

    const valid = await client.post("/api/entries", {
      direction: "transfer", amountCents: 60000, occurredOn: "2026-09-15",
      accountId: from, toAccountId: to,
    });
    expect(valid.status).toBe(201);
  });

  it("filters by direction, category and free text", async () => {
    const accountId = await makeAccount("Checking");
    await client.post("/api/entries", {
      direction: "in", amountCents: 371000, occurredOn: "2026-09-16",
      payee: "Northwind Labs", accountId, categoryId: "cat_salary",
    });
    await client.post("/api/entries", {
      direction: "out", amountCents: 14218, occurredOn: "2026-09-17",
      payee: "Whole Foods", reason: "Weekly shop", accountId, categoryId: "cat_groceries",
    });
    await client.post("/api/entries", {
      direction: "out", amountCents: 185000, occurredOn: "2026-09-11",
      payee: "Rent", accountId, categoryId: "cat_housing",
    });

    const outOnly = (await (await client.get("/api/entries?direction=out")).json()) as { total: number };
    expect(outOnly.total).toBe(2);

    const groceries = (await (await client.get("/api/entries?categoryId=cat_groceries")).json()) as { total: number };
    expect(groceries.total).toBe(1);

    const search = (await (await client.get("/api/entries?search=weekly")).json()) as { total: number };
    expect(search.total).toBe(1);

    const otherMonth = (await (await client.get("/api/entries?month=2026-08")).json()) as { total: number };
    expect(otherMonth.total).toBe(0);
  });

  it("treats a percent sign in search as text, not a wildcard", async () => {
    const accountId = await makeAccount("Checking");
    await client.post("/api/entries", {
      direction: "out", amountCents: 1000, occurredOn: "2026-09-01", payee: "50% off sale", accountId,
    });
    await client.post("/api/entries", {
      direction: "out", amountCents: 2000, occurredOn: "2026-09-02", payee: "Regular shop", accountId,
    });

    const matched = (await (await client.get("/api/entries?search=50%25")).json()) as { total: number };
    expect(matched.total).toBe(1);
  });

  it("edits and deletes an entry", async () => {
    const accountId = await makeAccount("Checking");
    const created = (await (
      await client.post("/api/entries", {
        direction: "out", amountCents: 1000, occurredOn: "2026-09-01", payee: "Typo", accountId,
      })
    ).json()) as { id: string };

    const patched = await client.patch(`/api/entries/${created.id}`, {
      amountCents: 2500,
      payee: "Fixed",
    });
    expect(patched.status).toBe(200);
    await expect(patched.json()).resolves.toMatchObject({ amountCents: 2500, payee: "Fixed" });

    expect((await client.del(`/api/entries/${created.id}`)).status).toBe(204);
    const remaining = (await (await client.get("/api/entries")).json()) as { total: number };
    expect(remaining.total).toBe(0);
  });

  it("404s when patching an entry that isn't there", async () => {
    expect((await client.patch("/api/entries/ent_nope", { payee: "x" })).status).toBe(404);
  });

  it("paginates", async () => {
    const accountId = await makeAccount("Checking");
    for (let day = 1; day <= 12; day++) {
      await client.post("/api/entries", {
        direction: "out",
        amountCents: day * 100,
        occurredOn: `2026-09-${String(day).padStart(2, "0")}`,
        accountId,
      });
    }
    const firstPage = (await (await client.get("/api/entries?limit=5&offset=0")).json()) as {
      entries: unknown[];
      total: number;
    };
    expect(firstPage.total).toBe(12);
    expect(firstPage.entries).toHaveLength(5);

    const lastPage = (await (await client.get("/api/entries?limit=5&offset=10")).json()) as {
      entries: unknown[];
    };
    expect(lastPage.entries).toHaveLength(2);
  });
});

describe("snapshot drives the whole UI", () => {
  beforeEach(signIn);

  it("returns everything needed, and the derived numbers agree with the shared module", async () => {
    const accountId = ((await (
      await client.post("/api/accounts", {
        name: "Checking", kind: "checking", currency: "USD", openingCents: 482015,
      })
    ).json()) as { id: string }).id;

    await client.post("/api/assets", {
      name: "Brokerage", kind: "investment", valueCents: 6231044, valuedOn: "2026-09-15",
    });
    await client.post("/api/liabilities", {
      name: "Card", kind: "credit_card", balanceCents: 214088, aprBps: 2124,
      minPaymentCents: 6500, dueDay: 3,
    });
    await client.post("/api/entries", {
      direction: "in", amountCents: 371000, occurredOn: "2026-09-16", accountId, categoryId: "cat_salary",
    });
    await client.post("/api/entries", {
      direction: "out", amountCents: 14218, occurredOn: "2026-09-17", accountId, categoryId: "cat_groceries",
    });

    const snapshot = (await (await client.get("/api/snapshot?month=2026-09")).json()) as Snapshot;

    expect(snapshot.accounts).toHaveLength(1);
    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.liabilities).toHaveLength(1);
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // The client computes these from the snapshot; check the inputs produce the right answers.
    expect(netWorthCents(snapshot.assets, snapshot.liabilities)).toBe(6231044 - 214088);
    const flow = flowForMonth(snapshot.entries, "2026-09");
    expect(flow.inCents).toBe(371000);
    expect(flow.outCents).toBe(14218);
    expect(flow.netCents).toBe(371000 - 14218);
  });

  it("windows entries to the twelve months ending at the month asked for", async () => {
    await client.post("/api/entries", { direction: "out", amountCents: 100, occurredOn: "2026-09-01" });
    await client.post("/api/entries", { direction: "out", amountCents: 100, occurredOn: "2024-01-01" });

    const snapshot = (await (await client.get("/api/snapshot?month=2026-09")).json()) as Snapshot;
    expect(snapshot.entries).toHaveLength(1);
    expect(snapshot.entries[0]?.occurredOn).toBe("2026-09-01");
  });

  it("rejects a malformed month", async () => {
    expect((await client.get("/api/snapshot?month=2026-13")).status).toBe(422);
    expect((await client.get("/api/snapshot?month=sep")).status).toBe(422);
  });
});

describe("targets", () => {
  beforeEach(signIn);

  it("requires the field each kind depends on", async () => {
    const noLiability = await client.post("/api/targets", {
      name: "Clear the card", kind: "pay_off", amountCents: 490000,
    });
    expect(noLiability.status).toBe(422);

    const noCategory = await client.post("/api/targets", {
      name: "Dining cap", kind: "spend_under", amountCents: 40000,
    });
    expect(noCategory.status).toBe(422);

    const fine = await client.post("/api/targets", {
      name: "Dining cap", kind: "spend_under", amountCents: 40000, categoryId: "cat_dining",
    });
    expect(fine.status).toBe(201);
  });

  it("saves, edits and removes a savings target", async () => {
    const created = (await (
      await client.post("/api/targets", {
        name: "Emergency fund", kind: "save_to", amountCents: 2500000, deadline: "2027-06-01",
      })
    ).json()) as { id: string };

    expect((await client.patch(`/api/targets/${created.id}`, { amountCents: 3000000 })).status).toBe(200);

    let snapshot = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    expect(snapshot.targets[0]?.amountCents).toBe(3000000);

    expect((await client.del(`/api/targets/${created.id}`)).status).toBe(204);
    snapshot = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    expect(snapshot.targets).toHaveLength(0);
  });
});

describe("export", () => {
  beforeEach(signIn);

  it("exports CSV with a header and quoted cells", async () => {
    await client.post("/api/entries", {
      direction: "out", amountCents: 14218, occurredOn: "2026-09-17",
      payee: "Whole Foods", reason: 'He said "weekly shop"', categoryId: "cat_groceries",
    });

    const response = await client.get("/api/export.csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");

    const body = await response.text();
    const [header, firstRow] = body.split("\r\n");
    expect(header).toBe('"Date","Direction","Amount","Payee","Reason","Category","From","To","Source"');
    expect(firstRow).toContain('"2026-09-17"');
    expect(firstRow).toContain('"142.18"');
    expect(firstRow).toContain('"He said ""weekly shop"""'); // quotes doubled, not dropped
    expect(firstRow).toContain('"Groceries"');
  });

  it("defuses a payee that a spreadsheet would run as a formula", async () => {
    await client.post("/api/entries", {
      direction: "out", amountCents: 100, occurredOn: "2026-09-17",
      payee: '=HYPERLINK("http://evil.test","click")',
    });
    const body = await (await client.get("/api/export.csv")).text();
    expect(body).toContain("\"'=HYPERLINK"); // prefixed, so Excel treats it as text
  });

  it("exports JSON containing every table", async () => {
    const payload = (await (await client.get("/api/export.json")).json()) as Record<string, unknown>;
    for (const key of ["accounts", "sources", "categories", "assets", "liabilities", "targets", "entries"]) {
      expect(payload, key).toHaveProperty(key);
    }
    expect(payload.exportedAt).toEqual(expect.any(String));
  });
});

describe("correcting an account balance", () => {
  beforeEach(signIn);

  async function checking(openingCents = 0): Promise<string> {
    const response = await client.post("/api/accounts", {
      name: "Chase Checking", kind: "checking", currency: "USD", openingCents,
    });
    return ((await response.json()) as { id: string }).id;
  }

  async function balanceOf(accountId: string): Promise<number> {
    const snapshot = (await (await client.get("/api/snapshot")).json()) as Snapshot & {
      balances: Record<string, number>;
    };
    const account = snapshot.accounts.find((a) => a.id === accountId)!;
    return accountBalanceCents(account, snapshot.entries);
  }

  it("makes the stated balance true by recording the difference", async () => {
    const id = await checking(100000);
    await client.post("/api/entries", {
      direction: "out", amountCents: 25000, occurredOn: "2026-09-10", accountId: id,
    });
    expect(await balanceOf(id)).toBe(75000); // 1,000 - 250

    // The bank actually says $812.34.
    const response = await client.post(`/api/accounts/${id}/balance`, { balanceCents: 81234 });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      adjusted: true,
      deltaCents: 6234,
      balanceCents: 81234,
    });
    expect(await balanceOf(id)).toBe(81234);
  });

  it("corrects downwards too", async () => {
    const id = await checking(100000);
    await client.post(`/api/accounts/${id}/balance`, { balanceCents: 40000 });
    expect(await balanceOf(id)).toBe(40000);
  });

  it("records nothing when the balance already matches", async () => {
    const id = await checking(100000);
    const response = await client.post(`/api/accounts/${id}/balance`, { balanceCents: 100000 });
    await expect(response.json()).resolves.toMatchObject({ adjusted: false });

    const listed = (await (await client.get("/api/entries")).json()) as { total: number };
    expect(listed.total).toBe(0);
  });

  it("keeps a correction out of income and spending", async () => {
    const id = await checking(0);
    await client.post("/api/entries", {
      direction: "in", amountCents: 300000, occurredOn: "2026-09-02", accountId: id, categoryId: "cat_salary",
    });
    await client.post(`/api/accounts/${id}/balance`, { balanceCents: 999999, occurredOn: "2026-09-20" });

    const snapshot = (await (await client.get("/api/snapshot?month=2026-09")).json()) as Snapshot;
    const flow = flowForMonth(snapshot.entries, "2026-09");

    // The correction moved the balance by a lot, but no money was earned.
    expect(flow.inCents).toBe(300000);
    expect(flow.outCents).toBe(0);
    expect(snapshot.entries.some((e) => e.isAdjustment)).toBe(true);
  });

  it("leaves the correction visible in the ledger, not hidden", async () => {
    const id = await checking(100000);
    await client.post(`/api/accounts/${id}/balance`, { balanceCents: 81234 });

    const listed = (await (await client.get("/api/entries")).json()) as {
      entries: Array<{ payee: string; reason: string; isAdjustment: boolean }>;
    };
    expect(listed.entries[0]?.payee).toBe("Balance correction");
    expect(listed.entries[0]?.reason).toContain("$812.34");
    expect(listed.entries[0]?.isAdjustment).toBe(true);
  });

  it("404s for an account that isn't there", async () => {
    expect((await client.post("/api/accounts/acc_nope/balance", { balanceCents: 100 })).status).toBe(404);
  });
});

describe("recurring rules", () => {
  beforeEach(signIn);

  async function accounts(): Promise<[string, string]> {
    const from = await client.post("/api/accounts", { name: "Checking", kind: "checking", currency: "USD", openingCents: 0 });
    const to = await client.post("/api/accounts", { name: "Fidelity", kind: "brokerage", currency: "USD", openingCents: 0 });
    return [
      ((await from.json()) as { id: string }).id,
      ((await to.json()) as { id: string }).id,
    ];
  }

  it("refuses to let a variable-amount rule post by itself", async () => {
    const response = await client.post("/api/schedules", {
      name: "Weekly transfer", direction: "out", amountCents: null,
      cadence: "weekly", anchorDate: "2026-09-07", autoPost: true,
    });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      fields: { autoPost: expect.stringContaining("fixed") },
    });
  });

  it("requires a transfer rule to have a destination", async () => {
    const [from] = await accounts();
    const response = await client.post("/api/schedules", {
      name: "To Fidelity", direction: "transfer", amountCents: 5000,
      cadence: "biweekly", anchorDate: "2026-09-04", accountId: from,
    });
    expect(response.status).toBe(422);
  });

  it("posts every missed occurrence of an auto rule and advances it once", async () => {
    const [from, to] = await accounts();
    const created = await client.post("/api/schedules", {
      name: "Fidelity $50", direction: "transfer", amountCents: 5000,
      cadence: "biweekly", anchorDate: "2026-09-04", nextDue: "2026-09-04",
      accountId: from, toAccountId: to, autoPost: true,
    });
    expect(created.status).toBe(201);
    const schedule = (await created.json()) as { id: string };

    const posted = await client.post("/api/schedules/post-due", {});
    expect(posted.status).toBe(200);
    const result = (await posted.json()) as { postedCount: number; created: Array<{ amountCents: number }> };

    // Several fortnights have passed since the anchor, so more than one is owed.
    expect(result.postedCount).toBeGreaterThan(0);
    expect(result.created.every((e) => e.amountCents === 5000)).toBe(true);

    const snapshot = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    const rule = snapshot.schedules.find((s) => s.id === schedule.id)!;
    // Nothing is left owing, and the rule now points at a future date.
    expect(rule.nextDue > snapshot.today).toBe(true);

    // Running it again is a no-op rather than a duplicate.
    const again = (await (await client.post("/api/schedules/post-due", {})).json()) as { postedCount: number };
    expect(again.postedCount).toBe(0);
  });

  it("leaves a confirm-first rule alone until it is named", async () => {
    const [from] = await accounts();
    const created = await client.post("/api/schedules", {
      name: "Groceries", direction: "out", amountCents: 8000,
      cadence: "weekly", anchorDate: "2026-09-07", nextDue: "2026-09-07",
      accountId: from, categoryId: "cat_groceries", autoPost: false,
    });
    const schedule = (await created.json()) as { id: string };

    const auto = (await (await client.post("/api/schedules/post-due", {})).json()) as { postedCount: number };
    expect(auto.postedCount).toBe(0);

    const explicit = (await (
      await client.post("/api/schedules/post-due", {
        occurrences: [{ scheduleId: schedule.id, occurredOn: "2026-09-07" }],
      })
    ).json()) as { postedCount: number };
    expect(explicit.postedCount).toBe(1);
  });

  it("takes a typed amount for a rule whose amount varies", async () => {
    const [from, to] = await accounts();
    const created = await client.post("/api/schedules", {
      name: "Fidelity weekly", direction: "transfer", amountCents: null,
      cadence: "weekly", anchorDate: "2026-09-07", nextDue: "2026-09-07",
      accountId: from, toAccountId: to,
    });
    const schedule = (await created.json()) as { id: string };

    // Without a figure there is nothing to record.
    const bare = (await (
      await client.post("/api/schedules/post-due", {
        occurrences: [{ scheduleId: schedule.id, occurredOn: "2026-09-07" }],
      })
    ).json()) as { postedCount: number; skipped: Array<{ reason: string }> };
    expect(bare.postedCount).toBe(0);
    expect(bare.skipped[0]?.reason).toContain("varies");

    const withAmount = (await (
      await client.post("/api/schedules/post-due", {
        occurrences: [{ scheduleId: schedule.id, occurredOn: "2026-09-07", amountCents: 12750 }],
      })
    ).json()) as { postedCount: number; created: Array<{ amountCents: number }> };
    expect(withAmount.postedCount).toBe(1);
    expect(withAmount.created[0]?.amountCents).toBe(12750);
  });

  it("refuses to record an occurrence dated in the future", async () => {
    const [from] = await accounts();
    const created = await client.post("/api/schedules", {
      name: "Rent", direction: "out", amountCents: 185000,
      cadence: "monthly", anchorDate: "2026-09-01", accountId: from,
    });
    const schedule = (await created.json()) as { id: string };

    const result = (await (
      await client.post("/api/schedules/post-due", {
        occurrences: [{ scheduleId: schedule.id, occurredOn: "2099-01-01" }],
      })
    ).json()) as { postedCount: number; skipped: Array<{ reason: string }> };
    expect(result.postedCount).toBe(0);
    expect(result.skipped[0]?.reason).toContain("future");
  });

  it("skips an occurrence without recording anything", async () => {
    const [from] = await accounts();
    const created = await client.post("/api/schedules", {
      name: "Gym", direction: "out", amountCents: 4000,
      cadence: "monthly", anchorDate: "2026-09-01", nextDue: "2026-09-01", accountId: from,
    });
    const schedule = (await created.json()) as { id: string };

    const skipped = await client.post(`/api/schedules/${schedule.id}/skip`, {});
    expect(skipped.status).toBe(200);
    await expect(skipped.json()).resolves.toMatchObject({ nextDue: "2026-10-01" });

    const listed = (await (await client.get("/api/entries")).json()) as { total: number };
    expect(listed.total).toBe(0);
  });

  it("links each posted entry back to the rule that made it", async () => {
    const [from] = await accounts();
    const created = await client.post("/api/schedules", {
      name: "Spotify", direction: "out", amountCents: 1999,
      cadence: "monthly", anchorDate: "2026-09-01", nextDue: "2026-09-01",
      accountId: from, categoryId: "cat_subscriptions", autoPost: true,
    });
    const schedule = (await created.json()) as { id: string };

    await client.post("/api/schedules/post-due", {});
    const listed = (await (await client.get("/api/entries")).json()) as {
      entries: Array<{ scheduleId: string | null; payee: string }>;
    };
    expect(listed.entries.length).toBeGreaterThan(0);
    expect(listed.entries[0]?.scheduleId).toBe(schedule.id);
    expect(listed.entries[0]?.payee).toBe("Spotify");
  });

  it("edits and removes a rule", async () => {
    const [from] = await accounts();
    const created = await client.post("/api/schedules", {
      name: "Old name", direction: "out", amountCents: 1000,
      cadence: "weekly", anchorDate: "2026-09-01", accountId: from,
    });
    const schedule = (await created.json()) as { id: string };

    expect((await client.patch(`/api/schedules/${schedule.id}`, { name: "New name", amountCents: 2000 })).status).toBe(200);
    let snapshot = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    expect(snapshot.schedules[0]).toMatchObject({ name: "New name", amountCents: 2000 });

    expect((await client.del(`/api/schedules/${schedule.id}`)).status).toBe(204);
    snapshot = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    expect(snapshot.schedules).toHaveLength(0);
  });
});

describe("debts people actually carry", () => {
  beforeEach(signIn);

  it("accepts buy-now-pay-later and money owed to an app", async () => {
    for (const [name, kind] of [
      ["Afterpay", "bnpl"],
      ["Cash App", "person"],
      ["Capital One", "credit_card"],
      ["Line of credit", "line_of_credit"],
    ]) {
      const response = await client.post("/api/liabilities", { name, kind, balanceCents: 10000 });
      expect(response.status, `${name} (${kind})`).toBe(201);
    }

    const snapshot = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    expect(snapshot.liabilities).toHaveLength(4);
    expect(snapshot.liabilities.map((l) => l.kind).sort()).toEqual([
      "bnpl", "credit_card", "line_of_credit", "person",
    ]);
  });

  it("still rejects a kind that means nothing", async () => {
    const response = await client.post("/api/liabilities", {
      name: "Mystery", kind: "vibes", balanceCents: 100,
    });
    expect(response.status).toBe(422);
  });
});

describe("recording some of what is due", () => {
  beforeEach(signIn);

  it("does not bury older occurrences when only the newest is recorded", async () => {
    const account = ((await (
      await client.post("/api/accounts", { name: "Checking", kind: "checking", currency: "USD", openingCents: 0 })
    ).json()) as { id: string }).id;

    // Three weeks owed, amount varies, so each one waits for a figure.
    const created = await client.post("/api/schedules", {
      name: "Fidelity weekly", direction: "out", amountCents: null,
      cadence: "weekly", anchorDate: "2026-09-01", nextDue: "2026-09-01", accountId: account,
    });
    const schedule = (await created.json()) as { id: string };

    const before = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    const owed = before.schedules[0]!;
    expect(owed.nextDue).toBe("2026-09-01");

    // Record only the third week.
    const posted = (await (
      await client.post("/api/schedules/post-due", {
        occurrences: [{ scheduleId: schedule.id, occurredOn: "2026-09-15", amountCents: 9000 }],
      })
    ).json()) as { postedCount: number };
    expect(posted.postedCount).toBe(1);

    // The first two are still owed, not silently stepped over.
    const after = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    expect(after.schedules[0]?.nextDue).toBe("2026-09-01");
  });

  it("moves past the batch once nothing older is left", async () => {
    const created = await client.post("/api/schedules", {
      name: "Rent", direction: "out", amountCents: 185000,
      cadence: "monthly", anchorDate: "2026-07-01", nextDue: "2026-07-01",
    });
    const schedule = (await created.json()) as { id: string };

    const snapshot = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    const everything = [];
    for (let month = 7; month <= Number(snapshot.today.slice(5, 7)); month++) {
      everything.push({
        scheduleId: schedule.id,
        occurredOn: `2026-${String(month).padStart(2, "0")}-01`,
      });
    }

    await client.post("/api/schedules/post-due", { occurrences: everything });

    const after = (await (await client.get("/api/snapshot")).json()) as Snapshot;
    expect(after.schedules[0]!.nextDue > snapshot.today).toBe(true);
  });
});
