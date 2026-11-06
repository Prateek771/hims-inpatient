import { sql } from "drizzle-orm";
import { check, date, decimal, index, int, json, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";
import { hospitalSettings, settingVersions } from "../schema/core";
import { admissions } from "../admissions/schema";
import { clinicalOrders, clinicalSummaries } from "../clinical/schema";
import { charges, chargeReversals } from "../billing/schema";
import { user } from "../schema/auth";
const quantity = (name: string) => decimal(name, { precision: 18, scale: 6 });
const signed = () => ({ signedBy: key("signed_by").notNull().references(() => user.id), signedAt: utc("signed_at").notNull().default(utcNow) });
// The same ECMAScript edge whitespace removed by Zod's String.trim(), as a PCRE class (MariaDB has no TRIM(chars)).
const referenceWhitespaceClass = String.raw`[\\x{9}-\\x{d}\\x{20}\\x{a0}\\x{1680}\\x{2000}-\\x{200a}\\x{2028}\\x{2029}\\x{202f}\\x{205f}\\x{3000}\\x{feff}]`;
const referenceEdgeWhitespace = sql.raw(`'(?-i)^${referenceWhitespaceClass}|${referenceWhitespaceClass}$'`);
export const pharmacyBatches = mysqlTable("pharmacy_batches", {
  id: uuid("id").primaryKey().default(uuidDefault),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitalSettings.id),
  medicineId: key("medicine_id").notNull(),
  catalogVersionId: uuid("catalog_version_id").notNull().references(() => settingVersions.id),
  batchNo: key("batch_no").notNull(), expiresOn: date("expires_on",{mode:"string"}).notNull(),
  unit: text("unit").notNull(), quantityScale: int("quantity_scale").notNull(), barcode: key("barcode").notNull(),
  availableQuantity: quantity("available_quantity").notNull().default("0"),
  reorderThreshold: quantity("reorder_threshold"),
  ...signed(),
}, (t) => [uniqueIndex("pharmacy_batch_identity").on(t.hospitalId, t.medicineId, t.batchNo), uniqueIndex("pharmacy_barcode_identity").on(t.hospitalId, t.barcode), index("pharmacy_batch_catalog_idx").on(t.catalogVersionId), check("pharmacy_stock_nonnegative", sql`${t.availableQuantity} >= 0 and (${t.reorderThreshold} is null or ${t.reorderThreshold} >= 0) and ${t.quantityScale} between 0 and 6`)]);
export const pharmacyMovements = mysqlTable("pharmacy_movements", {
  id: uuid("id").primaryKey().default(uuidDefault),
  batchId: uuid("batch_id").notNull().references(() => pharmacyBatches.id),
  admissionId: uuid("admission_id").references(() => admissions.id),
  orderId: uuid("order_id").references(() => clinicalOrders.id),
  kind: text("kind", { enum: ["RECEIPT", "ISSUE", "RETURN", "ADJUSTMENT"] }).notNull(),
  purpose: text("purpose", { enum: ["WARD", "TAKE_HOME"] }),
  quantity: quantity("quantity").notNull(),
  originalIssueId: uuid("original_issue_id"),
  chargeId: uuid("charge_id").references(() => charges.id),
  reversalId: uuid("reversal_id").references(() => chargeReversals.id),
  reference: key("reference").notNull(), ...signed(),
}, (t) => [index("pharmacy_movement_batch_idx").on(t.batchId), index("pharmacy_movement_episode_idx").on(t.admissionId), index("pharmacy_movement_order_idx").on(t.orderId), index("pharmacy_return_issue_idx").on(t.originalIssueId), index("pharmacy_charge_idx").on(t.chargeId), index("pharmacy_reversal_idx").on(t.reversalId), /* pharmacy_receipt_source_once (partial unique, kind=RECEIPT) lives in web/drizzle-maria/ as a generated-column unique index. */check("pharmacy_receipt_reference_canonical",sql`${t.kind} <> 'RECEIPT' or (${t.reference} NOT REGEXP ${referenceEdgeWhitespace} and char_length(${t.reference}) between 3 and 500)`), check("pharmacy_movement_kind", sql`(${t.kind} = 'RECEIPT' and ${t.quantity}>0 and ${t.admissionId} is null and ${t.orderId} is null and ${t.originalIssueId} is null and ${t.purpose} is null and ${t.chargeId} is null and ${t.reversalId} is null) or (${t.kind} = 'ADJUSTMENT' and ${t.quantity}<>0 and ${t.admissionId} is null and ${t.orderId} is null and ${t.originalIssueId} is null and ${t.purpose} is null and ${t.chargeId} is null and ${t.reversalId} is null) or (${t.kind} = 'ISSUE' and ${t.quantity}<0 and ${t.admissionId} is not null and ${t.orderId} is not null and ${t.purpose} in ('WARD','TAKE_HOME') and ${t.chargeId} is not null and ${t.originalIssueId} is null and ${t.reversalId} is null) or (${t.kind} = 'RETURN' and ${t.quantity}>0 and ${t.admissionId} is not null and ${t.orderId} is not null and ${t.purpose} in ('WARD','TAKE_HOME') and ${t.chargeId} is not null and ${t.originalIssueId} is not null)`)]);
export type PreparedItem = { orderId: string; batchId: string; quantity: string; unit: string; issueIds: string[] };
export const pharmacyPreparations = mysqlTable("pharmacy_preparations", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  version: int("version").notNull(),
  prescriptionVersionId: uuid("prescription_version_id").notNull().references(() => clinicalSummaries.id),
  items: json("items").$type<PreparedItem[]>().notNull(), ...signed(),
}, (t) => [index("pharmacy_preparation_episode_idx").on(t.admissionId), index("pharmacy_preparation_rx_idx").on(t.prescriptionVersionId),uniqueIndex("pharmacy_preparation_version").on(t.admissionId,t.version),check("pharmacy_preparation_positive",sql`${t.version}>0`)]);
