import { z } from "zod";
export const text = z.string().trim().min(1).max(5000);
export const quantity = z
  .string()
  .regex(/^\d{1,9}(\.\d{1,6})?$/)
  .refine((v) => Number(v) > 0);
export const scheduleInput = z.strictObject({
  startsAt: z.iso.datetime(),
  intervalMinutes: z.number().int().min(1).max(10080),
  occurrences: z.number().int().min(1).max(1000),
});
export const orderInput = z
  .strictObject({
    kind: z.enum([
      "MEDICINE",
      "LAB",
      "RADIOLOGY",
      "PROCEDURE",
      "DIET",
      "VITALS",
    ]),
    requestedItem: text,
    itemId: z
      .string()
      .regex(/^[A-Z0-9_-]{2,32}$/)
      .optional(),
    quantity: quantity.optional(),
    unit: text.optional(),
    dose: quantity.optional(),
    doseUnit: text.optional(),
    route: text.optional(),
    frequency: text.optional(),
    durationDays: z.number().int().min(1).max(365).optional(),
    schedule: scheduleInput.optional(),
    medicationPurpose: z.enum(["WARD", "TAKE_HOME", "BOTH"]).optional(),
    dispensingQuantity: quantity.optional(),
    dispensingUnit: text.optional(),
  })
  .superRefine((v, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: "custom", message });
    if (
      v.kind === "MEDICINE" &&
      (!v.dose ||
        !v.doseUnit ||
        !v.route ||
        !v.frequency ||
        !v.durationDays ||
        !v.medicationPurpose ||
        (v.medicationPurpose !== "TAKE_HOME" && !v.schedule))
    )
      issue(
        "Enter dose, unit, route, frequency, duration and explicit schedule",
      );
    if (v.kind === "VITALS" && !v.schedule)
      issue("Enter an explicit clinician monitoring schedule");
    if (!["MEDICINE", "VITALS"].includes(v.kind) && v.schedule)
      issue("Schedules apply to medicines or prescribed observations");
    if (
      v.kind !== "MEDICINE" &&
      (v.medicationPurpose ||
        v.dose ||
        v.dispensingQuantity ||
        v.dispensingUnit)
    )
      issue("Medicine details require a medicine order");
    if (
      ["TAKE_HOME", "BOTH"].includes(v.medicationPurpose ?? "") &&
      (!v.dispensingQuantity || !v.dispensingUnit)
    )
      issue(
        "Take-home medicine requires explicit dispensing quantity and unit",
      );
    if (
      (v.dispensingQuantity || v.dispensingUnit) &&
      !["TAKE_HOME", "BOTH"].includes(v.medicationPurpose ?? "")
    )
      issue("Dispensing details require a take-home prescription");
    if (
      ["LAB", "RADIOLOGY", "PROCEDURE"].includes(v.kind) &&
      (!v.itemId || !v.quantity || !v.unit)
    )
      issue(
        "Enter requested billing item identity, quantity and unit; absent configuration will remain unresolved",
      );
    if (v.medicationPurpose === "TAKE_HOME" && v.schedule)
      issue("Home-only prescriptions do not create ward monitoring schedules");
    if (
      v.kind === "MEDICINE" &&
      v.medicationPurpose !== "TAKE_HOME" &&
      /\b(prn|as[ -]needed|when needed|sos)\b/i.test(v.frequency ?? "")
    )
      issue(
        "As-needed ward administration is not supported by scheduled occurrences; use the hospital's existing clinical process",
      );
    if (
      v.schedule &&
      v.durationDays &&
      (v.schedule.occurrences - 1) * v.schedule.intervalMinutes >=
        v.durationDays * 1440
    )
      issue("Scheduled occurrence exceeds prescribed duration");
  });
export function scheduledTimes(schedule: z.infer<typeof scheduleInput>) {
  const value = scheduleInput.parse(schedule);
  return Array.from({ length: value.occurrences }, (_, i) =>
    new Date(
      Date.parse(value.startsAt) + i * value.intervalMinutes * 60000,
    ).toISOString(),
  );
}
export const observationValues = z
  .strictObject({
    bpSystolic: z.number().min(1).max(400).optional(),
    bpDiastolic: z.number().min(1).max(300).optional(),
    pulse: z.number().min(1).max(400).optional(),
    temperatureC: z.number().min(20).max(50).optional(),
    spo2: z.number().min(0).max(100).optional(),
    respiratoryRate: z.number().min(0).max(150).optional(),
    painScore: z.number().min(0).max(10).optional(),
  })
  .refine(
    (v) => Object.values(v).some((x) => x !== undefined),
    "Enter an actual reading",
  )
  .refine(
    (v) => (v.bpSystolic === undefined) === (v.bpDiastolic === undefined),
    "Enter both blood pressure readings",
  );
export const roundInput = z
  .strictObject({
    admissionId: z.uuid(),
    notes: text,
    orders: z.array(orderInput).max(50),
    feeScheduleId: z
      .string()
      .regex(/^[A-Z0-9_-]{2,32}$/)
      .optional(),
    feeUnit: text.optional(),
    requestId: z.uuid(),
  })
  .refine(
    (v) => Boolean(v.feeScheduleId) === Boolean(v.feeUnit),
    "Enter consultation identity and unit together",
  );
export type ClinicalOrderDetails = z.infer<typeof orderInput>;
export type PrescriptionLine = {
  orderId: string;
  medicineId: string;
  medicineCatalogVersionId: string | null;
  medicineIdentityState: "CONFIGURED" | "UNRESOLVED";
  requestedItem: string;
  dose: string;
  doseUnit: string;
  route: string;
  frequency: string;
  durationDays: number;
  dispensingQuantity: string;
  dispensingUnit: string;
};
