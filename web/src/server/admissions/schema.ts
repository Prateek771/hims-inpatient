import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { hims, hospitalSettings, settingVersions } from "../schema/core";
import { user } from "../schema/auth";
import { doctorDirectory } from "../mvp/staff-schema";

export type ClinicianAssessment = {
  clinicianId: string;
  assessedAt: string;
  chiefComplaint: string;
  vitals: string;
  triage: string;
  destinationCategory: string;
  overrideReason?: string;
};
const time = (name: string) => timestamp(name, { withTimezone: true });

export const patients = hims.table(
  "patients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uhid: text("uhid").notNull().unique(),
    name: text("name").notNull(),
    identityStatus: text("identity_status").notNull().default("KNOWN"),
    identityProvenance: text("identity_provenance"),
    dateOfBirth: date("date_of_birth"),
    ageYearsAtRegistration: integer("age_years_at_registration"),
    sex: text("sex").notNull(),
    phone: text("phone"),
    registeredAt: time("registered_at").notNull().defaultNow(),
    registeredBy: text("registered_by")
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    index("patients_name_idx").on(t.name),
    check("patient_identity_provenance", sql`${t.identityStatus} in ('KNOWN','TEMPORARY') and (${t.identityStatus}='KNOWN' or length(btrim(${t.identityProvenance}))>=3)`),
    check("patients_sex", sql`${t.sex} in ('FEMALE','MALE','OTHER','UNKNOWN')`),
    check(
      "patient_age_identity",
      sql`((${t.dateOfBirth} is not null) <> (${t.ageYearsAtRegistration} is not null)) or (${t.identityStatus}='TEMPORARY' and ${t.dateOfBirth} is null and ${t.ageYearsAtRegistration} is null)`,
    ),
    check(
      "patient_age_range",
      sql`${t.ageYearsAtRegistration} is null or ${t.ageYearsAtRegistration} between 0 and 130`,
    ),
  ],
);

export const beds = hims.table(
  "beds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull().unique(),
    category: text("category").notNull(),
    categoryVersionId: uuid("category_version_id")
      .notNull()
      .references(() => settingVersions.id),
    active: boolean("active").notNull().default(true),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [index("beds_category_idx").on(t.category)],
);

export const admissionCounters = hims.table(
  "admission_counters",
  {
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitalSettings.id),
    year: integer("year").notNull(),
    value: bigint("value", { mode: "bigint" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.hospitalId, t.year] }),
    check("admission_counter_positive", sql`${t.value} > 0`),
  ],
);

export const admissions = hims.table(
  "admissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitalSettings.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    ipCode: text("ip_code").notNull().unique(),
    status: text("status", {
      enum: ["PENDING", "ADMITTED", "CANCELLED", "DISCHARGED"],
    })
      .notNull()
      .default("PENDING"),
    admittingDoctorId: text("admitting_doctor_id")
      .references(() => user.id),
    externalDoctorId: uuid("external_doctor_id").references(()=>doctorDirectory.id),
    workflowVersion:integer("workflow_version").notNull().default(1),
    clinicianAssessment: jsonb("clinician_assessment")
      .$type<ClinicianAssessment>(),
    bedId: uuid("bed_id")
      .notNull()
      .references(() => beds.id),
    paymentRoute: text("payment_route", {
      enum: ["SELF_PAY", "INSURED"],
    }).notNull(),
    expectedStayDays: integer("expected_stay_days").notNull(),
    registeredAt: time("registered_at").notNull().defaultNow(),
    admittedAt: time("admitted_at"),
    cancelledAt: time("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    requestId: uuid("request_id").notNull(),
    requestPayload: text("request_payload").notNull(),
    version: integer("version").notNull().default(1),
    billRevision: integer("bill_revision").notNull().default(1),
    depositVersionId: uuid("deposit_version_id").references(() => settingVersions.id),
  },
  (t) => [
    uniqueIndex("admission_retry_idx").on(t.createdBy, t.requestId),
    uniqueIndex("patient_active_admission_idx")
      .on(t.patientId)
      .where(sql`${t.status} in ('PENDING','ADMITTED')`),
    index("admissions_doctor_idx").on(t.admittingDoctorId),
    index("admissions_bed_idx").on(t.bedId),
    index("admissions_hospital_idx").on(t.hospitalId),
    check(
      "admission_status",
      sql`${t.status} in ('PENDING','ADMITTED','CANCELLED','DISCHARGED')`,
    ),
    check("admission_route", sql`${t.paymentRoute} in ('SELF_PAY','INSURED')`),
    check("admission_days", sql`${t.expectedStayDays} between 1 and 365`),
    check(
      "admission_activation_time",
      sql`(${t.status} in ('ADMITTED','DISCHARGED')) = (${t.admittedAt} is not null)`,
    ),
    check(
      "admission_cancel_record",
      sql`${t.status} <> 'CANCELLED' or (${t.cancelledAt} is not null and length(trim(${t.cancellationReason})) > 0)`,
    ),
  ],
);

