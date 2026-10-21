import { randomUUID } from "node:crypto";
import { requireStaff, staffContext, type Staff } from "../src/server/access";
import { getAuth, staffRoles } from "../src/server/auth";
import { bootstrapAdmin } from "../src/server/bootstrap";
import { activateAdmission, createAdmission, createBed } from "../src/server/admissions/commands";
import { getBill, recordReceipt } from "../src/server/billing/commands";
import { createInsuranceCase, recordPolicyVerification } from "../src/server/insurance/commands";
import { getMvpEpisode, recordMvpAction, recordPatientMedicineCharge, type MvpActionInput } from "../src/server/mvp/commands";
import { recordExternalServiceCharge } from "../src/server/mvp/services";
import { assignAvailabilityCoordinator, recordDoctorAvailability, saveDoctor } from "../src/server/mvp/staff";
import { assignNurse, recordShift } from "../src/server/nursing/commands";
import { listSettings, saveSetting } from "../src/server/settings";

const hospital = "Lotus Grove Demo Hospital";
const reason = "Fictional clone demo initialization; no real patient, clinical instruction or money";
const routineRoles = ["ADMIN", "ADMISSION", "NURSE", "PHARMACY", "BILLING", "INSURANCE"] as const;
type RoutineRole = (typeof routineRoles)[number];
type DemoPatient = Awaited<ReturnType<typeof createAdmission>> & {
  key: string;
  name: string;
  bed: string;
  status: "PENDING" | "ADMITTED";
  paymentRoute: "SELF_PAY" | "INSURED";
  nextActions: string[];
};
type DemoAction = {
  [A in MvpActionInput["action"]]: Omit<Extract<MvpActionInput, { action: A }>, "admissionId" | "requestId" | "expectedReviewHash">;
}[MvpActionInput["action"]];

/**
 * Called only by the guarded clone-demo entrypoint after it has verified an empty,
 * dedicated local database and saved the generated password in a private file.
 * No environment loading, file access, direct SQL or import-time work belongs here.
 * Each domain command preserves its normal validation, role checks and audit trail.
 * This deliberately cannot resume: a failed initialization leaves data for review.
 */
