import { DomainError } from "../contracts";
export const MAX_PAISE = 9223372036854775807n;
export function paise(value: string | bigint): bigint {
  if (typeof value === "string" && !/^\d{1,19}$/.test(value))
    throw new DomainError("VALIDATION", "Use integer paise");
  const result = BigInt(value);
  if (result < 0n || result > MAX_PAISE)
    throw new DomainError("VALIDATION", "Money is outside the supported range");
  return result;
}
export function parseINR(value: string): bigint {
  if (!/^\d{1,16}(\.\d{1,2})?$/.test(value))
    throw new DomainError("VALIDATION", "Enter INR with at most two decimal places");
  const [r, p = ""] = value.split(".");
  return paise(BigInt(r) * 100n + BigInt(p.padEnd(2, "0")));
}
export function formatINR(value: bigint): string {
  const sign = value < 0n ? "−" : "";
  const amount = value < 0n ? -value : value;
  return `${sign}₹${(amount / 100n).toLocaleString("en-IN")}.${(amount % 100n).toString().padStart(2, "0")}`;
}
const halfUp = (numerator: bigint, denominator: bigint) => (numerator * 2n + denominator) / (denominator * 2n);
export function quantityAmount(rate: bigint, quantity: string, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0 || scale > 6 || !/^\d{1,12}(\.\d{1,6})?$/.test(quantity))
    throw new DomainError("VALIDATION", "Invalid quantity");
  const [whole, fraction = ""] = quantity.split(".");
  if (fraction.length > scale)
    throw new DomainError("VALIDATION", "Quantity exceeds the configured decimal scale");
  const numerator = BigInt(whole + fraction);
  if (numerator === 0n)
    throw new DomainError("VALIDATION", "Quantity must be positive");
  return paise(halfUp(paise(rate) * numerator, 10n ** BigInt(fraction.length)));
}
export type RoomPolicy = {
  amount: string;
  basis: "hour" | "24-hours";
  rounding: "exact" | "started-unit";
  graceMinutes: number;
  graceMode?: "deduct-once";
};
export function roomDue(policy: RoomPolicy, elapsedMs: number): bigint {
  if (!Number.isSafeInteger(elapsedMs) || elapsedMs < 0)
    throw new DomainError("VALIDATION", "Invalid stay duration");
  if (!Number.isInteger(policy.graceMinutes) || policy.graceMinutes < 0 || policy.graceMinutes > 1440 || (policy.graceMinutes > 0 && policy.graceMode !== "deduct-once"))
    throw new DomainError("PRECONDITION", "Explicit grace behavior must be configured");
  const unit = policy.basis === "hour" ? 3600000n : 86400000n;
  const elapsed = BigInt(Math.max(0, elapsedMs - policy.graceMinutes * 60000));
  const rate = paise(policy.amount);
  return paise(policy.rounding === "started-unit" ? ((elapsed + unit - 1n) / unit) * rate : halfUp(elapsed * rate, unit));
}
