import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, getViewSelectedFields, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { appendAudit } from "../audit";
import {
  assertHumanActor,
  DomainError,
  type CommandContext,
  type StaffRole,
} from "../contracts";
import { db, withTransaction, type Transaction } from "../db";
import { hospitalSettings, settingVersions, user } from "../schema";
import {
  admissions,
  admissionCounters,
  bedHolds,
  beds,
  effectivePatients as patients, patients as originalPatients,
  effectiveRoomStays as roomStays, roomStays as originalRoomStays,
} from "./schema";
import { admissionTransfers, transferInsuranceTasks, transferOrders } from "./transfer-schema";

const categoryCode = z
  .string()
  .trim()
  .regex(/^[A-Z0-9_-]{2,32}$/);
const reason = z.string().trim().min(3).max(500);
export function admissionYear(now: Date, timezone: string) {
  return Number(
    new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
    }).format(now),
  );
}
export const dateOfBirth = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(value);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value &&
      date <= new Date()
    );
  }, "Enter a valid date of birth");
export const admissionInput = z
  .strictObject({
    patientId: z.uuid().optional(),
    patientDetails: z
      .strictObject({
        name: z.string().trim().min(2).max(150).optional(),
        identityStatus:z.enum(["KNOWN","TEMPORARY"]).default("KNOWN"),
        identityProvenance:reason.optional(),
        dateOfBirth: dateOfBirth.optional(),
        ageYearsAtRegistration: z.number().int().min(0).max(130).optional(),
        sex: z.enum(["FEMALE", "MALE", "OTHER", "UNKNOWN"]),
        phone: z
          .string()
          .trim()
          .regex(/^[+\d ()-]{7,25}$/)
          .refine((value) => {
            const digits = value.replace(/\D/g, "").length;
            return digits >= 7 && digits <= 15;
          }, "Enter a phone number with 7 to 15 digits")
          .optional(),
      })
      .refine(
        (v) => (v.identityStatus==="TEMPORARY" ? !!v.identityProvenance : !!v.name) &&
          ((v.dateOfBirth !== undefined) !== (v.ageYearsAtRegistration !== undefined) || (v.identityStatus==="TEMPORARY" && v.dateOfBirth===undefined && v.ageYearsAtRegistration===undefined)),
        "Record either a known birth date or age in years, not both",
      )
      .optional(),
    admittingDoctorId: z.string().min(1).max(100),
    clinicianAssessment: z.strictObject({
      clinicianId: z.string().min(1).max(100),
      assessedAt: z.iso
        .datetime()
        .refine(
          (v) => new Date(v).getTime() <= Date.now() + 60_000,
          "Assessment cannot be in the future",
        ),
      chiefComplaint: z.string().trim().min(2).max(2000),
      vitals: z.string().trim().min(2).max(2000),
      triage: z.string().trim().min(2).max(500),
      destinationCategory: categoryCode,
      overrideReason: reason.optional(),
    }),
    bedId: z.uuid(),
    paymentRoute: z.enum(["SELF_PAY", "INSURED"]),
    expectedStayDays: z.number().int().min(1).max(365),
    requestId: z.uuid(),
  })
  .refine(
    (v) => Boolean(v.patientId) !== Boolean(v.patientDetails),
    "Select an existing patient or enter new identity details",
  );

export async function admissionOperator(
  ctx: CommandContext,
  roles: readonly StaffRole[],
  connection: typeof db | Transaction = db,
) {
  // All composed sources share this order with staff/settings administration.
  // Autocommit reads release it immediately; transaction commands retain it before staff locks.
  await connection.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);
  const actor = assertHumanActor(ctx);
  z.uuid().parse(ctx.requestId);
  if (!ctx.source.trim())
    throw new DomainError("VALIDATION", "Command source is required");
  const [staff] = await connection
    .select({
      id: user.id,
      role: user.role,
      banned: user.banned,
      name: user.name,
    })
    .from(user)
    .where(eq(user.id, actor.staffId))
    .for("share");
  if (!staff || staff.banned || !roles.includes(staff.role as StaffRole))
    throw new DomainError("FORBIDDEN", "Staff access denied");
  return { ...staff, role: staff.role as StaffRole };
}

