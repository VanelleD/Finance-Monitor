/** Thin fetch wrapper. Everything goes through `request`, so errors behave the same everywhere. */

import type {
  Account, Asset, Category, Entry, Liability, Schedule, Source, Target,
} from "@shared/types.js";

export class ApiError extends Error {
  readonly status: number;
  readonly fields: Record<string, string>;
  readonly retryAfterSeconds?: number;

  constructor(status: number, message: string, fields: Record<string, string> = {}, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      headers: init?.body ? { "content-type": "application/json" } : undefined,
      ...init,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.");
  }

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? ((await response.json()) as Record<string, unknown>) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      (payload?.error as string) ?? `Request failed (${response.status}).`,
      (payload?.fields as Record<string, string>) ?? {},
      payload?.retryAfterSeconds as number | undefined,
    );
  }
  return payload as T;
}

const post = <T>(path: string, data: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(data) });
const patch = <T>(path: string, data: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(data) });
const remove = (path: string) => request<void>(path, { method: "DELETE" });

export interface Snapshot {
  today: string;
  month: string;
  accounts: Account[];
  sources: Source[];
  categories: Category[];
  assets: Asset[];
  liabilities: Liability[];
  targets: Target[];
  schedules: Schedule[];
  entries: Entry[];
  /** Each account's balance, derived server-side from the full ledger. */
  balances: Record<string, number>;
}

export interface EntryQuery {
  month?: string;
  direction?: Entry["direction"];
  categoryId?: string;
  accountId?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

function toQueryString(query: object): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query) as Array<[string, unknown]>) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export const api = {
  authState: () => request<{ configured: boolean; authenticated: boolean }>("/auth/state"),
  authParams: () =>
    request<{ salt: string; iterations: number; hash: string; keyLengthBytes: number }>("/auth/params"),
  setup: (derivedKey: string) => post<{ ok: true }>("/auth/setup", { derivedKey }),
  login: (derivedKey: string) => post<{ ok: true }>("/auth/login", { derivedKey }),
  logout: () => post<{ ok: true }>("/auth/logout", {}),

  snapshot: (month?: string) => request<Snapshot>(`/snapshot${toQueryString({ month })}`),
  entries: (query: EntryQuery) =>
    request<{ entries: Entry[]; total: number }>(`/entries${toQueryString(query)}`),

  createEntry: (input: Omit<Entry, "id">) => post<Entry>("/entries", input),
  updateEntry: (id: string, input: Partial<Omit<Entry, "id">>) => patch<Entry>(`/entries/${id}`, input),
  deleteEntry: (id: string) => remove(`/entries/${id}`),

  createAccount: (input: Omit<Account, "id">) => post<Account>("/accounts", input),
  updateAccount: (id: string, input: Partial<Omit<Account, "id">>) => patch(`/accounts/${id}`, input),
  deleteAccount: (id: string) => remove(`/accounts/${id}`),
  /** State what an account really holds; the server records the difference. */
  setBalance: (id: string, balanceCents: number, occurredOn?: string) =>
    post<{ ok: true; adjusted: boolean; deltaCents?: number; balanceCents: number }>(
      `/accounts/${id}/balance`,
      { balanceCents, occurredOn },
    ),
  createSource: (name: string) => post<Source>("/sources", { name }),
  createCategory: (input: Omit<Category, "id">) => post<Category>("/categories", input),

  createAsset: (input: Omit<Asset, "id">) => post<Asset>("/assets", input),
  updateAsset: (id: string, input: Partial<Omit<Asset, "id">>) => patch(`/assets/${id}`, input),
  deleteAsset: (id: string) => remove(`/assets/${id}`),

  createLiability: (input: Omit<Liability, "id">) => post<Liability>("/liabilities", input),
  updateLiability: (id: string, input: Partial<Omit<Liability, "id">>) => patch(`/liabilities/${id}`, input),
  deleteLiability: (id: string) => remove(`/liabilities/${id}`),

  createSchedule: (input: Omit<Schedule, "id" | "nextDue"> & { nextDue?: string }) =>
    post<Schedule>("/schedules", input),
  updateSchedule: (id: string, input: Partial<Omit<Schedule, "id">>) => patch(`/schedules/${id}`, input),
  deleteSchedule: (id: string) => remove(`/schedules/${id}`),
  skipSchedule: (id: string) => post<{ ok: true; nextDue: string }>(`/schedules/${id}/skip`, {}),
  postDue: (occurrences?: Array<{ scheduleId: string; occurredOn: string; amountCents?: number }>) =>
    post<{ postedCount: number; skipped: Array<{ scheduleId: string; reason: string }> }>(
      "/schedules/post-due",
      occurrences ? { occurrences } : {},
    ),

  createTarget: (input: Omit<Target, "id">) => post<Target>("/targets", input),
  updateTarget: (id: string, input: Partial<Omit<Target, "id">>) => patch(`/targets/${id}`, input),
  deleteTarget: (id: string) => remove(`/targets/${id}`),
};
