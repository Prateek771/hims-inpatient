// Historical workflow-v1 coverage: create legacy episodes explicitly; current intake uses MVP v2.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { db } from "../../src/server/db";
import { user } from "../../src/server/schema/auth";
import { listSettings, saveSetting } from "../../src/server/settings";
import { createLegacyAdmission, createBed, activateAdmission } from "../../src/server/admissions/commands";
import { getCare, recordRound, signClinicalSummary } from "../../src/server/clinical/commands";
import { recordStockReceipt, prepareTakeHomeMedicines } from "../../src/server/pharmacy/commands";
import { assignNurse, recordShift } from "../../src/server/nursing/commands";
import { recordReceipt, getBill } from "../../src/server/billing/commands";
import { getClearanceReview, issueClearance, recordRoomVacated, recordDeparture } from "../../src/server/discharge/commands";
export async function prepareDocumentsBrowserFixture(adminHeaders: Headers) {
  const staff = await db.select({ id: user.id, email: user.email }).from(user), id = (role: string) => staff.find(s => s.email === `${role.toLowerCase()}@e2e.fixture.invalid`)!.id;
  const ctx = (role: string) => ({ actor: { type: "staff" as const, staffId: id(role) }, source: "synthetic-browser-documents", requestId: randomUUID() });
  for (const value of [
    { type: "bed-category", code: "DOCUMENTS", name: "Synthetic final documents", active: true },
    { type: "deposit", category: "DOCUMENTS", route: "self-pay", requirement: "not-required", amount: "0" },
    { type: "tariff", category: "DOCUMENTS", amount: "0", basis: "hour", rounding: "exact", graceMinutes: 0 },
    { type: "billable-item", code: "DOC_CONSULT", name: "Synthetic extended clinical consultation and review", category: "consultation", department: "DOCTOR", unit: "session", quantityScale: 0, amount: "1234.56", active: true },
    { type: "billable-item", code: "DOC_PRINT_MED", name: "Synthetic printable prescribed medicine", category: "medicine", department: "PHARMACY", unit: "tablet", quantityScale: 0, amount: "1", active: true },
  ]) {
    const current = await listSettings(adminHeaders), kind = ["tariff", "billable-item"].includes(value.type) ? "tariff" : "rule";
    await saveSetting(adminHeaders, { value, expectedVersion: Math.max(0, ...current.versions.filter(v => v.kind === kind).map(v => v.version)), reason: "Isolated synthetic multi-page document configuration" });
  }
  const bed = await createBed(ctx("ADMIN"), { label: `Synthetic documents ${randomUUID()}`, category: "DOCUMENTS", reason: "Independent document browser bed" });
  const a = ctx("ADMISSION"), { admissionId } = await createLegacyAdmission(a, { patientDetails: { name: "Synthetic José सावधानी क्षेत्र - Long recorded patient name for wrapping and international text verification", ageYearsAtRegistration: 54, sex: "FEMALE" }, admittingDoctorId: id("DOCTOR"), clinicianAssessment: { clinicianId: id("DOCTOR"), assessedAt: new Date().toISOString(), chiefComplaint: "Synthetic human assessment", vitals: "Synthetic vitals", triage: "Actual Doctor route", destinationCategory: "DOCUMENTS" }, bedId: bed.id, paymentRoute: "SELF_PAY", expectedStayDays: 1, requestId: a.requestId });
  const arrival = ctx("ADMISSION"); await activateAdmission(arrival, { admissionId, arrivedAt: new Date().toISOString(), expectedVersion: 1, requestId: arrival.requestId });
  await assignNurse(ctx("ADMIN"), { admissionId, nurseId: id("NURSE"), reason: "Actual document fixture assignment", authority: "Synthetic roster" });
  const nurse = ctx("NURSE"), shift = await recordShift(nurse, { admissionId, startedAt: new Date().toISOString(), handover: "Actual nursing attendance through departure", requestId: nurse.requestId });
  for (let i = 1; i <= 32; i++) { const doctor = ctx("DOCTOR"); await recordRound(doctor, { admissionId, notes: `Signed clinical review ${i}: actual synthetic diagnosis and patient progress, with human follow-up.`, feeScheduleId: "DOC_CONSULT", feeUnit: "session", orders: [], requestId: doctor.requestId }); }
  const order = ctx("DOCTOR"); await recordRound(order, { admissionId, notes: "Actual recorded take-home prescription", orders: [{ kind: "MEDICINE", requestedItem: "Synthetic printable prescribed medicine", itemId: "DOC_PRINT_MED", dose: "1", doseUnit: "tablet", route: "oral", frequency: "W".repeat(1100) + "END", durationDays: 2, medicationPurpose: "TAKE_HOME", dispensingQuantity: "2", dispensingUnit: "tablet" }], requestId: order.requestId });
  const chart = await getCare(ctx("DOCTOR"), admissionId), orderId = chart.orders[0].id;
  const rx = await signClinicalSummary(ctx("DOCTOR"), { admissionId, expectedVersion: 0, diagnosis: "Pneumonia José - सावधानी", course: "Actual synthetic hospital course. ".repeat(36), condition: "Stable following responsible Doctor review", followUp: "Doctor follow-up in seven days; return for recorded worsening symptoms.", advice: "आराम करें - सावधानी रखें. No invented clinical advice.", prescriptionOrderIds: [orderId] });
  const stock = ctx("PHARMACY"), batch = await recordStockReceipt(stock, { medicineId: "DOC_PRINT_MED", batchNo: `PRINT-${randomUUID()}`, expiresOn: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 7 * 86400000)), quantity: "2", unit: "tablet", barcode: `PRINT-${randomUUID()}`, reference: "Synthetic actual print regression stock", requestId: stock.requestId });
  const prepare = ctx("PHARMACY"); await prepareTakeHomeMedicines(prepare, { admissionId, prescriptionVersionId: rx.id, items: [{ orderId, batchId: batch.id, quantity: "2", unit: "tablet" }], requestId: prepare.requestId });
  for (const [role, gate] of [["DOCTOR", "DOCTOR"], ["PHARMACY", "PHARMACY"], ["NURSE", "NURSING"]] as const) { const r = await getClearanceReview(ctx(role), admissionId, gate); await issueClearance(ctx(role), { admissionId, gate, expectedReviewHash: r.reviewHash }); }
  const vacate = ctx("NURSE"); await recordRoomVacated(vacate, { admissionId, shiftId: shift.id, vacatedAt: new Date().toISOString(), waitingLocation: "Actual discharge waiting chairs", handover: "Actual bed cutoff and continued attendance", requestId: vacate.requestId });
  const bill = await getBill(ctx("BILLING"), admissionId), receipt = ctx("BILLING"); await recordReceipt(receipt, { admissionId, party: "PATIENT", kind: "PAYMENT", amountPaise: bill.netPaise.toString(), mode: "CASH", channel: "Synthetic document cashbook", sourceReference: randomUUID(), reference: "x\n".repeat(90) + "END", requestId: receipt.requestId });
  const review = await getClearanceReview(ctx("BILLING"), admissionId, "BILLING"); await issueClearance(ctx("BILLING"), { admissionId, gate: "BILLING", expectedReviewHash: review.reviewHash, expectedBillVersion: review.billVersion });
  const exit = ctx("BILLING"); await recordDeparture(exit, { admissionId, departedAt: new Date().toISOString(), expectedBillVersion: review.billVersion, requestId: exit.requestId });
  writeFileSync(resolve("tmp/e2e-documents.json"), JSON.stringify({ admissionId }));
}
