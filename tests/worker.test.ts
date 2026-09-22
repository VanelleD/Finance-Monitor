/**
 * Tests the Cloudflare entrypoint itself: what it does when a deployment is
 * wired up wrong, and that the D1 driver works against real SQLite.
 *
 * A half-configured deployment used to surface as "Worker threw exception",
 * which tells the person setting it up nothing. These pin the replacement.
 */

import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { D1Like } from "../src/server/db/driver.js";

/** better-sqlite3 dressed up in D1's shape, which is what the Worker is handed. */
function d1Stub(): D1Like {
  const sqlite = new Database(":memory:");
  const normalise = (values: unknown[]) =>
    values.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));

  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const bound = normalise(values);
          return {
            async all<T>() {
              return { results: sqlite.prepare(sql).all(...bound) as T[] };
            },
            async first<T>() {
              return (sqlite.prepare(sql).get(...bound) ?? null) as T | null;
            },
            async run() {
              return sqlite.prepare(sql).run(...bound);
            },
          };
        },
      };
    },
  };
}

function assetsStub(body = "<!doctype html><div id=\"root\"></div>") {
  return {
    fetch: async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/html" } }),
  };
}

async function loadWorker() {
  vi.resetModules(); // the entrypoint caches its app per isolate
  return (await import("../src/server/adapters/worker.js")).default;
}

const url = (path: string) => new Request(`https://ledger.test${path}`);

beforeEach(() => {
  vi.resetModules();
});

describe("a deployment that is not finished being set up", () => {
  it("explains a missing SESSION_SECRET instead of throwing", async () => {
    const worker = await loadWorker();
    const response = await worker.fetch(url("/"), { DB: d1Stub(), ASSETS: assetsStub() });

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("SESSION_SECRET is not set");
    expect(body).toContain("wrangler secret put SESSION_SECRET");
    expect(body).toContain("Variables and Secrets"); // the dashboard route, for Git-connected deploys
  });

  it("explains a missing D1 binding", async () => {
    const worker = await loadWorker();
    const response = await worker.fetch(url("/api/health"), {
      SESSION_SECRET: "x".repeat(40),
      ASSETS: assetsStub(),
    });

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("D1 database binding is missing");
    expect(body).toContain("wrangler d1 create finance-monitor");
  });

  it("explains a missing assets binding", async () => {
    const worker = await loadWorker();
    const response = await worker.fetch(url("/"), {
      SESSION_SECRET: "x".repeat(40),
      DB: d1Stub(),
    });

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("static assets binding is missing");
  });

  it("answers every route while misconfigured, not just the API", async () => {
    const worker = await loadWorker();
    for (const path of ["/", "/targets", "/api/snapshot", "/assets/index.css"]) {
      const response = await worker.fetch(url(path), { DB: d1Stub(), ASSETS: assetsStub() });
      expect(response.status, path).toBe(503);
    }
  });

  it("reports both problems at once when both are missing", async () => {
    const worker = await loadWorker();
    const body = await (await worker.fetch(url("/"), {})).text();
    expect(body).toContain("SESSION_SECRET");
    expect(body).toContain("D1 database binding");
    expect(body).toContain("static assets binding");
  });

  it("never caches a response a browser would keep after the fix", async () => {
    const worker = await loadWorker();
    const response = await worker.fetch(url("/"), {});
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

describe("a deployment that is set up", () => {
  const env = () => ({ SESSION_SECRET: "x".repeat(40), DB: d1Stub(), ASSETS: assetsStub() });

  it("serves the UI from the assets binding", async () => {
    const worker = await loadWorker();
    const response = await worker.fetch(url("/"), env());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('id="root"');
  });

  it("applies the schema on the first API request and serves the API over D1", async () => {
    const worker = await loadWorker();
    const ready = env();

    // Unauthenticated, so this proves routing and the guard, not the data.
    const guarded = await worker.fetch(url("/api/snapshot"), ready);
    expect(guarded.status).toBe(401);

    const health = await worker.fetch(url("/api/health"), ready);
    expect(health.status).toBe(200);

    // The schema having applied is what makes this reachable at all.
    const params = await worker.fetch(url("/api/auth/params"), ready);
    expect(params.status).toBe(200);
    const payload = (await params.json()) as { salt: string; iterations: number };
    expect(payload.salt).toEqual(expect.any(String));
    expect(payload.iterations).toBeGreaterThanOrEqual(600_000);
  });

  it("routes non-API paths to assets and API paths to the app", async () => {
    const worker = await loadWorker();
    const ready = env();
    expect((await worker.fetch(url("/targets"), ready)).status).toBe(200);
    expect((await worker.fetch(url("/api/entries"), ready)).status).toBe(401);
  });
});
