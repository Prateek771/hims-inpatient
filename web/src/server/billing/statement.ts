import "server-only";
import { DomainError } from "../contracts";
type Charge = { id: string; sourceEventId: string; category: string; itemId: string; description: string; quantity: string; unit: string; tariffVersionId: string; ratePaise: bigint | string; amountPaise: bigint | string; status: string };
type Stay = { id: string; bedId: string; bedLabel: string; tariffVersionId: string; originalStartedAt: Date | string; originalTariff?: Record<string, unknown> };
export type StatementLine = { kind: "ROOM" | "CHARGE"; description: string; status: string; amountPaise: string; chargeIds: string[]; postingCount: number; tariffVersionId: string; ratePaise: string; rateBasis?: string; stayId?: string; bedId?: string; bedLabel?: string; amendmentId?: string | null; intervalStart?: string; intervalEnd?: string; quantity?: string; unit?: string };
/** Statement presentation only. Ledger events/pricing/responsibility are unchanged. */
export function dischargeStatement(bill: { charges: Charge[]; grossPaise: bigint | string; reversedPaise: bigint | string; netPaise: bigint | string }, stays: Stay[], amendments: Record<string, unknown>[]) {
  const lines: StatementLine[] = [], groups = new Map<string, StatementLine>(), physical = new Map(stays.map(s => [s.id, s])), corrections = new Map(amendments.map(a => [String(a.id), a]));
  for (const c of bill.charges) {
    const source = c.category === "room" && c.unit === "elapsed-ms-cumulative" ? /^room:([0-9a-f-]{36}):\d+(?::([0-9a-f-]{36}))?$/i.exec(c.sourceEventId) : null;
    if (!source) { lines.push({ kind: "CHARGE", description: c.description, quantity: c.quantity, unit: c.unit, status: c.status, amountPaise: String(c.amountPaise), chargeIds: [c.id], postingCount: 1, tariffVersionId: c.tariffVersionId, ratePaise: String(c.ratePaise) }); continue; }
    const stay = physical.get(source[1]), amendmentId = source[2] ?? null, amendment = amendmentId ? corrections.get(amendmentId) : null;
    if (!stay || stay.bedId !== c.itemId || stay.tariffVersionId !== c.tariffVersionId || (amendmentId && (!amendment || amendment.stay_id !== stay.id)) || !/^\d+$/.test(c.quantity)) throw new DomainError("PRECONDITION", "Room statement requires its exact original stay, bed, tariff and amendment source");
    const anchor = amendment?.started_at ?? stay.originalStartedAt;
    const start = new Date(anchor instanceof Date ? anchor.getTime() : String(anchor)), elapsed = BigInt(c.quantity);
    if (!Number.isFinite(start.getTime()) || elapsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError("PRECONDITION", "Room posting interval is not representable");
    const cutoff = new Date(start.getTime() + Number(elapsed)); if (!Number.isFinite(cutoff.getTime())) throw new DomainError("PRECONDITION", "Room posting interval is not representable");
    const key = JSON.stringify([stay.id, c.itemId, c.tariffVersionId, String(c.ratePaise), amendmentId, c.status]), existing = groups.get(key);
    if (existing) {
      existing.amountPaise = (BigInt(existing.amountPaise) + BigInt(c.amountPaise)).toString(); existing.chargeIds.push(c.id); existing.postingCount++;
      if (cutoff.toISOString() > existing.intervalEnd!) existing.intervalEnd = cutoff.toISOString();
    } else {
      const line: StatementLine = { kind: "ROOM", description: c.description, stayId: stay.id, bedId: stay.bedId, bedLabel: stay.bedLabel, tariffVersionId: c.tariffVersionId, ratePaise: String(c.ratePaise), rateBasis: String(stay.originalTariff?.basis ?? "unit not recorded"), amendmentId, status: c.status, amountPaise: String(c.amountPaise), postingCount: 1, chargeIds: [c.id], intervalStart: start.toISOString(), intervalEnd: cutoff.toISOString() };
      groups.set(key, line); lines.push(line);
    }
  }
  if (lines.filter(l => l.status === "FINAL").reduce((n, l) => n + BigInt(l.amountPaise), 0n) !== BigInt(bill.grossPaise)) throw new DomainError("PRECONDITION", "Statement lines do not match the existing finalized gross projection");
  return { lines, rawChargeCount: bill.charges.length, grossPaise: String(bill.grossPaise), reversedPaise: String(bill.reversedPaise), netPaise: String(bill.netPaise) };
}