async function configuredCategories(connection: typeof db | Transaction = db) {
  const versions = await connection
    .select()
    .from(settingVersions)
    .orderBy(desc(settingVersions.version));
  const seen = new Set<string>();
  return versions.filter((v) => {
    if (
      v.payload.type !== "bed-category" ||
      typeof v.payload.code !== "string" ||
      seen.has(v.payload.code)
    )
      return false;
    seen.add(v.payload.code);
    return v.payload.active === true;
  });
}

async function configuredDeposits() {
  const versions = await db
    .select()
    .from(settingVersions)
    .where(eq(settingVersions.kind, "rule"))
    .orderBy(desc(settingVersions.version));
  const stored = z.strictObject({
    type: z.literal("deposit"),
    category: categoryCode,
    route: z.enum(["self-pay", "insured"]),
    requirement: z.enum(["required", "not-required"]),
    amount: z.string().regex(/^\d+$/),
  });
  const seen = new Set<string>();
  const rules = [];
  for (const version of versions) {
    if (version.payload.type !== "deposit") continue;
    const payload = stored.parse(version.payload);
    const key = `${payload.category}:${payload.route}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rules.push({ ...payload, versionId: version.id, version: version.version });
  }
  return rules;
}

export async function createBed(ctx: CommandContext, input: unknown) {
  const value = z
    .strictObject({
      label: z.string().trim().min(2).max(80),
      category: categoryCode,
      reason,
    })
    .parse(input);
  return withTransaction(async (tx) => {
    await admissionOperator(ctx, ["ADMIN"], tx);
    const category = (await configuredCategories(tx)).find(
      (v) => v.payload.code === value.category,
    );
    if (!category)
      throw new DomainError(
        "PRECONDITION",
        "Configure an active room category first",
      );
    const [bed] = await tx
      .insert(beds)
      .values({
        label: value.label,
        category: value.category,
        categoryVersionId: category.id,
      })
      .onConflictDoNothing()
      .returning();
    if (!bed) throw new DomainError("CONFLICT", "A bed already has this label");
    await appendAudit(tx, ctx, {
      event: "bed.created",
      entityType: "bed",
      entityId: bed.id,
      reason: value.reason,
    });
    return bed;
  });
}

export async function disableBed(ctx: CommandContext, input: unknown) {
  const value = z.strictObject({ bedId: z.uuid(), reason }).parse(input);
  return withTransaction(async (tx) => {
    await admissionOperator(ctx, ["ADMIN"], tx);
    const [bed] = await tx
      .select()
      .from(beds)
      .where(eq(beds.id, value.bedId))
      .for("update");
    if (!bed) throw new DomainError("VALIDATION", "Bed not found");
    if (
      (await tx.select().from(bedHolds).where(eq(bedHolds.bedId, bed.id)))
        .length
    )
      throw new DomainError(
        "PRECONDITION",
        "Reserved or occupied beds cannot be disabled",
      );
    await tx.update(beds).set({ active: false }).where(eq(beds.id, bed.id));
    await appendAudit(tx, ctx, {
      event: "bed.disabled",
      entityType: "bed",
      entityId: bed.id,
      reason: value.reason,
    });
  });
}

export async function createAdmission(
  ctx: CommandContext,
  input: unknown,
): Promise<{ admissionId: string; patientId: string; ipCode: string }> {
  const value = admissionInput.parse(input);
  if (ctx.requestId !== value.requestId)
    throw new DomainError("VALIDATION", "Request keys disagree");
  const payload = createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
  return withTransaction(async (tx) => {
    const operator = await admissionOperator(ctx, ["ADMISSION"], tx);
    // Serialize a retry key before checking its result. Other beds/patients remain concurrent.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${operator.id}:admission:${value.requestId}`}, 0))`,
    );
    const [retry] = await tx
      .select()
      .from(admissions)
      .where(
        and(
          eq(admissions.createdBy, operator.id),
          eq(admissions.requestId, value.requestId),
        ),
      );
    if (retry) {
      if (retry.requestPayload !== payload)
        throw new DomainError(
          "CONFLICT",
          "This request key was used for different admission details",
        );
      return {
        admissionId: retry.id,
        patientId: retry.patientId,
        ipCode: retry.ipCode,
      };
    }
    const clinicianIds = [
      ...new Set([
        value.admittingDoctorId,
        value.clinicianAssessment.clinicianId,
      ]),
    ].sort();
    const clinicians = await tx
      .select()
      .from(user)
      .where(inArray(user.id, clinicianIds))
      .orderBy(asc(user.id))
      .for("share");
    if (
      clinicians.length !== clinicianIds.length ||
      clinicians.some((s) => s.banned || s.role !== "DOCTOR")
    )
      throw new DomainError(
        "VALIDATION",
        "Admitting and assessing clinicians must be active doctors",
      );
    const [hospital] = await tx.select().from(hospitalSettings).limit(1);
    if (!hospital)
      throw new DomainError(
        "PRECONDITION",
        "Configure hospital identity before admitting patients",
      );
    let patient;
    if (value.patientId) {
      // Immutable identities need no UPDATE grant; serialize episodes by patient identity.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`patient:${value.patientId}`}, 0))`,
      );
      [patient] = await tx
        .select()
        .from(patients)
        .where(eq(patients.id, value.patientId));
      if (!patient)
        throw new DomainError("VALIDATION", "Select a registered patient");
      const active = await tx
        .select({ id: admissions.id })
        .from(admissions)
        .where(
          and(
            eq(admissions.patientId, patient.id),
            inArray(admissions.status, ["PENDING", "ADMITTED"]),
          ),
        );
      if (active.length)
        throw new DomainError(
          "CONFLICT",
          "This patient already has a pending or active admission",
        );
    } else {
      [patient] = await tx
        .insert(originalPatients)
        .values({
          ...value.patientDetails!,
          name:value.patientDetails!.name??`Unidentified ${crypto.randomUUID().slice(0,8).toUpperCase()}`,
          uhid: `UHID-${crypto.randomUUID()}`,
          registeredBy: operator.id,
        })
        .returning();
    }
    const [bed] = await tx
      .select()
      .from(beds)
      .where(eq(beds.id, value.bedId))
      .for("update");
    const cleaning = await tx.execute(sql`select 1 from hims.effective_bed_turnovers t where t.bed_id=${value.bedId} and not exists(select 1 from hims.bed_turnover_completions c where c.turnover_id=t.id) limit 1`);
    if (
      !bed ||
      !bed.active ||
      cleaning.rows.length ||
      (await tx.select().from(bedHolds).where(eq(bedHolds.bedId, value.bedId)))
        .length
    )
      throw new DomainError(
        "CONFLICT",
        "This bed is no longer available. Choose another bed.",
      );
    const categories = await configuredCategories(tx);
    if (
      !categories.some((v) => v.payload.code === bed.category) ||
      !categories.some(
        (v) => v.payload.code === value.clinicianAssessment.destinationCategory,
      )
    )
      throw new DomainError(
        "PRECONDITION",
        "Select active configured room categories",
      );
    if (
      bed.category !== value.clinicianAssessment.destinationCategory &&
      !value.clinicianAssessment.overrideReason
    )
      throw new DomainError(
        "VALIDATION",
        "Record a reason for overriding the clinician-selected destination",
      );
    const year = admissionYear(new Date(), hospital.timezone);
    const [counter] = await tx
      .insert(admissionCounters)
      .values({ hospitalId: hospital.id, year, value: 1n })
      .onConflictDoUpdate({
        target: [admissionCounters.hospitalId, admissionCounters.year],
        set: { value: sql`${admissionCounters.value} + 1` },
      })
      .returning();
    const ipCode = `IP-${year}-${counter.value.toString().padStart(5, "0")}`;
    const [admission] = await tx
      .insert(admissions)
      .values({
        hospitalId: hospital.id,
        patientId: patient.id,
        ipCode,
        admittingDoctorId: value.admittingDoctorId,
        clinicianAssessment: value.clinicianAssessment,
        bedId: bed.id,
        paymentRoute: value.paymentRoute,
        expectedStayDays: value.expectedStayDays,
        createdBy: operator.id,
        requestId: value.requestId,
        requestPayload: payload,
      })
      .returning();
    await tx
      .insert(bedHolds)
      .values({ bedId: bed.id, admissionId: admission.id });
    await appendAudit(tx, ctx, {
      event: "admission.pending-created",
      entityType: "admission",
      entityId: admission.id,
      reason:
        "Patient registered and bed reserved; activation awaits deposit checks",
    });
    return { admissionId: admission.id, patientId: patient.id, ipCode };
  });
}

