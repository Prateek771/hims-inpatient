import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
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
  patients,
  roomStays,
} from "./schema";

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
const dateOfBirth = z
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
        name: z.string().trim().min(2).max(150),
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
        (v) =>
          (v.dateOfBirth !== undefined) !==
          (v.ageYearsAtRegistration !== undefined),
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
        .insert(patients)
        .values({
          ...value.patientDetails!,
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
    if (
      !bed ||
      !bed.active ||
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
    .select({ admission: admissions, patient: patients, bedLabel: beds.label })
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
      if (value.exceptionId) throw new DomainError("PRECONDITION", "Activation exceptions require the administrator exception workflow, which is not yet available");
      const [bed] = await tx.select().from(beds).where(eq(beds.id, episode.bedId)).for("update");
      const [hold] = await tx.select().from(bedHolds).where(eq(bedHolds.bedId, bed.id));
      if (!bed.active || hold?.admissionId !== episode.id) throw new DomainError("CONFLICT", "The reserved bed is no longer available");
      const policies = await resolveActivationPolicies(tx, episode);
      if (await patientDepositCash(tx, episode.id) < policies.requiredPaise) throw new DomainError("PRECONDITION", "Record the configured patient deposit before activation");
      const arrivedAt = new Date(value.arrivedAt);
      // Staff records actual bed occupancy, not registration or waiting time. A retrospective
      // entry must still fit the persisted reservation chronology; exceptions belong to Task 12.
      if (arrivedAt < episode.registeredAt || arrivedAt < hold.heldAt || arrivedAt.getTime() > Date.now()) throw new DomainError("VALIDATION", "Actual bed occupancy must start after this reservation and no later than now");
      await tx.insert(roomStays).values({ admissionId: episode.id, bedId: bed.id, tariffVersionId: policies.tariff.id, startedAt: arrivedAt, lastReconciledAt: arrivedAt });
      await tx.update(admissions).set({ status: "ADMITTED", admittedAt: arrivedAt, depositVersionId: policies.deposit.id, version: episode.version + 1, billRevision: episode.billRevision + 1 }).where(eq(admissions.id, episode.id));
      await appendAudit(tx, ctx, { event: "admission.activated", entityType: "admission", entityId: episode.id, reason: "Configured deposit checked; occupied stay started once", beforeVersion: episode.version, afterVersion: episode.version + 1 });
      return { id: episode.id };
    });
  });
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
