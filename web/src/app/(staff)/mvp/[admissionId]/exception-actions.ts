"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { DomainError } from "@/server/contracts";
import { hospitalFormInstant } from "@/server/hospital-time";
import { recordMvpException } from "@/server/mvp/exceptions";
import type { CareState } from "@/components/care-forms";
const field = (form: FormData, name: string) => String(form.get(name) ?? "");
export async function saveMvpException(admissionId: string, expectedReviewHash: string, operation: string, authorityId: string, requestId: string, _previous: CareState, form: FormData): Promise<CareState> {
  try {
    const ctx = { ...staffContext(await requireStaff(), "mvp-exception-form"), requestId }, common = { admissionId, expectedReviewHash, requestId, action: operation };
    const instant = (name: string) => hospitalFormInstant(field(form, name), field(form, "hospitalTimezone"));
    let payload: Record<string, unknown>;
    if (operation === "clinical") payload = { type: field(form, "type"), authorizerName: field(form, "authorizerName"), sourceTime: await instant("sourceTime"), evidence: field(form, "evidence"), notes: field(form, "notes"), ...(field(form, "sourceId") ? { sourceId: field(form, "sourceId") } : {}) };
    else if (operation === "authorize") payload = { type: field(form, "type"), clinicalId: field(form, "clinicalId"), authority: field(form, "authority"), reason: field(form, "reason"), evidence: field(form, "evidence"), followUpOwnerId: field(form, "followUpOwnerId"), ...(field(form, "sourceId") ? { sourceId: field(form, "sourceId") } : {}) };
    else if (operation === "follow-up") payload = { authorityId, ownerId: field(form, "ownerId"), note: field(form, "note") };
    else if (operation === "vacancy") payload = { clinicalId: field(form, "clinicalId"), shiftId: field(form, "shiftId"), vacatedAt: await instant("vacatedAt"), waitingLocation: field(form, "waitingLocation"), handover: field(form, "handover") };
    else if (operation === "deliver") payload = { authorityId, documentId: field(form, "documentId"), recipient: field(form, "recipient"), deliveredAt: await instant("deliveredAt"), evidence: field(form, "evidence") };
    else if (operation === "exit") payload = { authorityId, shiftId: field(form, "shiftId"), departedAt: await instant("departedAt") };
    else if (operation === "return") payload = { authorityId, shiftId: field(form, "shiftId"), returnedAt: await instant("returnedAt"), handover: field(form, "handover") };
    else throw new DomainError("VALIDATION", "Choose a supported exception action");
    await recordMvpException(ctx, { ...common, ...payload });
    for (const path of [`/mvp/${admissionId}`, `/patients/${admissionId}`, "/exceptions", "/nursing", "/overview", "/admin/beds", "/billing", "/discharge"]) revalidatePath(path);
    return { message: operation === "exit" ? "Actual exceptional exit recorded. Missing approvals, unpaid amounts and follow-up remain retained." : operation === "return" ? "Actual return and nursing handover recorded. The previous vacancy and exact new room-use boundary remain retained." : "Exception source recorded with named authority, separate staff recorder and accountable follow-up." };
  } catch (error) { return { error: true, message: error instanceof DomainError ? error.message : error instanceof ZodError ? "Check the named external authority, original source, actual time and follow-up owner." : "Unable to record exception. Refresh the current sources and try again." }; }
}
