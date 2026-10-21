import { describe, expect, it } from "vitest";
import { medicineLines } from "../../src/lib/mvp-medicine-lines";

describe("patient medicine source presentation", () => {
  const sources = [
    { id: "s1", kind: "CHARGE", chargeId: "c1", originalId: null, reversalId: null, quantity: "1.25", quantityScale: 2 },
    { id: "r1", kind: "RETURN", chargeId: "c1", originalId: "s1", reversalId: "v1", quantity: "0.50", quantityScale: 2 },
  ];
  const charges = [{ id: "c1", description: "Training medicine", unit: "pack", ratePaise: 100n, amountPaise: 125n }];
  it("shows original item and exact remaining quantity and linked credit", () => {
    const rows = medicineLines(sources, charges, [{ id: "v1", amountPaise: 50n }]);
    expect(rows[0]).toMatchObject({ itemName: "Training medicine", unit: "pack", returnedQuantity: "0.50", remainingQuantity: "0.75", unitPricePaise: "100", amountPaise: "125", creditedPaise: "50" });
    expect(rows[1]).toMatchObject({ amountPaise: "50", itemName: "Training medicine", originalQuantity: "1.25" });
    expect(sources[0]).not.toHaveProperty("itemName");
  });
  it("does not mix returns across original lines of the same item", () => {
    const rows = medicineLines([...sources, { ...sources[0], id: "s2", chargeId: "c2", quantity: "2" }], [...charges, { ...charges[0], id: "c2" }], []);
    expect(rows[2].remainingQuantity).toBe("2.00");
    expect(rows[1].amountPaise).toBe("0");
  });
});
