import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { type CommandContext, DomainError } from "../contracts";
import { withTransaction } from "../db";
import { admissionOperator } from "../admissions/commands";
import { admissions, beds, bedHolds, effectiveRoomStays, roomStays } from "../admissions/schema";
import { admissionTransfers, transferOrders, transferInsuranceTasks } from "../admissions/transfer-schema";
import { settingVersions } from "../schema/core";
import { billingRequest, lockBillingAdmission, roomPolicyInput } from "../billing/commands";
import { correctAmendedRoomCharges } from "../billing/room-charges";
import { exceptionEvidence, stayBoundaryAmendments, roomReturns } from "./exception-schema";
import { bedTurnovers as originalBedTurnovers, effectiveRoomVacations } from "./schema";
import { requireException, actualEpisodeDeparture } from "./exceptions";
import { appendAudit } from "../audit";
import { careEpisode } from "../clinical/commands";
import { invalidateAffectedClearances } from "./dependencies";
export async function applyDelayedTransfer(ctx: CommandContext, input: unknown): Promise<{
  oldStayId: string;
  newStayId: string;
}> {
  const v = z.strictObject({
    admissionId: z.uuid(), exceptionId: z.uuid(), evidenceId: z.uuid(), targetBedId: z.uuid()
  }).parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["ADMIN"], tx);
    await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
    const e = await lockBillingAdmission(tx, v.admissionId), authority = await requireException(tx, e.id, v.exceptionId, "DELAYED_TRANSFER", "TRANSFER");
    const result = await billingRequest(tx, ctx, "exception.delayed-transfer", v, async () => {
      if (e.status !== "ADMITTED")
        throw new DomainError("PRECONDITION", "A new physical transfer needs an active admission");
      const [evidence] = await tx.select().from(exceptionEvidence).where(eq(exceptionEvidence.id, v.evidenceId));
      if (!evidence || evidence.admissionId !== e.id || evidence.kind !== "TRANSFER_HANDOVER" || !evidence.sourceId || !evidence.shiftId || !authority.evidenceIds.includes(evidence.id))
        throw new DomainError("VALIDATION", "Original Nurse-signed transfer evidence is required");
      const [stay] = await tx.select().from(effectiveRoomStays).where(and(eq(effectiveRoomStays.admissionId, e.id), isNull(effectiveRoomStays.endedAt)));
      const [order] = await tx.select().from(transferOrders).where(eq(transferOrders.id, evidence.sourceId));
      const [latest] = await tx.select().from(transferOrders).where(eq(transferOrders.admissionId, e.id)).orderBy(desc(transferOrders.version)).limit(1);
      const [consumed] = await tx.select().from(admissionTransfers).where(eq(admissionTransfers.transferOrderId, evidence.sourceId));
      const T = evidence.actualAt;
      if (!stay || !order || order.admissionId !== e.id || order.sourceStayId !== stay.id || latest?.id !== order.id || consumed || T <= stay.startedAt || T < order.signedAt)
        throw new DomainError("CONFLICT", "Actual time and original unconsumed Doctor order must match the current source stay");
      const physical = await tx.select().from(beds).where(inArray(beds.id, [stay.bedId, v.targetBedId].sort())).orderBy(asc(beds.id)).for("update");
      const target = physical.find(b => b.id === v.targetBedId), holds = await tx.select().from(bedHolds).where(inArray(bedHolds.bedId, [stay.bedId, v.targetBedId]));
      if (!target?.active || target.id === stay.bedId || target.category !== order.destinationCategory || holds.find(h => h.bedId === stay.bedId)?.admissionId !== e.id || holds.some(h => h.bedId === target.id))
        throw new DomainError("CONFLICT", "Original occupancy or clinician-selected available target changed");
      const conflicts = await tx.execute(sql `select 1 from hims.effective_room_stays where bed_id=${target.id} and (ended_at is null or ended_at>${T}) limit 1`);
      const cleaning = await tx.execute(sql `select 1 from hims.effective_bed_turnovers t left join hims.bed_turnover_completions c on c.turnover_id=t.id where t.bed_id=${target.id} and (c.id is null or c.completed_at>${T}) limit 1`);
      if (conflicts.rows.length || cleaning.rows.length)
        throw new DomainError("CONFLICT", "Target was occupied or not cleaned at the actual physical time");
      const uses = await tx.execute(sql `select 1 from hims.nursing_consumables where stay_id=${stay.id} and used_at>=${T} limit 1`);
      if (uses.rows.length)
        throw new DomainError("CONFLICT", "Recorded old-unit consumables require their own factual correction; no silent reassignment");
      const versions = await tx.select().from(settingVersions).where(and(eq(settingVersions.hospitalId, e.hospitalId), lte(settingVersions.createdAt, T))).orderBy(desc(settingVersions.version));
      const tariff = versions.find(s => s.payload.type === "tariff" && s.payload.category === target.category), category = versions.find(s => s.payload.type === "bed-category" && s.payload.code === target.category);
      if (!tariff || category?.payload.active !== true)
        throw new DomainError("PRECONDITION", "Historical target tariff and active category at the actual time are required");
      roomPolicyInput.parse(tariff.payload);
      const prior = await tx.select().from(stayBoundaryAmendments).where(eq(stayBoundaryAmendments.stayId, stay.id)).orderBy(desc(stayBoundaryAmendments.version)).limit(1);
      await tx.insert(stayBoundaryAmendments).values({
        admissionId: e.id, stayId: stay.id, exceptionId: authority.id, evidenceId: evidence.id, version: (prior[0]?.version ?? 0) + 1, startedAt: stay.startedAt, endedAt: T, reason: authority.reason, signedBy: staff.id, signedAt: new Date()
      });
      await correctAmendedRoomCharges(tx, ctx, e.id, stay.id, T);
      const [next] = await tx.insert(roomStays).values({
        admissionId: e.id, bedId: target.id, tariffVersionId: tariff.id, startedAt: T, lastReconciledAt: T
      }).returning();
      await tx.delete(bedHolds).where(eq(bedHolds.admissionId, e.id));
      await tx.insert(bedHolds).values({
        admissionId: e.id, bedId: target.id, heldAt: T
      });
      await tx.update(admissions).set({
        bedId: target.id, version: sql `${admissions.version}+1`, billRevision: sql `${admissions.billRevision}+1`
      }).where(eq(admissions.id, e.id));
      const [transfer] = await tx.insert(admissionTransfers).values({
        admissionId: e.id, transferOrderId: order.id, oldStayId: stay.id, newStayId: next.id, oldBedId: stay.bedId, targetBedId: target.id, shiftId: evidence.shiftId, handover: evidence.notes, transferredAt: T, signedBy: evidence.signedBy, signedAt: evidence.signedAt
      }).returning();
      await tx.insert(originalBedTurnovers).values({
        bedId: stay.bedId, stayId: stay.id, admissionId: e.id, vacatedAt: T, reason: "Actual delayed transfer; original evidence and charge corrections retained", signedBy: staff.id, signedAt: new Date()
      });
      if (e.paymentRoute === "INSURED")
        await tx.insert(transferInsuranceTasks).values({
          admissionId: e.id, transferId: transfer.id, reason: "Review externally verified implications of delayed factual transfer"
        });
      await appendAudit(tx, ctx, {
        event: "exception.delayed-transfer", entityType: "transfer", entityId: transfer.id, reason: authority.reason
      });
      return { id: transfer.id };
    });
    const [transfer] = await tx.select().from(admissionTransfers).where(eq(admissionTransfers.id, result.id));
    return { oldStayId: transfer.oldStayId, newStayId: transfer.newStayId };
  });
}
export async function returnToBed(ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  const v = z.strictObject({
    admissionId: z.uuid(), exceptionId: z.uuid(), doctorEvidenceId: z.uuid(), nurseEvidenceId: z.uuid()
  }).parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["NURSE"], tx);
    await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
    const e = await careEpisode(tx, staff, v.admissionId, false), authority = await requireException(tx, e.id, v.exceptionId, "RETURN_TO_BED", "RETURN_TO_BED");
    return billingRequest(tx, ctx, "exception.return-to-bed", v, async () => {
      if (e.status !== "ADMITTED")
        throw new DomainError("PRECONDITION", "An amendment never reopens a departed admission");
      const [vacation] = await tx.select().from(effectiveRoomVacations).where(eq(effectiveRoomVacations.admissionId, e.id));
      const evidence = await tx.select().from(exceptionEvidence).where(inArray(exceptionEvidence.id, [v.doctorEvidenceId, v.nurseEvidenceId]));
      const doctor = evidence.find(r => r.id === v.doctorEvidenceId), nurse = evidence.find(r => r.id === v.nurseEvidenceId);
      const cancelled = await tx.execute(sql`select 1 from hims.exception_evidence where kind='RETURN_CANCELLED' and source_id=${v.doctorEvidenceId} limit 1`);
      if (!vacation || !doctor || !nurse || cancelled.rows.length || doctor.admissionId !== e.id || nurse.admissionId !== e.id || doctor.kind !== "RETURN_TO_BED" || nurse.kind !== "RETURN_HANDOVER" || doctor.sourceId !== vacation.id || nurse.sourceId !== vacation.id || nurse.signedBy !== staff.id || !authority.evidenceIds.includes(doctor.id) || nurse.actualAt < doctor.signedAt || doctor.signedAt < vacation.vacatedAt)
        throw new DomainError("VALIDATION", "Fresh Doctor instruction and your actual Nurse return handover must bind the current vacancy");
      const T = nurse.actualAt;
      const [bed] = await tx.select().from(beds).where(eq(beds.id, e.bedId)).for("update");
      const [hold] = await tx.select().from(bedHolds).where(eq(bedHolds.bedId, e.bedId));
      if (!bed.active || hold?.admissionId !== e.id)
        throw new DomainError("CONFLICT", "The original reserved bed is no longer held for this episode");
      const cleaning = await tx.execute(sql `select 1 from hims.effective_bed_turnovers t left join hims.bed_turnover_completions c on c.turnover_id=t.id where t.bed_id=${bed.id} and (c.id is null or c.completed_at>${T}) limit 1`);
      if (cleaning.rows.length)
        throw new DomainError("PRECONDITION", "Actual cleaning must finish before return to the reserved bed");
      const versions = await tx.select().from(settingVersions).where(and(eq(settingVersions.hospitalId, e.hospitalId), lte(settingVersions.createdAt, T))).orderBy(desc(settingVersions.version));
      const tariff = versions.find(s => s.payload.type === "tariff" && s.payload.category === bed.category), category = versions.find(s => s.payload.type === "bed-category" && s.payload.code === bed.category);
      if (!tariff || category?.payload.active !== true)
        throw new DomainError("PRECONDITION", "Configure a tariff and active category for this actual return");
      roomPolicyInput.parse(tariff.payload);
      const [stay] = await tx.insert(roomStays).values({
        admissionId: e.id, bedId: bed.id, tariffVersionId: tariff.id, startedAt: T, lastReconciledAt: T
      }).returning();
      const [record] = await tx.insert(roomReturns).values({
        admissionId: e.id, vacationId: vacation.id, stayId: stay.id, exceptionId: authority.id, doctorEvidenceId: doctor.id, nurseEvidenceId: nurse.id, returnedAt: T, signedBy: staff.id, signedAt: new Date()
      }).returning();
      await tx.update(admissions).set({ version: sql `${admissions.version}+1`, billRevision: sql `${admissions.billRevision}+1` }).where(eq(admissions.id, e.id));
      await invalidateAffectedClearances(tx, {
        admissionId: e.id, changeKind: "CLINICAL", changedRecordIds: [record.id]
      });
      await appendAudit(tx, ctx, {
        event: "exception.return-to-bed", entityType: "room-return", entityId: record.id, reason: "Doctor instructed actual Nurse handover; original vacancy retained and fresh stay priced"
      });
      return { id: stay.id };
    });
  });
}
/** Correct a retained final cutoff. Occupancy and the actual hospital exit stay closed. */
export async function correctRoomCutoff(ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  const v = z.strictObject({
    admissionId: z.uuid(), exceptionId: z.uuid(), evidenceId: z.uuid()
  }).parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["ADMIN"], tx);
    await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
    const e = await lockBillingAdmission(tx, v.admissionId);
    const authority = await requireException(tx, e.id, v.exceptionId, "ROOM_CUTOFF_CORRECTION", "AMEND");
    return billingRequest(tx, ctx, "exception.room-cutoff-corrected", v, async () => {
      const [evidence] = await tx.select().from(exceptionEvidence).where(eq(exceptionEvidence.id, v.evidenceId));
      if (!evidence || evidence.admissionId !== e.id || evidence.kind !== "ROOM_CUTOFF" || evidence.exceptionId !== authority.id || evidence.sourceId !== authority.sourceId)
        throw new DomainError("VALIDATION", "Correction requires the assigned Nurse's source-bound factual cutoff");
      const [stay] = await tx.select().from(effectiveRoomStays).where(eq(effectiveRoomStays.id, evidence.sourceId!));
      if (!stay?.endedAt || stay.admissionId !== e.id || evidence.actualAt <= stay.startedAt)
        throw new DomainError("VALIDATION", "Correct the retained final closed stay boundary");
      const next = await tx.execute(sql `select 1 from hims.admission_transfers where old_stay_id=${stay.id} union all select 1 from hims.room_returns r join hims.room_vacations v on v.id=r.vacation_id where v.stay_id=${stay.id} limit 1`);
      if (next.rows.length)
        throw new DomainError("PRECONDITION", "An intermediate transfer or return boundary needs its adjacent professional source corrected together");
      const departure = await actualEpisodeDeparture(tx, e.id);
      if (departure && evidence.actualAt > departure)
        throw new DomainError("VALIDATION", "Physical bed use cannot continue after actual hospital departure");
      await tx.select().from(beds).where(eq(beds.id, stay.bedId)).for("update");
      const conflicts = await tx.execute(sql `select 1 from hims.effective_room_stays where id<>${stay.id} and (bed_id=${stay.bedId} or admission_id=${e.id}) and tstzrange(started_at,ended_at,'[)')&&tstzrange(${stay.startedAt}::timestamptz,${evidence.actualAt}::timestamptz,'[)') limit 1`);
      const cleaning = await tx.execute(sql `select 1 from hims.bed_turnovers t join hims.bed_turnover_completions c on c.turnover_id=t.id where t.stay_id=${stay.id} and c.completed_at<${evidence.actualAt} limit 1`);
      const uses = await tx.execute(sql `select 1 from hims.nursing_consumables where stay_id=${stay.id} and used_at>=${evidence.actualAt} limit 1`);
      if (conflicts.rows.length || cleaning.rows.length || uses.rows.length)
        throw new DomainError("CONFLICT", "Factual occupancy, cleaning or source-unit use contradicts this cutoff");
      const [prior] = await tx.select().from(stayBoundaryAmendments).where(eq(stayBoundaryAmendments.stayId, stay.id)).orderBy(desc(stayBoundaryAmendments.version)).limit(1);
      const [amendment] = await tx.insert(stayBoundaryAmendments).values({
        admissionId: e.id, stayId: stay.id, exceptionId: authority.id, evidenceId: evidence.id, version: (prior?.version ?? 0) + 1, startedAt: stay.startedAt, endedAt: evidence.actualAt, reason: authority.reason, signedBy: staff.id, signedAt: new Date()
      }).returning();
      await correctAmendedRoomCharges(tx, ctx, e.id, stay.id, new Date());
      await appendAudit(tx, ctx, {
        event: "exception.room-cutoff-corrected", entityType: "stay-boundary-amendment", entityId: amendment.id, reason: authority.reason
      });
      return { id: amendment.id };
    });
  });
}