export async function cancelAdmission(ctx: CommandContext, input: unknown) {
  const value = z.strictObject({ admissionId: z.uuid(), reason }).parse(input);
  return withTransaction(async (tx) => {
    await admissionOperator(ctx, ["ADMISSION", "ADMIN"], tx);
    const [admission] = await tx
      .select()
      .from(admissions)
      .where(eq(admissions.id, value.admissionId))
      .for("update");
    if (!admission || admission.status !== "PENDING")
      throw new DomainError(
        "PRECONDITION",
        "Only pending admissions can be cancelled",
      );
    await tx
      .select()
      .from(beds)
      .where(eq(beds.id, admission.bedId))
      .for("update");
    await tx.delete(bedHolds).where(eq(bedHolds.admissionId, admission.id));
    await tx
      .update(admissions)
      .set({
        status: "CANCELLED",
        version: sql`${admissions.version}+1`,
        cancelledAt: new Date(),
        cancellationReason: value.reason,
      })
      .where(eq(admissions.id, admission.id));
    await appendAudit(tx, ctx, {
      event: "admission.cancelled",
      entityType: "admission",
      entityId: admission.id,
      reason: value.reason,
    });
  });
}

export async function searchPatients(ctx: CommandContext, query: string) {
  await admissionOperator(ctx, ["ADMISSION"]);
  const term = z
    .string()
    .trim()
    .min(2)
    .max(100)
    .parse(query)
    .replace(/[\\%_]/g, "\\$&");
  return db
    .select({
      id: patients.id,
      uhid: patients.uhid,
      name: patients.name,
      dateOfBirth: patients.dateOfBirth,
      ageYearsAtRegistration: patients.ageYearsAtRegistration,
      sex: patients.sex,
    })
    .from(patients)
    .where(
      or(ilike(patients.name, `%${term}%`), ilike(patients.uhid, `%${term}%`)),
    )
    .orderBy(asc(patients.name))
    .limit(20);
}

