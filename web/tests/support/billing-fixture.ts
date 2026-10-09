import { randomUUID } from "node:crypto";
import { bootstrapAdmin, createStaff } from "../../src/server/staff";
import { getAuth } from "../../src/server/auth";
import { requireStaff, staffContext } from "../../src/server/access";
import { saveSetting } from "../../src/server/settings";
import { createBed, createAdmission } from "../../src/server/admissions/commands";
export async function billingFixture() {
  const password = "SyntheticBillingOnly123!";
  await bootstrapAdmin({
    name: "Synthetic admin", email: "admin@billing.invalid", password, role: "ADMIN", reason: "synthetic fixture"
  });
  async function login(email: string) {
    const response = await getAuth().api.signInEmail({ asResponse: true, body: { email, password } });
    if (!response.ok)
      throw new Error("Synthetic sign-in failed");
    return new Headers({ cookie: response.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
  }
  const ah = await login("admin@billing.invalid");
  for (const role of ["BILLING", "ADMISSION", "DOCTOR", "NURSE", "LAB", "PHARMACY"] as const) {
    await createStaff(ah, {
      name: `Synthetic ${role}`, email: `${role.toLowerCase()}@billing.invalid`, password, role, reason: "synthetic fixture"
    });
  }
  const admin = await requireStaff(ah);
  const desk = await requireStaff(await login("admission@billing.invalid"));
  const cashier = await requireStaff(await login("billing@billing.invalid"));
  const doctor = await requireStaff(await login("doctor@billing.invalid"));
  const nurse = await requireStaff(await login("nurse@billing.invalid"));
  const lab = await requireStaff(await login("lab@billing.invalid"));
  const pharmacy = await requireStaff(await login("pharmacy@billing.invalid"));
  let rule = 0, tariff = 0;
  async function setting(value: Record<string, unknown>) {
    const kind = ["tariff", "billable-item"].includes(String(value.type)) ? "tariff" : "rule";
    const record = await saveSetting(ah, { value, expectedVersion: kind === "tariff" ? tariff : rule, reason: "Synthetic configured policy" });
    if (kind === "tariff")
      tariff = record.version;
    else
      rule = record.version;
    return record;
  }
  await setting({
    type: "hospital", name: "Synthetic billing hospital", address: "Synthetic address", timezone: "Asia/Kolkata"
  });
  await setting({
    type: "bed-category", code: "GENERAL", name: "Synthetic General", active: true
  });
  const room = await setting({
    type: "tariff", category: "GENERAL", amount: "100.01", basis: "hour", rounding: "exact", graceMinutes: 0
  });
  async function episode(route: "SELF_PAY" | "INSURED" = "SELF_PAY") {
    const bed = await createBed(staffContext(admin, "synthetic"), { label: `Synthetic ${randomUUID()}`, category: "GENERAL", reason: "synthetic fixture" });
    const requestId = randomUUID();
    return createAdmission({ ...staffContext(desk, "synthetic"), requestId }, {
      patientDetails: { name: "Synthetic billing patient", ageYearsAtRegistration: 54, sex: "FEMALE" }, admittingDoctorId: doctor.id, clinicianAssessment: {
        clinicianId: doctor.id, assessedAt: new Date().toISOString(), chiefComplaint: "Synthetic complaint", vitals: "Synthetic clinician vitals", triage: "Synthetic clinical routing", destinationCategory: "GENERAL"
      }, bedId: bed.id, paymentRoute: route, expectedStayDays: 2, requestId
    });
  }
  return {
    ah, admin, desk, cashier, doctor, nurse, lab, pharmacy, setting, episode, room, ctx: () => staffContext(cashier, "synthetic-billing"), deskCtx: () => staffContext(desk, "synthetic-desk")
  };
}
