import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hims } from "../schema/core";
import { admissions,roomStays as roomStaysForMvp } from "../admissions/schema";
import { user } from "../schema/auth";
import { charges, chargeReversals, receipts } from "../billing/schema";
import { postDischargeAmendments } from "../discharge/exception-schema";
export const mvpChecks = ["NURSING", "PHARMACY", "INSURANCE", "DIAGNOSTICS"] as const;
export const optionalMvpChecks = ["PHARMACY", "INSURANCE", "DIAGNOSTICS"] as const;
export const mvpEvents = hims.table("mvp_events", {
  id: uuid("id").primaryKey().defaultRandom(), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  action: text("action").notNull(), check: text("check_key"), status: text("status"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(), reviewHash: text("review_hash").notNull(),
  billVersion: integer("bill_version").notNull(), clinicalId: uuid("clinical_id"), checklistId: uuid("checklist_id"),
  recordedBy: text("recorded_by").notNull().references(() => user.id), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [index("mvp_event_episode").on(t.admissionId, t.recordedAt), check("mvp_event_action", sql`${t.action} in ('doctor-approval','checklist','check','n-a','finance','deliver')`)]);
export const mvpInvalidations = hims.table("mvp_invalidations", {
  id: uuid("id").primaryKey().defaultRandom(), eventId: uuid("event_id").notNull().references(() => mvpEvents.id),
  kind: text("kind").notNull(), sourceId: text("source_id").notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [uniqueIndex("mvp_invalidate_once").on(t.eventId)]);
export const mvpMedicineSources = hims.table("mvp_medicine_sources", {
  id: uuid("id").primaryKey(), admissionId: uuid("admission_id").notNull().references(() => admissions.id), kind: text("kind").notNull(),
  originalId: uuid("original_id"), chargeId: uuid("charge_id").notNull().references(() => charges.id), reversalId: uuid("reversal_id").references(() => chargeReversals.id),
  quantity: text("quantity").notNull(), quantityScale: integer("quantity_scale").notNull(), evidence: text("evidence").notNull(), reference: text("reference").notNull(),
  recordedBy: text("recorded_by").notNull().references(() => user.id), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [index("mvp_medicine_episode").on(t.admissionId), index("mvp_medicine_original").on(t.originalId), uniqueIndex("mvp_medicine_reference").on(t.admissionId,t.kind,t.reference), check("mvp_medicine_kind", sql`${t.kind} in ('CHARGE','RETURN') and ${t.quantityScale} between 0 and 6`)]);
export const mvpReceivableReceipts = hims.table("mvp_receivable_receipts", {
  id: uuid("id").primaryKey().defaultRandom(), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  financeId: uuid("finance_id").references(() => mvpEvents.id),exceptionAuthorityId:uuid("exception_authority_id").references(()=>mvpExceptionEvents.id),allocationAmendmentId:uuid("allocation_amendment_id").references(()=>postDischargeAmendments.id), receiptId: uuid("receipt_id").notNull().references(() => receipts.id),
  recordedBy: text("recorded_by").notNull().references(() => user.id), recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [uniqueIndex("mvp_receivable_receipt_once").on(t.receiptId),index("mvp_receivable_episode").on(t.admissionId)]);
export const mvpExceptionEvents=hims.table("mvp_exception_events",{
  id:uuid("id").primaryKey().defaultRandom(),admissionId:uuid("admission_id").notNull().references(()=>admissions.id),
  action:text("action").notNull(),type:text("type").notNull(),sourceId:uuid("source_id"),payload:jsonb("payload").$type<Record<string,unknown>>().notNull(),
  billVersion:integer("bill_version").notNull(),recordedBy:text("recorded_by").notNull().references(()=>user.id),recordedAt:timestamp("recorded_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
},t=>[index("mvp_exception_episode").on(t.admissionId,t.recordedAt)]);
export const mvpExceptionalDepartures=hims.table("mvp_exceptional_departures",{
  id:uuid("id").primaryKey().defaultRandom(),admissionId:uuid("admission_id").notNull().unique().references(()=>admissions.id),
  authorityId:uuid("authority_id").notNull().references(()=>mvpExceptionEvents.id),clinicalId:uuid("clinical_id").notNull().references(()=>mvpExceptionEvents.id),
  stayId:uuid("stay_id").notNull().references(()=>roomStaysForMvp.id),shiftId:uuid("shift_id").notNull(),departedAt:timestamp("departed_at",{withTimezone:true}).notNull(),
  snapshot:jsonb("snapshot").$type<Record<string,unknown>>().notNull(),recordedBy:text("recorded_by").notNull().references(()=>user.id),recordedAt:timestamp("recorded_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
});
export const mvpRoomReturns=hims.table("mvp_room_returns",{
  id:uuid("id").primaryKey().defaultRandom(),admissionId:uuid("admission_id").notNull().references(()=>admissions.id),vacationId:uuid("vacation_id").notNull().unique(),
  authorityId:uuid("authority_id").notNull().references(()=>mvpExceptionEvents.id),clinicalId:uuid("clinical_id").notNull().references(()=>mvpExceptionEvents.id),stayId:uuid("stay_id").notNull().unique().references(()=>roomStaysForMvp.id),
  shiftId:uuid("shift_id").notNull(),returnedAt:timestamp("returned_at",{withTimezone:true}).notNull(),handover:text("handover").notNull(),recordedBy:text("recorded_by").notNull().references(()=>user.id),recordedAt:timestamp("recorded_at",{withTimezone:true}).notNull().default(sql`clock_timestamp()`),
});
