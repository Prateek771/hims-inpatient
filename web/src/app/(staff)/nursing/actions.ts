"use server";
import { hospitalFormInstant } from "@/server/hospital-time";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import {
  completeClinicalTask,
  resolveCareBilling,
} from "@/server/clinical/commands";
import {
  addNursingAddendum,
  assignNurse,
  revokeNurseAssignment,
  endShift,
  recordAdministration,
  recordConsumable,
  recordObservation,
  recordShift,
} from "@/server/nursing/commands";
import { DomainError } from "@/server/contracts";
import type { CareState } from "@/components/care-forms";
import { transferAdmission } from "@/server/admissions/commands";
const field = (form: FormData, name: string) => String(form.get(name) ?? "");
const timestamp = (form: FormData, name: string) =>
  hospitalFormInstant(field(form, name), field(form, "hospitalTimezone"));
export async function saveNursing(
  admissionId: string,
  requestId: string,
  operation:
    | "assign"
    | "revoke"
    | "start"
    | "end"
    | "mar"
    | "observation"
    | "consumable"
    | "diet"
    | "billing"
    | "addendum"
    | "transfer",
  targetId: string,
  shiftId: string,
  scheduledAt: string,
  _previous: CareState,
  form: FormData,
): Promise<CareState> {
  try {
    const ctx = {
      ...staffContext(await requireStaff(), "nursing-form"),
      requestId,
    };
    let message = "";
    const recordingShiftId = field(form, "recordingShiftId") || shiftId;
    if (operation === "transfer") {
      await transferAdmission(ctx, { admissionId, transferOrderId: targetId, targetBedId: field(form, "targetBedId"), transferredAt: await timestamp(form, "transferredAt"), handover: { shiftId, notes: field(form, "handover") }, requestId });
      message = "Transfer and actual handover signed. Exact room stays and charges retained; monitoring continues.";
    } else if (operation === "revoke") {
      await revokeNurseAssignment(ctx, {
        assignmentId: targetId,
        reason: field(form, "reason"),
        authority: field(form, "authority"),
      });
      message =
        "Assignment revoked. History and unfinished care remain available to current assigned staff.";
    } else if (operation === "assign") {
      await assignNurse(ctx, {
        admissionId: field(form, "admissionId"),
        nurseId: field(form, "nurseId"),
        reason: field(form, "reason"),
        authority: field(form, "authority"),
      });
      message =
        "Nursing responsibility assigned with authority and audit history.";
    } else if (operation === "start") {
      await recordShift(ctx, {
        admissionId,
        startedAt: await timestamp(form, "startedAt"),
        handover: field(form, "handover"),
        requestId,
      });
      message = "Assigned shift started. Prescribed occurrences are unchanged.";
    } else if (operation === "end") {
      await endShift(ctx, {
        shiftId,
        endedAt: await timestamp(form, "endedAt"),
        handover: field(form, "handover"),
      });
      message = "Handover signed. Unfinished prescribed work remains visible.";
    } else if (operation === "mar") {
      await recordAdministration(ctx, {
        orderId: targetId,
        shiftId: recordingShiftId,
        scheduledAt,
        actualAt: await timestamp(form, "actualAt"),
        actualDose: field(form, "actualDose"),
        doseUnit: field(form, "doseUnit"),
        outcome: field(form, "outcome"),
        ...(field(form, "reason") ? { reason: field(form, "reason") } : {}),
        requestId,
      });
      message =
        "Medication outcome signed. Administration creates no medicine charge.";
    } else if (operation === "observation") {
      const values: Record<string, number> = {};
      for (const key of [
        "bpSystolic",
        "bpDiastolic",
        "pulse",
        "temperatureC",
        "spo2",
        "respiratoryRate",
        "painScore",
      ])
        if (field(form, key)) values[key] = Number(field(form, key));
      await recordObservation(ctx, {
        admissionId,
        shiftId: recordingShiftId,
        orderId: targetId,
        scheduledFor: scheduledAt,
        observedAt: await timestamp(form, "observedAt"),
        values,
        requestId,
      });
      message = "Actual readings signed against the prescribed occurrence.";
    } else if (operation === "consumable") {
      await recordConsumable(ctx, {
        admissionId,
        shiftId,
        usedAt: await timestamp(form, "usedAt"),
        itemId: field(form, "itemId"),
        quantity: field(form, "quantity"),
        unit: field(form, "unit"),
        reason: field(form, "reason"),
      });
      message = "Consumable use recorded against its actual bed and stay.";
    } else if (operation === "diet") {
      await completeClinicalTask(ctx, {
        orderId: targetId,
        reason: field(form, "reason"),
      });
      message = "Diet task completed.";
    } else if (operation === "addendum") {
      const [recordType, recordId] = field(form, "record").split("|");
      await addNursingAddendum(ctx, {
        admissionId,
        recordType,
        recordId,
        reason: field(form, "reason"),
        text: field(form, "text"),
      });
      message = "Nursing addendum signed. Original record retained.";
    } else {
      await resolveCareBilling(ctx, {
        sourceEventId: targetId,
        reason: field(form, "reason"),
      });
      message = "Consumable source resolved against current configuration.";
    }
    revalidatePath("/nursing");
    revalidatePath("/clinical");
    revalidatePath("/admin/care");
    revalidatePath("/admin/beds");
    revalidatePath("/admissions");
    revalidatePath("/billing");
    return { message };
  } catch (error) {
    return {
      error: true,
      message:
        error instanceof DomainError
          ? error.message
          : error instanceof ZodError
            ? "Check the nursing fields, units and actual times."
            : "Unable to save. Refresh and try again.",
    };
  }
}