export async function getAdmission(ctx: CommandContext, admissionId: string) {
  if (!z.uuid().safeParse(admissionId).success)
    throw new DomainError("FORBIDDEN", "Admission access denied");
  const staff = await admissionOperator(ctx, ["ADMIN", "ADMISSION", "DOCTOR"]);
  const [record] = await db
    .select({ admission: admissions, patient: getViewSelectedFields(patients), bedLabel: beds.label })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .innerJoin(beds, eq(beds.id, admissions.bedId))
    .where(eq(admissions.id, admissionId));
  if (
    !record ||
    (staff.role === "DOCTOR" && record.admission.admittingDoctorId !== staff.id)
  )
    throw new DomainError("FORBIDDEN", "Admission access denied");
  const common = {
    admissionId: record.admission.id,
    patientId: record.patient.id,
    uhid: record.patient.uhid,
    name: record.patient.name,
    identityStatus:record.patient.identityStatus,identityProvenance:record.patient.identityProvenance,identityAmendmentId:record.patient.identityAmendmentId,
    dateOfBirth: record.patient.dateOfBirth,
    ageYearsAtRegistration: record.patient.ageYearsAtRegistration,
    identityRegisteredAt: record.patient.registeredAt,
    sex: record.patient.sex,
    ipCode: record.admission.ipCode,
    status: record.admission.status,
    bedLabel: record.bedLabel,
    registeredAt: record.admission.registeredAt,
    admittedAt: record.admission.admittedAt,
    version: record.admission.version,
  };
  if (staff.role === "ADMIN") return common;
  if (staff.role === "DOCTOR")
    return {
      ...common,
      clinicianAssessment: record.admission.clinicianAssessment,
    };
  return {
    ...common,
    phone: record.patient.phone,
    clinicianAssessment: record.admission.clinicianAssessment,
    paymentRoute: record.admission.paymentRoute,
    expectedStayDays: record.admission.expectedStayDays,
  };
}

