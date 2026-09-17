/**
 * The only database surface the rest of the server sees.
 *
 * Both backends are SQLite: `better-sqlite3` on your laptop and Cloudflare D1
 * in the cloud. Keeping them behind one narrow interface is what lets the same
 * schema, the same queries and the same code run in both places.
 */

export type Row = Record<string, unknown>;

export interface Db {
  all<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: unknown[]): Promise<T | undefined>;
  run(sql: string, params?: unknown[]): Promise<void>;
}

/** The minimum of Cloudflare's D1 API that we use, declared here to avoid pulling in global Worker types. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
}

export function d1Driver(d1: D1Like): Db {
  return {
    async all<T>(sql: string, params: unknown[] = []) {
      const { results } = await d1.prepare(sql).bind(...params).all<T>();
      return results ?? [];
    },
    async get<T>(sql: string, params: unknown[] = []) {
      const row = await d1.prepare(sql).bind(...params).first<T>();
      return row ?? undefined;
    },
    async run(sql: string, params: unknown[] = []) {
      await d1.prepare(sql).bind(...params).run();
    },
  };
}
