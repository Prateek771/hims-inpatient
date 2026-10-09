import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { DomainError, type CommandContext } from "../contracts";
import { withTransaction, type Transaction } from "../db";
import { admissionOperator, dateOfBirth } from "../admissions/commands";
import { admissions, bedHolds, beds, effectiveRoomStays as roomStays, roomStays as originalRoomStays } from "../admissions/schema";
import { user } from "../schema/auth";
import { appendAudit } from "../audit";
import { billingRequest, billProjection, financialResponsibilityInTransaction, lockBillingAdmission, patientDepositCash, resolveActivationPolicies, refundReceiptInTransaction } from "../billing/commands";
import { jsonSnapshot, latestSeals, billingClearanceInputs, invalidateAffectedClearances } from "./dependencies";
import { adminExceptions, exceptionDispositions, exceptionTypes, exceptionEvidence, evidenceKinds, exceptionalDepartures, postDischargeAmendments, stayBoundaryAmendments, administrativeShiftEnds, patientIdentifications, exceptionFollowups } from "./exception-schema";
import { careEpisode, actualTime } from "../clinical/commands";
import { shiftForCare } from "../nursing/commands";
import { reconcileRoomChargesInTransaction, correctAmendedRoomCharges } from "../billing/room-charges";
import { effectiveBedTurnovers as bedTurnovers, bedTurnovers as originalBedTurnovers, departures, effectiveRoomVacations as roomVacations } from "./schema";
import { correctionKinds, correctionRoles, validateCorrectionSource, applyCorrectionEffect } from "./exception-corrections";
const reason = z.string().trim().min(3).max(1000);
export async function exceptionObligationsInTransaction(tx: Transaction, e: typeof admissions.$inferSelect) {
  const bill = await billProjection(tx, e, new Date()), financial = await financialResponsibilityInTransaction(tx, e, bill);
  const pendingSources = (await billingClearanceInputs(tx, e, bill)).inputs.unresolved;
  let deposit: {
    sourceId: string;
    requiredPaise: string;
    outstandingPaise: string;
  } | null = null;
  if (e.status === "PENDING") {
    const p = await resolveActivationPolicies(tx, e), paid = await patientDepositCash(tx, e.id);
    deposit = {
      sourceId: p.deposit.id, requiredPaise: p.requiredPaise.toString(), outstandingPaise: (p.requiredPaise > paid ? p.requiredPaise - paid : 0n).toString()
    };
  }
  if (e.status === "ADMITTED") {
    const authorities = await tx.select().from(adminExceptions).where(and(eq(adminExceptions.admissionId, e.id), eq(adminExceptions.type, "URGENT_ADMISSION"))).orderBy(desc(adminExceptions.signedAt));
    const source = authorities.map(a => z.object({ sourceId: z.uuid(), requiredPaise: z.string().regex(/^\d+$/) }).safeParse(a.snapshot.deposit)).find(p => p.success && p.data.sourceId === e.depositVersionId);
    if (source?.success) {
      const paid = await patientDepositCash(tx, e.id), required = BigInt(source.data.requiredPaise);
      deposit = { ...source.data, outstandingPaise: (required > paid ? required - paid : 0n).toString() };
    }
  }
  const [exit] = await tx.select().from(exceptionalDepartures).where(eq(exceptionalDepartures.admissionId, e.id));
  const [professionalReview] = exit ? await tx.select().from(exceptionEvidence).where(and(eq(exceptionEvidence.admissionId, e.id), eq(exceptionEvidence.kind, "PROFESSIONAL_REVIEW"), eq(exceptionEvidence.sourceId, exit.id))).orderBy(desc(exceptionEvidence.signedAt)).limit(1) : [];
  return jsonSnapshot({
    pendingSources, professionalFollowUp: exit?.snapshot.professionalFollowUp ? {
      sourceId: exit.id, status: professionalReview ? "REVIEWED" : "PENDING_DOCTOR", reviewId: professionalReview?.id ?? null
    } : null, billVersion: e.billRevision, netPaise: bill.netPaise, retainedPaise: bill.retainedPaise, patientOutstandingPaise: financial.responsibility?.allocationComplete ? financial.responsibility.patientOutstandingPaise : null, insurerOutstandingPaise: financial.responsibility?.allocationComplete ? financial.responsibility.insurerOutstandingPaise : null, responsibilityStatus: financial.responsibility?.allocationComplete ? "REVIEWED" : "UNKNOWN_OR_STALE", pendingPaise: bill.pendingPaise, unpostedRoomPaise: bill.unpostedRoomPaise, deposit, financialSource: {
      decisionId: financial.decisionId, conversionId: financial.conversionId, selfPayReviewId: financial.selfPayReviewId
    }
  });
}
export async function authorizeException(ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  return withTransaction(tx => authorizeExceptionInTransaction(tx, ctx, input));
}
export async function authorizeExceptionInTransaction(tx: Transaction, ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  const v = z.strictObject({
    admissionId: z.uuid(), type: z.enum(exceptionTypes), authority: reason, reason, evidenceIds: z.array(z.uuid()).max(30), evidence: reason, disposition: z.enum(exceptionDispositions), followUpOwnerId: z.string().min(1), sourceId: z.uuid().optional(), correctionKind: z.string().max(60).optional()
  }).parse(input);
  const staff = await admissionOperator(ctx, ["ADMIN"], tx);
  await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
  const e = await lockBillingAdmission(tx, v.admissionId);
  return billingRequest(tx, ctx, "exception.authorized", v, async () => {
    const [owner] = await tx.select().from(user).where(eq(user.id, v.followUpOwnerId));
    if (!owner || owner.banned)
      throw new DomainError("VALIDATION", "Select an active staff follow-up owner");
    const evidence = v.evidenceIds.length ? await tx.select().from(exceptionEvidence).where(inArray(exceptionEvidence.id, v.evidenceIds)) : [];
    if (evidence.length !== new Set(v.evidenceIds).size || evidence.some(r => r.admissionId !== e.id))
      throw new DomainError("VALIDATION", "Evidence must be persisted in this admission");
    if (v.type === "URGENT_ADMISSION") {
      if (v.disposition !== "ACTIVATE" || e.status !== "PENDING")
        throw new DomainError("PRECONDITION", "Urgent activation requires a pending reservation");
    }
    else if (v.type === "POST_DISCHARGE_CORRECTION") {
      if (e.status !== "DISCHARGED" || v.disposition !== "AMEND" || !v.sourceId || !v.correctionKind)
        throw new DomainError("PRECONDITION", "Correction requires a closed episode, specific action and original source");
      await validateCorrectionSource(tx, e.id, z.enum(correctionKinds).parse(v.correctionKind), v.sourceId);
    }
    else if (v.type === "CANCELLED_DEPOSIT") {
      const original = await tx.execute(sql `select id from hims.receipts where id=${v.sourceId ?? null} and admission_id=${e.id} and party='PATIENT' and kind<>'PAYMENT'`);
      if (e.status !== "CANCELLED" || e.admittedAt || v.disposition !== "RETURN_DEPOSIT" || !original.rows.length)
        throw new DomainError("PRECONDITION", "Cancelled return requires this never-occupied original deposit receipt");
    }
    else if (v.type === "UNAVAILABLE_APPROVER" && v.disposition === "CLOSE_ATTENDANCE") {
      const shift = await tx.execute(sql `select id from hims.nursing_shifts where id=${v.sourceId ?? null} and admission_id=${e.id}`);
      if (!["ADMITTED", "DISCHARGED"].includes(e.status) || !shift.rows.length)
        throw new DomainError("PRECONDITION", "Attendance authority requires the original same-episode shift");
    }
    else if (v.type === "ROOM_CUTOFF_CORRECTION") {
      const [stay] = await tx.select().from(roomStays).where(and(eq(roomStays.id, v.sourceId ?? "00000000-0000-0000-0000-000000000000"), eq(roomStays.admissionId, e.id)));
      if (!["ADMITTED", "DISCHARGED"].includes(e.status) || v.disposition !== "AMEND" || !stay?.endedAt)
        throw new DomainError("PRECONDITION", "Room cutoff correction binds a retained closed physical stay");
    }
    else if (v.type === "DELAYED_TRANSFER") {
      if (e.status !== "ADMITTED" || v.disposition !== "TRANSFER" || !evidence.some(r => r.kind === "TRANSFER_HANDOVER" && r.sourceId))
        throw new DomainError("PRECONDITION", "Delayed transfer requires original Doctor authority and actual Nurse handover");
    }
    else if (v.type === "RETURN_TO_BED") {
      const [vacation] = await tx.select().from(roomVacations).where(eq(roomVacations.admissionId, e.id));
      const cancelled = (await tx.execute(sql`select source_id from hims.exception_evidence where admission_id=${e.id} and kind='RETURN_CANCELLED'`)).rows;
      if (e.status !== "ADMITTED" || v.disposition !== "RETURN_TO_BED" || !vacation || !evidence.some(r => r.kind === "RETURN_TO_BED" && r.sourceId === vacation.id && r.signedAt > vacation.vacatedAt && !cancelled.some(c => c.source_id === r.id)))
        throw new DomainError("PRECONDITION", "Return requires an active off-bed wait and fresh Doctor instruction for the retained vacancy");
      const [turnover] = await tx.select().from(bedTurnovers).where(eq(bedTurnovers.stayId, vacation.stayId));
      if (!turnover)
        await tx.insert(originalBedTurnovers).values({
          admissionId: e.id, bedId: e.bedId, stayId: vacation.stayId, vacatedAt: vacation.vacatedAt, reason: "Clean the reserved bed before clinically instructed return", signedBy: staff.id, signedAt: new Date()
        });
    }
    else {
      if (e.status !== "ADMITTED" || !["FOLLOW_UP", "EXCEPTIONAL_EXIT"].includes(v.disposition))
        throw new DomainError("PRECONDITION", "This disposition requires an active episode");
      if (v.type === "UNAVAILABLE_APPROVER" && v.disposition !== "FOLLOW_UP")
        throw new DomainError("PRECONDITION", "Unavailable-professional routing cannot authorize clinical departure");
      if (["AGAINST_ADVICE", "EXTERNAL_TRANSFER", "DEATH"].includes(v.type) && !evidence.some(r => r.role === "DOCTOR" && r.kind === v.type))
        throw new DomainError("PRECONDITION", "Proper same-episode Doctor disposition is required; administrator routing is not clinical evidence");
    }
    if (["CREDIT", "INSURANCE_DELAY", "INSURANCE_DENIAL"].includes(v.type) && v.disposition === "EXCEPTIONAL_EXIT" && !evidence.some(r => r.role === "DOCTOR" && r.kind === "PLANNED_EXIT"))
      throw new DomainError("PRECONDITION", "Planned exceptional departure requires the responsible Doctor's signed actual disposition");
    if (v.type === "INSURANCE_DELAY" || v.type === "INSURANCE_DENIAL") {
      const { insuranceCases, insuranceDecisions } = await import("../insurance/schema");
      const [c] = await tx.select().from(insuranceCases).where(and(eq(insuranceCases.id, v.sourceId ?? "00000000-0000-0000-0000-000000000000"), eq(insuranceCases.admissionId, e.id)));
      const [decision] = c ? await tx.select().from(insuranceDecisions).where(eq(insuranceDecisions.caseId, c.id)).orderBy(desc(insuranceDecisions.caseVersion)).limit(1) : [];
      if (!c || e.paymentRoute !== "INSURED" || (v.type === "INSURANCE_DENIAL" && decision?.status !== "REJECTED"))
        throw new DomainError("PRECONDITION", "Insurance exception requires the actual same-episode external case and applicable denial evidence");
    }
    const snapshot = await exceptionObligationsInTransaction(tx, e);
    const [record] = await tx.insert(adminExceptions).values({
      ...v, snapshot, signedBy: staff.id, signedAt: new Date()
    }).returning();
    await appendAudit(tx, ctx, {
      event: "exception.authorized", entityType: "administrator-exception", entityId: record.id, reason: v.reason
    });
    return { id: record.id };
  });
}
/** Caller owns current staff/request/admission locks. An arbitrary UUID never grants authority. */
export async function requireException(tx: Transaction, admissionId: string, exceptionId: string, type: typeof exceptionTypes[number], disposition: typeof exceptionDispositions[number]) {
  const [record] = await tx.select().from(adminExceptions).where(eq(adminExceptions.id, exceptionId));
  if (!record || record.admissionId !== admissionId || record.type !== type || record.disposition !== disposition)
    throw new DomainError("PRECONDITION", "Persisted same-episode exception authority is required");
  return record;
}
export async function recordExceptionEvidence(ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  return withTransaction(tx => recordExceptionEvidenceInTransaction(tx, ctx, input));
}
export async function recordExceptionEvidenceInTransaction(tx: Transaction, ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  const v = z.strictObject({
    admissionId: z.uuid(), kind: z.enum(evidenceKinds), exceptionId: z.uuid().optional(), shiftId: z.uuid().optional(), sourceId: z.uuid().optional(), actualAt: z.iso.datetime(), vacatedAt: z.iso.datetime().optional(), notes: reason
  }).parse(input);
  const physical = ["PHYSICAL_EXIT", "TRANSFER_HANDOVER", "RETURN_HANDOVER", "ROOM_CUTOFF"].includes(v.kind);
  const staff = await admissionOperator(ctx, physical ? ["NURSE"] : ["DOCTOR"], tx);
  await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
  const e = await careEpisode(tx, staff, v.admissionId, false);
  return billingRequest(tx, ctx, "exception.evidence", v, async () => {
    if (v.kind === "ROOM_CUTOFF") {
      if (!v.exceptionId || !v.sourceId)
        throw new DomainError("PRECONDITION", "Room correction witness needs original stay authority");
      const authority = await requireException(tx, e.id, v.exceptionId, "ROOM_CUTOFF_CORRECTION", "AMEND");
      if (authority.sourceId !== v.sourceId)
        throw new DomainError("VALIDATION", "Witness must bind the authorized original stay");
    }
    if ((e.status !== "ADMITTED" && !(e.status === "DISCHARGED" && v.kind === "ROOM_CUTOFF")) || !e.admittedAt)
      throw new DomainError("PRECONDITION", "New disposition evidence requires an active episode");
    const actual = actualTime(v.actualAt, e.admittedAt);
    if (["RETURN_TO_BED", "RETURN_CANCELLED", "RETURN_HANDOVER"].includes(v.kind)) {
      const [instruction] = v.kind === "RETURN_CANCELLED" ? await tx.select().from(exceptionEvidence).where(eq(exceptionEvidence.id, v.sourceId ?? "00000000-0000-0000-0000-000000000000")) : [];
      const sourceId = instruction?.sourceId ?? v.sourceId;
      const [vacation] = await tx.select().from(roomVacations).where(eq(roomVacations.id, sourceId ?? "00000000-0000-0000-0000-000000000000"));
      if (!vacation || vacation.admissionId !== e.id || actual < vacation.vacatedAt)
        throw new DomainError("PRECONDITION", "Return evidence must bind the current factual vacancy");
      const pending = (await tx.execute(sql`select p.* from hims.exception_evidence p where p.admission_id=${e.id} and p.kind='RETURN_TO_BED' and p.source_id=${vacation.id} and not exists(select 1 from hims.exception_evidence c where c.kind='RETURN_CANCELLED' and c.source_id=p.id) and not exists(select 1 from hims.room_returns r where r.doctor_evidence_id=p.id)`)).rows;
      if (v.kind === "RETURN_TO_BED" && pending.length)
        throw new DomainError("CONFLICT", "Review the existing return instruction before issuing another");
      if (v.kind === "RETURN_HANDOVER" && (!pending.length || actual < (pending[0].signed_at as Date)))
        throw new DomainError("PRECONDITION", "Actual handover requires a current Doctor return instruction");
      if (v.kind === "RETURN_CANCELLED") {
        const witnessed = await tx.execute(sql`select id from hims.exception_evidence where admission_id=${e.id} and kind='RETURN_HANDOVER' and source_id=${vacation.id} and actual_at>=${instruction?.signedAt ?? actual} limit 1`);
        if (!instruction || instruction.admissionId !== e.id || instruction.kind !== "RETURN_TO_BED" || !pending.some(p => p.id === instruction.id) || actual < instruction.signedAt || witnessed.rows.length)
          throw new DomainError("PRECONDITION", "Only an unconsumed, unwitnessed current return instruction can be reconsidered; record the actual return first");
      }
    }
    if (physical) {
      if (!v.shiftId)
        throw new DomainError("VALIDATION", "Use the actual witnessing Nurse shift");
      await shiftForCare(tx, staff, v.shiftId, e.id, v.actualAt, v.kind === "ROOM_CUTOFF" ? v.exceptionId : undefined);
    }
    const vacancy = v.vacatedAt ? actualTime(v.vacatedAt, e.admittedAt, actual) : null;
    if (v.kind === "PHYSICAL_EXIT" && !vacancy)
      throw new DomainError("VALIDATION", "Record actual bed vacancy separately from hospital exit");
    const [record] = await tx.insert(exceptionEvidence).values({
      ...v, role: staff.role, actualAt: actual, vacatedAt: vacancy, signedBy: staff.id, signedAt: new Date()
    }).returning();
    await invalidateAffectedClearances(tx, { admissionId: e.id, changeKind: staff.role === "DOCTOR" ? "CLINICAL" : "NURSING", changedRecordIds: [record.id] });
    await appendAudit(tx, ctx, {
      event: "exception.professional-evidence", entityType: "exception-evidence", entityId: record.id, reason: v.notes
    });
    return { id: record.id };
  });
}
export async function recordExceptionalDeparture(ctx: CommandContext, input: unknown): Promise<{
  id: string;
  status: string;
}> {
  return withTransaction(tx => recordExceptionalDepartureInTransaction(tx, ctx, input));
}
export async function recordExceptionalDepartureInTransaction(tx: Transaction, ctx: CommandContext, input: unknown): Promise<{
  id: string;
  status: string;
}> {
  const v = z.strictObject({
    admissionId: z.uuid(), exceptionId: z.uuid(), physicalEvidenceId: z.uuid()
  }).parse(input);
  const staff = await admissionOperator(ctx, ["ADMIN"], tx);
  await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
  const e = await lockBillingAdmission(tx, v.admissionId);
  const result = await billingRequest(tx, ctx, "exception.departure", v, async () => {
    const [authority] = await tx.select().from(adminExceptions).where(eq(adminExceptions.id, v.exceptionId));
    if (!authority || authority.admissionId !== e.id || authority.disposition !== "EXCEPTIONAL_EXIT")
      throw new DomainError("PRECONDITION", "Same-episode exceptional departure authority required");
    const [old] = await tx.select().from(exceptionalDepartures).where(eq(exceptionalDepartures.admissionId, e.id));
    if (old) {
      if (old.exceptionId !== v.exceptionId || old.physicalEvidenceId !== v.physicalEvidenceId)
        throw new DomainError("CONFLICT", "Departure already has different source facts");
      return { id: old.id };
    }
    if (e.status !== "ADMITTED")
      throw new DomainError("PRECONDITION", "Exceptional exit needs an active episode");
    const [evidence] = await tx.select().from(exceptionEvidence).where(eq(exceptionEvidence.id, v.physicalEvidenceId));
    if (!evidence || evidence.admissionId !== e.id || evidence.kind !== "PHYSICAL_EXIT" || !evidence.vacatedAt || !authority.evidenceIds.includes(evidence.id))
      throw new DomainError("VALIDATION", "Use the actual same-episode Nurse-witnessed departure");
    const [vacation] = await tx.select().from(roomVacations).where(eq(roomVacations.admissionId, e.id));
    const [stay] = await tx.select().from(roomStays).where(and(eq(roomStays.admissionId, e.id), vacation ? eq(roomStays.id, vacation.stayId) : isNull(roomStays.endedAt)));
    if (!stay || evidence.vacatedAt <= stay.startedAt || (vacation && vacation.vacatedAt.getTime() !== evidence.vacatedAt.getTime()))
      throw new DomainError("VALIDATION", "Actual physical bed boundary conflicts with retained vacancy");
    const later = await tx.execute(sql `select 1 from hims.nursing_consumables where stay_id=${stay.id} and used_at>=${evidence.vacatedAt} limit 1`);
    if (later.rows.length)
      throw new DomainError("CONFLICT", "Recorded source-unit use contradicts the supplied vacancy");
    await tx.select().from(beds).where(eq(beds.id, e.bedId)).for("update");
    const [hold] = await tx.select().from(bedHolds).where(eq(bedHolds.admissionId, e.id));
    if (hold?.bedId !== e.bedId)
      throw new DomainError("CONFLICT", "Physical bed hold changed");
    if (stay.lastReconciledAt && evidence.vacatedAt < stay.lastReconciledAt) {
      const [prior] = await tx.select().from(stayBoundaryAmendments).where(eq(stayBoundaryAmendments.stayId, stay.id)).orderBy(desc(stayBoundaryAmendments.version)).limit(1);
      await tx.insert(stayBoundaryAmendments).values({
        admissionId: e.id, stayId: stay.id, exceptionId: authority.id, evidenceId: evidence.id, version: (prior?.version ?? 0) + 1, startedAt: stay.startedAt, endedAt: evidence.vacatedAt, reason: authority.reason, signedBy: staff.id, signedAt: new Date()
      });
      await correctAmendedRoomCharges(tx, ctx, e.id, stay.id, evidence.vacatedAt);
    }
    else {
      await reconcileRoomChargesInTransaction(tx, {
        admissionId: e.id, cutoff: evidence.vacatedAt, actorContext: ctx
      });
      if (!stay.endedAt)
        await tx.update(originalRoomStays).set({ endedAt: evidence.vacatedAt }).where(eq(originalRoomStays.id, stay.id));
    }
    const current = await lockBillingAdmission(tx, e.id), snapshot = await exceptionObligationsInTransaction(tx, current), seals = await latestSeals(tx, e.id);
    const [exit] = await tx.insert(exceptionalDepartures).values({
      admissionId: e.id, exceptionId: authority.id, physicalEvidenceId: evidence.id, stayId: stay.id, departedAt: evidence.actualAt, snapshot: jsonSnapshot({
        ...snapshot, clinicalStatus: authority.type === "EARLY_EXIT" ? "UNREVIEWED_EARLY_EXIT" : authority.type, professionalFollowUp: authority.type === "EARLY_EXIT", seals: seals.all, followUpOwnerId: authority.followUpOwnerId
      }), signedBy: staff.id, signedAt: new Date()
    }).returning();
    await tx.update(admissions).set({ status: "DISCHARGED", version: sql `${admissions.version}+1` }).where(eq(admissions.id, e.id));
    await tx.delete(bedHolds).where(eq(bedHolds.admissionId, e.id));
    const [turnover] = await tx.select().from(bedTurnovers).where(eq(bedTurnovers.stayId, stay.id));
    if (!turnover)
      await tx.insert(originalBedTurnovers).values({
        bedId: stay.bedId, stayId: stay.id, admissionId: e.id, vacatedAt: evidence.vacatedAt, reason: "Actual exceptional exit; cleaning required and obligations remain", signedBy: staff.id, signedAt: new Date()
      });
    await appendAudit(tx, ctx, {
      event: "exception.departure", entityType: "exceptional-departure", entityId: exit.id, reason: authority.reason
    });
    return { id: exit.id };
  });
  return { ...result, status: "DISCHARGED" };
}
export async function requireCorrectionAuthority(tx: Transaction, e: typeof admissions.$inferSelect, exceptionId: string, kind: string, sourceId?: string) {
  const authority = await requireException(tx, e.id, exceptionId, "POST_DISCHARGE_CORRECTION", "AMEND");
  if (e.status !== "DISCHARGED" || authority.correctionKind !== kind || !authority.sourceId || (sourceId && authority.sourceId !== sourceId))
    throw new DomainError("PRECONDITION", "Closed-episode correction authority must bind this exact action and original source");
  return authority;
}
export async function applyPostDischargeCorrection(ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  return withTransaction(tx => applyPostDischargeCorrectionInTransaction(tx, ctx, input));
}
export async function applyPostDischargeCorrectionInTransaction(tx: Transaction, ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  const v = z.strictObject({
    admissionId: z.uuid(), exceptionId: z.uuid(), kind: z.enum(correctionKinds), sourceId: z.uuid(), data: z.record(z.string(), z.unknown())
  }).parse(input);
  const staff = await admissionOperator(ctx, correctionRoles(v.kind), tx);
  await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
  const e = await lockBillingAdmission(tx, v.admissionId);
  await requireCorrectionAuthority(tx, e, v.exceptionId, v.kind, v.sourceId);
  // Internal cash command owns the shared actor/request identity. The outer amendment
  // binds that one effect through its immutable result, never starts another pool transaction.
  const before = await exceptionObligationsInTransaction(tx, e);
  const result = await applyCorrectionEffect(tx, ctx, staff, v);
  const [old] = await tx.select().from(postDischargeAmendments).where(and(eq(postDischargeAmendments.exceptionId, v.exceptionId), eq(postDischargeAmendments.resultId, result.id)));
  if (old)
    return { id: old.id };
  const after = await exceptionObligationsInTransaction(tx, await lockBillingAdmission(tx, e.id));
  const [amendment] = await tx.insert(postDischargeAmendments).values({
    admissionId: e.id, exceptionId: v.exceptionId, kind: v.kind, sourceId: v.sourceId, resultId: result.id, beforeSnapshot: before, afterSnapshot: after, signedBy: staff.id, signedAt: new Date()
  }).returning();
  await appendAudit(tx, ctx, {
    event: "exception.amendment", entityType: "post-discharge-amendment", entityId: amendment.id, reason: "Attributable correction retains original departure and money history"
  });
  return { id: amendment.id };
}
export async function getExceptionReview(ctx: CommandContext, admissionId: string) {
  return withTransaction(async (tx) => {
    await admissionOperator(ctx, ["ADMIN", "BILLING"], tx);
    const e = await lockBillingAdmission(tx, z.uuid().parse(admissionId));
    return {
      episode: {
        id: e.id, ipCode: e.ipCode, status: e.status
      }, obligations: await exceptionObligationsInTransaction(tx, e), exceptions: await tx.select().from(adminExceptions).where(eq(adminExceptions.admissionId, e.id)), amendments: await tx.select().from(postDischargeAmendments).where(eq(postDischargeAmendments.admissionId, e.id))
    };
  });
}
export async function actualEpisodeDeparture(tx: Transaction, admissionId: string) {
  const [ordinary] = await tx.select({ departedAt: departures.departedAt }).from(departures).where(eq(departures.admissionId, admissionId));
  const [exceptional] = await tx.select({ departedAt: exceptionalDepartures.departedAt }).from(exceptionalDepartures).where(eq(exceptionalDepartures.admissionId, admissionId));
  return ordinary?.departedAt ?? exceptional?.departedAt;
}
export { applyDelayedTransfer } from "./exception-physical";
export { returnToBed } from "./exception-physical";
export async function returnCancelledDeposit(ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  const v = z.object({ admissionId: z.uuid(), exceptionId: z.uuid() }).parse(input);
  const { admissionId: _admissionId, exceptionId: _exceptionId, ...cash } = input as Record<string, unknown>;
  void _admissionId;
  void _exceptionId;
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["ADMIN", "BILLING"], tx);
    await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
    const e = await lockBillingAdmission(tx, v.admissionId), authority = await requireException(tx, e.id, v.exceptionId, "CANCELLED_DEPOSIT", "RETURN_DEPOSIT");
    if (authority.sourceId !== cash.receiptId)
      throw new DomainError("VALIDATION", "Return must use the authorized original receipt");
    return refundReceiptInTransaction(tx, ctx, cash, v.exceptionId);
  });
}
export async function closeUnavailableAttendance(ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  const v = z.strictObject({
    admissionId: z.uuid(), exceptionId: z.uuid(), shiftId: z.uuid(), endedAt: z.iso.datetime(), evidence: reason
  }).parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["ADMIN"], tx);
    await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
    const e = await lockBillingAdmission(tx, v.admissionId), authority = await requireException(tx, e.id, v.exceptionId, "UNAVAILABLE_APPROVER", "CLOSE_ATTENDANCE");
    if (authority.sourceId !== v.shiftId)
      throw new DomainError("VALIDATION", "Use the authorized original shift");
    return billingRequest(tx, ctx, "exception.attendance-closed", v, async () => {
      const { nursingShifts, effectiveShiftEnds } = await import("../nursing/schema");
      const [shift] = await tx.select().from(nursingShifts).where(eq(nursingShifts.id, v.shiftId));
      if (!shift || shift.admissionId !== e.id)
        throw new DomainError("VALIDATION", "Same-episode original attendance required");
      if ((await tx.select().from(effectiveShiftEnds).where(eq(effectiveShiftEnds.shiftId, shift.id))).length)
        throw new DomainError("CONFLICT", "Attendance already has a factual end");
      const end = actualTime(v.endedAt, shift.startedAt), departure = await actualEpisodeDeparture(tx, e.id);
      if (end <= shift.startedAt || !['ADMITTED', 'DISCHARGED'].includes(e.status) || (departure && end > departure))
        throw new DomainError("VALIDATION", "Actual attendance must follow its start and end no later than actual departure");
      await validateAttendanceEnd(tx, shift.id, end);
      const [record] = await tx.insert(administrativeShiftEnds).values({
        ...v, endedAt: end, signedBy: staff.id, signedAt: new Date()
      }).returning();
      await appendAudit(tx, ctx, {
        event: "exception.attendance-closed", entityType: "administrative-shift-end", entityId: record.id, reason: v.evidence
      });
      return { id: record.id };
    });
  });
}
export async function validateAttendanceEnd(tx: Transaction, shiftId: string, end: Date) {
  const later = await tx.execute(sql `select actual_at t from hims.medication_administrations where shift_id=${shiftId} and actual_at>${end}
union all select observed_at from hims.nursing_observations where shift_id=${shiftId} and observed_at>${end}
union all select used_at from hims.nursing_consumables where shift_id=${shiftId} and used_at>${end}
union all select transferred_at from hims.admission_transfers where shift_id=${shiftId} and transferred_at>${end}
union all select vacated_at from hims.effective_vacation_facts where shift_id=${shiftId} and vacated_at>${end}
union all select actual_at from hims.exception_evidence where shift_id=${shiftId} and actual_at>${end} limit 1`);
  if (later.rows.length)
    throw new DomainError("VALIDATION", "Attendance cannot end before recorded actual care or physical handover");
}
export async function identifyTemporaryPatient(ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  const v = z.strictObject({
    admissionId: z.uuid(), exceptionId: z.uuid(), expectedVersion: z.number().int().min(0).default(0), name: z.string().trim().min(2).max(150), dateOfBirth: dateOfBirth.optional(), ageYearsAtRegistration: z.number().int().min(0).max(130).optional(), sex: z.enum(["FEMALE", "MALE", "OTHER", "UNKNOWN"]), phone: z.string().trim().regex(/^[+\d ()-]{7,25}$/).optional(), evidence: reason, reason
  }).refine(v => (v.dateOfBirth !== undefined) !== (v.ageYearsAtRegistration !== undefined), "Record known DOB or age").parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["ADMISSION"], tx);
    await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
    const e = await lockBillingAdmission(tx, v.admissionId);
    await requireException(tx, e.id, v.exceptionId, "URGENT_ADMISSION", "ACTIVATE");
    return billingRequest(tx, ctx, "exception.patient-identified", v, async () => {
      const { patients } = await import("../admissions/schema");
      const [original] = await tx.select().from(patients).where(eq(patients.id, e.patientId));
      const [last] = await tx.select().from(patientIdentifications).where(eq(patientIdentifications.patientId, e.patientId)).orderBy(desc(patientIdentifications.version)).limit(1);
      if (original.identityStatus !== "TEMPORARY" || (last?.version ?? 0) !== v.expectedVersion)
        throw new DomainError("CONFLICT", "Review the current temporary identity history");
      const [record] = await tx.insert(patientIdentifications).values({
        ...v, patientId: e.patientId, version: v.expectedVersion + 1, signedBy: staff.id, signedAt: new Date()
      }).returning();
      await appendAudit(tx, ctx, {
        event: "exception.patient-identified", entityType: "patient-identification", entityId: record.id, reason: v.reason
      });
      return { id: record.id };
    });
  });
}
export { correctRoomCutoff } from "./exception-physical";
/** Follow-up notes and ownership are history. Payment status always comes from actual ledger facts. */
export async function recordExceptionFollowup(ctx: CommandContext, input: unknown): Promise<{
  id: string;
}> {
  const v = z.strictObject({
    exceptionId: z.uuid(), ownerId: z.string().min(1), note: reason
  }).parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["ADMIN", "BILLING", "INSURANCE", "DOCTOR", "NURSE", "ADMISSION", "PHARMACY", "LAB"], tx);
    await tx.execute(sql `select pg_advisory_xact_lock(hashtextextended(${`billing-request:${staff.id}:${ctx.requestId}`},0))`);
    const [authority] = await tx.select().from(adminExceptions).where(eq(adminExceptions.id, v.exceptionId));
    if (!authority)
      throw new DomainError("FORBIDDEN", "Exception access denied");
    await lockBillingAdmission(tx, authority.admissionId);
    const [last] = await tx.select().from(exceptionFollowups).where(eq(exceptionFollowups.exceptionId, authority.id)).orderBy(desc(exceptionFollowups.signedAt)).limit(1);
    if (staff.role !== "ADMIN" && (last?.ownerId ?? authority.followUpOwnerId) !== staff.id)
      throw new DomainError("FORBIDDEN", "Current accountable owner or administrator required");
    const [owner] = await tx.select().from(user).where(eq(user.id, v.ownerId));
    if (!owner || owner.banned || (staff.role !== "ADMIN" && owner.id !== staff.id))
      throw new DomainError("FORBIDDEN", "Only an administrator can route follow-up to another active staff owner");
    return billingRequest(tx, ctx, "exception.followup", v, async () => {
      const [record] = await tx.insert(exceptionFollowups).values({
        ...v, admissionId: authority.admissionId, signedBy: staff.id, signedAt: new Date()
      }).returning();
      await appendAudit(tx, ctx, {
        event: "exception.followup", entityType: "exception-followup", entityId: record.id, reason: v.note
      });
      return { id: record.id };
    });
  });
}