export async function activateAdmission(ctx: CommandContext, input: unknown) {
  const value = z.strictObject({ admissionId: z.uuid(), arrivedAt: z.iso.datetime(), expectedVersion: z.number().int().min(1), exceptionId: z.uuid().optional(), requestId: z.uuid() }).parse(input);
  if (ctx.requestId !== value.requestId) throw new DomainError("VALIDATION", "Request keys disagree");
  const { billingRequest, resolveActivationPolicies, patientDepositCash } = await import("../billing/commands");
  return withTransaction(async (tx) => {
    await admissionOperator(ctx, ["ADMISSION", "ADMIN"], tx);
    return billingRequest(tx, ctx, "activation", value, async () => {
      const [episode] = await tx.select().from(admissions).where(eq(admissions.id, value.admissionId)).for("update");
      if (!episode) throw new DomainError("FORBIDDEN", "Admission access denied");
      if (episode.version !== value.expectedVersion) throw new DomainError("CONFLICT", "Admission changed. Refresh before activation");
      if (episode.status !== "PENDING") throw new DomainError("PRECONDITION", "Only a pending admission can activate");
      if (value.exceptionId) {
        const { requireException } = await import("../discharge/exceptions");
        const authority = await requireException(tx, episode.id, value.exceptionId, "URGENT_ADMISSION", "ACTIVATE");
        const captured = authority.snapshot.deposit as { sourceId?: string } | undefined;
        const current = await resolveActivationPolicies(tx, episode);
        if (captured?.sourceId !== current.deposit.id) throw new DomainError("CONFLICT", "Deposit policy changed after exception review; obtain current authority");
      }
      const [bed] = await tx.select().from(beds).where(eq(beds.id, episode.bedId)).for("update");
      const [hold] = await tx.select().from(bedHolds).where(eq(bedHolds.bedId, bed.id));
      if (!bed.active || hold?.admissionId !== episode.id) throw new DomainError("CONFLICT", "The reserved bed is no longer available");
      const policies = await resolveActivationPolicies(tx, episode);
      const [identity] = await tx.select().from(patients).where(eq(patients.id,episode.patientId));
      if(identity.identityStatus==="TEMPORARY"&&!value.exceptionId)throw new DomainError("PRECONDITION","Unknown identity activation requires attributable urgent authority");
      if (!value.exceptionId && await patientDepositCash(tx, episode.id) < policies.requiredPaise) throw new DomainError("PRECONDITION", "Record the configured patient deposit before activation");
      const arrivedAt = new Date(value.arrivedAt);
      // Staff records actual bed occupancy, not registration or waiting time. A retrospective
      // entry must still fit the persisted reservation chronology; exceptions belong to Task 12.
      if (arrivedAt < episode.registeredAt || arrivedAt < hold.heldAt || arrivedAt.getTime() > Date.now()) throw new DomainError("VALIDATION", "Actual bed occupancy must start after this reservation and no later than now");
      await tx.insert(originalRoomStays).values({ admissionId: episode.id, bedId: bed.id, tariffVersionId: policies.tariff.id, startedAt: arrivedAt, lastReconciledAt: arrivedAt });
      await tx.update(admissions).set({ status: "ADMITTED", admittedAt: arrivedAt, depositVersionId: policies.deposit.id, version: episode.version + 1, billRevision: episode.billRevision + 1 }).where(eq(admissions.id, episode.id));
      await appendAudit(tx, ctx, { event: "admission.activated", entityType: "admission", entityId: episode.id, reason: value.exceptionId ? `Urgent exception ${value.exceptionId}; configured deposit obligation remains` : "Configured deposit checked; occupied stay started once", beforeVersion: episode.version, afterVersion: episode.version + 1 });
      return { id: episode.id };
    });
  });
}

