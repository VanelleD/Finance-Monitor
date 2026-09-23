/**
 * The HTTP API. Deliberately thin: it stores and returns rows, and lets the
 * shared `derive` module do the arithmetic. Both the browser and the tests run
 * that same module, so there is exactly one implementation of "net worth".
 */

import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";

import type { Db } from "./db/driver.js";
import * as repo from "./db/repo.js";
import {
  KDF, SESSION_COOKIE, getOrCreateSalt, isConfigured, isSessionValid,
  issueSession, setupPassphrase, verifyPassphrase,
} from "./auth.js";
import {
  accountInput, assetInput, assetPatch, categoryInput, derivedKeyInput, entryInput,
  entryPatch, entryQueryInput, fieldErrors, liabilityInput, liabilityPatch, postDueInput,
  schedulePatch, scheduleInput, setBalanceInput, snapshotQueryInput, sourceInput,
  targetInput, targetPatch,
} from "./validate.js";
import { addMonths, currentMonth, todayISO } from "../shared/dates.js";
import { accountBalanceCents, dueOccurrences, nextDueAfter } from "../shared/derive.js";
import { formatCents } from "../shared/money.js";

export interface Vars {
  db: Db;
  sessionSecret: string;
  /** False for plain-HTTP local development, true once deployed. */
  secureCookies: boolean;
}

export type AppType = Hono<{ Variables: Vars }>;

/** Paths that must work before you are logged in. */
const PUBLIC_PREFIXES = ["/api/health", "/api/auth/"];

const guard: MiddlewareHandler<{ Variables: Vars }> = async (c, next) => {
  const path = c.req.path;
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return next();

  const valid = await isSessionValid(getCookie(c, SESSION_COOKIE), c.get("sessionSecret"));
  if (!valid) return c.json({ error: "Not signed in." }, 401);
  return next();
};

/** Parse a JSON body against a schema, answering 422 with per-field messages. */
async function body<S extends z.ZodTypeAny>(
  c: Parameters<MiddlewareHandler>[0],
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: "Expected a JSON body." }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: c.json({ error: "Some fields need fixing.", fields: fieldErrors(parsed.error) }, 422),
    };
  }
  return { ok: true, data: parsed.data };
}

