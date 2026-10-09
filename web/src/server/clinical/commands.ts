import "server-only";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, withTransaction, type Transaction } from "../db";
import { DomainError, type CommandContext } from "../contracts";
import { admissionOperator } from "../admissions/commands";
import { admissions, bedHolds, beds, patients, roomStays } from "../admissions/schema";
import { admissionTransfers, transferInsuranceTasks, transferOrders } from "../admissions/transfer-schema";
import { user } from "../schema/auth";
import { settingVersions } from "../schema/core";
import { labDispositions, labReports, labReportAddenda } from "../lab/schema";
import { appendAudit } from "../audit";
import {
  billingRequest,
  itemPolicyInput,
  lockBillingAdmission,
  postChargeInTransaction,
  resolveBillableRate,
} from "../billing/commands";
import {
  careBillingEvents,
  careOccurrences,
  careTasks,
  clinicalAddenda,
  clinicalOrders,
  clinicalRounds,
  clinicalSummaries,
  clinicalTaskEvents,
} from "./schema";
import {
  medicationAdministrations,
  nurseAssignments,
  nurseAssignmentRevocations,
  nursingAddenda,
  nursingConsumables,
  nursingObservations,
  nursingShiftEnds,
  nursingShifts,
} from "../nursing/schema";
import {
  roundInput,
  scheduledTimes,
  text,
  type PrescriptionLine,
} from "./input";
export function requestKey(ctx: CommandContext, requestId: string) {
  if (ctx.requestId !== requestId)
    throw new DomainError("VALIDATION", "Request keys disagree");
}
export async function careEpisode(
  tx: Transaction,
  staff: { id: string; role: string },
  admissionId: string,
  active = true,
) {
  const episode = await lockBillingAdmission(tx, admissionId);
  if (staff.role === "DOCTOR" && episode.admittingDoctorId === staff.id) {
    /* recorded admitting doctor owns clinical care */
  } else if (
    staff.role === "NURSE" &&
    (
      await tx
        .select({ id: nurseAssignments.id })
        .from(nurseAssignments)
        .leftJoin(
          nurseAssignmentRevocations,
          eq(nurseAssignmentRevocations.assignmentId, nurseAssignments.id),
        )
        .where(
          and(
            eq(nurseAssignments.admissionId, admissionId),
            eq(nurseAssignments.nurseId, staff.id),
            isNull(nurseAssignmentRevocations.id),
          ),
        )
    ).length
  ) {
    /* explicit audited ward assignment */
  } else throw new DomainError("FORBIDDEN", "Assigned care access required");
  if (active && episode.status !== "ADMITTED")
    throw new DomainError(
      "PRECONDITION",
      "Care changes require an active admission",
    );
  return episode;
}
export function actualTime(value: string, start: Date, end?: Date) {
  const date = new Date(z.iso.datetime().parse(value));
  if (date < start || date.getTime() > Date.now() || (end && date > end))
    throw new DomainError(
      "VALIDATION",
      "Time must be within the admission and recorded shift, and no later than now",
    );
  return date;
}
/** A completed retry still requires current care access. Billing retry semantics remain unchanged. */
export async function careRequest(
  tx: Transaction,
  ctx: CommandContext,
  staff: { id: string; role: string },
  action: string,
  value: {
    admissionId?: string;
    orderId?: string;
    shiftId?: string;
    noteId?: string;
    sourceEventId?: string;
  },
  apply: () => Promise<{ id: string }>,
) {
  const result = await billingRequest(tx, ctx, action, value, apply);
  let admissionId = value.admissionId;
  if (!admissionId) {
    const source = value.orderId
      ? { table: clinicalOrders, id: value.orderId }
      : value.shiftId
        ? { table: nursingShifts, id: value.shiftId }
        : value.noteId
          ? { table: clinicalRounds, id: value.noteId }
          : value.sourceEventId
            ? { table: careBillingEvents, id: value.sourceEventId }
            : undefined;
    if (source) {
      const [record] = await tx
        .select({ admissionId: source.table.admissionId })
        .from(source.table)
        .where(eq(source.table.id, source.id));
      admissionId = record?.admissionId;
    }
  }
  if (!admissionId)
    throw new DomainError("FORBIDDEN", "Recorded care source access denied");
  await careEpisode(tx, staff, admissionId, false);
  return result;
}
async function clinicalAudit(
  tx: Transaction,
  ctx: CommandContext,
  event: string,
  id: string,
  reason: string,
) {
  await appendAudit(tx, ctx, {
    event: `care.${event}`,
    entityType: "care",
    entityId: id,
    reason,
  });
}
/** Persist source first; missing/mismatched configuration never discards clinical documentation. */
export async function createCareBillingEvent(
  tx: Transaction,
  ctx: CommandContext,
  source: typeof careBillingEvents.$inferInsert,
  post: boolean,
) {
  await tx.insert(careBillingEvents).values(source);
  let rate: Awaited<ReturnType<typeof resolveBillableRate>>;
  try {
    rate = await resolveBillableRate(tx, {
      itemId: source.itemId,
      eventKind: source.category,
      unit: source.unit,
      quantity: source.quantity,
    });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    await tx
      .update(careBillingEvents)
      .set({ resolutionReason: error.message })
      .where(eq(careBillingEvents.id, source.id));
    return;
  }
  await tx
    .update(careBillingEvents)
    .set({ tariffVersionId: rate.version.id, state: "READY" })
    .where(eq(careBillingEvents.id, source.id));
  if (post)
    await postCareBilling(
      tx,
      ctx,
      {
        ...source,
        tariffVersionId: rate.version.id,
        state: "READY",
      } as typeof careBillingEvents.$inferSelect,
      rate,
    );
}
async function postCareBilling(
  tx: Transaction,
  ctx: CommandContext,
  source: typeof careBillingEvents.$inferSelect,
  rate?: Awaited<ReturnType<typeof resolveBillableRate>>,
) {
  if (!source.tariffVersionId || source.state === "POSTED") return;
  const pinned =
    rate ??
    (await resolveBillableRate(tx, {
      itemId: source.itemId,
      eventKind: source.category,
      unit: source.unit,
      quantity: source.quantity,
      pinnedVersionId: source.tariffVersionId,
    }));
  await postChargeInTransaction(
    tx,
    ctx,
    {
      admissionId: source.admissionId,
      sourceEventId: source.id,
      category: source.category,
      itemId: source.itemId,
      quantity: source.quantity,
      unit: source.unit,
      tariffVersionId: source.tariffVersionId,
      status: ["lab", "radiology"].includes(source.category)
        ? "PENDING"
        : "FINAL",
    },
    pinned,
  );
  await tx
    .update(careBillingEvents)
    .set({ state: "POSTED" })
    .where(eq(careBillingEvents.id, source.id));
}
export async function recordRoundInTransaction(
  tx: Transaction,
  ctx: CommandContext,
  input: unknown,
) {
  const value = roundInput.parse(input);
  requestKey(ctx, value.requestId);
  const staff = await admissionOperator(ctx, ["DOCTOR"], tx);
  return careRequest(tx, ctx, staff, "care.round", value, async () => {
    const episode = await careEpisode(tx, staff, value.admissionId);
    const [round] = await tx
      .insert(clinicalRounds)
      .values({
        admissionId: episode.id,
        notes: value.notes,
        signedBy: staff.id,
      })
      .returning();
    if (value.feeScheduleId)
      await createCareBillingEvent(
        tx,
        ctx,
        {
          id: round.id,
          admissionId: episode.id,
          roundId: round.id,
          category: "consultation",
          itemId: value.feeScheduleId,
          unit: value.feeUnit!,
          quantity: "1",
          state: "UNRESOLVED",
        },
        true,
      );
    for (const details of value.orders) {
      let medicineItemId: string | null = null,
        medicineCatalogVersionId: string | null = null;
      if (details.kind === "MEDICINE" && details.itemId) {
        const versions = await tx
          .select()
          .from(settingVersions)
          .where(
            and(
              eq(settingVersions.hospitalId, episode.hospitalId),
              eq(settingVersions.kind, "tariff"),
            ),
          )
          .orderBy(desc(settingVersions.version));
        const version = versions.find(
          (v) =>
            v.payload.type === "billable-item" &&
            v.payload.code === details.itemId,
        );
        if (version) {
          const p = itemPolicyInput.parse(version.payload);
          if (
            p.active &&
            p.category === "medicine" &&
            p.department === "PHARMACY" &&
            p.name === details.requestedItem &&
            (details.medicationPurpose === "WARD" ||
              p.unit === details.dispensingUnit)
          ) {
            medicineItemId = p.code;
            medicineCatalogVersionId = version.id;
          }
        }
      }
      const [order] = await tx
        .insert(clinicalOrders)
        .values({
          admissionId: episode.id,
          roundId: round.id,
          kind: details.kind,
          requestedItem: details.requestedItem,
          details,
          medicineItemId,
          medicineCatalogVersionId,
          signedBy: staff.id,
        })
        .returning();
      const ownerRole = {
        MEDICINE: "PHARMACY",
        LAB: "LAB",
        RADIOLOGY: "LAB",
        PROCEDURE: "DOCTOR",
        DIET: "NURSE",
        VITALS: "NURSE",
      }[details.kind];
      await tx
        .insert(careTasks)
        .values({ admissionId: episode.id, orderId: order.id, ownerRole });
      if (details.schedule) {
        const times = scheduledTimes(details.schedule);
        if (
          Date.parse(times[0]) < episode.admittedAt!.getTime() ||
          Date.parse(times.at(-1)!) > Date.now() + 366 * 86400000
        )
          throw new DomainError(
            "VALIDATION",
            "Prescribed schedule must start within this admission and remain within one year",
          );
        await tx.insert(careOccurrences).values(
          times.map((t) => ({
            admissionId: episode.id,
            orderId: order.id,
            scheduledAt: new Date(t),
          })),
        );
      }
      if (["LAB", "RADIOLOGY", "PROCEDURE"].includes(details.kind))
        await createCareBillingEvent(
          tx,
          ctx,
          {
            id: order.id,
            admissionId: episode.id,
            orderId: order.id,
            category: details.kind.toLowerCase(),
            itemId: details.itemId!,
            quantity: details.quantity!,
            unit: details.unit!,
            state: "UNRESOLVED",
          },
          details.kind !== "PROCEDURE",
        );
    }
    await clinicalAudit(
      tx,
      ctx,
      "round-signed",
      round.id,
      "Doctor signed round and explicit orders",
    );
    return { id: round.id };
  });
}
export async function recordRound(ctx: CommandContext, input: unknown) {
  return withTransaction((tx) => recordRoundInTransaction(tx, ctx, input));
}
export async function orderTransfer(ctx: CommandContext, input: unknown) {
  return withTransaction(tx => orderTransferInTransaction(tx, ctx, input));
}
export async function orderTransferInTransaction(tx: Transaction, ctx: CommandContext, input: unknown) {
  const value = z.strictObject({ admissionId: z.uuid(), destinationCategory: z.string().regex(/^[A-Z0-9_-]{2,32}$/), reason: text, requestId: z.uuid() }).parse(input);
  requestKey(ctx, value.requestId);
  // Composing callers take this settings/staff lock before staff or admission row locks.
  await tx.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);
    const staff = await admissionOperator(ctx, ["DOCTOR"], tx);
    return careRequest(tx, ctx, staff, "care.transfer-ordered", value, async () => {
      const episode = await careEpisode(tx, staff, value.admissionId);
      const [stay] = await tx.select().from(roomStays).where(and(eq(roomStays.admissionId, episode.id), isNull(roomStays.endedAt)));
      if (!stay) throw new DomainError("PRECONDITION", "An occupied room stay is required");
      const versions = await tx.select().from(settingVersions).where(eq(settingVersions.hospitalId, episode.hospitalId)).orderBy(desc(settingVersions.version));
      const category = versions.find(v => v.payload.type === "bed-category" && v.payload.code === value.destinationCategory);
      if (category?.payload.active !== true) throw new DomainError("PRECONDITION", "Select an active configured destination category");
      const [previous] = await tx.select({ version: transferOrders.version }).from(transferOrders).where(eq(transferOrders.admissionId, episode.id)).orderBy(desc(transferOrders.version)).limit(1);
      const [order] = await tx.insert(transferOrders).values({ admissionId: episode.id, sourceStayId: stay.id, version: (previous?.version ?? 0) + 1, destinationCategory: value.destinationCategory, reason: value.reason, signedBy: staff.id }).returning();
      await clinicalAudit(tx, ctx, "transfer-ordered", order.id, value.reason);
      return { id: order.id };
    });
}
export async function addClinicalAddendum(ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({ noteId: z.uuid(), reason: text, text })
    .parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["DOCTOR"], tx);
    return careRequest(tx, ctx, staff, "care.addendum", value, async () => {
      const [round] = await tx
        .select()
        .from(clinicalRounds)
        .where(eq(clinicalRounds.id, value.noteId));
      if (!round)
        throw new DomainError("FORBIDDEN", "Clinical note access denied");
      await careEpisode(tx, staff, round.admissionId);
      const [addendum] = await tx
        .insert(clinicalAddenda)
        .values({ ...value, signedBy: staff.id })
        .returning();
      await clinicalAudit(
        tx,
        ctx,
        "addendum-signed",
        addendum.id,
        value.reason,
      );
      return { id: addendum.id };
    });
  });
}
export async function completeClinicalTask(
  ctx: CommandContext,
  input: unknown,
) {
  const value = z
    .strictObject({ orderId: z.uuid(), reason: text })
    .parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["DOCTOR", "NURSE"], tx);
    return careRequest(
      tx,
      ctx,
      staff,
      "care.task-completed",
      value,
      async () => {
        const [order] = await tx
          .select()
          .from(clinicalOrders)
          .where(eq(clinicalOrders.id, value.orderId));
        if (!order) throw new DomainError("FORBIDDEN", "Order access denied");
        await careEpisode(tx, staff, order.admissionId);
        if (
          !(
            (staff.role === "DOCTOR" && order.kind === "PROCEDURE") ||
            (staff.role === "NURSE" && order.kind === "DIET")
          )
        )
          throw new DomainError(
            "FORBIDDEN",
            "Complete this work in its owning department",
          );
        const events = await tx
          .select()
          .from(clinicalTaskEvents)
          .where(eq(clinicalTaskEvents.orderId, order.id));
        if (events.some((e) => e.status === "STOPPED"))
          throw new DomainError("PRECONDITION", "Order has been stopped");
        if (events.some((e) => e.status === "COMPLETED"))
          return { id: events.find((e) => e.status === "COMPLETED")!.id };
        const [event] = await tx
          .insert(clinicalTaskEvents)
          .values({
            orderId: order.id,
            status: "COMPLETED",
            reason: value.reason,
            signedBy: staff.id,
          })
          .returning();
        const [source] = await tx
          .select()
          .from(careBillingEvents)
          .where(eq(careBillingEvents.id, order.id));
        if (source) await postCareBilling(tx, ctx, source);
        await clinicalAudit(tx, ctx, "task-completed", event.id, value.reason);
        return { id: event.id };
      },
    );
  });
}
export async function stopClinicalOrder(ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({ orderId: z.uuid(), reason: text })
    .parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["DOCTOR"], tx);
    return careRequest(
      tx,
      ctx,
      staff,
      "care.order-stopped",
      value,
      async () => {
        const [order] = await tx
          .select()
          .from(clinicalOrders)
          .where(eq(clinicalOrders.id, value.orderId));
        if (!order) throw new DomainError("FORBIDDEN", "Order access denied");
        await careEpisode(tx, staff, order.admissionId);
        const [event] = await tx
          .insert(clinicalTaskEvents)
          .values({
            orderId: order.id,
            status: "STOPPED",
            reason: value.reason,
            signedBy: staff.id,
          })
          .onConflictDoNothing()
          .returning();
        if (event)
          await clinicalAudit(tx, ctx, "order-stopped", event.id, value.reason);
        return { id: event?.id ?? order.id };
      },
    );
  });
}
export async function resolveCareBilling(ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({ sourceEventId: z.uuid(), reason: text })
    .parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["DOCTOR", "NURSE"], tx);
    return careRequest(
      tx,
      ctx,
      staff,
      "care.billing-resolved",
      value,
      async () => {
        const [locator] = await tx
          .select({ admissionId: careBillingEvents.admissionId })
          .from(careBillingEvents)
          .where(eq(careBillingEvents.id, value.sourceEventId));
        if (!locator)
          throw new DomainError("FORBIDDEN", "Care source access denied");
        await careEpisode(tx, staff, locator.admissionId);
        const [source] = await tx
          .select()
          .from(careBillingEvents)
          .where(eq(careBillingEvents.id, value.sourceEventId));
        if (!source)
          throw new DomainError("FORBIDDEN", "Care source access denied");
        if(source.orderId && ["lab","radiology"].includes(source.category) && (await tx.select().from(labDispositions).where(eq(labDispositions.orderId,source.orderId))).length)
          throw new DomainError("PRECONDITION","Unperformed diagnostic work has a retained disposition; do not create a new fee");
        if ((staff.role === "NURSE") !== (source.category === "consumable"))
          throw new DomainError(
            "FORBIDDEN",
            "Source belongs to another care department",
          );
        if (source.state !== "UNRESOLVED") return { id: source.id };
        const rate = await resolveBillableRate(tx, {
          itemId: source.itemId,
          eventKind: source.category,
          quantity: source.quantity,
          unit: source.unit,
        });
        await tx
          .update(careBillingEvents)
          .set({
            tariffVersionId: rate.version.id,
            state: "READY",
            resolutionReason: value.reason,
          })
          .where(eq(careBillingEvents.id, source.id));
        const completed = source.orderId
          ? await tx
              .select()
              .from(clinicalTaskEvents)
              .where(
                and(
                  eq(clinicalTaskEvents.orderId, source.orderId),
                  eq(clinicalTaskEvents.status, "COMPLETED"),
                ),
              )
          : [];
        if (source.category !== "procedure" || completed.length)
          await postCareBilling(
            tx,
            ctx,
            { ...source, state: "READY", tariffVersionId: rate.version.id },
            rate,
          );
        await clinicalAudit(
          tx,
          ctx,
          "billing-resolved",
          source.id,
          value.reason,
        );
        return { id: source.id };
      },
    );
  });
}
export async function signClinicalSummary(ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({
      admissionId: z.uuid(),
      expectedVersion: z.number().int().min(0),
      diagnosis: text,
      course: text,
      condition: text,
      followUp: text,
      advice: text,
      prescriptionOrderIds: z.array(z.uuid()).max(100),
    })
    .parse(input);
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["DOCTOR"], tx);
    const result = await careRequest(
      tx,
      ctx,
      staff,
      "care.summary-signed",
      value,
      async () => {
        await careEpisode(tx, staff, value.admissionId);
        const [old] = await tx
          .select()
          .from(clinicalSummaries)
          .where(eq(clinicalSummaries.admissionId, value.admissionId))
          .orderBy(desc(clinicalSummaries.version))
          .limit(1);
        if ((old?.version ?? 0) !== value.expectedVersion)
          throw new DomainError(
            "CONFLICT",
            "Clinical summary changed; review the current version",
          );
        if (
          new Set(value.prescriptionOrderIds).size !==
          value.prescriptionOrderIds.length
        )
          throw new DomainError(
            "VALIDATION",
            "Prescription medicine order identities must be distinct",
          );
        const prescription: PrescriptionLine[] = [];
        for (const orderId of value.prescriptionOrderIds) {
          const [order] = await tx
            .select()
            .from(clinicalOrders)
            .where(eq(clinicalOrders.id, orderId));
          const stopped = await tx
            .select()
            .from(clinicalTaskEvents)
            .where(
              and(
                eq(clinicalTaskEvents.orderId, orderId),
                eq(clinicalTaskEvents.status, "STOPPED"),
              ),
            );
          if (
            !order ||
            order.admissionId !== value.admissionId ||
            order.kind !== "MEDICINE" ||
            !["TAKE_HOME", "BOTH"].includes(
              order.details.medicationPurpose ?? "",
            ) ||
            stopped.length
          )
            throw new DomainError(
              "VALIDATION",
              "Prescription requires current take-home medicine orders from this admission",
            );
          const d = order.details;
          prescription.push({
            orderId: order.id,
            medicineId: order.medicineItemId ?? order.id,
            medicineCatalogVersionId: order.medicineCatalogVersionId,
            medicineIdentityState: order.medicineItemId
              ? "CONFIGURED"
              : "UNRESOLVED",
            requestedItem: d.requestedItem,
            dose: d.dose!,
            doseUnit: d.doseUnit!,
            route: d.route!,
            frequency: d.frequency!,
            durationDays: d.durationDays!,
            dispensingQuantity: d.dispensingQuantity!,
            dispensingUnit: d.dispensingUnit!,
          });
        }
        const [summary] = await tx
          .insert(clinicalSummaries)
          .values({
            admissionId: value.admissionId,
            diagnosis: value.diagnosis,
            course: value.course,
            condition: value.condition,
            followUp: value.followUp,
            advice: value.advice,
            version: value.expectedVersion + 1,
            prescription,
            signedBy: staff.id,
          })
          .returning();
        await clinicalAudit(
          tx,
          ctx,
          "summary-signed",
          summary.id,
          "Doctor signed clinical summary and explicit prescription; no discharge clearance seal",
        );
        return { id: summary.id };
      },
    );
    const [summary] = await tx
      .select()
      .from(clinicalSummaries)
      .where(eq(clinicalSummaries.id, result.id));
    return summary;
  });
}
/** Identity selector only: no stock, price, patient ledger, or medicine posting authority. */
export async function clinicalMedicineCatalog(ctx: CommandContext) {
  await admissionOperator(ctx, ["DOCTOR"]);
  const versions = await db
    .select()
    .from(settingVersions)
    .where(eq(settingVersions.kind, "tariff"))
    .orderBy(desc(settingVersions.version));
  const seen = new Set<string>();
  const result: { itemId: string; name: string; dispensingUnit: string }[] = [];
  for (const version of versions) {
    if (version.payload.type !== "billable-item") continue;
    const p = itemPolicyInput.parse(version.payload);
    if (seen.has(p.code)) continue;
    seen.add(p.code);
    if (p.category === "medicine" && p.department === "PHARMACY" && p.active)
      result.push({ itemId: p.code, name: p.name, dispensingUnit: p.unit });
  }
  return result;
}
export async function careWorkspace(ctx: CommandContext) {
  const staff = await admissionOperator(ctx, ["DOCTOR", "NURSE"]);
  const episodes = await db
    .select({
      id: admissions.id,
      ipCode: admissions.ipCode,
      name: patients.name,
      bedLabel: beds.label,
      doctorId: admissions.admittingDoctorId,
    })
    .from(admissions)
    .innerJoin(patients, eq(admissions.patientId, patients.id))
    .innerJoin(beds, eq(admissions.bedId, beds.id))
    .where(eq(admissions.status, "ADMITTED"));
  if (staff.role === "DOCTOR")
    return episodes.filter((e) => e.doctorId === staff.id);
  const assignments = await db
    .select({ admissionId: nurseAssignments.admissionId })
    .from(nurseAssignments)
    .leftJoin(
      nurseAssignmentRevocations,
      eq(nurseAssignmentRevocations.assignmentId, nurseAssignments.id),
    )
    .where(
      and(
        eq(nurseAssignments.nurseId, staff.id),
        isNull(nurseAssignmentRevocations.id),
      ),
    );
  return episodes.filter((e) =>
    assignments.some((a) => a.admissionId === e.id),
  );
}
export async function getCare(ctx: CommandContext, admissionId: string) {
  return withTransaction(async (tx) => {
    const staff = await admissionOperator(ctx, ["DOCTOR", "NURSE"], tx);
    const episode = await careEpisode(tx, staff, admissionId, false);
    const [identity] = await tx
      .select({
        name: patients.name,
        uhid: patients.uhid,
        bedLabel: beds.label,
        doctor: user.name,
      })
      .from(patients)
      .innerJoin(beds, eq(beds.id, episode.bedId))
      .innerJoin(user, eq(user.id, episode.admittingDoctorId))
      .where(eq(patients.id, episode.patientId));
    const orders = await tx
      .select()
      .from(clinicalOrders)
      .where(eq(clinicalOrders.admissionId, admissionId))
      .orderBy(asc(clinicalOrders.signedAt), asc(clinicalOrders.id));
    const tasks = await tx
      .select()
      .from(careTasks)
      .where(eq(careTasks.admissionId, admissionId));
    const events = orders.length
      ? await tx
          .select()
          .from(clinicalTaskEvents)
          .where(
            inArray(
              clinicalTaskEvents.orderId,
              orders.map((o) => o.id),
            ),
          )
      : [];
    const observations = await tx
      .select()
      .from(nursingObservations)
      .where(eq(nursingObservations.admissionId, admissionId));
    const administrations = await tx
      .select()
      .from(medicationAdministrations)
      .where(eq(medicationAdministrations.admissionId, admissionId));
    const shifts = await tx
      .select()
      .from(nursingShifts)
      .where(eq(nursingShifts.admissionId, admissionId))
      .orderBy(asc(nursingShifts.startedAt));
    const shiftEnds = shifts.length
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
    const occurrences = (
      await tx
        .select()
        .from(careOccurrences)
        .where(eq(careOccurrences.admissionId, admissionId))
        .orderBy(asc(careOccurrences.scheduledAt), asc(careOccurrences.id))
    ).map((o) => ({
      ...o,
      status:
        observations.some((v) => v.occurrenceId === o.id) ||
        administrations.some((v) => v.occurrenceId === o.id)
          ? "RECORDED"
          : events.some(
                (e) => e.orderId === o.orderId && e.status === "STOPPED",
              )
            ? "STOPPED"
            : o.scheduledAt.getTime() < Date.now()
              ? "OVERDUE"
              : "PENDING",
    }));
    const rounds =
      staff.role === "DOCTOR"
        ? await tx
            .select()
            .from(clinicalRounds)
            .where(eq(clinicalRounds.admissionId, admissionId))
            .orderBy(desc(clinicalRounds.signedAt))
        : [];
    const addenda = rounds.length
      ? await tx
          .select()
          .from(clinicalAddenda)
          .where(
            inArray(
              clinicalAddenda.noteId,
              rounds.map((r) => r.id),
            ),
          )
      : [];
    const summaries =
      staff.role === "DOCTOR"
        ? await tx
            .select()
            .from(clinicalSummaries)
            .where(eq(clinicalSummaries.admissionId, admissionId))
            .orderBy(desc(clinicalSummaries.version))
        : [];
    const billing = (
      await tx
        .select()
        .from(careBillingEvents)
        .where(eq(careBillingEvents.admissionId, admissionId))
    ).filter((b) =>
      staff.role === "DOCTOR"
        ? b.category !== "consumable"
        : b.category === "consumable",
    );
    const consumables = await tx
      .select()
      .from(nursingConsumables)
      .where(eq(nursingConsumables.admissionId, admissionId));
    const nursingCorrections = await tx
      .select()
      .from(nursingAddenda)
      .where(eq(nursingAddenda.admissionId, admissionId));
    const stays = await tx.select({ stay: roomStays, bedLabel: beds.label, category: beds.category }).from(roomStays).innerJoin(beds, eq(beds.id, roomStays.bedId)).where(eq(roomStays.admissionId, admissionId)).orderBy(asc(roomStays.startedAt));
    const transferHistory = await tx.select().from(admissionTransfers).where(eq(admissionTransfers.admissionId, admissionId)).orderBy(asc(admissionTransfers.transferredAt));
    const signedTransferOrders = await tx.select().from(transferOrders).where(eq(transferOrders.admissionId, admissionId)).orderBy(desc(transferOrders.version));
    const latestVersions = await tx.select().from(settingVersions).where(eq(settingVersions.hospitalId, episode.hospitalId)).orderBy(desc(settingVersions.version));
    const seenCategories = new Set<string>();
    const transferCategories = latestVersions.filter(v => {
      if (v.payload.type !== "bed-category" || typeof v.payload.code !== "string" || seenCategories.has(v.payload.code)) return false;
      seenCategories.add(v.payload.code);
      return v.payload.active === true;
    }).map(v => ({ code: String(v.payload.code), name: String(v.payload.name) }));
    const transferBeds = await tx.select({ id: beds.id, label: beds.label, category: beds.category, active: beds.active, held: bedHolds.bedId }).from(beds).leftJoin(bedHolds, eq(bedHolds.bedId, beds.id)).orderBy(asc(beds.label));
    const insuranceTransferTasks = await tx.select().from(transferInsuranceTasks).where(eq(transferInsuranceTasks.admissionId, admissionId));
    const diagnosticReports = staff.role === "DOCTOR" ? await tx.select().from(labReports).where(eq(labReports.admissionId,admissionId)).orderBy(asc(labReports.signedAt)) : [];
    const diagnosticAddenda = diagnosticReports.length ? await tx.select().from(labReportAddenda).where(inArray(labReportAddenda.reportId,diagnosticReports.map(r=>r.id))).orderBy(asc(labReportAddenda.signedAt)) : [];
    const signerIds = [
      ...new Set(
        [
          ...rounds,
          ...addenda,
          ...orders,
          ...events,
          ...observations,
          ...administrations,
          ...shifts,
          ...shiftEnds,
          ...summaries,
          ...consumables,
          ...nursingCorrections,
          ...signedTransferOrders,
          ...transferHistory,
          ...diagnosticReports,
          ...diagnosticAddenda,
        ].map((r) => r.signedBy),
      ),
    ];
    const signerNames = signerIds.length
      ? await tx
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, signerIds))
      : [];
    const actors = Object.fromEntries(signerNames.map((s) => [s.id, s.name]));
    return {
      episode: {
        id: episode.id,
        ipCode: episode.ipCode,
        status: episode.status,
        admittedAt: episode.admittedAt,
      },
      identity,
      actors,
      rounds,
      addenda,
      orders,
      tasks: tasks.map((t) => ({
        ...t,
        status:
          events.find((e) => e.orderId === t.orderId && e.status === "STOPPED")
            ?.status ??
          events.find(
            (e) => e.orderId === t.orderId && e.status === "COMPLETED",
          )?.status ??
          "PENDING",
      })),
      events,
      diagnosticReports,
      diagnosticAddenda,
      occurrences,
      observations,
      administrations,
      shifts: shifts.map((s) => {
        const end = shiftEnds.find((e) => e.shiftId === s.id);
        return {
          ...s,
          endedAt: end?.endedAt,
          outgoingHandover: end?.handover,
          hours: end
            ? (end.endedAt.getTime() - s.startedAt.getTime()) / 3600000
            : undefined,
          durationMs: end
            ? end.endedAt.getTime() - s.startedAt.getTime()
            : undefined,
        };
      }),
      summaries,
      billing,
      consumables,
      nursingAddenda: nursingCorrections,
      stays: stays.map(s => ({ id: s.stay.id, bedId: s.stay.bedId, startedAt: s.stay.startedAt, endedAt: s.stay.endedAt, bedLabel: s.bedLabel, category: s.category })),
      transferHistory,
      transferOrders: signedTransferOrders.map((o, i) => ({ ...o, status: transferHistory.some(t => t.transferOrderId === o.id) ? "COMPLETED" : i !== 0 || !stays.some(s => s.stay.id === o.sourceStayId && !s.stay.endedAt) ? "SUPERSEDED" : "PENDING" })),
      transferCategories,
      transferBeds: transferBeds.map(b => ({ id: b.id, label: b.label, category: b.category, available: b.active && !b.held && transferCategories.some(c => c.code === b.category) })),
      insuranceTransferTasks,
    };
  });
}
