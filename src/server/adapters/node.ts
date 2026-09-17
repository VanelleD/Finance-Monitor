/**
 * Local runtime: better-sqlite3 against a file you own, served by Node.
 *
 * Run `npm run dev` for hot-reloading development (Vite serves the UI and
 * proxies /api here). Run `npm run build` then `npm run dev:api` to get the
 * whole app from this one process, with no cloud involved at all.
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

import { createApp } from "../app.js";
import type { Db } from "../db/driver.js";
import { ensureSchema } from "../db/migrations.js";

try {
  process.loadEnvFile(".env");
} catch {
  // No .env yet. Defaults below keep local development working.
}

const ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DATABASE_FILE = resolve(ROOT, process.env.DATABASE_FILE ?? "./data/finance.sqlite");
const PORT = Number(process.env.PORT ?? 8787);

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET === "change-me-to-something-long-and-random") {
  console.error(
    "\nSESSION_SECRET is not set.\n" +
      "  cp .env.example .env\n" +
      '  node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"   # paste into .env\n',
  );
  process.exit(1);
}

mkdirSync(dirname(DATABASE_FILE), { recursive: true });

const sqlite = new Database(DATABASE_FILE);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

/** better-sqlite3 is synchronous and rejects `undefined`; both are smoothed over here. */
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
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    return value;
  });
}

await ensureSchema(db);

const app = createApp(async (c, next) => {
  c.set("db", db);
  c.set("sessionSecret", SESSION_SECRET);
  c.set("secureCookies", false); // plain HTTP on localhost
  return next();
});

// If the client has been built, serve it from here too, so this one process is the whole app.
const CLIENT_DIR = resolve(ROOT, "dist/client");
if (existsSync(CLIENT_DIR)) {
  app.use("/*", serveStatic({ root: "./dist/client" }));
  app.get("/*", serveStatic({ path: "./dist/client/index.html" }));
} else {
  app.get("/", (c) =>
    c.text("API is up. Run `npm run dev:web` for the UI, or `npm run build` to serve it from here.\n"),
  );
}

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Finance Monitor API  http://localhost:${info.port}`);
  console.log(`Database             ${DATABASE_FILE}`);
  if (!existsSync(CLIENT_DIR)) console.log(`UI                   http://localhost:5173 (npm run dev)`);
});
