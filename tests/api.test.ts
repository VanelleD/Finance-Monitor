/**
 * Integration tests: the real Hono app over a real (in-memory) SQLite database.
 * Nothing is mocked, so these cover routing, auth, validation and SQL together.
 */

import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

import { createApp, type AppType } from "../src/server/app.js";
import type { Db } from "../src/server/db/driver.js";
import { ensureSchema } from "../src/server/db/migrations.js";
import { netWorthCents, flowForMonth } from "../src/shared/derive.js";
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
