import { describe, expect, it } from "vitest";
import { affectedRows, dbError, newId, rowsOf, toDate } from "../../src/server/sql";

describe("MariaDB result helpers", () => {
  it("unwraps execute() results", () => {
    expect(rowsOf([[{ a: 1 }], []])).toEqual([{ a: 1 }]);
    expect(rowsOf([{ affectedRows: 2 }, undefined])).toEqual([]);
    // 1-digit integer columns (BOOLEAN, EXISTS, comparisons) become booleans; wider integers stay numbers
    const fields = [{ name: "flag", columnType: 3, columnLength: 1 }, { name: "active", columnType: 1, columnLength: 1 }, { name: "n", columnType: 3, columnLength: 11 }];
    expect(rowsOf([[{ flag: 1, active: 0, n: 1 }, { flag: null, active: 1, n: 0 }], fields])).toEqual([{ flag: true, active: false, n: 1 }, { flag: null, active: true, n: 0 }]);
    expect(affectedRows([{ affectedRows: 2 }, undefined])).toBe(2);
  });

  it("parses raw UTC timestamps and rejects junk", () => {
    expect(toDate("2026-11-05 03:30:00.123456").toISOString()).toBe("2026-11-05T03:30:00.123Z");
    expect(toDate("2026-11-05T03:30:00Z").toISOString()).toBe("2026-11-05T03:30:00.000Z");
    expect(() => toDate("not a date")).toThrow();
  });

  it("classifies driver errors through Drizzle's cause chain", () => {
    expect(dbError(new Error("x", { cause: { errno: 1062, sqlMessage: "Duplicate entry" } }))).toMatchObject({ kind: "unique", errno: 1062 });
    expect(dbError({ errno: 1644, sqlMessage: "Billing history is immutable" })).toEqual({ kind: "rule", errno: 1644, message: "Billing history is immutable" });
    expect(dbError(new Error("plain")).kind).toBe("other");
  });

  it("generates distinct v4 ids", () => {
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    expect(newId()).not.toBe(newId());
  });
});
