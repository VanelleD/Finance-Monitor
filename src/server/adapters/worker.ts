/**
 * Cloudflare runtime: the same API over D1, with the built UI served from the
 * Workers static-asset binding. Everything here fits the free plan.
 */

import { createApp, type AppType } from "../app.js";
import { d1Driver, type D1Like } from "../db/driver.js";
import { ensureSchema } from "../db/migrations.js";

interface Env {
  DB: D1Like;
  ASSETS: { fetch(request: Request): Promise<Response> };
  SESSION_SECRET?: string;
}

/**
 * Built once per isolate and reused. `ensureSchema` is idempotent, so the
 * first request after a deploy applies the schema and later ones skip it.
 */
let cached: { app: AppType; schemaReady: Promise<void> } | null = null;

function appFor(env: Env): { app: AppType; schemaReady: Promise<void> } {
  if (cached) return cached;

  const db = d1Driver(env.DB);
  const secret = env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Run: npx wrangler secret put SESSION_SECRET");
  }

  const app = createApp(async (c, next) => {
    c.set("db", db);
    c.set("sessionSecret", secret);
    c.set("secureCookies", true); // workers.dev is always HTTPS
    return next();
  });

  cached = { app, schemaReady: ensureSchema(db) };
  return cached;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Static assets never touch the database.
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const { app, schemaReady } = appFor(env);
    await schemaReady;
    return app.fetch(request, env);
  },
};
