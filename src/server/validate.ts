/** Request-body schemas. Nothing reaches SQL without passing through here. */

import { z } from "zod";
import { MAX_CENTS } from "../shared/money.js";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
  .refine((value) => {
    // Rejects 2026-02-31, which the regex alone would happily accept.
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, "That date doesn't exist.");

const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.");
const cents = z.number().int().min(0).max(MAX_CENTS);
const positiveCents = z.number().int().positive().max(MAX_CENTS);
const id = z.string().min(1).max(64);
const optionalId = id.nullable().default(null);

export const entryInput = z
  .object({
    direction: z.enum(["in", "out", "transfer"]),
    amountCents: positiveCents,
    occurredOn: isoDate,
    payee: z.string().trim().max(200).default(""),
    reason: z.string().trim().max(1000).default(""),
    accountId: optionalId,
    toAccountId: optionalId,
    categoryId: optionalId,
    sourceId: optionalId,
    targetId: optionalId,
    repeatRule: z.enum(["weekly", "monthly", "yearly"]).nullable().default(null),
  })
  .superRefine((value, ctx) => {
    if (value.direction === "transfer") {
      if (!value.toAccountId) {
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "A transfer needs a destination account." });
      } else if (value.toAccountId === value.accountId) {
        ctx.addIssue({ code: "custom", path: ["toAccountId"], message: "A transfer must move between two different accounts." });
      }
    }
  });

export const entryPatch = entryInput.innerType().partial();

export const accountInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["checking", "savings", "cash", "brokerage", "credit_card"]),
  currency: z.string().trim().length(3).default("USD"),
  openingCents: z.number().int().min(-MAX_CENTS).max(MAX_CENTS).default(0),
  archived: z.boolean().default(false),
});

export const sourceInput = z.object({ name: z.string().trim().min(1).max(120) });

export const categoryInput = z.object({
  name: z.string().trim().min(1).max(120),
  direction: z.enum(["in", "out"]),
  archived: z.boolean().default(false),
});

export const assetInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["cash", "investment", "property", "vehicle", "other"]),
  valueCents: cents,
  valuedOn: isoDate,
  accountId: optionalId,
  archived: z.boolean().default(false),
});

export const liabilityInput = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["credit_card", "loan", "mortgage", "other"]),
  balanceCents: cents,
  aprBps: z.number().int().min(0).max(100_000).nullable().default(null),
  minPaymentCents: cents.nullable().default(null),
  dueDay: z.number().int().min(1).max(31).nullable().default(null),
  archived: z.boolean().default(false),
});

export const targetInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(["save_to", "pay_off", "spend_under", "net_worth"]),
    amountCents: positiveCents,
    deadline: isoDate.nullable().default(null),
    accountId: optionalId,
    liabilityId: optionalId,
    categoryId: optionalId,
    baselineCents: cents.default(0),
    archived: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.kind === "pay_off" && !value.liabilityId) {
      ctx.addIssue({ code: "custom", path: ["liabilityId"], message: "Choose which debt this target clears." });
    }
    if (value.kind === "spend_under" && !value.categoryId) {
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose which category the cap applies to." });
    }
  });

export const assetPatch = assetInput.partial();
export const liabilityPatch = liabilityInput.partial();
export const targetPatch = targetInput.innerType().partial();

export const derivedKeyInput = z.object({
  derivedKey: z.string().min(40).max(128),
});

export const entryQueryInput = z.object({
  month: isoMonth.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  direction: z.enum(["in", "out", "transfer"]).optional(),
  categoryId: id.optional(),
  accountId: id.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const snapshotQueryInput = z.object({ month: isoMonth.optional() });

/** Flatten a Zod error into `{ field: message }` for the client to render inline. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    out[key] ??= issue.message;
  }
  return out;
}
