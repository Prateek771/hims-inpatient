import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hims } from "../schema/core";
import { admissions, beds, roomStays } from "../admissions/schema";
import { user } from "../schema/auth";
import { nursingShifts } from "../nursing/schema";
import { mvpEvents,mvpExceptionEvents } from "../mvp/schema";
export const gates = ["DOCTOR", "PHARMACY", "NURSING", "BILLING"] as const;
export type Gate = typeof gates[number];
const signed = () => ({ signedBy: text("signed_by").notNull().references(() => user.id), signedAt: timestamp("signed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`) });
export const clearanceSeals = hims.table("clearance_seals", {
  id: uuid("id").primaryKey().defaultRandom(), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  gate: text("gate", { enum: gates }).notNull(), role: text("role").notNull(), reviewHash: text("review_hash").notNull(),
  billVersion: integer("bill_version"), predecessorId: uuid("predecessor_id"),
  inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(), reason: text("reason").notNull(), ...signed(),
}, t => [index("clearance_seal_episode_gate").on(t.admissionId, t.gate), index("clearance_seal_signer").on(t.signedBy), index("clearance_seal_predecessor").on(t.predecessorId), check("clearance_gate_role", sql`(${t.gate}='DOCTOR' and ${t.role}='DOCTOR') or (${t.gate}='PHARMACY' and ${t.role}='PHARMACY') or (${t.gate}='NURSING' and ${t.role}='NURSE') or (${t.gate}='BILLING' and ${t.role} in ('ADMIN','BILLING'))`), check("clearance_bill_version", sql`(${t.gate}='BILLING') = (${t.billVersion} is not null)`)]);
export const clearanceInvalidations = hims.table("clearance_invalidations", {
  id: uuid("id").primaryKey().defaultRandom(), sealId: uuid("seal_id").notNull().references(() => clearanceSeals.id),
  changeKind: text("change_kind").notNull(), changedRecordIds: jsonb("changed_record_ids").$type<string[]>().notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [uniqueIndex("clearance_invalidated_once").on(t.sealId)]);
export const departures = hims.table("departures", {
  id: uuid("id").primaryKey().defaultRandom(), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  stayId: uuid("stay_id").notNull().references(() => roomStays.id), billSealId: uuid("bill_seal_id").references(() => clearanceSeals.id),
  mvpFinanceId: uuid("mvp_finance_id").references(() => mvpEvents.id),
  departedAt: timestamp("departed_at", { withTimezone: true }).notNull(), billVersion: integer("bill_version").notNull(), ...signed(),
}, t => [uniqueIndex("departure_episode_once").on(t.admissionId), index("departure_stay").on(t.stayId), index("departure_seal").on(t.billSealId), index("departure_signer").on(t.signedBy)]);
export const roomVacations = hims.table("room_vacations", {
  id: uuid("id").primaryKey().defaultRandom(), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  stayId: uuid("stay_id").notNull().references(() => roomStays.id), nursingSealId: uuid("nursing_seal_id").references(() => clearanceSeals.id),
  mvpReadinessId: uuid("mvp_readiness_id").references(() => mvpEvents.id),
  mvpExceptionId:uuid("mvp_exception_id").references(()=>mvpExceptionEvents.id),
  shiftId: uuid("shift_id").notNull().references(()=>nursingShifts.id), vacatedAt: timestamp("vacated_at", { withTimezone: true }).notNull(),
  waitingLocation: text("waiting_location").notNull(), handover: text("handover").notNull(), ...signed(),
}, t => [uniqueIndex("room_vacation_stay_once").on(t.stayId), index("room_vacation_nursing_seal").on(t.nursingSealId), index("room_vacation_shift").on(t.shiftId), index("room_vacation_signer").on(t.signedBy)]);
export const effectiveRoomVacations = hims.view("effective_room_vacations", {
  id:uuid("id").notNull(),admissionId:uuid("admission_id").notNull(),stayId:uuid("stay_id").notNull(),nursingSealId:uuid("nursing_seal_id"),shiftId:uuid("shift_id").notNull(),vacatedAt:timestamp("vacated_at",{withTimezone:true}).notNull(),waitingLocation:text("waiting_location").notNull(),handover:text("handover").notNull(),signedBy:text("signed_by").notNull(),signedAt:timestamp("signed_at",{withTimezone:true}).notNull(),
  amendmentId:uuid("amendment_id"),evidenceId:uuid("evidence_id"),originalVacatedAt:timestamp("original_vacated_at",{withTimezone:true}).notNull(),originalShiftId:uuid("original_shift_id").notNull(),originalHandover:text("original_handover").notNull(),originalSignedBy:text("original_signed_by").notNull(),originalSignedAt:timestamp("original_signed_at",{withTimezone:true}).notNull(),originalWaitingLocation:text("original_waiting_location").notNull(),
}).existing();
export const bedTurnovers = hims.table("bed_turnovers", {
  id: uuid("id").primaryKey().defaultRandom(), bedId: uuid("bed_id").notNull().references(() => beds.id),
  stayId: uuid("stay_id").notNull().references(() => roomStays.id), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  vacatedAt: timestamp("vacated_at", { withTimezone: true }).notNull(), reason: text("reason").notNull(), ...signed(),
}, t => [uniqueIndex("turnover_stay_once").on(t.stayId), index("turnover_bed").on(t.bedId), index("turnover_episode").on(t.admissionId), index("turnover_signer").on(t.signedBy)]);
export const bedTurnoverCompletions = hims.table("bed_turnover_completions", {
  id: uuid("id").primaryKey().defaultRandom(), turnoverId: uuid("turnover_id").notNull().references(() => bedTurnovers.id),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull(), evidence: text("evidence").notNull(), ...signed(),
}, t => [uniqueIndex("turnover_completed_once").on(t.turnoverId), index("turnover_completion_signer").on(t.signedBy)]);

export const effectiveBedTurnovers = hims.view("effective_bed_turnovers",{
 id:uuid("id").notNull(),bedId:uuid("bed_id").notNull(),stayId:uuid("stay_id").notNull(),admissionId:uuid("admission_id").notNull(),vacatedAt:timestamp("vacated_at",{withTimezone:true}).notNull(),reason:text("reason").notNull(),signedBy:text("signed_by").notNull(),signedAt:timestamp("signed_at",{withTimezone:true}).notNull(),
 amendmentId:uuid("amendment_id"),evidenceId:uuid("evidence_id"),originalVacatedAt:timestamp("original_vacated_at",{withTimezone:true}).notNull(),cutoffShiftId:uuid("cutoff_shift_id"),cutoffSignedBy:text("cutoff_signed_by"),cutoffSignedAt:timestamp("cutoff_signed_at",{withTimezone:true}),cutoffFindings:text("cutoff_findings"),
}).existing();
