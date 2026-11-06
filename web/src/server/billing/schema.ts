import { sql } from "drizzle-orm";
import { bigint, check, index, int, json, mysqlTable, text, uniqueIndex } from "drizzle-orm/mysql-core";
import { uuid, uuidDefault, utc, utcNow, key } from "../schema/columns";
import { hospitalSettings, settingVersions } from "../schema/core";
import { admissions } from "../admissions/schema";
const time = () => utc("created_at").notNull().default(utcNow);
const amount = () => bigint("amount_paise", { mode: "bigint" }).notNull();
const actor = () => ({ actorType: text("actor_type").notNull(), actorId: key("actor_id").notNull(), createdAt: time() });
export const charges = mysqlTable("charges", {
  id: uuid("id").primaryKey().default(uuidDefault),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  sourceEventId: key("source_event_id").notNull(),
  sourcePayload: text("source_payload").notNull(),
  category: text("category").notNull(),
  itemId: text("item_id").notNull(),
  description: text("description").notNull(),
  quantity: text("quantity").notNull(),
  unit: text("unit").notNull(),
  tariffVersionId: uuid("tariff_version_id").notNull().references(() => settingVersions.id),
  ratePaise: bigint("rate_paise", { mode: "bigint" }).notNull(),
  amountPaise: amount(),
  initialStatus: text("initial_status", { enum: ["PENDING", "FINAL"] }).notNull(),
  correctionExceptionId: uuid("correction_exception_id"),
  ...actor(),
}, (t) => [uniqueIndex("charge_source_unique").on(t.admissionId, t.sourceEventId), index("charges_admission_idx").on(t.admissionId), check("charge_amount", sql `${t.amountPaise} >= 0 and ${t.ratePaise} >= 0`), check("charge_status", sql `${t.initialStatus} in ('PENDING','FINAL')`), check("charge_actor", sql `(${t.actorType}='staff' and char_length(trim(${t.actorId}))>0) or (${t.actorType}='system' and ${t.actorId}='room-charge' and ${t.category}='room')`)]);
export const chargeFinalizations = mysqlTable("charge_finalizations", {
  id: uuid("id").primaryKey().default(uuidDefault),
  chargeId: uuid("charge_id").notNull().references(() => charges.id),
  ...actor(),
}, (t) => [uniqueIndex("charge_finalize_once").on(t.chargeId)]);
export const chargeReversals = mysqlTable("charge_reversals", {
  id: uuid("id").primaryKey().default(uuidDefault),
  chargeId: uuid("charge_id").notNull().references(() => charges.id),
  amountPaise: amount(), reason: text("reason").notNull(), ...actor(),
  correctionExceptionId: uuid("correction_exception_id"),
  physicalAmendmentId: uuid("physical_amendment_id"),
}, (t) => [index("charge_reversal_idx").on(t.chargeId), check("reversal_amount", sql `${t.amountPaise} > 0`)]);
export const receipts = mysqlTable("receipts", {
  id: uuid("id").primaryKey().default(uuidDefault),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitalSettings.id),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  party: text("party", { enum: ["PATIENT", "INSURER"] }).notNull(),
  kind: text("kind", { enum: ["DEPOSIT", "TOP_UP", "PAYMENT"] }).notNull(),
  amountPaise: amount(),
  mode: key("mode", 64).notNull(), channel: key("channel", 64).notNull(), sourceReference: key("source_reference").notNull(),
  reference: text("reference").notNull(), evidenceId: text("evidence_id"),
  identityPayload: text("identity_payload").notNull(), ...actor(),
}, (t) => [uniqueIndex("receipt_cash_identity").on(t.hospitalId, t.mode, t.channel, t.sourceReference), index("receipts_admission_idx").on(t.admissionId), check("receipt_amount", sql `${t.amountPaise}>0`), check("receipt_party_kind", sql `(${t.party}='PATIENT' and ${t.kind} in ('DEPOSIT','TOP_UP','PAYMENT')) or (${t.party}='INSURER' and ${t.kind}='PAYMENT')`), check("receipt_mode", sql `${t.mode} in ('CASH','CARD','UPI','BANK')`), check("receipt_human", sql `${t.actorType}='staff' and char_length(trim(${t.actorId}))>0`)]);
export const receiptAllocations = mysqlTable("receipt_allocations", {
  id: uuid("id").primaryKey().default(uuidDefault),
  receiptId: uuid("receipt_id").notNull().references(() => receipts.id),
  amountPaise: amount(), reason: text("reason").notNull(), ...actor(),
}, (t) => [index("receipt_allocation_idx").on(t.receiptId), check("allocation_amount", sql `${t.amountPaise}>0`)]);
export const billingRequests = mysqlTable("billing_requests", {
  id: uuid("id").primaryKey().default(uuidDefault),
  actorId: key("actor_id").notNull(), requestId: uuid("request_id").notNull(), action: text("action").notNull(), payload: text("payload").notNull(),
  result: json("result").$type<{
    id: string;
  }>().notNull(), createdAt: time(),
}, (t) => [uniqueIndex("billing_request_actor_key").on(t.actorId, t.requestId)]);
export const receiptRefunds = mysqlTable("receipt_refunds", {
  id: uuid("id").primaryKey().default(uuidDefault), hospitalId: uuid("hospital_id").notNull().references(() => hospitalSettings.id),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id), receiptId: uuid("receipt_id").notNull().references(() => receipts.id),
  amountPaise: amount(), mode: key("mode", 64).notNull(), channel: key("channel", 64).notNull(), sourceReference: key("source_reference").notNull(),
  evidence: text("evidence").notNull(), reason: text("reason").notNull(), refundedAt: utc("refunded_at").notNull(),
  reviewedHash: text("reviewed_hash").notNull(), reviewedBillVersion: int("reviewed_bill_version").notNull(), identityPayload: text("identity_payload").notNull(), ...actor(),
}, t => [index("refund_receipt").on(t.receiptId), index("refund_episode").on(t.admissionId), uniqueIndex("refund_cash_identity").on(t.hospitalId,t.mode,t.channel,t.sourceReference), check("refund_amount", sql`${t.amountPaise}>0`), check("refund_mode", sql`${t.mode} in ('CASH','CARD','UPI','BANK')`), check("refund_staff", sql`${t.actorType}='staff'`)]);
export const allocationCancellations = mysqlTable("allocation_cancellations", {
  id: uuid("id").primaryKey().default(uuidDefault), allocationId: uuid("allocation_id").notNull().references(() => receiptAllocations.id),
  reason: text("reason").notNull(), reviewedHash: text("reviewed_hash").notNull(), reviewedBillVersion: int("reviewed_bill_version").notNull(), ...actor(),
}, t => [uniqueIndex("allocation_cancel_once").on(t.allocationId), check("allocation_cancel_staff", sql`${t.actorType}='staff'`)]);
export const selfPayReviews = mysqlTable("self_pay_reviews", {
  id: uuid("id").primaryKey().default(uuidDefault), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  billBasis: text("bill_basis").notNull(), netPaise: bigint("net_paise", { mode: "bigint" }).notNull(),
  insurerPaise: bigint("insurer_paise", { mode: "bigint" }).notNull(), patientPaise: bigint("patient_paise", { mode: "bigint" }).notNull(),
  reason: text("reason").notNull(), ...actor(),
}, t => [index("self_pay_review_episode").on(t.admissionId), check("self_pay_review_amounts", sql`${t.netPaise}>=0 and ${t.insurerPaise}>=0 and ${t.patientPaise}>=0 and ${t.insurerPaise}+${t.patientPaise}=${t.netPaise}`)]);
