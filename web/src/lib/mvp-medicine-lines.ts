type Source = { id: string; kind: string; chargeId: string; originalId: string | null; reversalId: string | null; quantity: string; quantityScale: number };
type Charge = { id: string; description: string; unit: string; ratePaise: bigint; amountPaise: bigint };
type Reversal = { id: string; amountPaise: bigint };

// Presentation only: the existing return command remains authoritative for quantities and credits.
export function medicineLines<T extends Source>(sources: T[], charges: Charge[], reversals: Reversal[]) {
  const units = (quantity: string, scale: number) => {
    const [whole, fraction = ""] = quantity.split(".");
    return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
  };
  const formatted = (quantity: bigint, scale: number) => {
    const text = quantity.toString().padStart(scale + 1, "0");
    return scale ? `${text.slice(0, -scale)}.${text.slice(-scale)}` : text;
  };
  return sources.map(source => {
    const original = source.kind === "CHARGE" ? source : sources.find(row => row.id === source.originalId);
    const charge = charges.find(row => row.id === source.chargeId);
    const returns = original ? sources.filter(row => row.kind === "RETURN" && row.originalId === original.id) : [];
    const scale = original?.quantityScale ?? source.quantityScale;
    const returned = returns.reduce((total, row) => total + units(row.quantity, scale), 0n);
    const remaining = original ? units(original.quantity, scale) - returned : 0n;
    const credit = (id: string | null) => reversals.find(row => row.id === id)?.amountPaise ?? 0n;
    return { ...source, itemName: charge?.description ?? "Retained medicine source", unit: charge?.unit ?? "units", originalQuantity: original?.quantity ?? source.quantity,
      returnedQuantity: formatted(returned, scale), remainingQuantity: formatted(remaining < 0n ? 0n : remaining, scale),
      unitPricePaise: charge?.ratePaise.toString() ?? "0", amountPaise: (source.kind === "RETURN" ? credit(source.reversalId) : charge?.amountPaise ?? 0n).toString(),
      creditedPaise: returns.reduce((total, row) => total + credit(row.reversalId), 0n).toString() };
  });
}