export async function transferAdmission(ctx: CommandContext, input: unknown): Promise<{ oldStayId: string; newStayId: string }> {
  return withTransaction(tx => transferAdmissionInTransaction(tx, ctx, input));
}
/** One transaction owns the admission, sorted physical-bed locks, charges and handover.
 * Composing callers acquire shared settings lock 729104211 before any staff/admission locks.
 */
export async function transferAdmissionInTransaction(tx: Transaction, ctx: CommandContext, input: unknown): Promise<{ oldStayId: string; newStayId: string }> {
  const value = z.strictObject({ admissionId: z.uuid(), transferOrderId: z.uuid(), targetBedId: z.uuid(), handover: z.strictObject({ shiftId: z.uuid(), notes: reason }), transferredAt: z.iso.datetime(), requestId: z.uuid() }).parse(input);
  if (ctx.requestId !== value.requestId) throw new DomainError("VALIDATION", "Request keys disagree");
  // Staff administration takes this existing exclusive lock before updating user rows.
  // Acquire its shared form first, then authenticate, so settings and staff changes serialize.
  await tx.execute(sql`select pg_advisory_xact_lock_shared(729104211)`);
  const { careEpisode, careRequest } = await import("../clinical/commands");
  const { shiftForCare } = await import("../nursing/commands");
  const { roomPolicyInput } = await import("../billing/commands");
  const { reconcileRoomChargesInTransaction } = await import("../billing/room-charges");
  const { paise } = await import("../billing/money");
  const staff = await admissionOperator(ctx, ["NURSE"], tx);
  const result = await careRequest(tx, ctx, staff, "admission.transferred", value, async () => {
    const episode = await careEpisode(tx, staff, value.admissionId);
    const [stay] = await tx.select().from(roomStays).where(and(eq(roomStays.admissionId, episode.id), isNull(roomStays.endedAt)));
    const [order] = await tx.select().from(transferOrders).where(eq(transferOrders.id, value.transferOrderId));
    const [latest] = await tx.select().from(transferOrders).where(eq(transferOrders.admissionId, episode.id)).orderBy(desc(transferOrders.version)).limit(1);
    const used = await tx.select({ id: admissionTransfers.id }).from(admissionTransfers).where(eq(admissionTransfers.transferOrderId, value.transferOrderId));
    if (!stay || stay.bedId !== episode.bedId || !order || order.admissionId !== episode.id || order.sourceStayId !== stay.id || latest?.id !== order.id || used.length)
      throw new DomainError("CONFLICT", "Transfer authority is missing, superseded or already consumed. Refresh the current stay and doctor order");
    const { actual: T } = await shiftForCare(tx, staff, value.handover.shiftId, episode.id, value.transferredAt);
    if (T <= stay.startedAt || T < order.signedAt || (stay.lastReconciledAt && T < stay.lastReconciledAt))
      throw new DomainError("CONFLICT", "Transfer precedes the occupied stay, doctor authority or committed room cursor; use the attributable correction workflow");
    // Future prescribed occurrences are obligations, not finalized history. Actual care must fit
    // the boundary; old consumables must remain within the original half-open source stay.
    const history = await tx.execute(sql`SELECT 1 FROM (
      SELECT signed_at AS at FROM hims.clinical_rounds WHERE admission_id=${episode.id}
      UNION ALL SELECT signed_at FROM hims.clinical_orders WHERE admission_id=${episode.id}
      UNION ALL SELECT signed_at FROM hims.clinical_summaries WHERE admission_id=${episode.id}
      UNION ALL SELECT e.signed_at FROM hims.clinical_task_events e JOIN hims.clinical_orders o ON o.id=e.order_id WHERE o.admission_id=${episode.id}
      UNION ALL SELECT a.signed_at FROM hims.clinical_addenda a JOIN hims.clinical_rounds r ON r.id=a.note_id WHERE r.admission_id=${episode.id}
      UNION ALL SELECT actual_at FROM hims.medication_administrations WHERE admission_id=${episode.id}
      UNION ALL SELECT observed_at FROM hims.nursing_observations WHERE admission_id=${episode.id}
      UNION ALL SELECT started_at FROM hims.nursing_shifts WHERE admission_id=${episode.id}
      UNION ALL SELECT e.ended_at FROM hims.effective_shift_ends e JOIN hims.nursing_shifts s ON s.id=e.shift_id WHERE s.admission_id=${episode.id}
    ) history WHERE at > ${T} LIMIT 1`);
    const uses = await tx.execute(sql`SELECT 1 FROM hims.nursing_consumables WHERE stay_id=${stay.id} AND used_at >= ${T} LIMIT 1`);
    if (history.rows.length || uses.rows.length) throw new DomainError("CONFLICT", "Transfer cannot precede recorded clinical or source-unit care; use the attributable correction workflow");
    if (episode.bedId === value.targetBedId) throw new DomainError("VALIDATION", "Choose a different target bed");
    const lockedBeds = await tx.select().from(beds).where(inArray(beds.id, [episode.bedId, value.targetBedId].sort())).orderBy(asc(beds.id)).for("update");
    const target = lockedBeds.find(b => b.id === value.targetBedId);
    const holds = await tx.select().from(bedHolds).where(inArray(bedHolds.bedId, [episode.bedId, value.targetBedId]));
    if (!lockedBeds.find(b => b.id === episode.bedId)?.active || holds.find(h => h.bedId === episode.bedId)?.admissionId !== episode.id || !target?.active || holds.some(h => h.bedId === value.targetBedId))
      throw new DomainError("CONFLICT", "Source occupancy or target availability changed. Choose an available bed");
    // A free bed now may still have been occupied at the supplied factual boundary.
    // The new stay is open-ended; any persisted target interval ending after T overlaps it.
    const targetHistory = await tx.execute(sql`SELECT 1 FROM hims.effective_room_stays WHERE bed_id=${target.id} AND (ended_at IS NULL OR ended_at > ${T}) LIMIT 1`);
    if (targetHistory.rows.length) throw new DomainError("CONFLICT", "Target bed was occupied at this actual transfer time. Preserve the factual time and use the correction workflow");
    const cleaning=await tx.execute(sql`select 1 from hims.effective_bed_turnovers t left join hims.bed_turnover_completions c on c.turnover_id=t.id where t.bed_id=${target.id} and (c.id is null or c.completed_at>${T}) limit 1`);
    if(cleaning.rows.length)throw new DomainError("CONFLICT","Target bed housekeeping was not complete at the actual transfer time");
    if (target.category !== order.destinationCategory) throw new DomainError("VALIDATION", "Target bed must match the clinician-selected destination category");
    const versions = await tx.select().from(settingVersions).where(eq(settingVersions.hospitalId, episode.hospitalId)).orderBy(desc(settingVersions.version));
    const category = versions.find(v => v.payload.type === "bed-category" && v.payload.code === target.category);
    const tariff = versions.find(v => v.payload.type === "tariff" && v.payload.category === target.category);
    if (category?.payload.active !== true || !tariff) throw new DomainError("PRECONDITION", "Configure active target category and room tariff before transfer");
    const policy = roomPolicyInput.parse(tariff.payload);
    paise(policy.amount);
    if (policy.graceMinutes > 0 && !policy.graceMode) throw new DomainError("PRECONDITION", "Configure explicit target room grace behavior");
    await reconcileRoomChargesInTransaction(tx, { admissionId: episode.id, cutoff: T, actorContext: ctx });
    await tx.update(originalRoomStays).set({ endedAt: T }).where(eq(originalRoomStays.id, stay.id));
    const [next] = await tx.insert(originalRoomStays).values({ admissionId: episode.id, bedId: target.id, tariffVersionId: tariff.id, startedAt: T, lastReconciledAt: T }).returning();
    await tx.delete(bedHolds).where(eq(bedHolds.admissionId, episode.id));
    await tx.insert(bedHolds).values({ admissionId: episode.id, bedId: target.id, heldAt: T });
    await tx.update(admissions).set({ bedId: target.id, version: sql`${admissions.version}+1`, billRevision: sql`${admissions.billRevision}+1` }).where(eq(admissions.id, episode.id));
    const [transfer] = await tx.insert(admissionTransfers).values({ admissionId: episode.id, transferOrderId: order.id, oldStayId: stay.id, newStayId: next.id, oldBedId: stay.bedId, targetBedId: target.id, shiftId: value.handover.shiftId, handover: value.handover.notes, transferredAt: T, signedBy: staff.id }).returning();
    const {bedTurnovers}=await import("../discharge/schema");
    await tx.insert(bedTurnovers).values({bedId:stay.bedId,stayId:stay.id,admissionId:episode.id,vacatedAt:T,reason:"Actual transfer vacated the previous physical bed",signedBy:staff.id,signedAt:new Date()});
    if (episode.paymentRoute === "INSURED") await tx.insert(transferInsuranceTasks).values({ admissionId: episode.id, transferId: transfer.id, reason: "Insurance staff must review the transfer's externally verified insurance implications using existing payer channels" });
    await appendAudit(tx, ctx, { event: "admission.transferred", entityType: "transfer", entityId: transfer.id, reason: value.handover.notes, beforeVersion: episode.version, afterVersion: episode.version + 1 });
    return { id: transfer.id };
  });
  const [transfer] = await tx.select().from(admissionTransfers).where(eq(admissionTransfers.id, result.id));
  return { oldStayId: transfer.oldStayId, newStayId: transfer.newStayId };
}

