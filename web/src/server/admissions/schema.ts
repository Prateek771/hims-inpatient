import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, int, json, mysqlTable, mysqlView, primaryKey, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";

import { hospitalSettings, settingVersions } from "../schema/core";
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
const time = (name: string) => utc(name);

export const patients = mysqlTable(
  "patients",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    uhid: key("uhid").notNull().unique(),
    name: key("name").notNull(),
    identityStatus: text("identity_status").notNull().default("KNOWN"),
    identityProvenance: text("identity_provenance"),
    dateOfBirth: date("date_of_birth",{mode:"string"}),
    ageYearsAtRegistration: int("age_years_at_registration"),
    sex: text("sex").notNull(),
    phone: text("phone"),
    registeredAt: time("registered_at").notNull().default(utcNow),
    registeredBy: key("registered_by")
      .notNull()
      .references(() => user.id),
  },
  (t) => [
    index("patients_name_idx").on(t.name),
    check("patient_identity_provenance", sql`${t.identityStatus} in ('KNOWN','TEMPORARY') and (${t.identityStatus}='KNOWN' or char_length(trim(${t.identityProvenance}))>=3)`),
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

export const beds = mysqlTable(
  "beds",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    label: key("label").notNull().unique(),
    category: key("category").notNull(),
    categoryVersionId: uuid("category_version_id")
      .notNull()
      .references(() => settingVersions.id),
    active: boolean("active").notNull().default(true),
    createdAt: time("created_at").notNull().default(utcNow),
  },
  (t) => [index("beds_category_idx").on(t.category)],
);

export const admissionCounters = mysqlTable(
  "admission_counters",
  {
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitalSettings.id),
    year: int("year").notNull(),
    value: bigint("value", { mode: "bigint" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.hospitalId, t.year] }),
    check("admission_counter_positive", sql`${t.value} > 0`),
  ],
);

export const admissions = mysqlTable(
  "admissions",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
    hospitalId: uuid("hospital_id")
      .notNull()
      .references(() => hospitalSettings.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    ipCode: key("ip_code").notNull().unique(),
    status: text("status", {
      enum: ["PENDING", "ADMITTED", "CANCELLED", "DISCHARGED"],
    })
      .notNull()
      .default("PENDING"),
    admittingDoctorId: key("admitting_doctor_id")
      .references(() => user.id),
    externalDoctorId: uuid("external_doctor_id").references(()=>doctorDirectory.id),
    workflowVersion:int("workflow_version").notNull().default(1),
    clinicianAssessment: json("clinician_assessment")
      .$type<ClinicianAssessment>(),
    bedId: uuid("bed_id")
      .notNull()
      .references(() => beds.id),
    paymentRoute: text("payment_route", {
      enum: ["SELF_PAY", "INSURED"],
    }).notNull(),
    expectedStayDays: int("expected_stay_days").notNull(),
    registeredAt: time("registered_at").notNull().default(utcNow),
    admittedAt: time("admitted_at"),
    cancelledAt: time("cancelled_at"),
    cancellationReason: text("cancellation_reason"),
    createdBy: key("created_by")
      .notNull()
      .references(() => user.id),
    requestId: uuid("request_id").notNull(),
    requestPayload: text("request_payload").notNull(),
    version: int("version").notNull().default(1),
    billRevision: int("bill_revision").notNull().default(1),
    depositVersionId: uuid("deposit_version_id").references(() => settingVersions.id),
  },
  (t) => [
    uniqueIndex("admission_retry_idx").on(t.createdBy, t.requestId),
    // patient_active_admission_idx (one PENDING/ADMITTED admission per patient) is a PostgreSQL partial index;
    // MariaDB enforces it with a unique index over a generated column in web/drizzle-maria/ (not expressible here).
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
      sql`${t.status} <> 'CANCELLED' or (${t.cancelledAt} is not null and char_length(trim(${t.cancellationReason})) > 0)`,
    ),
  ],
);

// One row protects both pending reservation and active occupancy.
export const bedHolds = mysqlTable("bed_holds", {
  bedId: uuid("bed_id")
    .primaryKey()
    .references(() => beds.id),
  admissionId: uuid("admission_id")
    .notNull()
    .unique()
    .references(() => admissions.id),
  heldAt: time("held_at").notNull().default(utcNow),
});

// Task 5 creates the first segment at activation, snapshotting the then-current tariff.
export const roomStays = mysqlTable(
  "room_stays",
  {
    id: uuid("id").primaryKey().default(uuidDefault),
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
export const effectiveRoomStays = mysqlView("effective_room_stays", {
  id: uuid("id").notNull(), admissionId: uuid("admission_id").notNull(), bedId: uuid("bed_id").notNull(), tariffVersionId: uuid("tariff_version_id").notNull(),
  startedAt: time("started_at").notNull(), endedAt: time("ended_at"), lastReconciledAt: time("last_reconciled_at"), postedPaise: bigint("posted_paise",{mode:"bigint"}).notNull(), amendmentId: uuid("amendment_id"),
}).existing();

export const effectivePatients = mysqlView("effective_patients",{
 id:uuid("id").notNull(),uhid:text("uhid").notNull(),name:key("name").notNull(),identityStatus:text("identity_status").notNull(),identityProvenance:text("identity_provenance"),dateOfBirth:date("date_of_birth",{mode:"string"}),ageYearsAtRegistration:int("age_years_at_registration"),sex:text("sex").notNull(),phone:text("phone"),registeredAt:time("registered_at").notNull(),registeredBy:text("registered_by").notNull(),identityAmendmentId:uuid("identity_amendment_id"),
}).existing();
