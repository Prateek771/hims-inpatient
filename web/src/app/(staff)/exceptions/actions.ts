"use server";
import { hospitalFormInstant } from "@/server/hospital-time";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { DomainError } from "@/server/contracts";
import { activateAdmission } from "@/server/admissions/commands";
import { endShift } from "@/server/nursing/commands";
import * as exceptions from "@/server/discharge/exceptions";
import { parseINR } from "@/server/billing/money";
import type { CareState } from "@/components/care-forms";

export type ExceptionBinding = { admissionId: string; requestId: string; version: number; billVersion?: number; exceptionId?: string; sourceId?: string; correctionKind?: string; caseVersion?: number; netPaise?: string };
export async function exceptionAction(action: string, b: ExceptionBinding, _prior: CareState, form: FormData): Promise<CareState> {
  const field = (name: string) => String(form.get(name) ?? "");
  const at = (name: string) => hospitalFormInstant(field(name), field("hospitalTimezone"));
  const amount = (name: string) => parseINR(field(name)).toString();
  try {
    const staff = await requireStaff(), ctx = { ...staffContext(staff, "exception-form"), requestId: b.requestId };
    const base = { admissionId: b.admissionId, exceptionId: b.exceptionId };
    if (action === "authorize") {
      await exceptions.authorizeException(ctx, { admissionId: b.admissionId, type: field("type"), disposition: field("disposition"), authority: field("authority"), reason: field("reason"), evidence: field("evidence"), evidenceIds: form.getAll("evidenceIds").map(String), followUpOwnerId: field("followUpOwnerId"), ...(field("sourceId") ? { sourceId: field("sourceId") } : {}), ...(field("correctionKind") ? { correctionKind: field("correctionKind") } : {}) });
    } else if (action === "evidence") {
      await exceptions.recordExceptionEvidence(ctx, { admissionId: b.admissionId, kind: field("kind"), actualAt: await at("actualAt"), notes: field("notes"), ...(field("shiftId") ? { shiftId: field("shiftId") } : {}), ...(field("sourceId") ? { sourceId: field("sourceId") } : {}), ...(field("exceptionId") ? { exceptionId: field("exceptionId") } : {}), ...(field("vacatedAt") ? { vacatedAt: await at("vacatedAt") } : {}) });
    } else if (action === "activate") {
      await activateAdmission(ctx, { ...base, expectedVersion: b.version, arrivedAt: await at("arrivedAt"), requestId: b.requestId });
    } else if (action === "departure") {
      await exceptions.recordExceptionalDeparture(ctx, { ...base, physicalEvidenceId: field("physicalEvidenceId") });
    } else if (action === "attendance") {
      await exceptions.closeUnavailableAttendance(ctx, { ...base, shiftId: b.sourceId, endedAt: await at("endedAt"), evidence: field("evidence") });
    } else if (action === "nurse-attendance") {
      await endShift(ctx, { shiftId: field("shiftId"), endedAt: await at("endedAt"), handover: field("handover") });
    } else if (action === "transfer") {
      await exceptions.applyDelayedTransfer(ctx, { ...base, evidenceId: field("evidenceId"), targetBedId: field("targetBedId") });
    } else if (action === "cutoff") {
      await exceptions.correctRoomCutoff(ctx, { ...base, evidenceId: field("evidenceId") });
    } else if (action === "return") {
      await exceptions.returnToBed(ctx, { ...base, doctorEvidenceId: field("doctorEvidenceId"), nurseEvidenceId: field("nurseEvidenceId") });
    } else if (action === "identify") {
      await exceptions.identifyTemporaryPatient(ctx, { ...base, name: field("name"), ...(field("dateOfBirth") ? { dateOfBirth: field("dateOfBirth") } : {}), ...(field("ageYears") ? { ageYearsAtRegistration: Number(field("ageYears")) } : {}), sex: field("sex"), ...(field("phone") ? { phone: field("phone") } : {}), evidence: field("evidence"), reason: field("reason") });
    } else if (action === "followup") {
      await exceptions.recordExceptionFollowup(ctx, { exceptionId: b.exceptionId, ownerId: field("ownerId"), note: field("note") });
    } else if (action === "cancelled-refund" || action === "amend") {
      const kind = b.correctionKind;
      let data: Record<string, unknown>;
      if (action === "cancelled-refund" || kind === "REFUND") {
        data = { amountPaise: amount("amount"), mode: field("mode"), channel: field("channel"), sourceReference: field("sourceReference"), evidence: field("evidence"), refundedAt: await at("refundedAt"), reason: field("reason"), expectedBillVersion: b.billVersion };
      } else if (kind === "RECEIPT") {
        data = { admissionId: b.admissionId, party: field("party"), kind: field("receiptKind"), amountPaise: amount("amount"), mode: field("mode"), channel: field("channel"), sourceReference: field("sourceReference"), reference: field("reference"), requestId: b.requestId };
      } else if (kind === "ALLOCATE") {
        data = { amountPaise: amount("amount"), reason: field("reason") };
      } else if (kind === "CANCEL_ALLOCATION") {
        data = { reason: field("reason"), expectedBillVersion: b.billVersion };
      } else if (kind === "LAB_BILLING") {
        data = { orderId: b.sourceId, reason: field("reason"), requestId: b.requestId };
      } else if (kind === "REVERSE_CHARGE") {
        data = { amountPaise: amount("amount"), reason: field("reason"), expectedBillVersion: b.billVersion };
      } else if (kind === "CARE_BILLING") {
        data = { sourceEventId: b.sourceId, reason: field("reason"), expectedBillVersion: b.billVersion };
      } else if (kind === "SELF_PAY_REVIEW") {
        data = { admissionId: b.admissionId, reason: field("reason"), expectedBillVersion: b.billVersion, requestId: b.requestId };
      } else if (kind === "LAB_REPORT") {
        data = { orderId: b.sourceId, result: field("result"), ...(field("barcode") ? { barcode: field("barcode") } : {}), requestId: b.requestId };
      } else if (kind === "INSURANCE_DECISION") {
        data = { caseId: b.sourceId, expectedCaseVersion: b.caseVersion, requestId: b.requestId, kind: field("decisionKind"), status: field("status"), reason: field("reason"), approvedPaise: amount("approved"), coPayBps: Number(parseINR(field("coPayPercent"))), verifiedBy: field("verifiedBy"), verifiedAt: await at("verifiedAt"), reference: field("reference"), documentIds: [], allocation: { billRevision: b.billVersion, netBillPaise: b.netPaise, eligibleBillPaise: amount("eligible"), nonPayablePaise: amount("nonPayable"), ...(field("patient") ? { verifiedPatientLiabilityPaise: amount("patient") } : {}), sourceReference: field("sourceReference") } };
      } else {
        data = { text: field("text"), reason: field("reason"), ...(kind === "NURSING_ADDENDUM" ? { recordType: field("recordType") } : {}) };
      }
      if (action === "cancelled-refund") await exceptions.returnCancelledDeposit(ctx, { ...base, ...data, receiptId: b.sourceId, requestId: b.requestId });
      else await exceptions.applyPostDischargeCorrection(ctx, { ...base, kind, sourceId: b.sourceId, data });
    } else throw new DomainError("VALIDATION", "Unknown exception action");
    for (const path of ["/exceptions", "/admissions", "/billing", "/clinical", "/nursing", "/lab", "/pharmacy", "/insurance", "/discharge", "/admin/beds"]) revalidatePath(path);
    return { message: "Recorded with its authority and original evidence. Current obligations are shown below." };
  } catch (error) {
    return { error: true, message: error instanceof DomainError ? error.message : error instanceof ZodError || error instanceof RangeError ? "Check the required details, original source and actual times." : "Unable to save. Refresh the current record and retry." };
  }
}