export function createApp(bootstrap: MiddlewareHandler<{ Variables: Vars }>): AppType {
  const app = new Hono<{ Variables: Vars }>();

  app.use("/api/*", bootstrap);
  app.use("/api/*", guard);

  app.onError((error, c) => {
    console.error("[api]", error);
    return c.json({ error: "Something went wrong on the server." }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  /* ---------------------------------- auth --------------------------------- */

  app.get("/api/auth/state", async (c) => {
    const db = c.get("db");
    return c.json({
      configured: await isConfigured(db),
      authenticated: await isSessionValid(getCookie(c, SESSION_COOKIE), c.get("sessionSecret")),
    });
  });

  app.get("/api/auth/params", async (c) => {
    const db = c.get("db");
    return c.json({
      salt: await getOrCreateSalt(db),
      iterations: KDF.iterations,
      hash: KDF.hash,
      keyLengthBytes: KDF.keyLengthBytes,
    });
  });

  async function startSession(c: Parameters<MiddlewareHandler>[0]) {
    const { value, maxAge } = await issueSession(c.get("sessionSecret"));
    setCookie(c, SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: "Lax",
      secure: c.get("secureCookies"),
      path: "/",
      maxAge,
    });
  }

  app.post("/api/auth/setup", async (c) => {
    const parsed = await body(c, derivedKeyInput);
    if (!parsed.ok) return parsed.response;
    const result = await setupPassphrase(c.get("db"), parsed.data.derivedKey);
    if (!result.ok) return c.json({ error: result.error }, 409);
    await startSession(c);
    return c.json({ ok: true });
  });

  app.post("/api/auth/login", async (c) => {
    const parsed = await body(c, derivedKeyInput);
    if (!parsed.ok) return parsed.response;
    const result = await verifyPassphrase(c.get("db"), parsed.data.derivedKey);
    if (!result.ok) {
      return c.json({ error: result.error, retryAfterSeconds: result.retryAfterSeconds }, 401);
    }
    await startSession(c);
    return c.json({ ok: true });
  });

  app.post("/api/auth/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  /* -------------------------------- snapshot ------------------------------- */

  /**
   * One request that fills the whole app: reference data plus the last twelve
   * months of entries. Twelve covers the six-month charts and the three-month
   * pace window with room to spare, and keeps the free-tier read budget tiny.
   */
  app.get("/api/snapshot", async (c) => {
    const parsed = snapshotQueryInput.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "Bad query.", fields: fieldErrors(parsed.error) }, 422);

    const db = c.get("db");
    const month = parsed.data.month ?? currentMonth();
    const from = `${addMonths(month, -11)}-01`;
    const to = `${month}-31`;

    const [accounts, sources, categories, assets, liabilities, targets, schedules, entries] =
      await Promise.all([
        repo.listAccounts(db),
        repo.listSources(db),
        repo.listCategories(db),
        repo.listAssets(db),
        repo.listLiabilities(db),
        repo.listTargets(db),
        repo.listSchedules(db),
        repo.listEntries(db, { from, to, limit: 1000 }),
      ]);

    // Balances are derived, never stored, so they cannot drift from the ledger.
    const allEntries = await repo.listEntries(db, { limit: 1000 });
    const balances = Object.fromEntries(
      accounts.map((account) => [account.id, accountBalanceCents(account, allEntries)]),
    );

    return c.json({
      today: todayISO(),
      month,
      accounts, sources, categories, assets, liabilities, targets, schedules, entries,
      balances,
    });
  });

  /* --------------------------------- entries ------------------------------- */

  app.get("/api/entries", async (c) => {
    const parsed = entryQueryInput.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "Bad query.", fields: fieldErrors(parsed.error) }, 422);

    const { month, ...rest } = parsed.data;
    const query = month ? { ...rest, from: `${month}-01`, to: `${month}-31` } : rest;
    const db = c.get("db");
    const [entries, total] = await Promise.all([
      repo.listEntries(db, query),
      repo.countEntries(db, query),
    ]);
    return c.json({ entries, total });
  });

  app.post("/api/entries", async (c) => {
    const parsed = await body(c, entryInput);
    if (!parsed.ok) return parsed.response;
    return c.json(await repo.createEntry(c.get("db"), parsed.data), 201);
  });

  app.patch("/api/entries/:id", async (c) => {
    const parsed = await body(c, entryPatch);
    if (!parsed.ok) return parsed.response;
    const updated = await repo.updateEntry(c.get("db"), c.req.param("id"), parsed.data);
    if (!updated) return c.json({ error: "No such entry." }, 404);
    return c.json(updated);
  });

  app.delete("/api/entries/:id", async (c) => {
    await repo.deleteEntry(c.get("db"), c.req.param("id"));
    return c.body(null, 204);
  });

  /* -------------------------- accounts and reference ----------------------- */

  app.post("/api/accounts", async (c) => {
    const parsed = await body(c, accountInput);
    if (!parsed.ok) return parsed.response;
    return c.json(await repo.createAccount(c.get("db"), parsed.data), 201);
  });

  app.patch("/api/accounts/:id", async (c) => {
    const parsed = await body(c, accountInput.partial());
    if (!parsed.ok) return parsed.response;
    await repo.updateAccount(c.get("db"), c.req.param("id"), parsed.data);
    return c.json({ ok: true });
  });

  app.delete("/api/accounts/:id", async (c) => {
    await repo.deleteRow(c.get("db"), "accounts", c.req.param("id"));
    return c.body(null, 204);
  });

  /**
   * Say what an account's balance actually is, and let the ledger agree.
   *
   * Rather than overwrite the opening figure — which would silently rewrite what
   * every past entry added up to — this records a dated correction for the
   * difference. History stays intact, the balance comes out right, and the
   * ledger shows when and by how much it was corrected. The correction is
   * flagged so it never counts as income or spending.
   */
  app.post("/api/accounts/:id/balance", async (c) => {
    const parsed = await body(c, setBalanceInput);
    if (!parsed.ok) return parsed.response;

    const db = c.get("db");
    const id = c.req.param("id");
    const account = await repo.getAccount(db, id);
    if (!account) return c.json({ error: "No such account." }, 404);

    const entries = await repo.entriesForAccount(db, id);
    const currentCents = accountBalanceCents(account, entries);
    const deltaCents = parsed.data.balanceCents - currentCents;

    if (deltaCents === 0) {
      return c.json({ ok: true, adjusted: false, balanceCents: currentCents });
    }

    const entry = await repo.createEntry(db, {
      direction: deltaCents > 0 ? "in" : "out",
      amountCents: Math.abs(deltaCents),
      occurredOn: parsed.data.occurredOn ?? todayISO(),
      payee: "Balance correction",
      reason: `${account.name} set to ${formatCents(parsed.data.balanceCents)}`,
      accountId: id,
      toAccountId: null,
      categoryId: null,
      sourceId: null,
      targetId: null,
      repeatRule: null,
      isAdjustment: true,
      scheduleId: null,
    });

    return c.json({ ok: true, adjusted: true, deltaCents, balanceCents: parsed.data.balanceCents, entry });
  });

  app.post("/api/sources", async (c) => {
    const parsed = await body(c, sourceInput);
    if (!parsed.ok) return parsed.response;
    return c.json(await repo.createSource(c.get("db"), parsed.data.name), 201);
  });

  app.post("/api/categories", async (c) => {
    const parsed = await body(c, categoryInput);
    if (!parsed.ok) return parsed.response;
    return c.json(await repo.createCategory(c.get("db"), parsed.data), 201);
  });

  /* --------------------------- assets and liabilities ---------------------- */

  app.post("/api/assets", async (c) => {
    const parsed = await body(c, assetInput);
    if (!parsed.ok) return parsed.response;
    return c.json(await repo.createAsset(c.get("db"), parsed.data), 201);
  });

  app.patch("/api/assets/:id", async (c) => {
    const parsed = await body(c, assetPatch);
    if (!parsed.ok) return parsed.response;
    await repo.updateAsset(c.get("db"), c.req.param("id"), parsed.data);
    return c.json({ ok: true });
  });

  app.delete("/api/assets/:id", async (c) => {
    await repo.deleteRow(c.get("db"), "assets", c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/api/liabilities", async (c) => {
    const parsed = await body(c, liabilityInput);
    if (!parsed.ok) return parsed.response;
    return c.json(await repo.createLiability(c.get("db"), parsed.data), 201);
  });

  app.patch("/api/liabilities/:id", async (c) => {
    const parsed = await body(c, liabilityPatch);
    if (!parsed.ok) return parsed.response;
    await repo.updateLiability(c.get("db"), c.req.param("id"), parsed.data);
    return c.json({ ok: true });
  });

  app.delete("/api/liabilities/:id", async (c) => {
    await repo.deleteRow(c.get("db"), "liabilities", c.req.param("id"));
    return c.body(null, 204);
  });

  /* --------------------------------- targets ------------------------------- */

  app.post("/api/targets", async (c) => {
    const parsed = await body(c, targetInput);
    if (!parsed.ok) return parsed.response;
    return c.json(await repo.createTarget(c.get("db"), parsed.data), 201);
  });

  app.patch("/api/targets/:id", async (c) => {
    const parsed = await body(c, targetPatch);
    if (!parsed.ok) return parsed.response;
    await repo.updateTarget(c.get("db"), c.req.param("id"), parsed.data);
    return c.json({ ok: true });
  });

  app.delete("/api/targets/:id", async (c) => {
    await repo.deleteRow(c.get("db"), "targets", c.req.param("id"));
    return c.body(null, 204);
  });

  /* -------------------------------- schedules ------------------------------ */

  app.post("/api/schedules", async (c) => {
    const parsed = await body(c, scheduleInput);
    if (!parsed.ok) return parsed.response;
    const { nextDue, ...rest } = parsed.data;
    return c.json(
      await repo.createSchedule(c.get("db"), { ...rest, nextDue: nextDue ?? rest.anchorDate }),
      201,
    );
  });

  app.patch("/api/schedules/:id", async (c) => {
    const parsed = await body(c, schedulePatch);
    if (!parsed.ok) return parsed.response;
    await repo.updateSchedule(c.get("db"), c.req.param("id"), parsed.data);
    return c.json({ ok: true });
  });

  app.delete("/api/schedules/:id", async (c) => {
    await repo.deleteRow(c.get("db"), "schedules", c.req.param("id"));
    return c.body(null, 204);
  });

  /** Move a schedule past its current occurrence without recording anything. */
  app.post("/api/schedules/:id/skip", async (c) => {
    const db = c.get("db");
    const schedule = await repo.getSchedule(db, c.req.param("id"));
    if (!schedule) return c.json({ error: "No such schedule." }, 404);

    const nextDue = nextDueAfter(schedule, schedule.nextDue);
    await repo.updateSchedule(db, schedule.id, { nextDue });
    return c.json({ ok: true, nextDue });
  });

  /**
   * Turn occurrences that have come due into real entries.
   *
   * With no body, only rules marked `autoPost` are recorded — those are the ones
   * the bank performs by itself, so they definitely happened. Everything else is
   * named explicitly by the client after you confirm it, which is also how a
   * variable amount gets its figure.
   */
  app.post("/api/schedules/post-due", async (c) => {
    const parsed = await body(c, postDueInput);
    if (!parsed.ok) return parsed.response;

    const db = c.get("db");
    const today = todayISO();
    const schedules = await repo.listSchedules(db);
    const byId = new Map(schedules.map((schedule) => [schedule.id, schedule]));

    const wanted =
      parsed.data.occurrences ??
      schedules
        .filter((schedule) => schedule.autoPost && !schedule.archived)
        .flatMap((schedule) =>
          dueOccurrences(schedule, today).map((occurrence) => ({
            scheduleId: schedule.id,
            occurredOn: occurrence.occurredOn,
            amountCents: undefined as number | undefined,
          })),
        );

    const created = [];
    const skipped: Array<{ scheduleId: string; reason: string }> = [];
    /** Which occurrence dates each schedule actually recorded in this batch. */
    const recorded = new Map<string, Set<string>>();

    for (const item of wanted) {
      const schedule = byId.get(item.scheduleId);
      if (!schedule || schedule.archived) {
        skipped.push({ scheduleId: item.scheduleId, reason: "No such schedule." });
        continue;
      }
      // Never record something that has not happened yet.
      if (item.occurredOn > today) {
        skipped.push({ scheduleId: schedule.id, reason: "That occurrence is in the future." });
        continue;
      }
      const amountCents = item.amountCents ?? schedule.amountCents;
      if (amountCents === null || amountCents === undefined) {
        skipped.push({ scheduleId: schedule.id, reason: "This rule's amount varies; give it one." });
        continue;
      }

      created.push(
        await repo.createEntry(db, {
          direction: schedule.direction,
          amountCents,
          occurredOn: item.occurredOn,
          payee: schedule.payee || schedule.name,
          reason: schedule.reason,
          accountId: schedule.accountId,
          toAccountId: schedule.direction === "transfer" ? schedule.toAccountId : null,
          categoryId: schedule.direction === "transfer" ? null : schedule.categoryId,
          sourceId: schedule.direction === "in" ? schedule.sourceId : null,
          targetId: schedule.targetId,
          repeatRule: null,
          isAdjustment: false,
          scheduleId: schedule.id,
        }),
      );

      const dates = recorded.get(schedule.id) ?? new Set<string>();
      dates.add(item.occurredOn);
      recorded.set(schedule.id, dates);
    }

    /*
     * Move each rule on, without stepping over occurrences that were left alone.
     *
     * Recording only the newest of three due weeks must not quietly bury the two
     * older ones, so the rule lands on the earliest occurrence it still owes and
     * only jumps past the batch when nothing is left behind.
     */
    for (const [scheduleId, dates] of recorded) {
      const schedule = byId.get(scheduleId)!;
      const outstanding = dueOccurrences(schedule, today)
        .map((occurrence) => occurrence.occurredOn)
        .filter((date) => !dates.has(date));

      const latest = [...dates].sort().at(-1)!;
      const nextDue = outstanding.length > 0 ? outstanding[0]! : nextDueAfter(schedule, latest);
      await repo.updateSchedule(db, scheduleId, { nextDue });
    }

    return c.json({ created, skipped, postedCount: created.length });
  });

  /* ---------------------------------- export ------------------------------- */

  /** Your data, on demand, in a format nothing can lock you out of. */
  app.get("/api/export.csv", async (c) => {
    const db = c.get("db");
    const [entries, accounts, categories, sources] = await Promise.all([
      repo.listEntries(db, { limit: 1000 }),
      repo.listAccounts(db),
      repo.listCategories(db),
      repo.listSources(db),
    ]);
    const name = (list: Array<{ id: string; name: string }>, id: string | null) =>
      list.find((row) => row.id === id)?.name ?? "";

    const header = ["Date", "Direction", "Amount", "Payee", "Reason", "Category", "From", "To", "Source"];
    const rows = entries.map((e) => [
      e.occurredOn,
      e.direction,
      (e.amountCents / 100).toFixed(2),
      e.payee,
      e.reason,
      name(categories, e.categoryId),
      name(accounts, e.accountId),
      name(accounts, e.toAccountId),
      name(sources, e.sourceId),
    ]);

    return new Response([header, ...rows].map(toCsvLine).join("\r\n"), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="finance-monitor-${todayISO()}.csv"`,
      },
    });
  });

  app.get("/api/export.json", async (c) => {
    const db = c.get("db");
    const [accounts, sources, categories, assets, liabilities, targets, entries] = await Promise.all([
      repo.listAccounts(db), repo.listSources(db), repo.listCategories(db), repo.listAssets(db),
      repo.listLiabilities(db), repo.listTargets(db), repo.listEntries(db, { limit: 1000 }),
    ]);
    return c.json(
      { exportedAt: new Date().toISOString(), accounts, sources, categories, assets, liabilities, targets, entries },
      200,
      { "content-disposition": `attachment; filename="finance-monitor-${todayISO()}.json"` },
    );
  });

  return app;
}

function toCsvLine(cells: string[]): string {
  return cells.map(toCsvCell).join(",");
}

/**
 * Quote every cell, and defuse anything a spreadsheet would treat as a formula.
 * A payee literally named "=cmd|..." is the classic CSV-injection payload.
 */
function toCsvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}
