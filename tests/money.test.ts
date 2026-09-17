import { describe, expect, it } from "vitest";
import { formatBps, formatCents, formatCompact, parseMoney } from "../src/shared/money.js";

describe("parseMoney", () => {
  it("parses the shapes people actually type", () => {
    expect(parseMoney("142.18")).toEqual({ ok: true, cents: 14218 });
    expect(parseMoney("1,234.56")).toEqual({ ok: true, cents: 123456 });
    expect(parseMoney("$3,710")).toEqual({ ok: true, cents: 371000 });
    expect(parseMoney("  600  ")).toEqual({ ok: true, cents: 60000 });
    expect(parseMoney(".5")).toEqual({ ok: true, cents: 50 });
    expect(parseMoney("1.5")).toEqual({ ok: true, cents: 150 });
    expect(parseMoney("-20")).toEqual({ ok: true, cents: -2000 });
    expect(parseMoney("−20")).toEqual({ ok: true, cents: -2000 });
  });

  it("never introduces floating-point error", () => {
    // 0.1 + 0.2 in cents is exact; the classic float bug cannot occur.
    const a = parseMoney("0.10");
    const b = parseMoney("0.20");
    expect(a.ok && b.ok && a.cents + b.cents).toBe(30);
    expect(parseMoney("19.99")).toEqual({ ok: true, cents: 1999 });
    expect(parseMoney("1850.00")).toEqual({ ok: true, cents: 185000 });
  });

  it("refuses to silently round away someone's money", () => {
    const result = parseMoney("10.005");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toMatch(/two decimal places/);
  });

  it("rejects junk and empty input", () => {
    for (const bad of ["", "   ", "abc", "1.2.3", "12-34", "$", "1e5", "--5"]) {
      expect(parseMoney(bad).ok, `expected ${JSON.stringify(bad)} to be rejected`).toBe(false);
    }
  });

  it("rejects absurd amounts rather than overflowing", () => {
    expect(parseMoney("99999999999999").ok).toBe(false);
  });
});

describe("formatCents", () => {
  it("formats the way a ledger should", () => {
    expect(formatCents(10342971)).toBe("$103,429.71");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(-14218)).toBe("−$142.18");
    expect(formatCents(243358, { signed: true })).toBe("+$2,433.58");
    expect(formatCents(10342971, { whole: true })).toBe("$103,430");
    expect(formatCents(14218, { bare: true })).toBe("142.18");
    expect(formatCents(123456, { currency: "NGN" })).toBe("₦1,234.56");
  });

  it("marks a signed zero as positive rather than negative", () => {
    expect(formatCents(0, { signed: true })).toBe("+$0.00");
  });
});

describe("formatCompact", () => {
  it("shortens big figures for tight spaces", () => {
    expect(formatCompact(10342971)).toBe("$103.4K");
    expect(formatCompact(428600)).toBe("$4.3K");
    expect(formatCompact(420000000)).toBe("$4.2M");
    expect(formatCompact(14218)).toBe("$142");
  });
});

describe("formatBps", () => {
  it("renders rates without float drift", () => {
    expect(formatBps(2124)).toBe("21.24%");
    expect(formatBps(499)).toBe("4.99%");
    expect(formatBps(340)).toBe("3.40%");
  });
});
