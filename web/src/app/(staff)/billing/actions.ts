"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { activateAdmission } from "@/server/admissions/commands";
import { allocateDeposit, recordReceipt, reconcileBill, reverseCharge } from "@/server/billing/commands";
import { parseINR } from "@/server/billing/money";
import { DomainError } from "@/server/contracts";
export type BillingActionState = {
  message: string;
  error?: boolean;
};
const field = (form: FormData, key: string) => String(form.get(key) ?? "");
function failure(error: unknown): BillingActionState {
  return { error: true, message: error instanceof DomainError ? error.message : error instanceof ZodError ? "Check the fields and try again." : "Unable to save. Refresh and try again." };
}
function refresh(admissionId: string) { revalidatePath("/billing"); revalidatePath(`/patients/${admissionId}`); revalidatePath("/admissions"); }
export async function saveManualReceipt(admissionId: string, requestId: string, _previous: BillingActionState, form: FormData): Promise<BillingActionState> {
  try {
    const staff = await requireStaff();
    await recordReceipt({ ...staffContext(staff, "manual-receipt-form"), requestId }, {
      admissionId, requestId, party: field(form, "party"), kind: field(form, "kind"), amountPaise: parseINR(field(form, "amount")).toString(), mode: field(form, "mode"), channel: field(form, "channel"), sourceReference: field(form, "sourceReference"), reference: field(form, "reference"), ...(field(form, "evidenceId") ? { evidenceId: field(form, "evidenceId") } : {})
    });
    refresh(admissionId);
    return { message: "Manual receipt recorded. HIMS has not verified bank receipt." };
  }
  catch (error) {
    return failure(error);
  }
}
export async function saveAllocation(admissionId: string, receiptId: string, requestId: string, _previous: BillingActionState, form: FormData): Promise<BillingActionState> {
  try {
    await allocateDeposit({ ...staffContext(await requireStaff(), "allocation-form"), requestId }, {
      receiptId, requestId, amountPaise: parseINR(field(form, "amount")).toString(), reason: field(form, "reason")
    });
    refresh(admissionId);
    return { message: "Deposit allocated. Cash received is unchanged." };
  }
  catch (error) {
    return failure(error);
  }
}
export async function saveReversal(admissionId: string, chargeId: string, requestId: string, _previous: BillingActionState, form: FormData): Promise<BillingActionState> {
  try {
    await reverseCharge({ ...staffContext(await requireStaff(), "reversal-form"), requestId }, {
      chargeId, requestId, amountPaise: parseINR(field(form, "amount")).toString(), reason: field(form, "reason")
    });
    refresh(admissionId);
    return { message: "Linked charge reversal recorded. Original entry retained." };
  }
  catch (error) {
    return failure(error);
  }
}
export async function startAdmission(admissionId: string, expectedVersion: number, requestId: string, _previous: BillingActionState, form: FormData): Promise<BillingActionState> {
  try {
    await activateAdmission({ ...staffContext(await requireStaff(), "activation-form"), requestId }, {
      admissionId, expectedVersion, requestId, arrivedAt: new Date(`${field(form, "arrivedAt")}Z`).toISOString()
    });
    refresh(admissionId);
    return { message: "Admission activated. The occupied room stay has started." };
  }
  catch (error) {
    return failure(error);
  }
}
export async function postRoomThroughNow(admissionId: string, cutoff: string, requestId: string, _previous: BillingActionState, _form: FormData): Promise<BillingActionState> {
  void _previous;
  void _form;
  try {
    await reconcileBill({ ...staffContext(await requireStaff(), "billing-reconciliation"), requestId }, { admissionId, cutoff });
    refresh(admissionId);
    return { message: "Room charges posted through the recorded cutoff." };
  }
  catch (error) {
    return failure(error);
  }
}
