import { sql } from "drizzle-orm";
import { check, index, int, json, mysqlTable, mysqlView, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";

import { admissions, beds, roomStays } from "../admissions/schema";
import { user } from "../schema/auth";
import { nursingShifts } from "../nursing/schema";
import { mvpEvents,mvpExceptionEvents } from "../mvp/schema";
export const gates = ["DOCTOR", "PHARMACY", "NURSING", "BILLING"] as const;
export type Gate = typeof gates[number];
const signed = () => ({ signedBy: key("signed_by").notNull().references(() => user.id), signedAt: utc("signed_at").notNull().default(utcNow) });
export const clearanceSeals = mysqlTable("clearance_seals", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  gate: varchar("gate", { length: 16, enum: gates }).notNull(), role: text("role").notNull(), reviewHash: text("review_hash").notNull(),
  billVersion: int("bill_version"), predecessorId: uuid("predecessor_id"),
  inputs: json("inputs").$type<Record<string, unknown>>().notNull(), reason: text("reason").notNull(), ...signed(),
}, t => [index("clearance_seal_episode_gate").on(t.admissionId, t.gate), index("clearance_seal_signer").on(t.signedBy), index("clearance_seal_predecessor").on(t.predecessorId), check("clearance_gate_role", sql`(${t.gate}='DOCTOR' and ${t.role}='DOCTOR') or (${t.gate}='PHARMACY' and ${t.role}='PHARMACY') or (${t.gate}='NURSING' and ${t.role}='NURSE') or (${t.gate}='BILLING' and ${t.role} in ('ADMIN','BILLING'))`), check("clearance_bill_version", sql`(${t.gate}='BILLING') = (${t.billVersion} is not null)`)]);
export const clearanceInvalidations = mysqlTable("clearance_invalidations", {
  id: uuid("id").primaryKey().default(uuidDefault), sealId: uuid("seal_id").notNull().references(() => clearanceSeals.id),
  changeKind: text("change_kind").notNull(), changedRecordIds: json("changed_record_ids").$type<string[]>().notNull(),
  recordedAt: utc("recorded_at").notNull().default(utcNow),
}, t => [uniqueIndex("clearance_invalidated_once").on(t.sealId)]);
export const departures = mysqlTable("departures", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  stayId: uuid("stay_id").notNull().references(() => roomStays.id), billSealId: uuid("bill_seal_id").references(() => clearanceSeals.id),
  mvpFinanceId: uuid("mvp_finance_id").references(() => mvpEvents.id),
  departedAt: utc("departed_at").notNull(), billVersion: int("bill_version").notNull(), ...signed(),
}, t => [uniqueIndex("departure_episode_once").on(t.admissionId), index("departure_stay").on(t.stayId), index("departure_seal").on(t.billSealId), index("departure_signer").on(t.signedBy)]);
export const roomVacations = mysqlTable("room_vacations", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  stayId: uuid("stay_id").notNull().references(() => roomStays.id), nursingSealId: uuid("nursing_seal_id").references(() => clearanceSeals.id),
  mvpReadinessId: uuid("mvp_readiness_id").references(() => mvpEvents.id),
  mvpExceptionId:uuid("mvp_exception_id").references(()=>mvpExceptionEvents.id),
  shiftId: uuid("shift_id").notNull().references(()=>nursingShifts.id), vacatedAt: utc("vacated_at").notNull(),
  waitingLocation: text("waiting_location").notNull(), handover: text("handover").notNull(), ...signed(),
}, t => [uniqueIndex("room_vacation_stay_once").on(t.stayId), index("room_vacation_nursing_seal").on(t.nursingSealId), index("room_vacation_shift").on(t.shiftId), index("room_vacation_signer").on(t.signedBy)]);
export const effectiveRoomVacations = mysqlView("effective_room_vacations", {
  id:uuid("id").notNull(),admissionId:uuid("admission_id").notNull(),stayId:uuid("stay_id").notNull(),nursingSealId:uuid("nursing_seal_id"),shiftId:uuid("shift_id").notNull(),vacatedAt:utc("vacated_at").notNull(),waitingLocation:text("waiting_location").notNull(),handover:text("handover").notNull(),signedBy:key("signed_by").notNull(),signedAt:utc("signed_at").notNull(),
  amendmentId:uuid("amendment_id"),evidenceId:uuid("evidence_id"),originalVacatedAt:utc("original_vacated_at").notNull(),originalShiftId:uuid("original_shift_id").notNull(),originalHandover:text("original_handover").notNull(),originalSignedBy:text("original_signed_by").notNull(),originalSignedAt:utc("original_signed_at").notNull(),originalWaitingLocation:text("original_waiting_location").notNull(),
}).existing();
export const bedTurnovers = mysqlTable("bed_turnovers", {
  id: uuid("id").primaryKey().default(uuidDefault), bedId: uuid("bed_id").notNull().references(() => beds.id),
  stayId: uuid("stay_id").notNull().references(() => roomStays.id), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  vacatedAt: utc("vacated_at").notNull(), reason: text("reason").notNull(), ...signed(),
}, t => [uniqueIndex("turnover_stay_once").on(t.stayId), index("turnover_bed").on(t.bedId), index("turnover_episode").on(t.admissionId), index("turnover_signer").on(t.signedBy)]);
export const bedTurnoverCompletions = mysqlTable("bed_turnover_completions", {
  id: uuid("id").primaryKey().default(uuidDefault), turnoverId: uuid("turnover_id").notNull().references(() => bedTurnovers.id),
  completedAt: utc("completed_at").notNull(), evidence: text("evidence").notNull(), ...signed(),
}, t => [uniqueIndex("turnover_completed_once").on(t.turnoverId), index("turnover_completion_signer").on(t.signedBy)]);

export const effectiveBedTurnovers = mysqlView("effective_bed_turnovers",{
 id:uuid("id").notNull(),bedId:uuid("bed_id").notNull(),stayId:uuid("stay_id").notNull(),admissionId:uuid("admission_id").notNull(),vacatedAt:utc("vacated_at").notNull(),reason:text("reason").notNull(),signedBy:key("signed_by").notNull(),signedAt:utc("signed_at").notNull(),
 amendmentId:uuid("amendment_id"),evidenceId:uuid("evidence_id"),originalVacatedAt:utc("original_vacated_at").notNull(),cutoffShiftId:uuid("cutoff_shift_id"),cutoffSignedBy:text("cutoff_signed_by"),cutoffSignedAt:utc("cutoff_signed_at"),cutoffFindings:text("cutoff_findings"),
}).existing();
