import "server-only";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "../audit";
import { DomainError, type CommandContext } from "../contracts";
import type { Transaction } from "../db";
import { admissionOperator } from "../admissions/commands";
import { roomStays } from "../admissions/schema";
import { settingVersions } from "../schema/core";
import { charges } from "./schema";
import { actorColumns, bumpBillRevision, fingerprint, roomPolicyInput } from "./commands";
import { paise, roomDue } from "./money";
function validateCutoff(cutoff: Date) {
  if (!(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime()) || cutoff.getTime() > Date.now())
    throw new DomainError("VALIDATION", "Use a valid cutoff no later than now");
}
async function roomDeltas(tx: Transaction, admissionId: string, cutoff: Date) {
  validateCutoff(cutoff);
  const stays = await tx.select({ stay: roomStays, version: settingVersions }).from(roomStays).innerJoin(settingVersions, eq(roomStays.tariffVersionId, settingVersions.id)).where(eq(roomStays.admissionId, admissionId)).orderBy(asc(roomStays.startedAt));
  return stays.map(({ stay, version }) => {
    const end = new Date(Math.min(cutoff.getTime(), stay.endedAt?.getTime() ?? Infinity));
    if (end < stay.startedAt || (stay.lastReconciledAt && end < stay.lastReconciledAt))
      throw new DomainError("CONFLICT", "Cutoff precedes the stay or committed charge cursor; history cannot be repriced backwards");
    const policy = roomPolicyInput.parse(version.payload);
    const due = roomDue(policy, end.getTime() - stay.startedAt.getTime());
    if (due < stay.postedPaise)
      throw new DomainError("CONFLICT", "Room charge history exceeds the computed cumulative amount");
    return {
      stay, policy, end, due, delta: due - stay.postedPaise
    };
  });
}
export async function estimateRoomChargesInTransaction(tx: Transaction, admissionId: string, cutoff: Date) {
  return (await roomDeltas(tx, admissionId, cutoff)).reduce((n, row) => n + row.delta, 0n);
}
/** Admission already locked by the caller. Compose transfer/final cutoff here; never invoke the global worker inside a transaction. */
export async function reconcileRoomChargesInTransaction(tx: Transaction, input: {
  admissionId: string;
  cutoff: Date;
  actorContext: CommandContext;
}) {
  const ctx = input.actorContext;
  if (ctx.actor.type === "system") {
    if (ctx.actor.systemId !== "room-charge" || ctx.source !== "room-worker")
      throw new DomainError("FORBIDDEN", "Room worker actor required");
    z.uuid().parse(ctx.requestId);
  }
  else
    await admissionOperator(ctx, ["ADMIN", "BILLING", "DOCTOR", "NURSE"], tx);
  const deltas = await roomDeltas(tx, input.admissionId, input.cutoff);
  for (const { stay, policy, end, due, delta } of deltas) {
    if (delta > 0n) {
      const sourceEventId = `room:${stay.id}:${due}`;
      const [line] = await tx.insert(charges).values({
        admissionId: stay.admissionId, sourceEventId, sourcePayload: fingerprint({ stayId: stay.id, cutoff: end.toISOString(), due: due.toString() }), category: "room", itemId: stay.bedId, description: `Room · ${policy.category}`, quantity: (end.getTime() - stay.startedAt.getTime()).toString(), unit: "elapsed-ms-cumulative", tariffVersionId: stay.tariffVersionId, ratePaise: paise(policy.amount), amountPaise: delta, initialStatus: "FINAL", ...actorColumns(ctx)
      }).returning();
      const revision = await bumpBillRevision(tx, stay.admissionId);
      await appendAudit(tx, ctx, {
        event: "billing.room-reconciled", entityType: "charge", entityId: line.id, reason: `Cumulative room due through ${end.toISOString()}; append delta only`, afterVersion: revision
      });
    }
    if (!stay.lastReconciledAt || end > stay.lastReconciledAt)
      await tx.update(roomStays).set({ lastReconciledAt: end, postedPaise: due }).where(eq(roomStays.id, stay.id));
  }
  return deltas.reduce((n, row) => n + row.delta, 0n);
}
