import { it, expect } from "vitest";
import { canonicalJSON, snapshotHash } from "../../src/server/documents/snapshot";
import { createHash } from "node:crypto";
import * as snapshots from "../../src/server/documents/snapshot";
it("supports complete long-stay event lists and rejects excess without truncating source", () => {
  expect(snapshots).toHaveProperty("assertDocumentSourceSize");
  const charges = Array.from({ length: 50000 }, (_, i) => ({ id: `Original event ${i}`, amountPaise: "100" }));
  expect(() => snapshots.assertDocumentSourceSize({ money: { bill: { charges } } })).not.toThrow();
  expect(charges.at(-1)?.id).toBe("Original event 49999");
  expect(() => snapshots.assertDocumentSourceSize({ money: { bill: { charges: [...charges, { id: "Excess original event", amountPaise: "100" }] } } })).toThrow("50000");
  expect(() => snapshots.assertDocumentSourceSize({ money: { bill: { charges }, statement: { lines: Array(2501).fill("Actual separate statement line") } } })).toThrow("2500");
  expect(() => snapshots.assertDocumentSourceSize({ money: { bill: { charges } }, notes: "x".repeat(64_000_001) })).toThrow("64000000");
});
it("canonical discharge hashes retain exact dates, paise and array order across JSONB object-key ordering", () => {
  const value = { z: [{ y: 1, a: "José सावधानी" }], date: new Date("2026-10-09T18:00:00.000Z"), amount: 9223372036854775807n };
  const literal = '{"amount":"9223372036854775807","date":"2026-10-09T18:00:00.000Z","z":[{"a":"José सावधानी","y":1}]}';
  expect(canonicalJSON(value)).toBe(literal);
  expect(snapshotHash(value)).toBe(createHash("sha256").update(literal).digest("hex"));
  expect(snapshotHash({ date: "2026-10-09T18:00:00.000Z", amount: "9223372036854775807", z: [{ a: "José सावधानी", y: 1 }] })).toBe(snapshotHash(value));
  expect(snapshotHash({ rows: ["charge", "refund"] })).not.toBe(snapshotHash({ rows: ["refund", "charge"] }));
  expect(snapshotHash({ paise: "100" })).not.toBe(snapshotHash({ paise: "101" }));
});
