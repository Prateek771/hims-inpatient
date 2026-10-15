"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { DomainError } from "@/server/contracts";
import { hospitalFormInstant } from "@/server/hospital-time";
import { recordMvpTransferAuthority, executeMvpTransfer, cancelMvpTransferAuthority } from "@/server/mvp/transfers";
import type { CareState } from "@/components/care-forms";
const field = (form: FormData, name: string) => String(form.get(name) ?? "");
export async function saveMvpTransfer(admissionId: string, operation: string, expectedVersion: number, authorityId: string, requestId: string, _previous: CareState, form: FormData): Promise<CareState> {
  try {
    const ctx = { ...staffContext(await requireStaff(), "mvp-transfer-form"), requestId };
    const instant = (name: string) => hospitalFormInstant(field(form, name), field(form, "hospitalTimezone"));
    if (operation === "record") await recordMvpTransferAuthority(ctx, { admissionId, externalDoctorId: field(form, "externalDoctorId"), authorizerName: field(form, "authorizerName"), sourceTime: await instant("sourceTime"), evidence: field(form, "evidence"), destinationCategory: field(form, "destinationCategory"), expectedVersion, reason: field(form, "reason"), requestId });
    else if (operation === "execute") await executeMvpTransfer(ctx, { admissionId, authorityId, targetBedId: field(form, "targetBedId"), shiftId: field(form, "shiftId"), handover: field(form, "handover"), transferredAt: await instant("transferredAt"), requestId });
    else if (operation === "cancel") await cancelMvpTransferAuthority(ctx, { admissionId, authorityId, externalDoctorId: field(form, "externalDoctorId"), authorizerName: field(form, "authorizerName"), sourceTime: await instant("sourceTime"), evidence: field(form, "evidence"), reason: field(form, "reason"), requestId });
    else throw new DomainError("VALIDATION", "Choose a supported transfer action");
    for (const path of [`/mvp/${admissionId}`, `/patients/${admissionId}`, "/nursing", "/overview", "/admin/beds", "/billing", "/insurance"]) revalidatePath(path);
    return { message: operation === "execute" ? "Actual transfer and handover recorded. Exact old/new room boundaries and charge sources are retained." : "External transfer instruction recorded with its authorizer and separate staff recorder." };
  } catch (error) { return { error: true, message: error instanceof DomainError ? error.message : error instanceof ZodError ? "Check the named authority, destination, actual time and handover." : "Unable to record transfer. Refresh the patient and review current bed availability." }; }
}
