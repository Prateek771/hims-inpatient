import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import type { Transaction } from "../db";
import { transferOrders, transferOrderCancellations, admissionTransfers } from "./transfer-schema";
import { admissions, effectiveRoomStays } from "./schema";
/** Shared current authority for care, transfers, discharge and worklists; originals remain immutable. */
export async function transferAuthority(tx: Transaction, admissionId: string) {
  const orders = await tx.select().from(transferOrders).where(eq(transferOrders.admissionId, admissionId)).orderBy(desc(transferOrders.version));
  const cancellations = await tx.select().from(transferOrderCancellations).where(eq(transferOrderCancellations.admissionId, admissionId));
  const history = await tx.select().from(admissionTransfers).where(eq(admissionTransfers.admissionId, admissionId));
  const stays = await tx.select({ id: effectiveRoomStays.id, endedAt: effectiveRoomStays.endedAt }).from(effectiveRoomStays).where(eq(effectiveRoomStays.admissionId, admissionId));
  const [episode] = await tx.select({ status: admissions.status }).from(admissions).where(eq(admissions.id, admissionId));
  const witnesses = (await tx.execute<{ source_id: string; actual_at: Date | string }>(sql`select source_id,actual_at from hims.exception_evidence where admission_id=${admissionId} and kind='TRANSFER_HANDOVER'`)).rows;
  return { cancellations, orders: orders.map((o, i) => {
    const completed = history.some(t => t.transferOrderId === o.id), cancellation = cancellations.find(c => c.transferOrderId === o.id), current = i === 0 && episode?.status === "ADMITTED" && stays.some(s => s.id === o.sourceStayId && !s.endedAt);
    const factual = witnesses.some(w => w.source_id === o.id && (!cancellation || new Date(w.actual_at) < cancellation.signedAt));
    return { ...o, cancelledAt: cancellation?.signedAt ?? null, pendingFactualMove: current && !completed && factual, status: completed ? "COMPLETED" : cancellation ? "CANCELLED" : !current ? "SUPERSEDED" : factual ? "WITNESSED" : "PENDING" };
  }) };
}
