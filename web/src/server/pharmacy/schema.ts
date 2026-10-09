import { sql } from "drizzle-orm";
import { check, date, index, integer, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hims, hospitalSettings, settingVersions } from "../schema/core";
import { admissions } from "../admissions/schema";
import { clinicalOrders, clinicalSummaries } from "../clinical/schema";
import { charges, chargeReversals } from "../billing/schema";
import { user } from "../schema/auth";
const quantity = (name: string) => numeric(name, { precision: 18, scale: 6 });
const signed = () => ({ signedBy: text("signed_by").notNull().references(() => user.id), signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow() });
// The same ECMAScript edge whitespace removed by Zod's String.trim().
const referenceWhitespace = sql.raw([9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279].map(n=>`chr(${n})`).join("||"));
export const pharmacyBatches = hims.table("pharmacy_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitalSettings.id),
  medicineId: text("medicine_id").notNull(),
  catalogVersionId: uuid("catalog_version_id").notNull().references(() => settingVersions.id),
  batchNo: text("batch_no").notNull(), expiresOn: date("expires_on").notNull(),
  unit: text("unit").notNull(), quantityScale: integer("quantity_scale").notNull(), barcode: text("barcode").notNull(),
  availableQuantity: quantity("available_quantity").notNull().default("0"),
  reorderThreshold: quantity("reorder_threshold"),
  ...signed(),
}, (t) => [uniqueIndex("pharmacy_batch_identity").on(t.hospitalId, t.medicineId, t.batchNo), uniqueIndex("pharmacy_barcode_identity").on(t.hospitalId, t.barcode), index("pharmacy_batch_catalog_idx").on(t.catalogVersionId), check("pharmacy_stock_nonnegative", sql`${t.availableQuantity} >= 0 and (${t.reorderThreshold} is null or ${t.reorderThreshold} >= 0) and ${t.quantityScale} between 0 and 6`)]);
export const pharmacyMovements = hims.table("pharmacy_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => pharmacyBatches.id),
  admissionId: uuid("admission_id").references(() => admissions.id),
  orderId: uuid("order_id").references(() => clinicalOrders.id),
  kind: text("kind", { enum: ["RECEIPT", "ISSUE", "RETURN", "ADJUSTMENT"] }).notNull(),
  purpose: text("purpose", { enum: ["WARD", "TAKE_HOME"] }),
  quantity: quantity("quantity").notNull(),
  originalIssueId: uuid("original_issue_id"),
  chargeId: uuid("charge_id").references(() => charges.id),
  reversalId: uuid("reversal_id").references(() => chargeReversals.id),
  reference: text("reference").notNull(), ...signed(),
}, (t) => [index("pharmacy_movement_batch_idx").on(t.batchId), index("pharmacy_movement_episode_idx").on(t.admissionId), index("pharmacy_movement_order_idx").on(t.orderId), index("pharmacy_return_issue_idx").on(t.originalIssueId), index("pharmacy_charge_idx").on(t.chargeId), index("pharmacy_reversal_idx").on(t.reversalId), uniqueIndex("pharmacy_receipt_source_once").on(t.batchId,t.reference).where(sql`${t.kind} = 'RECEIPT'`),check("pharmacy_receipt_reference_canonical",sql`${t.kind} <> 'RECEIPT' or (${t.reference} = btrim(${t.reference}, ${referenceWhitespace}) and length(${t.reference}) between 3 and 500)`), check("pharmacy_movement_kind", sql`(${t.kind} = 'RECEIPT' and ${t.quantity}>0 and ${t.admissionId} is null and ${t.orderId} is null and ${t.originalIssueId} is null and ${t.purpose} is null and ${t.chargeId} is null and ${t.reversalId} is null) or (${t.kind} = 'ADJUSTMENT' and ${t.quantity}<>0 and ${t.admissionId} is null and ${t.orderId} is null and ${t.originalIssueId} is null and ${t.purpose} is null and ${t.chargeId} is null and ${t.reversalId} is null) or (${t.kind} = 'ISSUE' and ${t.quantity}<0 and ${t.admissionId} is not null and ${t.orderId} is not null and ${t.purpose} in ('WARD','TAKE_HOME') and ${t.chargeId} is not null and ${t.originalIssueId} is null and ${t.reversalId} is null) or (${t.kind} = 'RETURN' and ${t.quantity}>0 and ${t.admissionId} is not null and ${t.orderId} is not null and ${t.purpose} in ('WARD','TAKE_HOME') and ${t.chargeId} is not null and ${t.originalIssueId} is not null)`)]);
export type PreparedItem = { orderId: string; batchId: string; quantity: string; unit: string; issueIds: string[] };
export const pharmacyPreparations = hims.table("pharmacy_preparations", {
  id: uuid("id").primaryKey().defaultRandom(), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  version: integer("version").notNull(),
  prescriptionVersionId: uuid("prescription_version_id").notNull().references(() => clinicalSummaries.id),
  items: jsonb("items").$type<PreparedItem[]>().notNull(), ...signed(),
}, (t) => [index("pharmacy_preparation_episode_idx").on(t.admissionId), index("pharmacy_preparation_rx_idx").on(t.prescriptionVersionId),uniqueIndex("pharmacy_preparation_version").on(t.admissionId,t.version),check("pharmacy_preparation_positive",sql`${t.version}>0`)]);