export async function admissionWorkspace(ctx: CommandContext) {
  const staff = await admissionOperator(ctx, ["ADMISSION", "ADMIN", "DOCTOR"]);
  const doctorScope =
    staff.role === "DOCTOR"
      ? eq(admissions.admittingDoctorId, staff.id)
      : undefined;
  const bedRows = await db
    .select({
      id: beds.id,
      label: beds.label,
      category: beds.category,
      active: beds.active,
      admissionId: bedHolds.admissionId,
      cleaning: sql<boolean>`exists(select 1 from hims.effective_bed_turnovers t where t.bed_id=${beds.id} and not exists(select 1 from hims.bed_turnover_completions c where c.turnover_id=t.id))`,
    })
    .from(beds)
    .leftJoin(bedHolds, eq(bedHolds.bedId, beds.id))
    .orderBy(asc(beds.label));
  const worklist = await db
    .select({
      id: admissions.id,
      ipCode: admissions.ipCode,
      name: patients.name,
      status: admissions.status,
      bedLabel: beds.label,
      registeredAt: admissions.registeredAt,
    })
    .from(admissions)
    .innerJoin(patients, eq(patients.id, admissions.patientId))
    .innerJoin(beds, eq(beds.id, admissions.bedId))
    .where(
      and(
        doctorScope,
        or(
          inArray(admissions.status, ["PENDING", "ADMITTED"]),
          inArray(
            admissions.id,
            db
              .select({ id: admissions.id })
              .from(admissions)
              .where(
                and(
                  doctorScope,
                  inArray(admissions.status, ["CANCELLED", "DISCHARGED"]),
                ),
              )
              .orderBy(desc(admissions.registeredAt), desc(admissions.id))
              .limit(50),
          ),
        ),
      ),
    )
    .orderBy(
      sql`case when ${admissions.status} in ('PENDING','ADMITTED') then 0 else 1 end`,
      desc(admissions.registeredAt),
      desc(admissions.id),
    );
  const doctors =
    staff.role === "ADMISSION"
      ? await db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(and(eq(user.role, "DOCTOR"), eq(user.banned, false)))
          .orderBy(asc(user.name))
      : [];
  return {
    depositRules: staff.role === "ADMISSION" ? await configuredDeposits() : [],
    beds: staff.role === "DOCTOR" ? [] : bedRows,
    categories:
      staff.role === "DOCTOR"
        ? []
        : (await configuredCategories()).map((v) => ({
            code: String(v.payload.code),
            name: String(v.payload.name),
          })),
    doctors,
    worklist,
  };
}
