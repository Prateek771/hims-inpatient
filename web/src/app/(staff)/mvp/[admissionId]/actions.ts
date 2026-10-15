"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { DomainError } from "@/server/contracts";
import { hospitalFormInstant } from "@/server/hospital-time";
import { recordMvpAction, recordPatientMedicineCharge, acceptPatientMedicineReturn, recordInsurerReceivableReceipt, recordExceptionalReceivableReceipt } from "@/server/mvp/commands";
import { parseINR } from "@/server/billing/money";
import { refundReceipt, cancelAllocation } from "@/server/billing/commands";
import { createMvpDocument } from "@/server/documents/mvp";
import { recordExternalServiceCharge } from "@/server/mvp/services";
import type { CareState } from "@/components/care-forms";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");
export async function saveMvpAction(admissionId: string, expectedReviewHash: string, requestId: string, operation: string, _previous: CareState, form: FormData): Promise<CareState> {
  try {
    const ctx = { ...staffContext(await requireStaff(), "mvp-patient-form"), requestId };
    const instant = (name: string) => hospitalFormInstant(field(form, name), field(form, "hospitalTimezone"));
    const common = { admissionId, expectedReviewHash, requestId, action: operation };
    let payload: Record<string, unknown>;
    if (operation === "doctor-approval") payload = { authorizerName: field(form, "authorizerName"), ...(field(form, "authorizerId") ? { authorizerId: field(form, "authorizerId") } : {}), sourceTime: await instant("sourceTime"), evidence: field(form, "evidence"), clinicalSummary: field(form, "clinicalSummary"), prescription: field(form, "prescription"), followUp: field(form, "followUp") };
    else if (operation === "checklist") payload = { items: field(form, "items").split(/\r?\n/).map(item => item.trim()).filter(Boolean), proposedNa: form.getAll("proposedNa").map(String), remarks: field(form, "remarks") };
    else if (operation === "check") payload = { check: field(form, "check"), status: field(form, "status"), remarks: field(form, "remarks"), ...(field(form, "confirmerName") ? { confirmerName: field(form, "confirmerName") } : {}), ...(field(form, "sourceTime") ? { sourceTime: await instant("sourceTime") } : {}), ...(field(form, "evidence") ? { evidence: field(form, "evidence") } : {}) };
    else if (operation === "n-a") payload = { check: field(form, "check"), reason: field(form, "reason") };
    else if (operation === "vacancy") payload = { shiftId: field(form, "shiftId"), vacatedAt: await instant("vacatedAt"), waitingLocation: field(form, "waitingLocation"), handover: field(form, "handover") };
    else if (operation === "finance") payload = { reason: field(form, "reason") };
    else if (operation === "deliver") payload = { kind: field(form, "kind"), recipient: field(form, "recipient"), deliveredAt: await instant("deliveredAt"), evidence: field(form, "evidence"), ...(field(form, "documentId") ? { documentId: field(form, "documentId") } : {}) };
    else if (operation === "exit") payload = { shiftId: field(form, "shiftId"), departedAt: await instant("departedAt") };
    else if (operation === "generate-paper") {
      await createMvpDocument(ctx, { admissionId, kind: field(form, "kind"), expectedReviewHash });
      payload = {};
    } else if (operation === "refund") {
      await refundReceipt(ctx, { receiptId: field(form, "receiptId"), amountPaise: parseINR(field(form, "amount")).toString(), reason: field(form, "reason"), requestId, expectedReviewHash, expectedBillVersion: Number(field(form, "expectedBillVersion")), mode: field(form, "mode"), channel: field(form, "channel"), sourceReference: field(form, "sourceReference"), evidence: field(form, "evidence"), refundedAt: await instant("refundedAt") });
      payload = {};
    } else if (operation === "cancel-allocation") {
      await cancelAllocation(ctx, { allocationId: field(form, "allocationId"), reason: field(form, "reason"), requestId, expectedReviewHash, expectedBillVersion: Number(field(form, "expectedBillVersion")) });
      payload = {};
    }
    else if (operation === "service-charge") {
      const [category, itemId, unit, expectedTariffVersionId] = field(form, "serviceItem").split("|");
      await recordExternalServiceCharge(ctx, { admissionId, requestId, expectedBillVersion: Number(field(form, "expectedBillVersion")), category, itemId, quantity: field(form, "quantity"), unit, expectedTariffVersionId, performedAt: await instant("performedAt"), departmentIssuer: field(form, "departmentIssuer"), externalBillReference: field(form, "externalBillReference"), externalLineReference: field(form, "externalLineReference"), evidence: field(form, "evidence") });
      payload = {};
    } else if (operation === "medicine-charge") {
      const [itemId, unit, expectedTariffVersionId] = field(form, "medicine").split("|");
      await recordPatientMedicineCharge(ctx, { admissionId, requestId, itemId, unit, expectedTariffVersionId, quantity: field(form, "quantity"), sourceReference: field(form, "sourceReference"), evidence: field(form, "evidence") });
      payload = {};
    } else if (operation === "medicine-return") {
      await acceptPatientMedicineReturn(ctx, { admissionId, requestId, originalChargeId: field(form, "originalChargeId"), quantity: field(form, "quantity"), reason: field(form, "reason"), evidence: field(form, "evidence"), expectedBillVersion: Number(field(form, "expectedBillVersion")) });
      payload = {};
    } else if (operation === "insurer-receipt") {
      await recordInsurerReceivableReceipt(ctx, { admissionId, requestId, party: "INSURER", kind: "PAYMENT", amountPaise: parseINR(field(form, "amount")).toString(), mode: field(form, "mode"), channel: field(form, "channel"), sourceReference: field(form, "sourceReference"), reference: field(form, "reference"), ...(field(form, "evidenceId") ? { evidenceId: field(form, "evidenceId") } : {}) });
      payload = {};
    } else if (operation === "exception-receipt") {
      await recordExceptionalReceivableReceipt(ctx, { admissionId, requestId, party: field(form, "party"), kind: "PAYMENT", amountPaise: parseINR(field(form, "amount")).toString(), mode: field(form, "mode"), channel: field(form, "channel"), sourceReference: field(form, "sourceReference"), reference: field(form, "reference"), evidenceId: field(form, "evidenceId") });
      payload = {};
    } else throw new DomainError("VALIDATION", "Choose a supported patient action");
    if (!["service-charge", "medicine-charge", "medicine-return", "insurer-receipt", "exception-receipt", "generate-paper", "refund", "cancel-allocation"].includes(operation)) await recordMvpAction(ctx, { ...common, ...payload });
    for (const path of ["/overview", "/nursing", "/pharmacy", "/billing", "/insurance", "/discharge", `/mvp/${admissionId}`, `/patients/${admissionId}`]) revalidatePath(path);
    return { message: operation === "service-charge" ? "Performed service billing evidence and configured-price charge recorded. Original issuer, bill and line references are retained." : operation === "generate-paper" ? "Authorized paper version generated. Review the protected saved version before actual delivery." : operation === "medicine-return" ? "Accepted return credited to the bill. A cash refund is recorded separately by Billing." : operation === "exception-receipt" ? "Actual payment recorded against the original exception receivable. Historical exit and saved papers are unchanged." : operation === "insurer-receipt" ? "Actual insurer receipt recorded against the retained receivable. Historical exit is unchanged." : "Recorded. Current sources and dependent approvals have been refreshed." };
  } catch (error) {
    return { error: true, message: error instanceof DomainError ? error.message : error instanceof ZodError ? "Check required fields, dates and evidence, then try again." : "Unable to save. Refresh the patient record and try again." };
  }
}
