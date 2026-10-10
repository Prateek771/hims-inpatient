import "server-only";
import { getViewSelectedFields } from "drizzle-orm";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "../audit";
import { DomainError, type CommandContext } from "../contracts";
import type { Transaction } from "../db";
import { admissionOperator } from "../admissions/commands";
import { roomStays as originalRoomStays, effectiveRoomStays as roomStays } from "../admissions/schema";
import { settingVersions } from "../schema/core";
import { charges, chargeReversals } from "./schema";
import { actorColumns, bumpBillRevision, fingerprint, roomPolicyInput } from "./commands";
import { paise, roomDue } from "./money";
function validateCutoff(cutoff: Date) {
  if (!(cutoff instanceof Date) || !Number.isFinite(cutoff.getTime()) || cutoff.getTime() > Date.now())
    throw new DomainError("VALIDATION", "Use a valid cutoff no later than now");
}
async function roomDeltas(tx: Transaction, admissionId: string, cutoff: Date) {
  validateCutoff(cutoff);
  const stays = await tx.select({ stay: getViewSelectedFields(roomStays), version: settingVersions }).from(roomStays).innerJoin(settingVersions, eq(roomStays.tariffVersionId, settingVersions.id)).where(eq(roomStays.admissionId, admissionId)).orderBy(asc(roomStays.startedAt));
  return Promise.all(stays.map(async ({ stay, version }) => {
    const end = new Date(Math.min(cutoff.getTime(), stay.endedAt?.getTime() ?? Infinity));
    if (end < stay.startedAt || (!stay.amendmentId && stay.lastReconciledAt && end < stay.lastReconciledAt))
      throw new DomainError("CONFLICT", "Cutoff precedes the stay or committed charge cursor; history cannot be repriced backwards");
    const policy = roomPolicyInput.parse(version.payload);
    const due = roomDue(policy, end.getTime() - stay.startedAt.getTime());
    const net = stay.amendmentId ? (await tx.execute(sql`select coalesce(sum(c.amount_paise-coalesce((select sum(r.amount_paise) from hims.charge_reversals r where r.charge_id=c.id),0)),0)::text amount from hims.charges c where c.admission_id=${admissionId} and c.source_event_id like ${`room:${stay.id}:%`}`)).rows[0] : undefined;
    const posted = net ? BigInt(String(net.amount)) : stay.postedPaise;
    if (due < posted)
      throw new DomainError("CONFLICT", "Room charge history exceeds the computed cumulative amount");
    return {
      stay, policy, end, due, delta: due - posted
    };
  }));
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
      const sourceEventId = `room:${stay.id}:${due}${stay.amendmentId?`:${stay.amendmentId}`:""}`;
      const [line] = await tx.insert(charges).values({
        admissionId: stay.admissionId, sourceEventId, sourcePayload: fingerprint({ stayId: stay.id, cutoff: end.toISOString(), due: due.toString() }), category: "room", itemId: stay.bedId, description: `Room · ${policy.category}`, quantity: (end.getTime() - stay.startedAt.getTime()).toString(), unit: "elapsed-ms-cumulative", tariffVersionId: stay.tariffVersionId, ratePaise: paise(policy.amount), amountPaise: delta, initialStatus: "FINAL", ...actorColumns(ctx)
      }).returning();
      const revision = await bumpBillRevision(tx, stay.admissionId);
      await appendAudit(tx, ctx, {
        event: "billing.room-reconciled", entityType: "charge", entityId: line.id, reason: `Cumulative room due through ${end.toISOString()}; append delta only`, afterVersion: revision
      });
    }
    if (!stay.amendmentId && (!stay.lastReconciledAt || end > stay.lastReconciledAt))
      await tx.update(originalRoomStays).set({ lastReconciledAt: end, postedPaise: due }).where(eq(originalRoomStays.id, stay.id));
  }
  return deltas.reduce((n, row) => n + row.delta, 0n);
}
/** Original-rate correction only. Caller has persisted a same-episode boundary amendment. */
export async function correctAmendedRoomCharges(tx: Transaction, ctx: CommandContext, admissionId: string, stayId: string, cutoff: Date) {
  const [row] = await tx.select({ stay: getViewSelectedFields(roomStays), version: settingVersions }).from(roomStays).innerJoin(settingVersions, eq(roomStays.tariffVersionId, settingVersions.id)).where(eq(roomStays.id, stayId));
  if (!row?.stay.amendmentId || row.stay.admissionId !== admissionId)
    throw new DomainError("PRECONDITION", "Persisted actual stay amendment required");
  const { stay, version } = row, end = new Date(Math.min(cutoff.getTime(), stay.endedAt?.getTime() ?? Infinity));
  const due = roomDue(roomPolicyInput.parse(version.payload), end.getTime() - stay.startedAt.getTime());
  const lines = (await tx.select().from(charges).where(eq(charges.admissionId, admissionId)).orderBy(asc(charges.createdAt), asc(charges.id))).filter(c => c.sourceEventId.startsWith(`room:${stay.id}:`));
  const reversals = lines.length ? await tx.select().from(chargeReversals).where(inArray(chargeReversals.chargeId, lines.map(c => c.id))) : [];
  let remaining = lines.reduce((n, c) => n + c.amountPaise - reversals.filter(r => r.chargeId === c.id).reduce((m, r) => m + r.amountPaise, 0n), 0n) - due;
  for (const line of [...lines].reverse()) {
    if (remaining <= 0n)
      break;
    const available = line.amountPaise - reversals.filter(r => r.chargeId === line.id).reduce((n, r) => n + r.amountPaise, 0n), amount = available < remaining ? available : remaining;
    if (amount > 0n) {
      const [reversal] = await tx.insert(chargeReversals).values({
        chargeId: line.id, amountPaise: amount, physicalAmendmentId: stay.amendmentId, reason: `Actual physical correction ${stay.amendmentId}; original pinned tariff retained`, ...actorColumns(ctx)
      }).returning();
      await bumpBillRevision(tx, admissionId);
      await appendAudit(tx, ctx, {
        event: "exception.room-overcharge-corrected", entityType: "charge-reversal", entityId: reversal.id, reason: `Retained actual boundary and original source ${line.id}`
      });
      remaining -= amount;
    }
  }
  await reconcileRoomChargesInTransaction(tx, {
    admissionId, cutoff, actorContext: ctx
  });
}
