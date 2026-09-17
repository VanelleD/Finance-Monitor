/**
 * Money is stored and computed as integer cents, never floats.
 * 0.1 + 0.2 !== 0.3 is not an acceptable property for a ledger.
 */

/** Largest value we accept: ~10 billion dollars. Guards against typos and overflow. */
export const MAX_CENTS = 1_000_000_000_000;

export type ParseResult = { ok: true; cents: number } | { ok: false; error: string };

/**
 * Parse human input into cents. Accepts "1,234.56", "$1234.5", "1234", ".5", "-20".
 * Rejects more than two decimal places rather than silently rounding someone's money.
 */
export function parseMoney(input: string): ParseResult {
  const raw = input.trim();
  if (raw === "") return { ok: false, error: "Enter an amount." };

  const cleaned = raw.replace(/[$\s, ]/g, "").replace(/−/g, "-");
  const match = /^(-|\+)?(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return { ok: false, error: "That doesn't look like an amount." };

  const [, sign, whole = "", frac] = match;
  if (whole === "" && (frac === undefined || frac === "")) {
    return { ok: false, error: "That doesn't look like an amount." };
  }
  if (frac !== undefined && frac.length > 2) {
    return { ok: false, error: "Amounts can have at most two decimal places." };
  }

  const cents = Number(whole || "0") * 100 + Number((frac ?? "").padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents)) return { ok: false, error: "That amount is too large." };
  if (cents > MAX_CENTS) return { ok: false, error: "That amount is too large." };

  return { ok: true, cents: sign === "-" ? -cents : cents };
}

export interface FormatOptions {
  /** Show an explicit + for positive values. */
  signed?: boolean;
  /** Drop the decimals (rounds for display only). */
  whole?: boolean;
  /** Omit the currency symbol. */
  bare?: boolean;
  currency?: string;
}

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£", NGN: "₦" };

/** Format cents for display, e.g. 10342971 -> "$103,429.71". */
export function formatCents(cents: number, options: FormatOptions = {}): string {
  const { signed = false, whole = false, bare = false, currency = "USD" } = options;
  const negative = cents < 0;
  const abs = Math.abs(cents);

  const body = whole
    ? Math.round(abs / 100).toLocaleString("en-US")
    : (abs / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const symbol = bare ? "" : (SYMBOLS[currency] ?? "");
  const prefix = negative ? "−" : signed ? "+" : "";
  return `${prefix}${symbol}${body}`;
}

/** Compact form for tight spaces: 4_286_00 -> "$4.3K", 103_429_71 -> "$103.4K". */
export function formatCompact(cents: number, currency = "USD"): string {
  const abs = Math.abs(cents);
  const symbol = SYMBOLS[currency] ?? "";
  const sign = cents < 0 ? "−" : "";
  const dollars = abs / 100;
  if (dollars >= 1_000_000) return `${sign}${symbol}${trim(dollars / 1_000_000)}M`;
  if (dollars >= 1_000) return `${sign}${symbol}${trim(dollars / 1_000)}K`;
  return `${sign}${symbol}${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function trim(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Percent of a whole, guarding the zero denominator. Returns 0..1 unclamped. */
export function ratio(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return part / whole;
}

/** Basis points to a readable rate: 2124 -> "21.24%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}
