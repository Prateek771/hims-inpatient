import { describe, expect, it } from "vitest";
import { parseINR, paise, quantityAmount, roomDue, formatINR } from "../../src/server/billing/money";
describe("exact paise and quantities", () => {
  it("keeps INR input distinct from stored paise and formats without floating money", () => {
    expect(parseINR("120000")).toBe(12000000n);
    expect(paise("12000000") - paise("500000")).toBe(11500000n);
    expect(parseINR("0.01")).toBe(1n);
    expect(formatINR(11500000n)).toBe("₹1,15,000.00");
    for (const v of ["-1", "1.001", "1e4", "", "9223372036854775808"])
      expect(() => parseINR(v)).toThrow();
    expect(() => paise("9223372036854775808")).toThrow();
  });
  it("uses configured quantity scale and half-up paise rounding", () => {
    expect(quantityAmount(101n, "0.5", 1)).toBe(51n);
    expect(quantityAmount(101n, "0.25", 2)).toBe(25n);
    for (const v of ["0", "-1", "1.1", "1e2", "1.00", "NaN"])
      expect(() => quantityAmount(100n, v, 0)).toThrow();
    expect(() => quantityAmount(9223372036854775807n, "2", 0)).toThrow();
  });
  it("calculates cumulative half-open hourly and day boundaries, not polling fragments", () => {
    const p = {
      amount: "10001", basis: "hour" as const, rounding: "exact" as const, graceMinutes: 0
    };
    expect(roomDue(p, 3600000)).toBe(10001n);
    expect(roomDue(p, 1800000)).toBe(5001n);
    expect(roomDue(p, 3600000) - roomDue(p, 1800000)).toBe(5000n);
    const d = { ...p, basis: "24-hours" as const, rounding: "started-unit" as const };
    expect(roomDue(d, 0)).toBe(0n);
    expect(roomDue(d, 86400000)).toBe(10001n);
    expect(roomDue(d, 86400001)).toBe(20002n);
    expect(() => roomDue(p, -1)).toThrow();
  });
  it("deducts explicitly configured grace once per stay and refuses ambiguous legacy grace", () => {
    const p = {
      amount: "6000", basis: "hour" as const, rounding: "started-unit" as const, graceMinutes: 10, graceMode: "deduct-once" as const
    };
    expect(roomDue(p, 600000)).toBe(0n);
    expect(roomDue(p, 600001)).toBe(6000n);
    expect(roomDue(p, 4200000)).toBe(6000n);
    expect(roomDue(p, 4200001)).toBe(12000n);
    expect(() => roomDue({ ...p, graceMode: undefined }, 3600000)).toThrow();
  });
});
