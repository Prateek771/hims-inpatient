import { db } from "../../src/server/db";
import { eq } from "drizzle-orm";
import { createStaffAuth } from "../../src/server/auth";
import { user } from "../../src/server/schema/auth";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
async function prepare() {
  for (const role of ["ADMIN", "DOCTOR", "ADMISSION", "BILLING", "NURSE"] as const) {
    const email = `${role.toLowerCase()}@e2e.fixture.invalid`;
    const [existing] = await db
      .select()
      .from(user)
      .where(eq(user.email, email));
    if (!existing)
      await createStaffAuth().api.createUser({
        body: {
          name: `Synthetic E2E ${role}`,
          email,
          password: "SyntheticE2EOnly123!",
          role,
        },
      });
  }
  const { getAuth } = await import("../../src/server/auth");
  const { saveSetting, listSettings } = await import(
    "../../src/server/settings"
  );
  const { requireStaff, staffContext } = await import(
    "../../src/server/access"
  );
  const { createBed } = await import("../../src/server/admissions/commands");
  const { beds } = await import("../../src/server/admissions/schema");
  const response = await getAuth().api.signInEmail({
    asResponse: true,
    body: {
      email: "admin@e2e.fixture.invalid",
      password: "SyntheticE2EOnly123!",
    },
  });
  if (!response.ok) throw new Error("Synthetic fixture admin login failed");
  const h = new Headers({
    cookie: response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
  let state = await listSettings(h);
  if (!state.hospital)
    await saveSetting(h, {
      expectedVersion: 0,
      reason: "Synthetic browser identity",
      value: {
        type: "hospital",
        name: "Synthetic E2E hospital",
        address: "Synthetic address",
        timezone: "Asia/Kolkata",
      },
    });
  state = await listSettings(h);
  if (
    !state.versions.some(
      (v) => v.payload.type === "bed-category" && v.payload.code === "GENERAL",
    )
  ) {
    await saveSetting(h, {
      expectedVersion: Math.max(
        0,
        ...state.versions
          .filter((v) => v.kind === "rule")
          .map((v) => v.version),
      ),
      reason: "Synthetic browser room category",
      value: {
        type: "bed-category",
        code: "GENERAL",
        name: "General",
        active: true,
      },
    });
  }
  const [bed] = await db
    .select()
    .from(beds)
    .where(eq(beds.label, "Synthetic E2E General bed"));
  if (!bed)
    await createBed(
      staffContext(await requireStaff(h), "synthetic-browser-bed"),
      {
        label: "Synthetic E2E General bed",
        category: "GENERAL",
        reason: "Synthetic browser inventory",
      },
    );
  await prepareBillingFixtures(h);
  await prepareCareFixtures(h);
  await prepareTransferFixtures(h);
  // Workflow browser contexts reuse real synthetic sessions, avoiding unrelated login-limiter traffic.
  // These signed cookies are credentials and stay exclusively inside the ignored test output folder.
  for (const role of ["ADMIN", "DOCTOR", "ADMISSION", "BILLING", "NURSE"] as const) {
    const response = await getAuth().api.signInEmail({ asResponse: true, body: { email: `${role.toLowerCase()}@e2e.fixture.invalid`, password: "SyntheticE2EOnly123!" } });
    if (!response.ok) throw new Error("Synthetic storage-state sign-in failed");
    const cookies = response.headers.getSetCookie().map((header) => {
      const [pair, ...parts] = header.split(";");
      const separator = pair.indexOf("=");
      const attributes = new Map(parts.map((part) => {
        const [key, ...value] = part.trim().split("=");
        return [key.toLowerCase(), value.join("=")] as const;
      }));
      const maxAge = attributes.get("max-age"), expires = attributes.get("expires");
      const sameSite = attributes.get("samesite")?.toLowerCase();
      return { name: pair.slice(0, separator), value: pair.slice(separator+1), domain: attributes.get("domain") ?? "127.0.0.1", path: attributes.get("path") ?? "/", expires: maxAge ? Math.floor(Date.now()/1000) + Number(maxAge) : expires ? Date.parse(expires)/1000 : -1, httpOnly: attributes.has("httponly"), secure: attributes.has("secure"), sameSite: sameSite === "strict" ? "Strict" : sameSite === "none" ? "None" : "Lax" };
    });
    const current = await requireStaff(new Headers({ cookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ") }));
    if (current.role !== role) throw new Error("Synthetic storage-state role mismatch");
    const directory = resolve("tmp/e2e-auth");
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, `${role.toLowerCase()}.json`), JSON.stringify({ cookies, origins: [] }));
  }
}

async function prepareBillingFixtures(adminHeaders: Headers) {
  const { getAuth } = await import("../../src/server/auth");
  const { requireStaff, staffContext } = await import("../../src/server/access");
  const { listSettings, saveSetting } = await import("../../src/server/settings");
  const { createAdmission, createBed, activateAdmission } = await import("../../src/server/admissions/commands");
  const { recordReceipt, postChargeInTransaction, reconcileBill } = await import("../../src/server/billing/commands");
  const { withTransaction } = await import("../../src/server/db");
  const { admissions } = await import("../../src/server/admissions/schema");
  const admin = await requireStaff(adminHeaders);
  const [doctor] = await db.select().from(user).where(eq(user.email, "doctor@e2e.fixture.invalid"));
  async function context(role: string) {
    const r = await getAuth().api.signInEmail({ asResponse: true, body: { email: `${role}@e2e.fixture.invalid`, password: "SyntheticE2EOnly123!" } });
    if (!r.ok) throw new Error("Synthetic billing fixture sign-in failed");
    const staff = await requireStaff(new Headers({ cookie: r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") }));
    return staffContext(staff, "synthetic-browser-billing");
  }
  async function setting(value: Record<string, unknown>) {
    const state = await listSettings(adminHeaders);
    const kind = ["tariff", "billable-item"].includes(String(value.type)) ? "tariff" : "rule";
    return saveSetting(adminHeaders, { expectedVersion: Math.max(0, ...state.versions.filter((v) => v.kind === kind).map((v) => v.version)), value, reason: "Synthetic browser billing policy" });
  }
  const state = await listSettings(adminHeaders);
  if (!state.versions.some((v) => v.payload.type === "tariff" && v.payload.category === "GENERAL")) await setting({ type: "tariff", category: "GENERAL", amount: "500", basis: "hour", rounding: "exact", graceMinutes: 0 });
  await setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "required", amount: "500" });
  const item = await setting({ type: "billable-item", code: "E2E_CONSULT", name: "Synthetic recorded consultation", category: "consultation", department: "DOCTOR", unit: "session", quantityScale: 0, amount: "1200", active: true });
  for (const name of ["Synthetic E2E billing patient", "Synthetic E2E activation patient"]) {
    const bed = await createBed(staffContext(admin, "synthetic-browser-bed"), { label: `Synthetic billing ${crypto.randomUUID()}`, category: "GENERAL", reason: "Synthetic browser billing inventory" });
    const desk = await context("admission");
    const a = await createAdmission(desk, { patientDetails: { name, ageYearsAtRegistration: 54, sex: "FEMALE" }, admittingDoctorId: doctor.id, clinicianAssessment: { clinicianId: doctor.id, assessedAt: new Date().toISOString(), chiefComplaint: "Synthetic complaint", vitals: "Synthetic assessment", triage: "Synthetic destination", destinationCategory: "GENERAL" }, bedId: bed.id, paymentRoute: "SELF_PAY", expectedStayDays: 2, requestId: desk.requestId });
    if (name.includes("activation")) continue;
    const cashier = await context("billing");
    await recordReceipt(cashier, { admissionId: a.admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "50000", mode: "CASH", channel: "Synthetic E2E fixture book", sourceReference: crypto.randomUUID(), reference: "Synthetic initial deposit", requestId: cashier.requestId });
    const arrival = await context("admission");
    await activateAdmission(arrival, { admissionId: a.admissionId, expectedVersion: 1, arrivedAt: new Date().toISOString(), requestId: arrival.requestId });
    await withTransaction(async (tx) => {
      await tx.select().from(admissions).where(eq(admissions.id, a.admissionId)).for("update");
      await postChargeInTransaction(tx, await context("billing"), { admissionId: a.admissionId, sourceEventId: crypto.randomUUID(), itemId: "E2E_CONSULT", category: "consultation", quantity: "1", unit: "session", tariffVersionId: item.id, status: "FINAL" });
    });
    await reconcileBill(await context("billing"), { admissionId: a.admissionId, cutoff: new Date().toISOString() });
  }
}
async function prepareCareFixtures(adminHeaders: Headers, transferCase = false) {
  const { requireStaff } = await import("../../src/server/access");
  const { createAdmission, createBed, activateAdmission } = await import("../../src/server/admissions/commands");
  const { recordReceipt } = await import("../../src/server/billing/commands");
  const { recordRound } = await import("../../src/server/clinical/commands");
  const { assignNurse } = await import("../../src/server/nursing/commands");
  const admin = await requireStaff(adminHeaders);
  const [doctor] = await db.select().from(user).where(eq(user.email, "doctor@e2e.fixture.invalid"));
  const [nurse] = await db.select().from(user).where(eq(user.email, "nurse@e2e.fixture.invalid"));
  // This entrypoint is launched only by the guarded synthetic auth fixture process.
  const context = (id: string) => ({ actor: { type: "staff" as const, staffId: id }, source: "synthetic-browser-care", requestId: crypto.randomUUID() });
  const [desk] = await db.select().from(user).where(eq(user.email, "admission@e2e.fixture.invalid"));
  const [billing] = await db.select().from(user).where(eq(user.email, "billing@e2e.fixture.invalid"));
  const bed = await createBed(context(admin.id), { label: `Synthetic care ${crypto.randomUUID()}`, category: "GENERAL", reason: "Synthetic care inventory" });
  const deskCtx = context(desk.id);
  const a = await createAdmission(deskCtx, { patientDetails: { name: transferCase ? "Synthetic E2E transfer patient" : "Synthetic E2E care patient", ageYearsAtRegistration: 54, sex: "FEMALE" }, admittingDoctorId: doctor.id, clinicianAssessment: { clinicianId: doctor.id, assessedAt: new Date().toISOString(), chiefComplaint: "Synthetic complaint", vitals: "Synthetic assessment", triage: "Synthetic destination", destinationCategory: "GENERAL" }, bedId: bed.id, paymentRoute: "SELF_PAY", expectedStayDays: 2, requestId: deskCtx.requestId });
  const receiptCtx = context(billing.id);
  await recordReceipt(receiptCtx, { admissionId: a.admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "50000", mode: "CASH", channel: "Synthetic care fixture book", sourceReference: crypto.randomUUID(), reference: "Synthetic care deposit", requestId: receiptCtx.requestId });
  const arrival = context(desk.id), startedAt = new Date().toISOString();
  await activateAdmission(arrival, { admissionId: a.admissionId, expectedVersion: 1, arrivedAt: startedAt, requestId: arrival.requestId });
  await assignNurse(context(admin.id), { admissionId: a.admissionId, nurseId: nurse.id, authority: "Synthetic hospital administrator schedule", reason: "Synthetic ward responsibility" });
  const round = context(doctor.id);
  await recordRound(round, { admissionId: a.admissionId, notes: "Synthetic care fixture round", requestId: round.requestId, orders: [
    { kind: "MEDICINE", requestedItem: "Synthetic prescribed medicine", dose: "5", doseUnit: "mg", route: "oral", frequency: "Clinician explicit schedule", durationDays: 1, medicationPurpose: "BOTH", dispensingQuantity: "4", dispensingUnit: "tablet", schedule: { startsAt: startedAt, intervalMinutes: 60, occurrences: 2 } },
    { kind: "VITALS", requestedItem: "Synthetic clinician monitoring", schedule: { startsAt: startedAt, intervalMinutes: 60, occurrences: 2 } },
    { kind: "VITALS", requestedItem: "Synthetic unresolved monitoring for handover", schedule: { startsAt: startedAt, intervalMinutes: 60, occurrences: 2 } }
  ] });
  if (!transferCase) writeFileSync(resolve("tmp/e2e-care.json"), JSON.stringify({ admissionId: a.admissionId }));
  return { admissionId: a.admissionId, sourceBedId: bed.id, sourceBedLabel: bed.label };
}

async function prepareTransferFixtures(adminHeaders: Headers) {
  const { requireStaff, staffContext } = await import("../../src/server/access");
  const { listSettings, saveSetting } = await import("../../src/server/settings");
  const { createBed } = await import("../../src/server/admissions/commands");
  for (const value of [{ type: "bed-category", code: "ICU", name: "Synthetic ICU", active: true }, { type: "tariff", category: "ICU", amount: "1000", basis: "hour", rounding: "exact", graceMinutes: 0 }]) {
    const kind = value.type === "tariff" ? "tariff" : "rule";
    const settings = await listSettings(adminHeaders);
    await saveSetting(adminHeaders, { value, reason: "Synthetic transfer browser policy", expectedVersion: Math.max(0, ...settings.versions.filter(v => v.kind === kind).map(v => v.version)) });
  }
  const admin = await requireStaff(adminHeaders);
  const bed = await createBed(staffContext(admin, "synthetic-browser-transfer"), { label: `Synthetic transfer ICU ${crypto.randomUUID()}`, category: "ICU", reason: "Independent synthetic transfer target" });
  const episode = await prepareCareFixtures(adminHeaders, true);
  writeFileSync(resolve("tmp/e2e-transfer.json"), JSON.stringify({ ...episode, targetBedId: bed.id, targetBedLabel: bed.label }));
}

prepare()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(
      JSON.stringify({
        fixtureError: error.name,
        code: error.code ?? error.cause?.code ?? null,
      }),
    );
    process.exit(1);
  });
