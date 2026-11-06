import { index, int, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";
import { user } from "../schema/auth";
import { admissions, beds, roomStays } from "./schema";
import { nursingShifts } from "../nursing/schema";
import { sql } from "drizzle-orm";
import { doctorDirectory } from "../mvp/staff-schema";
const signed = () => ({ signedBy: key("signed_by").notNull().references(() => user.id), signedAt: utc("signed_at").notNull().default(utcNow) });
// Immutable doctor authority is tied to the originating stay, never reusable after a move.
export const transferOrders = mysqlTable("transfer_orders", {
  id: uuid("id").primaryKey().default(uuidDefault),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  sourceStayId: uuid("source_stay_id").notNull().references(() => roomStays.id),
  version: int("version").notNull(),
  destinationCategory: text("destination_category").notNull(),
  reason: text("reason").notNull(),
  ...signed(),
}, t => [index("transfer_orders_episode_idx").on(t.admissionId), index("transfer_orders_stay_idx").on(t.sourceStayId), uniqueIndex("transfer_order_version_idx").on(t.admissionId, t.version)]);
export const transferOrderCancellations = mysqlTable("transfer_order_cancellations", {
  id: uuid("id").primaryKey().default(uuidDefault),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  transferOrderId: uuid("transfer_order_id").notNull().unique().references(() => transferOrders.id),
  reason: text("reason").notNull(),
  signedBy: key("signed_by").notNull().references(() => user.id),
  signedAt: utc("signed_at").notNull().default(utcNow),
}, t => [index("transfer_cancel_episode_idx").on(t.admissionId)]);
// External clinical authority and the authenticated Nurse recorder are distinct facts.
export const mvpTransferAuthorities = mysqlTable("mvp_transfer_authorities", {
  id: uuid("id").primaryKey().default(uuidDefault),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  sourceStayId: uuid("source_stay_id").notNull().references(() => roomStays.id),
  externalDoctorId: uuid("external_doctor_id").notNull().references(() => doctorDirectory.id),
  authorizerName: text("authorizer_name").notNull(),
  sourceTime: utc("source_time").notNull(),
  destinationCategory: text("destination_category").notNull(),
  evidence: text("evidence").notNull(), reason: text("reason").notNull(),
  version: int("version").notNull(), admissionVersion: int("admission_version").notNull(),
  recordedBy: key("recorded_by").notNull().references(() => user.id),
  recordedAt: utc("recorded_at").notNull().default(utcNow),
}, t => [uniqueIndex("mvp_transfer_authority_version").on(t.admissionId, t.version), index("mvp_transfer_authority_stay").on(t.sourceStayId), index("mvp_transfer_authority_doctor").on(t.externalDoctorId)]);
export const mvpTransferCancellations = mysqlTable("mvp_transfer_cancellations", {
  id: uuid("id").primaryKey().default(uuidDefault),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  authorityId: uuid("authority_id").notNull().unique().references(() => mvpTransferAuthorities.id),
  externalDoctorId: uuid("external_doctor_id").notNull().references(() => doctorDirectory.id),
  authorizerName: text("authorizer_name").notNull(),
  sourceTime: utc("source_time").notNull(),
  evidence: text("evidence").notNull(), reason: text("reason").notNull(),
  recordedBy: key("recorded_by").notNull().references(() => user.id),
  recordedAt: utc("recorded_at").notNull().default(utcNow),
}, t => [index("mvp_transfer_cancellation_episode").on(t.admissionId), index("mvp_transfer_cancellation_doctor").on(t.externalDoctorId)]);
export const admissionTransfers = mysqlTable("admission_transfers", {
  id: uuid("id").primaryKey().default(uuidDefault),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  transferOrderId: uuid("transfer_order_id").unique().references(() => transferOrders.id),
  mvpAuthorityId: uuid("mvp_authority_id").unique().references(() => mvpTransferAuthorities.id),
  oldStayId: uuid("old_stay_id").notNull().unique().references(() => roomStays.id),
  newStayId: uuid("new_stay_id").notNull().unique().references(() => roomStays.id),
  oldBedId: uuid("old_bed_id").notNull().references(() => beds.id),
  targetBedId: uuid("target_bed_id").notNull().references(() => beds.id),
  shiftId: uuid("shift_id").notNull().references(() => nursingShifts.id),
  handover: text("handover").notNull(),
  transferredAt: utc("transferred_at").notNull(),
  ...signed(),
}, t => [index("admission_transfers_episode_idx").on(t.admissionId)]);
export const transferInsuranceTasks = mysqlTable("transfer_insurance_tasks", {
  id: uuid("id").primaryKey().default(uuidDefault),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  transferId: uuid("transfer_id").notNull().unique().references(() => admissionTransfers.id),
  ownerRole: text("owner_role").notNull().default("INSURANCE"),
  reason: text("reason").notNull(),
  createdAt: utc("created_at").notNull().default(utcNow),
}, t => [index("transfer_insurance_tasks_episode_idx").on(t.admissionId)]);
