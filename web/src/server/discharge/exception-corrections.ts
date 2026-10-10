import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Transaction } from "../db";
import { DomainError, type CommandContext, type StaffRole } from "../contracts";
import { careEpisode } from "../clinical/commands";
import { clinicalAddenda, clinicalRounds } from "../clinical/schema";
import { nursingAddenda, nursingConsumables, nursingObservations, nursingShifts, medicationAdministrations } from "../nursing/schema";
import { labReportAddenda, labReports } from "../lab/schema";
import { allocateDepositInTransaction, cancelAllocationInTransaction, refundReceiptInTransaction, billingRequest, recordReceiptInTransaction, reverseChargeInTransaction } from "../billing/commands";
import { appendAudit } from "../audit";
export const correctionKinds = ["RECEIPT", "REFUND", "ALLOCATE", "CANCEL_ALLOCATION", "INSURANCE_DECISION", "DISPOSITION_REVIEW", "CLINICAL_ADDENDUM", "NURSING_ADDENDUM", "LAB_ADDENDUM", "LAB_REPORT", "LAB_BILLING", "SELF_PAY_REVIEW", "REVERSE_CHARGE", "CARE_BILLING"] as const;
export type CorrectionKind = typeof correctionKinds[number];
export function correctionRoles(kind: CorrectionKind): readonly StaffRole[] {
  if (kind === "CARE_BILLING") return ["DOCTOR", "NURSE"];
  if (kind === "CLINICAL_ADDENDUM" || kind === "DISPOSITION_REVIEW")
    return ["DOCTOR"];
  if (kind === "NURSING_ADDENDUM")
    return ["NURSE"];
  if (kind === "LAB_ADDENDUM" || kind === "LAB_REPORT" || kind === "LAB_BILLING")
    return ["LAB"];
  if (kind === "INSURANCE_DECISION")
    return ["ADMIN", "BILLING", "INSURANCE"];
  return ["ADMIN", "BILLING"];
}
/** Exact retained source, checked when routing and again before applying. */
export async function validateCorrectionSource(tx: Transaction, admissionId: string, kind: CorrectionKind, sourceId: string) {
  const queries = {
    REVERSE_CHARGE: sql`select id from hims.charges where id=${sourceId} and admission_id=${admissionId} and category<>'room' and source_event_id not like 'room:%'`,
    CARE_BILLING: sql`select b.id from hims.care_billing_events b where b.id=${sourceId} and b.admission_id=${admissionId} and ((b.category='consultation' and exists(select 1 from hims.clinical_rounds r where r.id=b.round_id and r.admission_id=b.admission_id)) or (b.category='consumable' and exists(select 1 from hims.nursing_consumables n where n.id=b.id and n.admission_id=b.admission_id)))`,
    DISPOSITION_REVIEW: sql `select id from hims.exceptional_departures where id=${sourceId} and admission_id=${admissionId}`,
    INSURANCE_DECISION: sql `select id from hims.insurance_cases where id=${sourceId} and admission_id=${admissionId}`,
    REFUND: sql `select id from hims.receipts where id=${sourceId} and admission_id=${admissionId}`,
    ALLOCATE: sql `select id from hims.receipts where id=${sourceId} and admission_id=${admissionId} and party='PATIENT' and kind<>'PAYMENT'`,
    CANCEL_ALLOCATION: sql `select a.id from hims.receipt_allocations a join hims.receipts r on r.id=a.receipt_id where a.id=${sourceId} and r.admission_id=${admissionId}`,
    RECEIPT: sql `select id from hims.departures where id=${sourceId} and admission_id=${admissionId} union all select id from hims.exceptional_departures where id=${sourceId} and admission_id=${admissionId}`,
    CLINICAL_ADDENDUM: sql `select id from hims.clinical_rounds where id=${sourceId} and admission_id=${admissionId}`,
    NURSING_ADDENDUM: sql `select id from hims.nursing_shifts where id=${sourceId} and admission_id=${admissionId} union all select id from hims.nursing_observations where id=${sourceId} and admission_id=${admissionId} union all select id from hims.medication_administrations where id=${sourceId} and admission_id=${admissionId} union all select id from hims.nursing_consumables where id=${sourceId} and admission_id=${admissionId}`,
    LAB_ADDENDUM: sql `select id from hims.lab_reports where id=${sourceId} and admission_id=${admissionId}`,
    LAB_BILLING: sql `select r.order_id from hims.lab_reports r join hims.lab_processing p on p.order_id=r.order_id where r.order_id=${sourceId} and r.admission_id=${admissionId}`,
    SELF_PAY_REVIEW: sql `select c.id from hims.insurance_conversions c join hims.insurance_cases i on i.id=c.case_id where c.id=${sourceId} and i.admission_id=${admissionId}`,
    LAB_REPORT: sql `select o.id from hims.clinical_orders o join hims.lab_processing p on p.order_id=o.id where o.id=${sourceId} and o.admission_id=${admissionId} and o.kind in ('LAB','RADIOLOGY')`,
  };
  if (!(await tx.execute(queries[kind])).rows.length)
    throw new DomainError("VALIDATION", "Correction requires this episode's retained original source");
}
export async function applyCorrectionEffect(tx: Transaction, ctx: CommandContext, staff: {
  id: string;
  role: string;
}, v: {
  admissionId: string;
  exceptionId: string;
  kind: CorrectionKind;
  sourceId: string;
  data: Record<string, unknown>;
}): Promise<{
  id: string;
}> {
  await validateCorrectionSource(tx, v.admissionId, v.kind, v.sourceId);
  if (v.kind === "REVERSE_CHARGE") {
    const data = z.strictObject({ amountPaise: z.string().regex(/^\d+$/), reason: z.string().trim().min(3).max(500), expectedBillVersion: z.number().int().positive() }).parse(v.data);
    return billingRequest(tx, ctx, "exception.charge-reversed", v, () => reverseChargeInTransaction(tx, ctx, { chargeId: v.sourceId, ...data }, v.exceptionId));
  }
  if (v.kind === "CARE_BILLING") {
    if (v.data.sourceEventId !== v.sourceId) throw new DomainError("VALIDATION", "Fee resolution must bind the authorized original care source");
    const { resolveCareBillingInTransaction } = await import("../clinical/commands");
    return resolveCareBillingInTransaction(tx, ctx, v.data, v.exceptionId);
  }
  if (v.kind === "RECEIPT") {
    if (v.data.admissionId !== v.admissionId || v.data.requestId !== ctx.requestId)
      throw new DomainError("VALIDATION", "Correction cash must belong to this episode and request");
    return recordReceiptInTransaction(tx, ctx, v.data, v.exceptionId);
  }
  if (v.kind === "INSURANCE_DECISION") {
    if (v.data.caseId !== v.sourceId || v.data.requestId !== ctx.requestId)
      throw new DomainError("VALIDATION", "Later external decision must bind its actual original case");
    const { recordPayerDecisionInTransaction } = await import("../insurance/commands");
    return recordPayerDecisionInTransaction(tx, ctx, v.data, v.exceptionId);
  }
  if (v.kind === "ALLOCATE") {
    const data = z.strictObject({ amountPaise: z.string().regex(/^\d+$/), reason: z.string().trim().min(3).max(500) }).parse(v.data);
    return billingRequest(tx, ctx, "exception.deposit-allocated", v, () => allocateDepositInTransaction(tx, ctx, { ...data, receiptId: v.sourceId }, v.exceptionId));
  }
  if (v.kind === "REFUND" || v.kind === "CANCEL_ALLOCATION") {
    const field = v.kind === "REFUND" ? "receiptId" : "allocationId";
    if ((v.data[field] && v.data[field] !== v.sourceId) || (v.data.requestId && v.data.requestId !== ctx.requestId))
      throw new DomainError("VALIDATION", "Cash correction must bind the authorized original source and request");
    const data = {
      ...v.data, [field]: v.sourceId, requestId: ctx.requestId
    };
    return v.kind === "REFUND" ? refundReceiptInTransaction(tx, ctx, data, v.exceptionId) : cancelAllocationInTransaction(tx, ctx, data, v.exceptionId);
  }
  if (v.kind === "LAB_BILLING") {
    if (v.data.orderId !== v.sourceId || v.data.requestId !== ctx.requestId)
      throw new DomainError("VALIDATION", "Fee resolution must bind the authorized reported order");
    const { resolveLabBillingInTransaction } = await import("../lab/commands");
    return resolveLabBillingInTransaction(tx, ctx, v.data, v.exceptionId);
  }
  if (v.kind === "SELF_PAY_REVIEW") {
    if (v.data.admissionId !== v.admissionId || v.data.requestId !== ctx.requestId)
      throw new DomainError("VALIDATION", "Self-pay review must bind this episode and request");
    const { reviewSelfPayResponsibilityInTransaction } = await import("../billing/commands");
    return reviewSelfPayResponsibilityInTransaction(tx, ctx, v.data, v.exceptionId);
  }
  if (v.kind === "LAB_REPORT") {
    if (v.data.orderId !== v.sourceId || v.data.requestId !== ctx.requestId)
      throw new DomainError("VALIDATION", "Report must bind the authorized original diagnostic order");
    const { recordLabReportInTransaction } = await import("../lab/commands");
    return recordLabReportInTransaction(tx, ctx, v.data, v.exceptionId);
  }
  if (v.kind === "CLINICAL_ADDENDUM" || v.kind === "NURSING_ADDENDUM" || v.kind === "DISPOSITION_REVIEW")
    await careEpisode(tx, staff, v.admissionId, false);
  const text = z.string().trim().min(3).max(5000);
  const data = z.strictObject({
    text, reason: text, recordType: z.enum(["MAR", "OBSERVATION", "SHIFT", "CONSUMABLE"]).optional()
  }).parse(v.data);
  return billingRequest(tx, ctx, "exception.professional-addendum", v, async () => {
    const signature = { signedBy: staff.id, signedAt: new Date() };
    let id: string;
    if (v.kind === "DISPOSITION_REVIEW") {
      const { exceptionEvidence } = await import("./exception-schema");
      const [record] = await tx.insert(exceptionEvidence).values({
        admissionId: v.admissionId, exceptionId: v.exceptionId, sourceId: v.sourceId, kind: "PROFESSIONAL_REVIEW", role: "DOCTOR", actualAt: signature.signedAt, notes: data.text, ...signature
      }).returning();
      id = record.id;
    }
    else if (v.kind === "CLINICAL_ADDENDUM") {
      const [source] = await tx.select().from(clinicalRounds).where(and(eq(clinicalRounds.id, v.sourceId), eq(clinicalRounds.admissionId, v.admissionId)));
      if (!source)
        throw new DomainError("FORBIDDEN", "Original clinical note access denied");
      const [record] = await tx.insert(clinicalAddenda).values({
        noteId: source.id, text: data.text, reason: data.reason, ...signature
      }).returning();
      id = record.id;
    }
    else if (v.kind === "NURSING_ADDENDUM") {
      if (!data.recordType)
        throw new DomainError("VALIDATION", "Select the original nursing record type");
      const table = {
        MAR: medicationAdministrations, OBSERVATION: nursingObservations, SHIFT: nursingShifts, CONSUMABLE: nursingConsumables
      }[data.recordType];
      const [source] = await tx.select({ id: table.id }).from(table).where(and(eq(table.id, v.sourceId), eq(table.admissionId, v.admissionId)));
      if (!source)
        throw new DomainError("FORBIDDEN", "Original nursing source type does not match");
      const [record] = await tx.insert(nursingAddenda).values({
        admissionId: v.admissionId, recordId: source.id, recordType: data.recordType, text: data.text, reason: data.reason, ...signature
      }).returning();
      id = record.id;
    }
    else {
      const [source] = await tx.select().from(labReports).where(and(eq(labReports.id, v.sourceId), eq(labReports.admissionId, v.admissionId)));
      if (!source)
        throw new DomainError("FORBIDDEN", "Original diagnostic report access denied");
      const [record] = await tx.insert(labReportAddenda).values({
        reportId: source.id, text: data.text, reason: data.reason, ...signature
      }).returning();
      id = record.id;
    }
    await appendAudit(tx, ctx, {
      event: "exception.professional-addendum", entityType: "professional-addendum", entityId: id, reason: data.reason
    });
    return { id };
  });
}