export async function seedDemoHospital(password: string) {
  await bootstrapAdmin({
    name: "Demo hospital administrator",
    email: "admin@hims.test",
    password,
    role: "ADMIN",
    reason: "Fictional clone demo initialization",
  }, true);

  const staff = {} as Record<RoutineRole, Staff>;
  const headers = {} as Record<RoutineRole, Headers>;
  for (const role of routineRoles) {
    const response = await getAuth().api.signInEmail({
      asResponse: true,
      body: { email: `${role.toLowerCase()}@hims.test`, password },
    });
    if (!response.ok) throw new Error(`Fresh demo ${role} sign-in failed`);
    const requestHeaders = new Headers({
      cookie: response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; "),
    });
    staff[role] = await requireStaff(requestHeaders);
    headers[role] = requestHeaders;
  }
  const context = (role: RoutineRole) => ({
    ...staffContext(staff[role], "fictional-clone-demo"),
    requestId: randomUUID(),
  });
  const now = () => new Date().toISOString();
  async function setting(value: Record<string, unknown>) {
    const state = await listSettings(headers.ADMIN);
    const kind = ["tariff", "billable-item"].includes(String(value.type)) ? "tariff" : "rule";
    return saveSetting(headers.ADMIN, {
      value,
      expectedVersion: Math.max(0, ...state.versions.filter((version) => version.kind === kind).map((version) => version.version)),
      reason,
    });
  }
  await setting({ type: "hospital", name: hospital, address: "Fictional Training Campus, Demo Nagar, India; demonstration only", timezone: "Asia/Kolkata" });

  const categories = [
    { code: "DEMO_GENERAL", name: "Demo General Ward", rate: 1200, selfPay: 3000, insured: 2000, beds: ["G-101", "G-102", "G-103", "G-104", "G-105", "G-106"] },
    { code: "DEMO_PRIVATE", name: "Demo Private Room", rate: 2500, selfPay: 5000, insured: 2000, beds: ["P-201", "P-202", "P-203", "P-204"] },
    { code: "DEMO_HDU", name: "Demo High Dependency", rate: 4000, selfPay: 10000, insured: 5000, beds: ["H-301", "H-302"] },
  ];
  const demoBeds = new Map<string, { id: string; category: (typeof categories)[number] }>();
  for (const category of categories) {
    await setting({ type: "bed-category", code: category.code, name: category.name, active: true });
    await setting({ type: "tariff", category: category.code, amount: String(category.rate), basis: "24-hours", rounding: "started-unit", graceMinutes: 0 });
    for (const route of ["self-pay", "insured"] as const) {
      await setting({ type: "deposit", category: category.code, route, requirement: "required", amount: String(route === "self-pay" ? category.selfPay : category.insured) });
    }
    for (const label of category.beds) {
      const bed = await createBed(context("ADMIN"), { label: `Demo ${label}`, category: category.code, reason });
      demoBeds.set(label, { id: bed.id, category });
    }
  }
  await setting({ type: "alert", basis: "patient-deposit", percent: 80 });
  await setting({ type: "alert", basis: "insurer-limit", percent: 80 });

  const itemSpecs = [
    ["DEMO_CONSULT", "Demo external consultation", "consultation", "DOCTOR", "visit", 800],
    ["DEMO_PROCEDURE", "Demo procedure", "procedure", "DOCTOR", "procedure", 1500],
    ["DEMO_MED", "Demo medicine pack; training only", "medicine", "PHARMACY", "pack", 100],
    ["DEMO_CONSUMABLE", "Demo dressing kit", "consumable", "NURSE", "kit", 150],
    ["DEMO_CBC", "Demo external blood count", "lab", "LAB", "test", 400],
    ["DEMO_XRAY", "Demo external imaging", "radiology", "LAB", "study", 700],
  ] as const;
  const rates = new Map<string, string>();
  for (const [code, name, category, department, unit, amount] of itemSpecs) {
    const record = await setting({ type: "billable-item", code, name, category, department, unit, quantityScale: 0, amount: String(amount), active: true });
    rates.set(code, record.id);
  }

  const doctors: Awaited<ReturnType<typeof saveDoctor>>[] = [];
  for (const [name, specialty] of [["Dr Demo Anika Rao", "General medicine"], ["Dr Demo Vikram Sen", "General surgery"], ["Dr Demo Farah Ali", "Critical care"]]) {
    const ctx = context("ADMIN");
    doctors.push(await saveDoctor(ctx, { name, specialty, active: true, expectedVersion: 0, reason, requestId: ctx.requestId }));
  }
  const roster = { startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString() };
  const coordinator = context("ADMIN");
  await assignAvailabilityCoordinator(coordinator, { nurseId: staff.NURSE.id, ...roster, expectedVersion: 0, reason, requestId: coordinator.requestId });
  for (const doctor of doctors) {
    const ctx = context("NURSE");
    await recordDoctorAvailability(ctx, { doctorId: doctor.id, status: "AVAILABLE", ...roster, remarks: "Fictional seven-day training roster; update availability during practice", expectedVersion: 0, requestId: ctx.requestId });
  }

  async function patient(input: {
    key: string; name: string; bed: string; age: number; sex: "MALE" | "FEMALE";
    paymentRoute: "SELF_PAY" | "INSURED"; pending?: boolean; nextActions: string[];
  }): Promise<DemoPatient> {
    const bed = demoBeds.get(input.bed)!;
    const ctx = context("ADMISSION");
    const admission = await createAdmission(ctx, {
      externalDoctorId: doctors[input.bed.startsWith("P") ? 1 : input.bed.startsWith("H") ? 2 : 0].id,
      patientDetails: { name: input.name, ageYearsAtRegistration: input.age, sex: input.sex },
      bedId: bed.id, paymentRoute: input.paymentRoute, expectedStayDays: 2, requestId: ctx.requestId,
    });
    if (!input.pending) {
      const receipt = context("BILLING");
      await recordReceipt(receipt, {
        admissionId: admission.admissionId, party: "PATIENT", kind: "DEPOSIT",
        amountPaise: String((input.paymentRoute === "SELF_PAY" ? bed.category.selfPay : bed.category.insured) * 100),
        mode: "CASH", channel: "FICTIONAL training cashier", sourceReference: `${input.key}:deposit`, reference: reason, requestId: receipt.requestId,
      });
      const activation = context("ADMISSION");
      await activateAdmission(activation, { admissionId: admission.admissionId, arrivedAt: now(), expectedVersion: 1, requestId: activation.requestId });
      await assignNurse(context("ADMIN"), { admissionId: admission.admissionId, nurseId: staff.NURSE.id, reason, authority: "Fictional training ward roster" });
      const shift = context("NURSE");
      await recordShift(shift, { admissionId: admission.admissionId, startedAt: now(), handover: "FICTIONAL practice episode; no real care or clinical instructions", requestId: shift.requestId });
    }
    return { ...admission, key: input.key, name: input.name, bed: `Demo ${input.bed}`, status: input.pending ? "PENDING" : "ADMITTED", paymentRoute: input.paymentRoute, nextActions: input.nextActions };
  }
  async function medicine(episode: DemoPatient, quantity: string) {
    const ctx = context("PHARMACY");
    await recordPatientMedicineCharge(ctx, { admissionId: episode.admissionId, itemId: "DEMO_MED", quantity, unit: "pack", expectedTariffVersionId: rates.get("DEMO_MED")!, sourceReference: `${episode.key}:medicine`, evidence: reason, requestId: ctx.requestId });
  }
  async function consultation(episode: DemoPatient) {
    const ctx = context("BILLING");
    const bill = await getBill(ctx, episode.admissionId);
    await recordExternalServiceCharge(ctx, { admissionId: episode.admissionId, expectedBillVersion: bill.revision, category: "consultation", itemId: "DEMO_CONSULT", quantity: "1", unit: "visit", expectedTariffVersionId: rates.get("DEMO_CONSULT")!, performedAt: now(), departmentIssuer: "Fictional training department", externalBillReference: episode.key, externalLineReference: "consultation-1", evidence: reason, requestId: ctx.requestId });
  }
  async function action(episode: DemoPatient, value: DemoAction) {
    const ctx = context("NURSE");
    const state = await getMvpEpisode(ctx, episode.admissionId);
    await recordMvpAction(ctx, { ...value, admissionId: episode.admissionId, requestId: ctx.requestId, expectedReviewHash: state.reviewHash });
  }

  const pending = await patient({ key: "demo-saira", name: "Demo Saira Kapoor", bed: "P-201", age: 31, sex: "FEMALE", paymentRoute: "SELF_PAY", pending: true, nextActions: ["Admission: record fictional deposit and activate reserved admission", "Admin: assign Nurse after activation"] });
  const ongoing = await patient({ key: "demo-aarav", name: "Demo Aarav Sharma", bed: "G-101", age: 42, sex: "MALE", paymentRoute: "SELF_PAY", nextActions: ["Nurse: continue assigned episode and record external Doctor instruction when practicing discharge", "Pharmacy: review medicine charges or accept a fictional unused return", "Billing: review deposit and performed-service charges"] });
  await medicine(ongoing, "5");
  await consultation(ongoing);

  const insured = await patient({ key: "demo-meera", name: "Demo Meera Shah", bed: "G-102", age: 54, sex: "FEMALE", paymentRoute: "INSURED", nextActions: ["Insurance: review assigned case and record fictional external payer decision", "Nurse: continue assigned episode", "Billing: review patient deposit separately from insurer responsibility"] });
  await medicine(insured, "3");
  await consultation(insured);
  const caseCtx = context("ADMIN");
  const insuranceCase = await createInsuranceCase(caseCtx, { admissionId: insured.admissionId, assignedStaffId: staff.INSURANCE.id, reason, requestId: caseCtx.requestId });
  const policy = context("INSURANCE");
  const year = new Date().getUTCFullYear();
  await recordPolicyVerification(policy, { caseId: insuranceCase.id, expectedCaseVersion: 1, requestId: policy.requestId, insurer: "Fictional Lotus Assurance; training only", tpa: "Fictional Care Desk", policyNumber: "DEMO-MEERA-POLICY", memberNumber: "DEMO-MEERA-MEMBER", validFrom: `${year - 1}-01-01`, validTo: `${year + 1}-12-31`, verifiedBy: "Fictional external policy desk", verifiedAt: now(), reference: "DEMO policy evidence; no real policy or insurer connection", documentIds: [] });

  const readiness = await patient({ key: "demo-kavya", name: "Demo Kavya Patel", bed: "G-103", age: 38, sex: "FEMALE", paymentRoute: "SELF_PAY", nextActions: ["Pharmacy: reconcile fictional medicine charges and complete readiness check", "Admin: review Nurse-proposed diagnostic and insurance N/A with reasons", "Nurse: record vacancy only after current readiness; Billing then reviews settlement"] });
  await medicine(readiness, "2");
  await consultation(readiness);
  await action(readiness, { action: "doctor-approval", authorizerName: doctors[0].name, authorizerId: doctors[0].id, sourceTime: now(), evidence: "FICTIONAL signed training sheet; not real medical authority", clinicalSummary: "FICTIONAL practice case: external Doctor discharge instruction recorded for workflow training.", prescription: "FICTIONAL exercise only; no real prescription or medicine advice.", followUp: "FICTIONAL exercise: demonstrate recording advice supplied by an external Doctor." });
  await action(readiness, { action: "checklist", items: ["Fictional instruction sheet reviewed", "Simulated belongings and handover reviewed"], proposedNa: ["DIAGNOSTICS", "INSURANCE"], remarks: reason });
  await action(readiness, { action: "check", check: "NURSING", status: "COMPLETE", remarks: "FICTIONAL training readiness; bed remains occupied until Nurse records vacancy" });

  return {
    fictional: true,
    hospital,
    completedAt: now(),
    accounts: staffRoles.map((role) => ({ role, email: `${role.toLowerCase()}@hims.test`, routineDashboard: routineRoles.some((routine) => routine === role) })),
    counts: { staff: staffRoles.length, routineWorkspaces: routineRoles.length, bedCategories: categories.length, beds: demoBeds.size, externalDoctors: doctors.length, catalogueItems: itemSpecs.length, patients: 4 },
    patients: [pending, ongoing, insured, readiness],
    notes: ["All records and amounts are fictional training data.", "Doctor and Lab accounts are retained legacy roles; the MVP has six routine staff workspaces.", "No external provider, real clinical authorization, document upload or actual payment is involved.", "Doctor availability is initialized for seven days; refresh the roster during later practice."],
  };
}
