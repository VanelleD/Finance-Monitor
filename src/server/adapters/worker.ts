/**
 * Cloudflare runtime: the same API over D1, with the built UI served from the
 * Workers static-asset binding. Everything here fits the free plan.
 */

import { createApp, type AppType } from "../app.js";
import { d1Driver, type D1Like } from "../db/driver.js";
import { ensureSchema } from "../db/migrations.js";

interface Env {
  DB?: D1Like;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  SESSION_SECRET?: string;
}

/**
 * Built once per isolate and reused. `ensureSchema` is idempotent, so the
 * first request after a deploy applies the schema and later ones skip it.
 */
let cached: { app: AppType; schemaReady: Promise<void> } | null = null;

function appFor(db: D1Like, secret: string): { app: AppType; schemaReady: Promise<void> } {
  if (cached) return cached;

  const driver = d1Driver(db);
  const app = createApp(async (c, next) => {
    c.set("db", driver);
    c.set("sessionSecret", secret);
    c.set("secureCookies", true); // workers.dev is always HTTPS
    return next();
  });

  cached = { app, schemaReady: ensureSchema(driver) };
  return cached;
}

/**
 * A deployment can be wired up wrong in exactly two ways, and both used to
 * surface as an unexplained "Worker threw exception". Say what is missing and
 * what to run instead — the person reading this is mid-setup, not debugging.
 */
function misconfigured(missing: string[]): Response {
  const remedies: Record<string, string> = {
    SESSION_SECRET:
      "SESSION_SECRET is not set.\n" +
      "  Locally:   npx wrangler secret put SESSION_SECRET\n" +
      "  Dashboard: Settings -> Variables and Secrets -> Add -> type Secret\n" +
      '  Generate a value with: node -e "console.log(crypto.randomUUID()+crypto.randomUUID())"',
    DB:
      "The D1 database binding is missing.\n" +
      "  npx wrangler d1 create finance-monitor\n" +
      "  then put the printed database_id into wrangler.toml and redeploy.",
    ASSETS:
      "The static assets binding is missing.\n" +
      "  Check [assets] in wrangler.toml and that `npm run build` ran before deploy.\n" +
      "  Wrangler 3 accepted this config without wiring it; use Wrangler 4.",
  };

  const body =
    "Ledger is deployed but not finished being set up.\n\n" +
    missing.map((key) => remedies[key] ?? `${key} is missing.`).join("\n\n") +
    "\n\nNothing is broken in the code — this deployment just needs the step above.\n";

  return new Response(body, {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const missing: string[] = [];
    if (!env.SESSION_SECRET) missing.push("SESSION_SECRET");
    if (!env.DB) missing.push("DB");
    if (!env.ASSETS) missing.push("ASSETS");

    // Answer every route, not just /api/*: a half-configured deployment that
    // served the UI and then failed on every fetch would be worse than useless.
    if (missing.length > 0) return misconfigured(missing);

    const url = new URL(request.url);

    // Static assets never touch the database.
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS!.fetch(request);
    }

    const { app, schemaReady } = appFor(env.DB!, env.SESSION_SECRET!);
    await schemaReady;
    return app.fetch(request, env);
  },
};
