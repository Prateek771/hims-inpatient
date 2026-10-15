import { index, integer, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hims } from "../schema/core";
import { user } from "../schema/auth";
import { admissions, beds, roomStays } from "./schema";
import { nursingShifts } from "../nursing/schema";
import { sql } from "drizzle-orm";
import { doctorDirectory } from "../mvp/staff-schema";
const signed = () => ({ signedBy: text("signed_by").notNull().references(() => user.id), signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow() });
// Immutable doctor authority is tied to the originating stay, never reusable after a move.
export const transferOrders = hims.table("transfer_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  sourceStayId: uuid("source_stay_id").notNull().references(() => roomStays.id),
  version: integer("version").notNull(),
  destinationCategory: text("destination_category").notNull(),
  reason: text("reason").notNull(),
  ...signed(),
}, t => [index("transfer_orders_episode_idx").on(t.admissionId), index("transfer_orders_stay_idx").on(t.sourceStayId), uniqueIndex("transfer_order_version_idx").on(t.admissionId, t.version)]);
export const transferOrderCancellations = hims.table("transfer_order_cancellations", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  transferOrderId: uuid("transfer_order_id").notNull().unique().references(() => transferOrders.id),
  reason: text("reason").notNull(),
  signedBy: text("signed_by").notNull().references(() => user.id),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [index("transfer_cancel_episode_idx").on(t.admissionId)]);
// External clinical authority and the authenticated Nurse recorder are distinct facts.
export const mvpTransferAuthorities = hims.table("mvp_transfer_authorities", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  sourceStayId: uuid("source_stay_id").notNull().references(() => roomStays.id),
  externalDoctorId: uuid("external_doctor_id").notNull().references(() => doctorDirectory.id),
  authorizerName: text("authorizer_name").notNull(),
  sourceTime: timestamp("source_time", { withTimezone: true }).notNull(),
  destinationCategory: text("destination_category").notNull(),
  evidence: text("evidence").notNull(), reason: text("reason").notNull(),
  version: integer("version").notNull(), admissionVersion: integer("admission_version").notNull(),
  recordedBy: text("recorded_by").notNull().references(() => user.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [uniqueIndex("mvp_transfer_authority_version").on(t.admissionId, t.version), index("mvp_transfer_authority_stay").on(t.sourceStayId), index("mvp_transfer_authority_doctor").on(t.externalDoctorId)]);
export const mvpTransferCancellations = hims.table("mvp_transfer_cancellations", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  authorityId: uuid("authority_id").notNull().unique().references(() => mvpTransferAuthorities.id),
  externalDoctorId: uuid("external_doctor_id").notNull().references(() => doctorDirectory.id),
  authorizerName: text("authorizer_name").notNull(),
  sourceTime: timestamp("source_time", { withTimezone: true }).notNull(),
  evidence: text("evidence").notNull(), reason: text("reason").notNull(),
  recordedBy: text("recorded_by").notNull().references(() => user.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, t => [index("mvp_transfer_cancellation_episode").on(t.admissionId), index("mvp_transfer_cancellation_doctor").on(t.externalDoctorId)]);
export const admissionTransfers = hims.table("admission_transfers", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  transferOrderId: uuid("transfer_order_id").unique().references(() => transferOrders.id),
  mvpAuthorityId: uuid("mvp_authority_id").unique().references(() => mvpTransferAuthorities.id),
  oldStayId: uuid("old_stay_id").notNull().unique().references(() => roomStays.id),
  newStayId: uuid("new_stay_id").notNull().unique().references(() => roomStays.id),
  oldBedId: uuid("old_bed_id").notNull().references(() => beds.id),
  targetBedId: uuid("target_bed_id").notNull().references(() => beds.id),
  shiftId: uuid("shift_id").notNull().references(() => nursingShifts.id),
  handover: text("handover").notNull(),
  transferredAt: timestamp("transferred_at", { withTimezone: true }).notNull(),
  ...signed(),
}, t => [index("admission_transfers_episode_idx").on(t.admissionId)]);
export const transferInsuranceTasks = hims.table("transfer_insurance_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  transferId: uuid("transfer_id").notNull().unique().references(() => admissionTransfers.id),
  ownerRole: text("owner_role").notNull().default("INSURANCE"),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("transfer_insurance_tasks_episode_idx").on(t.admissionId)]);
