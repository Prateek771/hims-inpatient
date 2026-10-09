import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { hims, hospitalSettings, settingVersions } from "../schema/core";
import { admissions } from "../admissions/schema";
const time = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const amount = () => bigint("amount_paise", { mode: "bigint" }).notNull();
const actor = () => ({ actorType: text("actor_type").notNull(), actorId: text("actor_id").notNull(), createdAt: time() });
export const charges = hims.table("charges", {
  id: uuid("id").primaryKey().defaultRandom(),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  sourceEventId: text("source_event_id").notNull(),
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
  ...actor(),
}, (t) => [uniqueIndex("charge_source_unique").on(t.admissionId, t.sourceEventId), index("charges_admission_idx").on(t.admissionId), check("charge_amount", sql `${t.amountPaise} >= 0 and ${t.ratePaise} >= 0`), check("charge_status", sql `${t.initialStatus} in ('PENDING','FINAL')`), check("charge_actor", sql `(${t.actorType}='staff' and length(trim(${t.actorId}))>0) or (${t.actorType}='system' and ${t.actorId}='room-charge' and ${t.category}='room')`)]);
export const chargeFinalizations = hims.table("charge_finalizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  chargeId: uuid("charge_id").notNull().references(() => charges.id),
  ...actor(),
}, (t) => [uniqueIndex("charge_finalize_once").on(t.chargeId)]);
export const chargeReversals = hims.table("charge_reversals", {
  id: uuid("id").primaryKey().defaultRandom(),
  chargeId: uuid("charge_id").notNull().references(() => charges.id),
  amountPaise: amount(), reason: text("reason").notNull(), ...actor(),
}, (t) => [index("charge_reversal_idx").on(t.chargeId), check("reversal_amount", sql `${t.amountPaise} > 0`)]);
export const receipts = hims.table("receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  hospitalId: uuid("hospital_id").notNull().references(() => hospitalSettings.id),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  party: text("party", { enum: ["PATIENT", "INSURER"] }).notNull(),
  kind: text("kind", { enum: ["DEPOSIT", "TOP_UP", "PAYMENT"] }).notNull(),
  amountPaise: amount(),
  mode: text("mode").notNull(), channel: text("channel").notNull(), sourceReference: text("source_reference").notNull(),
  reference: text("reference").notNull(), evidenceId: text("evidence_id"),
  identityPayload: text("identity_payload").notNull(), ...actor(),
}, (t) => [uniqueIndex("receipt_cash_identity").on(t.hospitalId, t.mode, t.channel, t.sourceReference), index("receipts_admission_idx").on(t.admissionId), check("receipt_amount", sql `${t.amountPaise}>0`), check("receipt_party_kind", sql `(${t.party}='PATIENT' and ${t.kind} in ('DEPOSIT','TOP_UP','PAYMENT')) or (${t.party}='INSURER' and ${t.kind}='PAYMENT')`), check("receipt_mode", sql `${t.mode} in ('CASH','CARD','UPI','BANK')`), check("receipt_human", sql `${t.actorType}='staff' and length(trim(${t.actorId}))>0`)]);
export const receiptAllocations = hims.table("receipt_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull().references(() => receipts.id),
  amountPaise: amount(), reason: text("reason").notNull(), ...actor(),
}, (t) => [index("receipt_allocation_idx").on(t.receiptId), check("allocation_amount", sql `${t.amountPaise}>0`)]);
export const billingRequests = hims.table("billing_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: text("actor_id").notNull(), requestId: uuid("request_id").notNull(), action: text("action").notNull(), payload: text("payload").notNull(),
  result: jsonb("result").$type<{
    id: string;
  }>().notNull(), createdAt: time(),
}, (t) => [uniqueIndex("billing_request_actor_key").on(t.actorId, t.requestId)]);
export const receiptRefunds = hims.table("receipt_refunds", {
  id: uuid("id").primaryKey().defaultRandom(), hospitalId: uuid("hospital_id").notNull().references(() => hospitalSettings.id),
  admissionId: uuid("admission_id").notNull().references(() => admissions.id), receiptId: uuid("receipt_id").notNull().references(() => receipts.id),
  amountPaise: amount(), mode: text("mode").notNull(), channel: text("channel").notNull(), sourceReference: text("source_reference").notNull(),
  evidence: text("evidence").notNull(), reason: text("reason").notNull(), refundedAt: timestamp("refunded_at", { withTimezone: true }).notNull(),
  reviewedHash: text("reviewed_hash").notNull(), reviewedBillVersion: integer("reviewed_bill_version").notNull(), identityPayload: text("identity_payload").notNull(), ...actor(),
}, t => [index("refund_receipt").on(t.receiptId), index("refund_episode").on(t.admissionId), uniqueIndex("refund_cash_identity").on(t.hospitalId,t.mode,t.channel,t.sourceReference), check("refund_amount", sql`${t.amountPaise}>0`), check("refund_mode", sql`${t.mode} in ('CASH','CARD','UPI','BANK')`), check("refund_staff", sql`${t.actorType}='staff'`)]);
export const allocationCancellations = hims.table("allocation_cancellations", {
  id: uuid("id").primaryKey().defaultRandom(), allocationId: uuid("allocation_id").notNull().references(() => receiptAllocations.id),
  reason: text("reason").notNull(), reviewedHash: text("reviewed_hash").notNull(), reviewedBillVersion: integer("reviewed_bill_version").notNull(), ...actor(),
}, t => [uniqueIndex("allocation_cancel_once").on(t.allocationId), check("allocation_cancel_staff", sql`${t.actorType}='staff'`)]);
export const selfPayReviews = hims.table("self_pay_reviews", {
  id: uuid("id").primaryKey().defaultRandom(), admissionId: uuid("admission_id").notNull().references(() => admissions.id),
  billBasis: text("bill_basis").notNull(), netPaise: bigint("net_paise", { mode: "bigint" }).notNull(),
  insurerPaise: bigint("insurer_paise", { mode: "bigint" }).notNull(), patientPaise: bigint("patient_paise", { mode: "bigint" }).notNull(),
  reason: text("reason").notNull(), ...actor(),
}, t => [index("self_pay_review_episode").on(t.admissionId), check("self_pay_review_amounts", sql`${t.netPaise}>=0 and ${t.insurerPaise}>=0 and ${t.patientPaise}>=0 and ${t.insurerPaise}+${t.patientPaise}=${t.netPaise}`)]);
