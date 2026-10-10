"use server";
import { hospitalFormInstant } from "@/server/hospital-time";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import {
  addClinicalAddendum,
  completeClinicalTask,
  recordRound,
  resolveCareBilling,
  signClinicalSummary,
  stopClinicalOrder,
  orderTransfer,
} from "@/server/clinical/commands";
import { DomainError } from "@/server/contracts";
import type { CareState } from "@/components/care-forms";
const field = (form: FormData, name: string) => String(form.get(name) ?? "");
const timestamp = (form: FormData, name: string) =>
  hospitalFormInstant(field(form, name), field(form, "hospitalTimezone"));
export async function saveClinical(
  admissionId: string,
  requestId: string,
  operation: "round" | "addendum" | "complete" | "stop" | "billing" | "summary" | "transfer",
  targetId: string,
  version: number,
  _previous: CareState,
  form: FormData,
): Promise<CareState> {
  try {
    const ctx = {
      ...staffContext(await requireStaff(), "clinical-form"),
      requestId,
    };
    let message = "";
    if (operation === "round") {
      const kind = field(form, "kind");
      const orders = [];
      if (kind !== "NONE") {
        const order: Record<string, unknown> = {
          kind,
          requestedItem: field(form, "requestedItem"),
        };
        for (const key of ["itemId", "quantity", "unit"])
          if (field(form, key)) order[key] = field(form, key);
        if (kind === "MEDICINE") {
          for (const key of ["dose", "doseUnit", "route", "frequency"])
            order[key] = field(form, key);
          order.durationDays = Number(field(form, "durationDays"));
          order.medicationPurpose = field(form, "medicationPurpose");
          if (["TAKE_HOME", "BOTH"].includes(String(order.medicationPurpose))) {
            order.dispensingQuantity = field(form, "dispensingQuantity");
            order.dispensingUnit = field(form, "dispensingUnit");
          }
        }
        if (
          kind === "VITALS" ||
          (kind === "MEDICINE" && order.medicationPurpose !== "TAKE_HOME")
        )
          order.schedule = {
            startsAt: await timestamp(form, "startsAt"),
            intervalMinutes: Number(field(form, "intervalMinutes")),
            occurrences: Number(field(form, "occurrences")),
          };
        orders.push(order);
      }
      const [feeScheduleId, feeUnit] = field(form, "feeScheduleId").split("|");
      await recordRound(ctx, {
        admissionId,
        requestId,
        notes: field(form, "notes"),
        orders,
        ...(feeScheduleId ? { feeScheduleId, feeUnit } : {}),
      });
      message =
        "Round signed. Orders and any unresolved billing work are retained.";
    } else if (operation === "transfer") {
      await orderTransfer(ctx, { admissionId, destinationCategory: field(form, "destinationCategory"), reason: field(form, "reason"), requestId });
      message = "Transfer order signed for the current stay. Nursing records the actual bed move and handover.";
    } else if (operation === "addendum") {
      await addClinicalAddendum(ctx, {
        noteId: targetId,
        reason: field(form, "reason"),
        text: field(form, "text"),
      });
      message = "Addendum signed. Original note retained.";
    } else if (operation === "complete") {
      await completeClinicalTask(ctx, {
        orderId: targetId,
        reason: field(form, "reason"),
      });
      message =
        "Clinical work completed. Billing status remains separately visible.";
    } else if (operation === "stop") {
      await stopClinicalOrder(ctx, {
        orderId: targetId,
        reason: field(form, "reason"),
      });
      message =
        "Clinical order stopped. Original occurrences and records retained.";
    } else if (operation === "billing") {
      await resolveCareBilling(ctx, {
        sourceEventId: targetId,
        reason: field(form, "reason"),
      });
      message = "Recorded source resolved against current configuration.";
    } else {
      await signClinicalSummary(ctx, {
        admissionId,
        expectedVersion: version,
        diagnosis: field(form, "diagnosis"),
        course: field(form, "course"),
        condition: field(form, "condition"),
        followUp: field(form, "followUp"),
        advice: field(form, "advice"),
        prescriptionOrderIds: form.getAll("prescriptionOrderIds").map(String),
      });
      message =
        "Clinical summary signed with a new prescription version. Discharge clearance remains separate.";
    }
    revalidatePath("/clinical");
    revalidatePath("/nursing");
    return { message };
  } catch (error) {
    return {
      error: true,
      message:
        error instanceof DomainError
          ? error.message
          : error instanceof ZodError
            ? "Check the clinical fields and explicit schedule."
            : "Unable to save. Refresh and try again.",
    };
  }
}