// One row protects both pending reservation and active occupancy.
export const bedHolds = hims.table("bed_holds", {
  bedId: uuid("bed_id")
    .primaryKey()
    .references(() => beds.id),
  admissionId: uuid("admission_id")
    .notNull()
    .unique()
    .references(() => admissions.id),
  heldAt: time("held_at").notNull().defaultNow(),
});

// Task 5 creates the first segment at activation, snapshotting the then-current tariff.
export const roomStays = hims.table(
  "room_stays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    admissionId: uuid("admission_id")
      .notNull()
      .references(() => admissions.id),
    bedId: uuid("bed_id")
      .notNull()
      .references(() => beds.id),
    tariffVersionId: uuid("tariff_version_id")
      .notNull()
      .references(() => settingVersions.id),
    startedAt: time("started_at").notNull(),
    endedAt: time("ended_at"),
    lastReconciledAt: time("last_reconciled_at"),
    postedPaise: bigint("posted_paise", { mode: "bigint" }).notNull().default(sql`0`),
  },
  (t) => [
    index("room_stays_admission_idx").on(t.admissionId),
    index("room_stays_bed_idx").on(t.bedId),
    index("room_stays_tariff_idx").on(t.tariffVersionId),
    check(
      "room_stay_boundary",
      sql`${t.endedAt} is null or ${t.endedAt} > ${t.startedAt}`,
    ),
    check("room_stay_posted_positive", sql`${t.postedPaise} >= 0`),
    check("room_stay_cursor_boundary", sql`${t.lastReconciledAt} is null or (${t.lastReconciledAt} >= ${t.startedAt} and (${t.endedAt} is null or ${t.lastReconciledAt} <= ${t.endedAt}))`),
  ],
);

/** Authoritative physical bounds; raw room_stays remain original evidence. */
export const effectiveRoomStays = hims.view("effective_room_stays", {
  id: uuid("id").notNull(), admissionId: uuid("admission_id").notNull(), bedId: uuid("bed_id").notNull(), tariffVersionId: uuid("tariff_version_id").notNull(),
  startedAt: time("started_at").notNull(), endedAt: time("ended_at"), lastReconciledAt: time("last_reconciled_at"), postedPaise: bigint("posted_paise",{mode:"bigint"}).notNull(), amendmentId: uuid("amendment_id"),
}).existing();

export const effectivePatients = hims.view("effective_patients",{
 id:uuid("id").notNull(),uhid:text("uhid").notNull(),name:text("name").notNull(),identityStatus:text("identity_status").notNull(),identityProvenance:text("identity_provenance"),dateOfBirth:date("date_of_birth"),ageYearsAtRegistration:integer("age_years_at_registration"),sex:text("sex").notNull(),phone:text("phone"),registeredAt:time("registered_at").notNull(),registeredBy:text("registered_by").notNull(),identityAmendmentId:uuid("identity_amendment_id"),
}).existing();
