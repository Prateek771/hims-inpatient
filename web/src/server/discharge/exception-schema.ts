import { sql } from "drizzle-orm";
import { check, date, index, int, json, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";
import { admissions, patients } from "../admissions/schema";
import { roomStays } from "../admissions/schema";
import { nursingShifts } from "../nursing/schema";
import { user } from "../schema/auth";
import { roomVacations } from "./schema";
export const exceptionTypes = ["URGENT_ADMISSION", "INSURANCE_DELAY", "INSURANCE_DENIAL", "CREDIT", "UNAVAILABLE_APPROVER", "EARLY_EXIT", "AGAINST_ADVICE", "EXTERNAL_TRANSFER", "DEATH", "CANCELLED_DEPOSIT", "POST_DISCHARGE_CORRECTION", "DELAYED_TRANSFER", "ROOM_CUTOFF_CORRECTION", "RETURN_TO_BED"] as const;
export const exceptionDispositions = ["ACTIVATE", "FOLLOW_UP", "EXCEPTIONAL_EXIT", "RETURN_DEPOSIT", "AMEND", "TRANSFER", "RETURN_TO_BED", "CLOSE_ATTENDANCE"] as const;
export const signed = () => ({ signedBy: key("signed_by").notNull().references(() => user.id), signedAt: utc("signed_at").notNull().default(utcNow) });
export const adminExceptions = mysqlTable("admin_exceptions", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  type: text("type", { enum: exceptionTypes }).notNull(), disposition: text("disposition", { enum: exceptionDispositions }).notNull(),
  authority: text("authority").notNull(), reason: text("reason").notNull(), evidence: text("evidence").notNull(),
  evidenceIds: json("evidence_ids").$type<string[]>().notNull(), sourceId: uuid("source_id"), correctionKind: text("correction_kind"),
  followUpOwnerId: key("follow_up_owner_id").notNull().references(() => user.id),
  snapshot: json("snapshot").$type<Record<string, unknown>>().notNull(), ...signed(),
}, t => [index("exceptions_admission_idx").on(t.admissionId), index("exceptions_owner_idx").on(t.followUpOwnerId), index("exceptions_source_idx").on(t.sourceId), check("exception_authority_text", sql `char_length(trim(${t.authority}))>=3 and char_length(trim(${t.reason}))>=3 and char_length(trim(${t.evidence}))>=3`)]);
export const evidenceKinds = ["EARLY_EXIT", "AGAINST_ADVICE", "EXTERNAL_TRANSFER", "DEATH", "RETURN_TO_BED", "RETURN_CANCELLED", "PHYSICAL_EXIT", "TRANSFER_HANDOVER", "RETURN_HANDOVER", "ROOM_CUTOFF", "PLANNED_EXIT", "PROFESSIONAL_REVIEW"] as const;
export const exceptionEvidence = mysqlTable("exception_evidence", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  exceptionId: uuid("exception_id").references(() => adminExceptions.id),
  kind: text("kind", { enum: evidenceKinds }).notNull(), role: text("role").notNull(),
  shiftId: uuid("shift_id").references(() => nursingShifts.id), sourceId: uuid("source_id"),
  actualAt: utc("actual_at").notNull(), vacatedAt: utc("vacated_at"),
  notes: text("notes").notNull(), ...signed(),
}, t => [index("exception_evidence_episode").on(t.admissionId), index("exception_evidence_shift").on(t.shiftId), index("exception_evidence_source").on(t.sourceId), index("exception_evidence_authority").on(t.exceptionId), check("exception_evidence_role", sql `(${t.kind} in ('PHYSICAL_EXIT','TRANSFER_HANDOVER','RETURN_HANDOVER','ROOM_CUTOFF') and ${t.role}='NURSE' and ${t.shiftId} is not null) or (${t.kind} not in ('PHYSICAL_EXIT','TRANSFER_HANDOVER','RETURN_HANDOVER','ROOM_CUTOFF') and ${t.role}='DOCTOR')`)]);
export const exceptionalDepartures = mysqlTable("exceptional_departures", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().unique().references(() => admissions.id),
  exceptionId: uuid("exception_id").notNull().references(() => adminExceptions.id), physicalEvidenceId: uuid("physical_evidence_id").notNull().references(() => exceptionEvidence.id),
  stayId: uuid("stay_id").notNull().references(() => roomStays.id), departedAt: utc("departed_at").notNull(),
  snapshot: json("snapshot").$type<Record<string, unknown>>().notNull(), ...signed(),
}, t => [index("exceptional_departure_authority").on(t.exceptionId), index("exceptional_departure_stay").on(t.stayId), index("exceptional_departure_evidence").on(t.physicalEvidenceId)]);
export const postDischargeAmendments = mysqlTable("post_discharge_amendments", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  exceptionId: uuid("exception_id").notNull().references(() => adminExceptions.id), kind: text("kind").notNull(), sourceId: uuid("source_id").notNull(), resultId: uuid("result_id").notNull(),
  beforeSnapshot: json("before_snapshot").$type<Record<string, unknown>>().notNull(), afterSnapshot: json("after_snapshot").$type<Record<string, unknown>>().notNull(), ...signed(),
}, t => [index("amendment_episode").on(t.admissionId), index("amendment_authority").on(t.exceptionId), index("amendment_source").on(t.sourceId), index("amendment_result").on(t.resultId)]);
export const stayBoundaryAmendments = mysqlTable("stay_boundary_amendments", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id), stayId: uuid("stay_id").notNull().references(() => roomStays.id),
  exceptionId: uuid("exception_id").notNull().references(() => adminExceptions.id), evidenceId: uuid("evidence_id").notNull().references(() => exceptionEvidence.id), version: int("version").notNull(),
  startedAt: utc("started_at").notNull(), endedAt: utc("ended_at"),
  reason: text("reason").notNull(), ...signed(),
}, t => [uniqueIndex("stay_amendment_version").on(t.stayId, t.version), index("stay_amendment_episode").on(t.admissionId), index("stay_amendment_authority").on(t.exceptionId), index("stay_amendment_evidence").on(t.evidenceId), check("stay_amendment_bounds", sql `${t.version}>0 and (${t.endedAt} is null or ${t.endedAt}>${t.startedAt})`)]);
export const roomReturns = mysqlTable("room_returns", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id), vacationId: uuid("vacation_id").notNull().unique().references(() => roomVacations.id), stayId: uuid("stay_id").notNull().unique().references(() => roomStays.id),
  exceptionId: uuid("exception_id").notNull().references(() => adminExceptions.id), doctorEvidenceId: uuid("doctor_evidence_id").notNull().references(() => exceptionEvidence.id), nurseEvidenceId: uuid("nurse_evidence_id").notNull().references(() => exceptionEvidence.id), returnedAt: utc("returned_at").notNull(), ...signed(),
}, t => [index("room_return_episode").on(t.admissionId), index("room_return_authority").on(t.exceptionId), index("room_return_doctor").on(t.doctorEvidenceId), index("room_return_nurse").on(t.nurseEvidenceId)]);
/** Operational absence evidence, deliberately separate from a Nurse's signed handover. */
export const administrativeShiftEnds = mysqlTable("administrative_shift_ends", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id), shiftId: uuid("shift_id").notNull().unique().references(() => nursingShifts.id), exceptionId: uuid("exception_id").notNull().references(() => adminExceptions.id), endedAt: utc("ended_at").notNull(), evidence: text("evidence").notNull(), ...signed(),
}, t => [index("admin_shift_end_episode").on(t.admissionId), index("admin_shift_end_authority").on(t.exceptionId)]);
export const patientIdentifications = mysqlTable("patient_identifications", {
  id: uuid("id").primaryKey().default(uuidDefault), patientId: uuid("patient_id").notNull().references(() => patients.id), admissionId: uuid("admission_id").notNull().references(() => admissions.id), exceptionId: uuid("exception_id").notNull().references(() => adminExceptions.id), version: int("version").notNull(), name: text("name").notNull(), dateOfBirth: date("date_of_birth",{mode:"string"}), ageYearsAtRegistration: int("age_years_at_registration"), sex: text("sex").notNull(), phone: text("phone"), evidence: text("evidence").notNull(), reason: text("reason").notNull(), ...signed(),
}, t => [uniqueIndex("patient_identification_version").on(t.patientId, t.version), index("identification_episode").on(t.admissionId), index("identification_authority").on(t.exceptionId), check("identified_patient_age", sql `(${t.dateOfBirth} is not null) <> (${t.ageYearsAtRegistration} is not null)`), check("identified_patient_values", sql `${t.sex} in ('FEMALE','MALE','OTHER','UNKNOWN') and (${t.ageYearsAtRegistration} is null or ${t.ageYearsAtRegistration} between 0 and 130) and ${t.version}>0`)]);
export const exceptionFollowups = mysqlTable("exception_followups", {
  id: uuid("id").primaryKey().default(uuidDefault), exceptionId: uuid("exception_id").notNull().references(() => adminExceptions.id), admissionId: uuid("admission_id").notNull().references(() => admissions.id), note: text("note").notNull(), ownerId: key("owner_id").notNull().references(() => user.id), ...signed(),
}, t => [index("exception_followup_authority").on(t.exceptionId), index("exception_followup_episode").on(t.admissionId), index("exception_followup_owner").on(t.ownerId)]);
