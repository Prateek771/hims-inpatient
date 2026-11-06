import { sql } from "drizzle-orm";
import { check, index, int, json, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";
import { admissions,roomStays as roomStaysForMvp } from "../admissions/schema";
import { user } from "../schema/auth";
import { charges, chargeReversals, receipts } from "../billing/schema";
import { postDischargeAmendments } from "../discharge/exception-schema";
export const mvpChecks = ["NURSING", "PHARMACY", "INSURANCE", "DIAGNOSTICS"] as const;
export const optionalMvpChecks = ["PHARMACY", "INSURANCE", "DIAGNOSTICS"] as const;
export const mvpEvents = mysqlTable("mvp_events", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  action: text("action").notNull(), check: text("check_key"), status: text("status"),
  payload: json("payload").$type<Record<string, unknown>>().notNull(), reviewHash: text("review_hash").notNull(),
  billVersion: int("bill_version").notNull(), clinicalId: uuid("clinical_id"), checklistId: uuid("checklist_id"),
  recordedBy: key("recorded_by").notNull().references(() => user.id), recordedAt: utc("recorded_at").notNull().default(utcNow),
}, t => [index("mvp_event_episode").on(t.admissionId, t.recordedAt), check("mvp_event_action", sql`${t.action} in ('doctor-approval','checklist','check','n-a','finance','deliver')`)]);
export const mvpInvalidations = mysqlTable("mvp_invalidations", {
  id: uuid("id").primaryKey().default(uuidDefault), eventId: uuid("event_id").notNull().references(() => mvpEvents.id),
  kind: key("kind").notNull(), sourceId: text("source_id").notNull(), recordedAt: utc("recorded_at").notNull().default(utcNow),
}, t => [uniqueIndex("mvp_invalidate_once").on(t.eventId)]);
export const mvpMedicineSources = mysqlTable("mvp_medicine_sources", {
  id: uuid("id").primaryKey(), admissionId: uuid("admission_id").notNull().references(() => admissions.id), kind: key("kind").notNull(),
  originalId: uuid("original_id"), chargeId: uuid("charge_id").notNull().references(() => charges.id), reversalId: uuid("reversal_id").references(() => chargeReversals.id),
  quantity: text("quantity").notNull(), quantityScale: int("quantity_scale").notNull(), evidence: text("evidence").notNull(), reference: key("reference").notNull(),
  recordedBy: key("recorded_by").notNull().references(() => user.id), recordedAt: utc("recorded_at").notNull().default(utcNow),
}, t => [index("mvp_medicine_episode").on(t.admissionId), index("mvp_medicine_original").on(t.originalId), uniqueIndex("mvp_medicine_reference").on(t.admissionId,t.kind,t.reference), check("mvp_medicine_kind", sql`${t.kind} in ('CHARGE','RETURN') and ${t.quantityScale} between 0 and 6`)]);
export const mvpReceivableReceipts = mysqlTable("mvp_receivable_receipts", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  financeId: uuid("finance_id").references(() => mvpEvents.id),exceptionAuthorityId:uuid("exception_authority_id").references(()=>mvpExceptionEvents.id),allocationAmendmentId:uuid("allocation_amendment_id").references(()=>postDischargeAmendments.id), receiptId: uuid("receipt_id").notNull().references(() => receipts.id),
  recordedBy: key("recorded_by").notNull().references(() => user.id), recordedAt: utc("recorded_at").notNull().default(utcNow),
}, t => [uniqueIndex("mvp_receivable_receipt_once").on(t.receiptId),index("mvp_receivable_episode").on(t.admissionId)]);
export const mvpExceptionEvents=mysqlTable("mvp_exception_events",{
  id:uuid("id").primaryKey().default(uuidDefault),admissionId:uuid("admission_id").notNull().references(()=>admissions.id),
  action:text("action").notNull(),type:text("type").notNull(),sourceId:uuid("source_id"),payload:json("payload").$type<Record<string,unknown>>().notNull(),
  billVersion:int("bill_version").notNull(),recordedBy:key("recorded_by").notNull().references(()=>user.id),recordedAt:utc("recorded_at").notNull().default(utcNow),
},t=>[index("mvp_exception_episode").on(t.admissionId,t.recordedAt)]);
export const mvpExceptionalDepartures=mysqlTable("mvp_exceptional_departures",{
  id:uuid("id").primaryKey().default(uuidDefault),admissionId:uuid("admission_id").notNull().unique().references(()=>admissions.id),
  authorityId:uuid("authority_id").notNull().references(()=>mvpExceptionEvents.id),clinicalId:uuid("clinical_id").notNull().references(()=>mvpExceptionEvents.id),
  stayId:uuid("stay_id").notNull().references(()=>roomStaysForMvp.id),shiftId:uuid("shift_id").notNull(),departedAt:utc("departed_at").notNull(),
  snapshot:json("snapshot").$type<Record<string,unknown>>().notNull(),recordedBy:key("recorded_by").notNull().references(()=>user.id),recordedAt:utc("recorded_at").notNull().default(utcNow),
});
export const mvpRoomReturns=mysqlTable("mvp_room_returns",{
  id:uuid("id").primaryKey().default(uuidDefault),admissionId:uuid("admission_id").notNull().references(()=>admissions.id),vacationId:uuid("vacation_id").notNull().unique(),
  authorityId:uuid("authority_id").notNull().references(()=>mvpExceptionEvents.id),clinicalId:uuid("clinical_id").notNull().references(()=>mvpExceptionEvents.id),stayId:uuid("stay_id").notNull().unique().references(()=>roomStaysForMvp.id),
  shiftId:uuid("shift_id").notNull(),returnedAt:utc("returned_at").notNull(),handover:text("handover").notNull(),recordedBy:key("recorded_by").notNull().references(()=>user.id),recordedAt:utc("recorded_at").notNull().default(utcNow),
});
