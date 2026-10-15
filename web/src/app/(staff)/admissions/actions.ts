"use server";
import { revalidatePath } from "next/cache";
import { requireStaff, staffContext } from "@/server/access";
import {
  cancelAdmission,
  createAdmission,
  createBed,
  disableBed,
} from "@/server/admissions/commands";
import { DomainError } from "@/server/contracts";
import { ZodError } from "zod";

export type AdmissionActionState = {
  message: string;
  error?: boolean;
  admissionId?: string;
};
function failure(error: unknown): AdmissionActionState {
  return {
    error: true,
    message:
      error instanceof DomainError
        ? error.message
        : error instanceof ZodError
          ? "Check the fields and try again."
          : "Unable to save. Refresh and try again.",
  };
}
const field = (form: FormData, key: string) => String(form.get(key) ?? "");

// Next encrypts these server-bound arguments; the actor always comes from the current session.
export async function savePendingAdmission(
  requestId: string,
  _previous: AdmissionActionState,
  form: FormData,
): Promise<AdmissionActionState> {
  try {
    const staff = await requireStaff();
    const patientId = field(form, "patientId");
    const result = await createAdmission(
      { ...staffContext(staff, "admission-form"), requestId },
      {
        ...(patientId
          ? { patientId }
          : {
              patientDetails: {
                ...(field(form,"name")?{name:field(form,"name")}:{}),
                identityStatus:field(form,"identityStatus")||"KNOWN",
                ...(field(form,"identityProvenance")?{identityProvenance:field(form,"identityProvenance")}:{}),
                ...(field(form, "dateOfBirth")
                  ? { dateOfBirth: field(form, "dateOfBirth") }
                  : {}),
                ...(field(form, "ageYears")
                  ? { ageYearsAtRegistration: Number(field(form, "ageYears")) }
                  : {}),
                sex: field(form, "sex"),
                ...(field(form, "phone")
                  ? { phone: field(form, "phone") }
                  : {}),
              },
            }),
        externalDoctorId: field(form, "externalDoctorId"),
        bedId: field(form, "bedId"),
        paymentRoute: field(form, "paymentRoute"),
        expectedStayDays: Number(field(form, "expectedStayDays")),
        requestId,
      },
    );
    revalidatePath("/admissions");
    return {
      message: `Bed reserved · ${result.ipCode} · PENDING. Deposit checks are required before activation.`,
      admissionId: result.admissionId,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelPendingAdmission(
  admissionId: string,
  _previous: AdmissionActionState,
  form: FormData,
): Promise<AdmissionActionState> {
  try {
    await cancelAdmission(
      staffContext(await requireStaff(), "admission-cancellation"),
      { admissionId, reason: field(form, "reason") },
    );
    revalidatePath(`/patients/${admissionId}`);
    revalidatePath("/admissions");
    return {
      message:
        "Pending admission cancelled; reservation released. Patient identity and admission history retained.",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function addBed(
  _previous: AdmissionActionState,
  form: FormData,
): Promise<AdmissionActionState> {
  try {
    await createBed(staffContext(await requireStaff(), "bed-inventory"), {
      label: field(form, "label"),
      category: field(form, "category"),
      reason: field(form, "reason"),
    });
    revalidatePath("/admin/beds");
    revalidatePath("/admissions");
    return { message: "Bed added." };
  } catch (error) {
    return failure(error);
  }
}

export async function removeAvailableBed(
  bedId: string,
  _previous: AdmissionActionState,
  form: FormData,
): Promise<AdmissionActionState> {
  try {
    await disableBed(staffContext(await requireStaff(), "bed-inventory"), {
      bedId,
      reason: field(form, "reason"),
    });
    revalidatePath("/admin/beds");
    revalidatePath("/admissions");
    return { message: "Bed disabled." };
  } catch (error) {
    return failure(error);
  }
}
