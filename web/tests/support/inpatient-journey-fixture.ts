// Historical workflow-v1 coverage: create legacy episodes explicitly; current intake uses MVP v2.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../../src/server/db";
import { user } from "../../src/server/schema/auth";
import { listSettings, saveSetting } from "../../src/server/settings";
import { createLegacyAdmission, createBed, activateAdmission, transferAdmission } from "../../src/server/admissions/commands";
import * as clinical from "../../src/server/clinical/commands";
import * as nursing from "../../src/server/nursing/commands";
import * as pharmacy from "../../src/server/pharmacy/commands";
import * as lab from "../../src/server/lab/commands";
import * as insurance from "../../src/server/insurance/commands";
import * as billing from "../../src/server/billing/commands";
import * as discharge from "../../src/server/discharge/commands";
import * as exceptions from "../../src/server/discharge/exceptions";
import * as documents from "../../src/server/documents/commands";
import { attachCaseDocument } from "../../src/server/insurance/documents";
import { startPaperworkRun } from "../../src/server/insurance/paperwork-commands";
import type { CommandContext, StaffRole } from "../../src/server/contracts";

// These explicit rules are synthetic test policy, never hospital defaults.
export async function prepareInpatientJourney(adminHeaders: Headers) {
  const staff = await db.select({ id: user.id, email: user.email }).from(user);
  const id = (role: StaffRole) => staff.find(s => s.email === `${role.toLowerCase()}@e2e.fixture.invalid`)!.id;
  const ctx = (role: StaffRole): CommandContext => ({ actor: { type: "staff", staffId: id(role) }, source: "synthetic-whole-journey", requestId: randomUUID() });
  const now = () => new Date().toISOString();
  async function setting(value: Record<string, unknown>) {
    const state = await listSettings(adminHeaders), kind = ["tariff", "billable-item"].includes(String(value.type)) ? "tariff" : "rule";
    await saveSetting(adminHeaders, { value, expectedVersion: Math.max(0, ...state.versions.filter(v => v.kind === kind).map(v => v.version)), reason: "Synthetic whole-journey policy; not ordinary hospital configuration" });
  }
  for (const [code, name, amount] of [["JOURNEY_GENERAL", "Synthetic journey General", "600"], ["JOURNEY_ICU", "Synthetic journey ICU", "1200"]]) {
    await setting({ type: "bed-category", code, name, active: true });
    await setting({ type: "tariff", category: code, amount, basis: "hour", rounding: "started-unit", graceMinutes: 0 });
    for (const route of ["self-pay", "insured"]) await setting({ type: "deposit", category: code, route, requirement: "required", amount: "200" });
  }
  for (const [code, name, category, department, unit, amount] of [
    ["JOURNEY_CONSULT", "Synthetic journey consultation", "consultation", "DOCTOR", "session", "500"],
    ["JOURNEY_MED", "Synthetic journey prescribed medicine", "medicine", "PHARMACY", "tablet", "10"],
    ["JOURNEY_LAB", "Synthetic journey CBC", "lab", "LAB", "test", "300"],
    ["JOURNEY_RAD", "Synthetic journey radiology", "radiology", "LAB", "test", "500"],
    ["JOURNEY_USE", "Synthetic journey ward consumable", "consumable", "NURSE", "item", "50"],
  ]) await setting({ type: "billable-item", code, name, category, department, unit, quantityScale: 0, amount, active: true });

  async function admission(route: "SELF_PAY" | "INSURED", label: string) {
    const bed = await createBed(ctx("ADMIN"), { label: `${label} ${randomUUID()}`, category: "JOURNEY_GENERAL", reason: "Isolated synthetic journey bed" });
    const c = ctx("ADMISSION"), created = await createLegacyAdmission(c, { patientDetails: { name: label, ageYearsAtRegistration: 42, sex: "FEMALE" }, admittingDoctorId: id("DOCTOR"), clinicianAssessment: { clinicianId: id("DOCTOR"), assessedAt: now(), chiefComplaint: "Synthetic clinician-entered assessment", vitals: "Human synthetic observations", triage: "Human assessed General destination", destinationCategory: "JOURNEY_GENERAL" }, bedId: bed.id, paymentRoute: route, expectedStayDays: 1, requestId: c.requestId });
    return { admissionId: created.admissionId, bedId: bed.id, name: label };
  }
  async function cash(admissionId: string, party: "PATIENT" | "INSURER", amountPaise: string, kind: "DEPOSIT" | "PAYMENT") {
    const c = ctx("BILLING"), value = { admissionId, party, kind, amountPaise, mode: "CASH", channel: "Synthetic journey cashier book", sourceReference: randomUUID(), reference: "Actual synthetic funds recorded by human Billing", requestId: c.requestId };
    const pair = await Promise.all([billing.recordReceipt(c, value), billing.recordReceipt(c, value)]); assert.deepEqual(pair[0], pair[1]); return pair[0];
  }
  async function activate(admissionId: string) {
    const c = ctx("ADMISSION"), arrivedAt = now(), value = { admissionId, expectedVersion: 1, arrivedAt, requestId: c.requestId };
    const pair = await Promise.all([activateAdmission(c, value), activateAdmission(c, value)]); assert.deepEqual(pair[0], pair[1]);
    await nursing.assignNurse(ctx("ADMIN"), { admissionId, nurseId: id("NURSE"), authority: "Synthetic responsible ward roster", reason: "Actual synthetic assignment" });
    const n = ctx("NURSE"), shift = await nursing.recordShift(n, { admissionId, startedAt: now(), handover: "Actual incoming synthetic attendance", requestId: n.requestId });
    return { arrivedAt, shiftId: shift.id };
  }
  async function publish(admissionId: string) {
    const review = await documents.getDischargeDocumentReview(ctx("BILLING"), admissionId);
    const pair = await Promise.all([documents.createDischargeDocument(ctx("BILLING"), review.input), documents.createDischargeDocument(ctx("BILLING"), review.input)]);
    assert.deepEqual(pair[0], pair[1]); return pair[0];
  }
  async function journey(route: "SELF_PAY" | "INSURED") {
    const e = await admission(route, `Synthetic whole journey ${route}`), deposit = await cash(e.admissionId, "PATIENT", route === "SELF_PAY" ? "400000" : "60000", "DEPOSIT");
    const arrival = await activate(e.admissionId), scheduledAt = now(), roundCtx = ctx("DOCTOR");
    const round = await clinical.recordRound(roundCtx, { admissionId: e.admissionId, notes: "Whole-journey original signed findings", feeScheduleId: "JOURNEY_CONSULT", feeUnit: "session", orders: [
      { kind: "MEDICINE", requestedItem: "Synthetic journey prescribed medicine", itemId: "JOURNEY_MED", dose: "1", doseUnit: "tablet", route: "oral", frequency: "Single supervised occurrence and human home directions", durationDays: 1, medicationPurpose: "BOTH", dispensingQuantity: "2", dispensingUnit: "tablet", schedule: { startsAt: scheduledAt, intervalMinutes: 60, occurrences: 1 } },
      { kind: "VITALS", requestedItem: "Single human prescribed observation", schedule: { startsAt: scheduledAt, intervalMinutes: 60, occurrences: 1 } },
      { kind: "LAB", requestedItem: "Synthetic journey CBC", itemId: "JOURNEY_LAB", quantity: "1", unit: "test" },
      { kind: "RADIOLOGY", requestedItem: "Synthetic journey radiology", itemId: "JOURNEY_RAD", quantity: "1", unit: "test" },
    ], requestId: roundCtx.requestId });
    await clinical.addClinicalAddendum(ctx("DOCTOR"), { noteId: round.id, text: "Whole-journey signed correction retains original findings", reason: "Human clarification of original clinical record" });
    const chart = await clinical.getCare(ctx("DOCTOR"), e.admissionId), medicine = chart.orders.find(o => o.kind === "MEDICINE")!, observation = chart.orders.find(o => o.kind === "VITALS")!;
    const batchCtx = ctx("PHARMACY"), batch = await pharmacy.recordStockReceipt(batchCtx, { medicineId: "JOURNEY_MED", batchNo: randomUUID(), expiresOn: "2099-12-31", quantity: "10", unit: "tablet", barcode: `JOURNEY-${randomUUID()}`, reference: `Synthetic qualified delivery/${randomUUID()}/line1`, requestId: batchCtx.requestId });
    const issueCtx = ctx("PHARMACY"), issueInput = { admissionId: e.admissionId, orderId: medicine.id, batchId: batch.id, quantity: "2", unit: "tablet", requestId: issueCtx.requestId };
    const issues = await Promise.all([pharmacy.issueMedicine(issueCtx, issueInput), pharmacy.issueMedicine(issueCtx, issueInput)]); assert.deepEqual(issues[0], issues[1]);
    const marCtx = ctx("NURSE"); await nursing.recordAdministration(marCtx, { orderId: medicine.id, shiftId: arrival.shiftId, scheduledAt, actualAt: now(), actualDose: "1", doseUnit: "tablet", outcome: "GIVEN", requestId: marCtx.requestId });
    const vitals = ctx("NURSE"); await nursing.recordObservation(vitals, { admissionId: e.admissionId, shiftId: arrival.shiftId, orderId: observation.id, scheduledFor: scheduledAt, observedAt: now(), values: { pulse: 78, spo2: 98 }, requestId: vitals.requestId });
    await nursing.recordConsumable(ctx("NURSE"), { admissionId: e.admissionId, shiftId: arrival.shiftId, usedAt: now(), itemId: "JOURNEY_USE", quantity: "1", unit: "item", reason: "One actual ward consumable in original unit" });
    const returnCtx = ctx("PHARMACY"); await pharmacy.returnMedicine(returnCtx, { issueId: issues[0].id, quantity: "1", reason: "One unused sealed tablet actually returned", requestId: returnCtx.requestId });
    const sampleCtx = ctx("LAB"), diagnostic = chart.orders.find(o => o.kind === "LAB")!, sample = await lab.collectSample(sampleCtx, { orderId: diagnostic.id, requestId: sampleCtx.requestId });
    for (const order of chart.orders.filter(o => ["LAB", "RADIOLOGY"].includes(o.kind))) {
      const scan = order.kind === "LAB" ? { barcode: sample.barcode } : {};
      const process = ctx("LAB"); await lab.startLabProcessing(process, { orderId: order.id, ...scan, requestId: process.requestId });
      const reportCtx = ctx("LAB"), input = { orderId: order.id, ...scan, result: `Whole-journey human ${order.kind} result`, requestId: reportCtx.requestId };
      const reports = await Promise.all([lab.recordLabReport(reportCtx, input), lab.recordLabReport(reportCtx, input)]); assert.deepEqual(reports[0], reports[1]);
    }
    const target = await createBed(ctx("ADMIN"), { label: `Synthetic whole-journey ICU ${randomUUID()}`, category: "JOURNEY_ICU", reason: "Synthetic clinician-directed transfer destination" });
    const transferCtx = ctx("DOCTOR"), authority = await clinical.orderTransfer(transferCtx, { admissionId: e.admissionId, destinationCategory: "JOURNEY_ICU", reason: "Actual synthetic Doctor transfer instruction", requestId: transferCtx.requestId });
    const n = ctx("NURSE"), transferredAt = now(), transferInput = { admissionId: e.admissionId, transferOrderId: authority.id, targetBedId: target.id, handover: { shiftId: arrival.shiftId, notes: "Actual assigned Nurse handover at the exact boundary" }, transferredAt, requestId: n.requestId };
    const transfers = await Promise.all([transferAdmission(n, transferInput), transferAdmission(n, transferInput)]); assert.deepEqual(transfers[0], transfers[1]);
    const summary = await clinical.signClinicalSummary(ctx("DOCTOR"), { admissionId: e.admissionId, expectedVersion: 0, diagnosis: "Whole-journey human diagnosis", course: "Recorded actual care, human reports and exact ward transfer", condition: "Responsible Doctor recorded stable condition", followUp: "Human recorded follow-up", advice: "Human recorded advice", prescriptionOrderIds: [medicine.id] });
    const prep = ctx("PHARMACY"); await pharmacy.prepareTakeHomeMedicines(prep, { admissionId: e.admissionId, prescriptionVersionId: summary.id, items: [{ orderId: medicine.id, batchId: batch.id, quantity: "2", unit: "tablet" }], requestId: prep.requestId });
    for (const [role, gate] of [["DOCTOR", "DOCTOR"], ["PHARMACY", "PHARMACY"], ["NURSE", "NURSING"]] as const) {
      const r = await discharge.getClearanceReview(ctx(role), e.admissionId, gate); assert.deepEqual(r.blockers, []);
      await discharge.issueClearance(ctx(role), { admissionId: e.admissionId, gate, expectedReviewHash: r.reviewHash });
    }
    const vacancy = ctx("NURSE"), vacatedAt = now(); await discharge.recordRoomVacated(vacancy, { admissionId: e.admissionId, shiftId: arrival.shiftId, vacatedAt, waitingLocation: "Actual synthetic waiting chairs", handover: "Assigned nursing monitoring continues after bed cutoff", requestId: vacancy.requestId });
    assert(Date.parse(transferredAt) > Date.parse(arrival.arrivedAt)); assert(Date.parse(vacatedAt) > Date.parse(transferredAt)); assert(Date.parse(vacatedAt) - Date.parse(arrival.arrivedAt) < 3600000);
    const bill = await billing.getBill(ctx("BILLING"), e.admissionId); assert.equal(bill.grossPaise, 319000n); assert.equal(bill.reversedPaise, 1000n); assert.equal(bill.netPaise, 318000n);
    let caseId: string | null = null;
    if (route === "INSURED") {
      const c = ctx("ADMIN"), created = await insurance.createInsuranceCase(c, { admissionId: e.admissionId, assignedStaffId: id("INSURANCE"), reason: "Actual synthetic Insurance assignment", requestId: c.requestId }); caseId = created.id;
      const p = ctx("INSURANCE"); await insurance.recordPolicyVerification(p, { caseId, expectedCaseVersion: 1, insurer: "Synthetic external payer", tpa: "", policyNumber: "SYNTHETIC-JOURNEY", memberNumber: "SYNTHETIC-MEMBER", validFrom: "2026-01-01", validTo: "2099-12-31", verifiedBy: "Human synthetic verification clerk", verifiedAt: now(), reference: "External synthetic verification entered manually", documentIds: [], requestId: p.requestId });
      const d = ctx("INSURANCE"), decision = await insurance.recordPayerDecision(d, { caseId, expectedCaseVersion: 2, status: "APPROVED", kind: "PREAUTH", approvedPaise: "270000", coPayBps: 1000, verifiedBy: "Human synthetic payer record clerk", verifiedAt: now(), reference: "External synthetic authorization, never cash", reason: "Human entered current external decision", allocation: { billRevision: bill.revision, netBillPaise: "318000", eligibleBillPaise: "300000", nonPayablePaise: "18000", sourceReference: "Human reviewed itemized synthetic bill" }, documentIds: [], requestId: d.requestId });
      const tasks = await db.execute<{ id: string }>(sql`select id from hims.transfer_insurance_tasks where admission_id=${e.admissionId}`);
      assert.equal(tasks.rows.length, 1); const r = ctx("INSURANCE"); await insurance.resolveTransferInsuranceTask(r, { caseId, expectedCaseVersion: 3, taskId: tasks.rows[0].id, decisionId: decision.id, verifiedBy: "Human synthetic external transfer clerk", verifiedAt: now(), reference: "Actual external transfer review entered manually", reason: "Current external decision applies to recorded transfer", requestId: r.requestId });
      await cash(e.admissionId, "INSURER", "100000", "PAYMENT");
      const waiting = await discharge.getClearanceReview(ctx("BILLING"), e.admissionId, "BILLING"); assert(waiting.blockers.some(b => b.includes("Actual insurer money still owed")));
      await assert.rejects(discharge.issueClearance(ctx("BILLING"), { admissionId: e.admissionId, gate: "BILLING", expectedReviewHash: waiting.reviewHash, expectedBillVersion: waiting.billVersion }), { code: "PRECONDITION" });
      await cash(e.admissionId, "INSURER", "170000", "PAYMENT");
    }
    const allocate = ctx("BILLING"); await billing.allocateDeposit(allocate, { receiptId: deposit.id, amountPaise: route === "SELF_PAY" ? "318000" : "48000", reason: "Apply existing cash once against reviewed patient responsibility", requestId: allocate.requestId });
    const beforeRefund = await discharge.getClearanceReview(ctx("BILLING"), e.admissionId, "BILLING"), refund = ctx("BILLING");
    await billing.refundReceipt(refund, { receiptId: deposit.id, amountPaise: route === "SELF_PAY" ? "82000" : "12000", reason: "Return actual excess patient deposit", expectedReviewHash: beforeRefund.reviewHash, expectedBillVersion: beforeRefund.billVersion, mode: "CASH", channel: "Synthetic journey cashier book", sourceReference: randomUUID(), evidence: "Human recorded actual returned cash", refundedAt: now(), requestId: refund.requestId });
    await assert.rejects(discharge.issueClearance(ctx("BILLING"), { admissionId: e.admissionId, gate: "BILLING", expectedReviewHash: beforeRefund.reviewHash, expectedBillVersion: beforeRefund.billVersion }), { code: "CONFLICT" });
    const final = await discharge.getClearanceReview(ctx("BILLING"), e.admissionId, "BILLING"); assert.deepEqual(final.blockers, []);
    await discharge.issueClearance(ctx("BILLING"), { admissionId: e.admissionId, gate: "BILLING", expectedReviewHash: final.reviewHash, expectedBillVersion: final.billVersion });
    const exit = ctx("BILLING"), departedAt = now(), exitInput = { admissionId: e.admissionId, departedAt, expectedBillVersion: final.billVersion, requestId: exit.requestId };
    const exits = await Promise.all([discharge.recordDeparture(exit, exitInput), discharge.recordDeparture(exit, exitInput)]); assert.deepEqual(exits[0], exits[1]);
    const original = await publish(e.admissionId);
    const amendment = await exceptions.authorizeException(ctx("ADMIN"), { admissionId: e.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correctionKind: "CLINICAL_ADDENDUM", sourceId: round.id, authority: "Responsible synthetic administrator", reason: "Route factual later Doctor addendum", evidenceIds: [], evidence: "Original clinical source is retained", followUpOwnerId: id("DOCTOR") });
    await exceptions.applyPostDischargeCorrection(ctx("DOCTOR"), { admissionId: e.admissionId, exceptionId: amendment.id, kind: "CLINICAL_ADDENDUM", sourceId: round.id, data: { text: "Whole-journey attributable post-discharge addendum", reason: "Later human correction retains original signed document" } });
    const amended = await publish(e.admissionId); assert.equal(original.version, 1); assert.equal(amended.version, 2); assert.notEqual(original.documentId, amended.documentId);
    const totals = await billing.getBill(ctx("BILLING"), e.admissionId); assert.equal(totals.netPaise, 318000n); assert.equal(totals.retainedPaise, 318000n); assert.equal(totals.outstandingPaise, 0n);
    const physical = await db.execute<{ old_end: Date; new_start: Date; vacated: Date; departed: Date; seals: number; departures: number; holds: number }>(sql`select s.ended_at old_end,t.started_at new_start,v.vacated_at vacated,d.departed_at departed,(select count(*)::int from hims.clearance_seals where admission_id=${e.admissionId}) seals,(select count(*)::int from hims.departures where admission_id=${e.admissionId}) departures,(select count(*)::int from hims.bed_holds where admission_id=${e.admissionId}) holds from hims.room_stays s join hims.room_stays t on t.admission_id=s.admission_id and t.id<>s.id join hims.room_vacations v on v.admission_id=s.admission_id join hims.departures d on d.admission_id=s.admission_id where s.id=${transfers[0].oldStayId}`);
    const instant = (value: Date | string) => new Date(value).toISOString();
    assert.equal(instant(physical.rows[0].old_end), transferredAt); assert.equal(instant(physical.rows[0].new_start), transferredAt); assert.equal(instant(physical.rows[0].vacated), vacatedAt); assert.equal(instant(physical.rows[0].departed), departedAt); assert.equal(physical.rows[0].seals, 4); assert.equal(physical.rows[0].departures, 1); assert.equal(physical.rows[0].holds, 0);
    return { ...e, caseId, sampleId: sample.id, labOrderId: diagnostic.id, originalDocumentId: original.documentId, amendedDocumentId: amended.documentId, transferredAt, vacatedAt, departedAt, netPaise: "318000", patientRefundPaise: route === "SELF_PAY" ? "82000" : "12000" };
  }
  const selfPay = await journey("SELF_PAY"), insured = await journey("INSURED");
  const exceptional = await admission("SELF_PAY", "Synthetic whole-journey exceptional exit"), deposit = await cash(exceptional.admissionId, "PATIENT", "20000", "DEPOSIT"), active = await activate(exceptional.admissionId);
  void deposit;
  const round = ctx("DOCTOR"); await clinical.recordRound(round, { admissionId: exceptional.admissionId, notes: "Actual synthetic early-exit clinical findings", feeScheduleId: "JOURNEY_CONSULT", feeUnit: "session", orders: [], requestId: round.requestId });
  const T = now(), witness = await exceptions.recordExceptionEvidence(ctx("NURSE"), { admissionId: exceptional.admissionId, kind: "PHYSICAL_EXIT", shiftId: active.shiftId, actualAt: T, vacatedAt: T, notes: "Assigned Nurse actually witnessed synthetic early departure" });
  const authority = await exceptions.authorizeException(ctx("ADMIN"), { admissionId: exceptional.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Responsible synthetic administrator", reason: "Record actual exit with unpaid money and missing Doctor advice", evidenceIds: [witness.id], evidence: "Actual human witnessed facts; debt remains", followUpOwnerId: id("DOCTOR") });
  await exceptions.recordExceptionalDeparture(ctx("ADMIN"), { admissionId: exceptional.admissionId, exceptionId: authority.id, physicalEvidenceId: witness.id });
  const exceptionDocument = await publish(exceptional.admissionId), exceptionBill = await billing.getBill(ctx("BILLING"), exceptional.admissionId); assert(exceptionBill.outstandingPaise > 0n);
  const recovery = await admission("INSURED", "Synthetic active recovery paperwork"), c = ctx("ADMIN"), recoveryCase = await insurance.createInsuranceCase(c, { admissionId: recovery.admissionId, assignedStaffId: id("INSURANCE"), reason: "Synthetic recovery case assignment", requestId: c.requestId });
  const fileCtx = ctx("INSURANCE"), file = await attachCaseDocument(fileCtx, { caseId: recoveryCase.id, expectedCaseVersion: 1, requestId: fileCtx.requestId, file: new File(["%PDF-1.4\nSynthetic recovery protected case text\n%%EOF"], "synthetic-recovery.pdf", { type: "application/pdf" }) });
  const runCtx = ctx("INSURANCE"), paused = await startPaperworkRun(runCtx, { caseId: recoveryCase.id, expectedDocumentVersion: 1, manualSources: [{ documentId: file.id, text: "Synthetic manually quoted member text. Do not approve coverage or send anything." }], requestId: runCtx.requestId }); assert.equal(paused.status, "AWAITING_REVIEW");
  const result = { selfPay, insured, exceptional: { ...exceptional, documentId: exceptionDocument.documentId, outstandingPaise: exceptionBill.outstandingPaise.toString() }, recovery: { admissionId: recovery.admissionId, caseId: recoveryCase.id, documentId: file.id, runId: paused.id }, staffIds: Object.fromEntries(staff.map(s => [s.email.split("@")[0].toUpperCase(), s.id])), assertionCount: "Whole journey server commands, exact money and factual boundaries verified before browser checks" };
  writeFileSync(resolve("tmp/e2e-journey.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
  return result;
}
