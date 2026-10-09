import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction, type Transaction } from "../db";
import { DomainError, type CommandContext } from "../contracts";
import { admissionOperator } from "../admissions/commands";
import { admissions, beds, effectivePatients as patients, effectiveRoomStays as roomStays } from "../admissions/schema";
import { user } from "../schema/auth";
import { appendAudit } from "../audit";
import { billingRequest, lockBillingAdmission } from "../billing/commands";
import {
  careEpisode,
  careRequest,
  actualTime,
  createCareBillingEvent,
  requestKey,
} from "../clinical/commands";
import {
  careOccurrences,
  clinicalOrders,
  clinicalTaskEvents,
} from "../clinical/schema";
import { observationValues, quantity, text } from "../clinical/input";
import {
  medicationAdministrations,
  nurseAssignments,
  nurseAssignmentRevocations,
  nursingAddenda,
  nursingConsumables,
  nursingObservations,
  effectiveShiftEnds as nursingShiftEnds,
  nursingShiftEnds as originalShiftEnds,
  nursingShifts,
} from "./schema";

export async function assignmentWorkspace(ctx: CommandContext) {
  await admissionOperator(ctx, ["ADMIN"]);
  const episodes = await db
    .select({
      id: admissions.id,
      ipCode: admissions.ipCode,
      name: patients.name,
      bedLabel: beds.label,
    })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .innerJoin(beds, eq(beds.id, admissions.bedId))
    .where(eq(admissions.status, "ADMITTED"));
  const nurses = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(eq(user.role, "NURSE"));
  const assignments = await db
    .select({
      id: nurseAssignments.id,
      admissionId: nurseAssignments.admissionId,
      nurseId: nurseAssignments.nurseId,
      reason: nurseAssignments.reason,
      authority: nurseAssignments.authority,
      assignedBy: nurseAssignments.signedBy,
      assignedAt: nurseAssignments.signedAt,
      revokedAt: nurseAssignmentRevocations.signedAt,
      revokedBy: nurseAssignmentRevocations.signedBy,
      revocationReason: nurseAssignmentRevocations.reason,
    })
    .from(nurseAssignments)
    .leftJoin(
      nurseAssignmentRevocations,
      eq(nurseAssignmentRevocations.assignmentId, nurseAssignments.id),
    );
  return { episodes, nurses, assignments };
}
export async function assignNurse(ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({
      admissionId: z.uuid(),
      nurseId: text,
      reason: text,
      authority: text,
    })
    .parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["ADMIN"], tx);
    return billingRequest(tx, ctx, "care.nurse-assigned", value, async () => {
      // Lock staff before episode, consistently with every staff command.
      const [nurse] = await tx
        .select()
        .from(user)
        .where(eq(user.id, value.nurseId))
        .for("share");
      if (!nurse || nurse.role !== "NURSE" || nurse.banned)
        throw new DomainError("VALIDATION", "Choose an active nurse account");
      const episode = await lockBillingAdmission(tx, value.admissionId);
      if (episode.status !== "ADMITTED")
        throw new DomainError(
          "PRECONDITION",
          "Assignment requires an active admission",
        );
      const [old] = await tx
        .select({ id: nurseAssignments.id })
        .from(nurseAssignments)
        .leftJoin(
          nurseAssignmentRevocations,
          eq(nurseAssignmentRevocations.assignmentId, nurseAssignments.id),
        )
        .where(
          and(
            eq(nurseAssignments.admissionId, value.admissionId),
            eq(nurseAssignments.nurseId, value.nurseId),
            isNull(nurseAssignmentRevocations.id),
          ),
        );
      if (old) return { id: old.id };
      const [assignment] = await tx
        .insert(nurseAssignments)
        .values({ ...value, signedBy: staff.id })
        .returning();
      await appendAudit(tx, ctx, {
        event: "care.nurse-assigned",
        entityType: "nurse-assignment",
        entityId: assignment.id,
        reason: `${value.authority}: ${value.reason}`,
      });
      return { id: assignment.id };
    });
  });
}
export async function revokeNurseAssignment(
  ctx: CommandContext,
  input: unknown,
) {
  return withTransaction((tx) =>
    revokeNurseAssignmentInTransaction(tx, ctx, input),
  );
}
export async function revokeNurseAssignmentInTransaction(
  tx: Transaction,
  ctx: CommandContext,
  input: unknown,
) {
  const value = z
    .strictObject({ assignmentId: z.uuid(), reason: text, authority: text })
    .parse(input);
  const staff = await admissionOperator(ctx, ["ADMIN"], tx);
  return billingRequest(
    tx,
    ctx,
    "care.nurse-assignment-revoked",
    value,
    async () => {
      const [grant] = await tx
        .select()
        .from(nurseAssignments)
        .where(eq(nurseAssignments.id, value.assignmentId));
      if (!grant)
        throw new DomainError("FORBIDDEN", "Assignment access denied");
      const episode = await lockBillingAdmission(tx, grant.admissionId);
      if (episode.status !== "ADMITTED")
        throw new DomainError(
          "PRECONDITION",
          "Operational reassignment requires an active admission",
        );
      if (
        (
          await tx
            .select()
            .from(nurseAssignmentRevocations)
            .where(eq(nurseAssignmentRevocations.assignmentId, grant.id))
        ).length
      )
        throw new DomainError(
          "CONFLICT",
          "This recorded grant has already been revoked",
        );
      const open = await tx
        .select({ id: nursingShifts.id })
        .from(nursingShifts)
        .leftJoin(
          nursingShiftEnds,
          eq(nursingShiftEnds.shiftId, nursingShifts.id),
        )
        .where(
          and(
            eq(nursingShifts.admissionId, grant.admissionId),
            eq(nursingShifts.nurseId, grant.nurseId),
            isNull(nursingShiftEnds.id),
          ),
        );
      if (open.length)
        throw new DomainError(
          "PRECONDITION",
          "The assigned nurse must sign the open shift handover before ordinary revocation. Unavailable-nurse exceptions require the later exception workflow.",
        );
      const [revocation] = await tx
        .insert(nurseAssignmentRevocations)
        .values({ ...value, signedBy: staff.id })
        .returning();
      await appendAudit(tx, ctx, {
        event: "care.nurse-assignment-revoked",
        entityType: "nurse-assignment",
        entityId: grant.id,
        reason: `${value.authority}: ${value.reason}`,
      });
      return { id: revocation.id };
    },
  );
}
async function audit(
  tx: Transaction,
  ctx: CommandContext,
  event: string,
  id: string,
  reason: string,
) {
  await appendAudit(tx, ctx, {
    event: `nursing.${event}`,
    entityType: "nursing-record",
    entityId: id,
    reason,
  });
}
export async function recordShift(ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({
      admissionId: z.uuid(),
      startedAt: z.iso.datetime(),
      endedAt: z.iso.datetime().optional(),
      handover: text,
      requestId: z.uuid(),
    })
    .parse(input);
  requestKey(ctx, value.requestId);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["NURSE"], tx);
    return careRequest(
      tx,
      ctx,
      staff,
      "nursing.shift-started",
      value,
      async () => {
        const episode = await careEpisode(tx, staff, value.admissionId);
        const start = actualTime(value.startedAt, episode.admittedAt!);
        const end = value.endedAt
          ? actualTime(value.endedAt, start)
          : undefined;
        if (end && end <= start)
          throw new DomainError(
            "VALIDATION",
            "Shift end must follow its start",
          );
        const shifts = await tx
          .select()
          .from(nursingShifts)
          .where(
            and(
              eq(nursingShifts.admissionId, value.admissionId),
              eq(nursingShifts.nurseId, staff.id),
            ),
          );
        const ends = shifts.length
          ? await tx
              .select()
              .from(nursingShiftEnds)
              .where(
                inArray(
                  nursingShiftEnds.shiftId,
                  shifts.map((s) => s.id),
                ),
              )
          : [];
        if (
          shifts.some((s) => {
            const e = ends.find((e) => e.shiftId === s.id)?.endedAt;
            return (!e || start < e) && (!end || s.startedAt < end);
          })
        )
          throw new DomainError(
            "CONFLICT",
            "Close the prior shift; attendance boundaries cannot overlap",
          );
        const [shift] = await tx
          .insert(nursingShifts)
          .values({
            admissionId: value.admissionId,
            nurseId: staff.id,
            startedAt: start,
            handover: value.handover,
            signedBy: staff.id,
          })
          .returning();
        if (end)
          await tx.insert(originalShiftEnds).values({
            shiftId: shift.id,
            endedAt: end,
            handover: value.handover,
            signedBy: staff.id,
          });
        await audit(tx, ctx, "shift-started", shift.id, value.handover);
        return { id: shift.id };
      },
    );
  });
}
export async function endShift(ctx: CommandContext, input: unknown) {
  return withTransaction(tx => endShiftInTransaction(tx, ctx, input));
}
export async function endShiftInTransaction(tx: Transaction, ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({
      shiftId: z.uuid(),
      endedAt: z.iso.datetime(),
      handover: text,
    })
    .parse(input);
    const staff = await admissionOperator(ctx, ["NURSE"], tx);
    return careRequest(
      tx,
      ctx,
      staff,
      "nursing.shift-ended",
      value,
      async () => {
        const [shift] = await tx
          .select()
          .from(nursingShifts)
          .where(eq(nursingShifts.id, value.shiftId));
        if (!shift || shift.nurseId !== staff.id)
          throw new DomainError(
            "FORBIDDEN",
            "Only this shift's nurse can sign its handover",
          );
        const episode = await careEpisode(tx, staff, shift.admissionId, false);
        if (episode.status !== "ADMITTED") {
          const { actualEpisodeDeparture } = await import("../discharge/exceptions");
          const departure = await actualEpisodeDeparture(tx, episode.id);
          if (episode.status !== "DISCHARGED" || !departure || new Date(value.endedAt) > departure) throw new DomainError("PRECONDITION", "After departure the original Nurse may only close factual attendance through the actual exit");
        }
        const endedAt = actualTime(value.endedAt, shift.startedAt);
        if (endedAt <= shift.startedAt)
          throw new DomainError(
            "VALIDATION",
            "Shift end must follow its start",
          );
        if (
          (
            await tx
              .select()
              .from(nursingShiftEnds)
              .where(eq(nursingShiftEnds.shiftId, shift.id))
          ).length
        )
          throw new DomainError(
            "CONFLICT",
            "This shift already has a signed handover",
          );
        const { validateAttendanceEnd } = await import("../discharge/exceptions");
        await validateAttendanceEnd(tx, shift.id, endedAt);
        const [end] = await tx
          .insert(originalShiftEnds)
          .values({ ...value, endedAt, signedBy: staff.id })
          .returning();
        await audit(tx, ctx, "shift-ended", end.id, value.handover);
        return { id: end.id };
      },
    );
}
export async function shiftForCare(
  tx: Transaction,
  staff: { id: string; role: string },
  shiftId: string,
  admissionId: string,
  time: string,
  cutoffExceptionId?: string,
) {
  const episode = await careEpisode(tx, staff, admissionId, !cutoffExceptionId);
  if(cutoffExceptionId){const {requireException}=await import("../discharge/exceptions");await requireException(tx,admissionId,cutoffExceptionId,"ROOM_CUTOFF_CORRECTION","AMEND");}
  const [shift] = await tx
    .select()
    .from(nursingShifts)
    .where(eq(nursingShifts.id, shiftId));
  if (!shift || shift.nurseId !== staff.id || shift.admissionId !== admissionId)
    throw new DomainError("FORBIDDEN", "Use your own shift for this admission");
  const [end] = await tx
    .select()
    .from(nursingShiftEnds)
    .where(eq(nursingShiftEnds.shiftId, shiftId));
  return {
    episode,
    shift,
    actual: actualTime(time, shift.startedAt, end?.endedAt),
  };
}
async function occurrenceForCare(
  tx: Transaction,
  admissionId: string,
  kind: string,
  scheduledAt: string,
  actualAt: Date,
  orderId?: string,
) {
  const rows = await tx
    .select({ occurrence: careOccurrences, order: clinicalOrders })
    .from(careOccurrences)
    .innerJoin(clinicalOrders, eq(clinicalOrders.id, careOccurrences.orderId))
    .where(
      and(
        eq(careOccurrences.admissionId, admissionId),
        eq(careOccurrences.scheduledAt, new Date(scheduledAt)),
        eq(clinicalOrders.kind, kind),
        ...(orderId ? [eq(clinicalOrders.id, orderId)] : []),
      ),
    );
  if (rows.length !== 1)
    throw new DomainError(
      "VALIDATION",
      "Select one exact prescribed occurrence for this admission",
    );
  const { occurrence, order } = rows[0];
  const [stop] = await tx
    .select()
    .from(clinicalTaskEvents)
    .where(
      and(
        eq(clinicalTaskEvents.orderId, order.id),
        eq(clinicalTaskEvents.status, "STOPPED"),
      ),
    );
  if (stop && actualAt >= stop.signedAt)
    throw new DomainError(
      "PRECONDITION",
      "The clinician has stopped this order",
    );
  if (actualAt < order.signedAt)
    throw new DomainError(
      "VALIDATION",
      "Actual care cannot precede the recorded clinician order",
    );
  return { occurrence, order };
}
export async function recordObservation(ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({
      admissionId: z.uuid(),
      shiftId: z.uuid(),
      orderId: z.uuid().optional(),
      scheduledFor: z.iso.datetime(),
      observedAt: z.iso.datetime(),
      values: observationValues,
      requestId: z.uuid(),
    })
    .parse(input);
  requestKey(ctx, value.requestId);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["NURSE"], tx);
    return careRequest(
      tx,
      ctx,
      staff,
      "nursing.observation",
      value,
      async () => {
        const { actual } = await shiftForCare(
          tx,
          staff,
          value.shiftId,
          value.admissionId,
          value.observedAt,
        );
        const { occurrence } = await occurrenceForCare(
          tx,
          value.admissionId,
          "VITALS",
          value.scheduledFor,
          actual,
          value.orderId,
        );
        if (
          (
            await tx
              .select()
              .from(nursingObservations)
              .where(eq(nursingObservations.occurrenceId, occurrence.id))
          ).length
        )
          throw new DomainError(
            "CONFLICT",
            "This occurrence already has a signed reading",
          );
        const [observation] = await tx
          .insert(nursingObservations)
          .values({
            admissionId: value.admissionId,
            shiftId: value.shiftId,
            occurrenceId: occurrence.id,
            observedAt: actual,
            values: value.values as Record<string, number>,
            signedBy: staff.id,
          })
          .returning();
        await audit(
          tx,
          ctx,
          "observation-signed",
          observation.id,
          "Nurse signed scheduled and actual readings",
        );
        return { id: observation.id };
      },
    );
  });
}
export async function recordAdministration(
  ctx: CommandContext,
  input: unknown,
) {
  return withTransaction((tx) =>
    recordAdministrationInTransaction(tx, ctx, input),
  );
}
export async function recordAdministrationInTransaction(
  tx: Transaction,
  ctx: CommandContext,
  input: unknown,
) {
  const value = z
    .strictObject({
      orderId: z.uuid(),
      shiftId: z.uuid(),
      scheduledAt: z.iso.datetime(),
      actualAt: z.iso.datetime(),
      actualDose: z.string().regex(/^\d{1,9}(\.\d{1,6})?$/),
      doseUnit: text,
      outcome: z.enum(["GIVEN", "HELD", "REFUSED"]),
      reason: text.optional(),
      requestId: z.uuid(),
    })
    .refine(
      (v) =>
        v.outcome === "GIVEN"
          ? Number(v.actualDose) > 0
          : Boolean(v.reason) && Number(v.actualDose) === 0,
      "Given requires actual dose; held/refused require reason and zero administered dose",
    )
    .parse(input);
  requestKey(ctx, value.requestId);
  const staff = await admissionOperator(ctx, ["NURSE"], tx);
  return careRequest(tx, ctx, staff, "nursing.mar", value, async () => {
    const [order] = await tx
      .select()
      .from(clinicalOrders)
      .where(eq(clinicalOrders.id, value.orderId));
    if (!order || order.kind !== "MEDICINE")
      throw new DomainError("FORBIDDEN", "Medicine order access denied");
    const { actual } = await shiftForCare(
      tx,
      staff,
      value.shiftId,
      order.admissionId,
      value.actualAt,
    );
    const { occurrence } = await occurrenceForCare(
      tx,
      order.admissionId,
      "MEDICINE",
      value.scheduledAt,
      actual,
      order.id,
    );
    if (value.doseUnit !== order.details.doseUnit)
      throw new DomainError(
        "VALIDATION",
        "Actual dose unit must match the prescribed dose unit; conversions are not inferred",
      );
    if (
      value.outcome === "GIVEN" &&
      value.actualDose !== order.details.dose &&
      !value.reason
    )
      throw new DomainError(
        "VALIDATION",
        "Record the reason for an actual dose differing from the prescription",
      );
    if (
      (
        await tx
          .select()
          .from(medicationAdministrations)
          .where(eq(medicationAdministrations.occurrenceId, occurrence.id))
      ).length
    )
      throw new DomainError(
        "CONFLICT",
        "This occurrence already has a signed administration outcome",
      );
    const [mar] = await tx
      .insert(medicationAdministrations)
      .values({
        admissionId: order.admissionId,
        shiftId: value.shiftId,
        occurrenceId: occurrence.id,
        actualAt: actual,
        actualDose: value.actualDose,
        doseUnit: value.doseUnit,
        outcome: value.outcome,
        reason: value.reason,
        signedBy: staff.id,
      })
      .returning();
    await audit(
      tx,
      ctx,
      "mar-signed",
      mar.id,
      value.reason ?? "Nurse signed actual medication administration",
    );
    return { id: mar.id };
  });
}
export async function recordConsumable(ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({
      admissionId: z.uuid(),
      shiftId: z.uuid(),
      usedAt: z.iso.datetime(),
      itemId: z.string().regex(/^[A-Z0-9_-]{2,32}$/),
      quantity,
      unit: text,
      reason: text,
    })
    .parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["NURSE"], tx);
    return careRequest(
      tx,
      ctx,
      staff,
      "nursing.consumable",
      value,
      async () => {
        const { actual } = await shiftForCare(
          tx,
          staff,
          value.shiftId,
          value.admissionId,
          value.usedAt,
        );
        const stays = await tx
          .select()
          .from(roomStays)
          .where(eq(roomStays.admissionId, value.admissionId));
        const stay = stays.find(
          (s) => s.startedAt <= actual && (!s.endedAt || actual < s.endedAt),
        );
        if (!stay)
          throw new DomainError(
            "VALIDATION",
            "Consumable use must belong to an actual room stay",
          );
        const [use] = await tx
          .insert(nursingConsumables)
          .values({
            ...value,
            usedAt: actual,
            bedId: stay.bedId,
            stayId: stay.id,
            signedBy: staff.id,
          })
          .returning();
        await createCareBillingEvent(
          tx,
          ctx,
          {
            id: use.id,
            admissionId: value.admissionId,
            category: "consumable",
            itemId: use.itemId,
            quantity: use.quantity,
            unit: use.unit,
            state: "UNRESOLVED",
          },
          true,
        );
        await audit(tx, ctx, "consumable-used", use.id, value.reason);
        return { id: use.id };
      },
    );
  });
}
export async function addNursingAddendum(ctx: CommandContext, input: unknown) {
  return withTransaction((tx) =>
    addNursingAddendumInTransaction(tx, ctx, input),
  );
}
export async function addNursingAddendumInTransaction(
  tx: Transaction,
  ctx: CommandContext,
  input: unknown,
) {
  const value = z
    .strictObject({
      admissionId: z.uuid(),
      recordType: z.enum(["MAR", "OBSERVATION", "SHIFT", "CONSUMABLE"]),
      recordId: z.uuid(),
      reason: text,
      text,
    })
    .parse(input);
  const staff = await admissionOperator(ctx, ["NURSE"], tx);
  return careRequest(tx, ctx, staff, "nursing.addendum", value, async () => {
    await careEpisode(tx, staff, value.admissionId);
    const table = {
      MAR: medicationAdministrations,
      OBSERVATION: nursingObservations,
      SHIFT: nursingShifts,
      CONSUMABLE: nursingConsumables,
    }[value.recordType];
    const [record] = await tx
      .select({ admissionId: table.admissionId })
      .from(table)
      .where(eq(table.id, value.recordId));
    if (!record || record.admissionId !== value.admissionId)
      throw new DomainError(
        "FORBIDDEN",
        "Nursing record must belong to this admission",
      );
    const [addendum] = await tx
      .insert(nursingAddenda)
      .values({ ...value, signedBy: staff.id })
      .returning();
    await audit(tx, ctx, "addendum-signed", addendum.id, value.reason);
    return { id: addendum.id };
  });
}
