"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { DomainError } from "@/server/contracts";
import { hospitalFormInstant } from "@/server/hospital-time";
import { saveDoctor, assignAvailabilityCoordinator, recordDoctorAvailability } from "@/server/mvp/staff";
import type { CareState } from "@/components/care-forms";
const field = (form: FormData, name: string) => String(form.get(name) ?? "");
export async function saveAvailability(operation: string, requestId: string, _previous: CareState, form: FormData): Promise<CareState> {
  try {
    const ctx = { ...staffContext(await requireStaff(), "doctor-availability-form"), requestId };
    const instant = (name: string) => hospitalFormInstant(field(form, name), field(form, "hospitalTimezone"));
    if (operation === "doctor") await saveDoctor(ctx, { ...(field(form, "id") ? { id: field(form, "id") } : {}), name: field(form, "name"), ...(field(form, "specialty") ? { specialty: field(form, "specialty") } : {}), active: form.get("active") === "true", expectedVersion: Number(field(form, "expectedVersion")), reason: field(form, "reason"), requestId });
    else if (operation === "coordinator") await assignAvailabilityCoordinator(ctx, { nurseId: field(form, "nurseId"), ...(field(form, "backupNurseId") ? { backupNurseId: field(form, "backupNurseId") } : {}), startsAt: await instant("startsAt"), endsAt: await instant("endsAt"), expectedVersion: Number(field(form, "expectedVersion")), reason: field(form, "reason"), requestId });
    else if (operation === "availability") {
      const [doctorId, version] = field(form, "doctor").split("|");
      await recordDoctorAvailability(ctx, { doctorId, expectedVersion: Number(version), status: field(form, "status"), startsAt: await instant("startsAt"), endsAt: await instant("endsAt"), ...(field(form, "expectedReturn") ? { expectedReturn: await instant("expectedReturn") } : {}), remarks: field(form, "remarks"), requestId });
    } else throw new DomainError("VALIDATION", "Choose a supported staff operation");
    for (const path of ["/availability", "/overview", "/admissions", "/admin/staff"]) revalidatePath(path);
    return { message: "Staff operation recorded with author, time and retained history." };
  } catch (error) { return { error: true, message: error instanceof DomainError ? error.message : error instanceof ZodError ? "Check the required names, shift period and reason." : "Unable to save. Refresh the current staff record and try again." }; }
}
