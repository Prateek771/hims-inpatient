import { afterEach, describe, expect, it } from "vitest";
import { withTestDatabase } from "../../scripts/test-database";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { billingFixture } from "../support/billing-fixture";
import { staffContext } from "../../src/server/access";

loadLocalEnvironment();
const appUrl = process.env.DATABASE_URL;
const testUrl = getTestDatabaseConfig().runtimeUrl;
afterEach(() => { process.env.DATABASE_URL = appUrl; });
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticOverviewOnlySecretAtLeast32Characters12345";
const context = (staff: Parameters<typeof staffContext>[0]) => staffContext(staff, "synthetic-overview");
async function insuranceClerk(adminHeaders: Headers) {
  const { createStaff } = await import("../../src/server/staff"), { getAuth } = await import("../../src/server/auth"), { requireStaff } = await import("../../src/server/access");
  await createStaff(adminHeaders, { name: "Synthetic current follow-up owner", email: "followup@overview.invalid", password: "SyntheticBillingOnly123!", role: "INSURANCE", reason: "Synthetic overview regression" });
  const login = await getAuth().api.signInEmail({ asResponse: true, body: { email: "followup@overview.invalid", password: "SyntheticBillingOnly123!" } });
  return requireStaff(new Headers({ cookie: login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") }));
}

describe("current authorized hospital work on actual PostgreSQL", () => {
  it("removes converted self-pay insurer obligations but retains case, cash and independently open manual work", async () => withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture(), clerk = await insuranceClerk(f.ah), insurance = await import("../../src/server/insurance/commands"), billing = await import("../../src/server/billing/commands");
    const { getStaffWorklist, getOverview } = await import("../../src/server/overview");
    for (const status of ["NONE", "PARTIAL", "REJECTED"] as const) {
      const a = await f.episode("INSURED"), create = context(f.admin);
      const c = await insurance.createInsuranceCase(create, { admissionId: a.admissionId, assignedStaffId: clerk.id, reason: "Current retained case", requestId: create.requestId });
      await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) values($1,$2,'synthetic','room','GENERAL','Synthetic conversion bill','1','hour',$3,100000,100000,'FINAL','staff',$4)", [a.admissionId, `conversion-${a.admissionId}`, f.room.id, f.cashier.id]);
      const cash = context(f.cashier);
      await billing.recordReceipt(cash, { admissionId: a.admissionId, party: "INSURER", kind: "PAYMENT", amountPaise: "40000", mode: "BANK", channel: "Synthetic received money", sourceReference: `cash-${a.admissionId}`, reference: "Actual retained insurer cash", requestId: cash.requestId });
      if (status !== "NONE") {
        const p = context(clerk);
        await insurance.recordPolicyVerification(p, { caseId: c.id, expectedCaseVersion: 1, requestId: p.requestId, insurer: "Synthetic external payer", tpa: "", policyNumber: "FIX1-POL", memberNumber: "FIX1-MEM", validFrom: "2026-01-01", validTo: "2099-12-31", verifiedBy: "External human", verifiedAt: new Date().toISOString(), reference: "FIX1-POLICY", documentIds: [] });
        const bill = await insurance.getInsuranceCase(context(clerk), c.id), d = context(clerk);
        await insurance.recordPayerDecision(d, { caseId: c.id, expectedCaseVersion: bill.case.version, requestId: d.requestId, status, kind: "PREAUTH", verifiedBy: "External human", verifiedAt: new Date().toISOString(), reference: "FIX1-DECISION", reason: "Retained external response", approvedPaise: status === "PARTIAL" ? "40000" : "0", coPayBps: 0, documentIds: [], allocation: { billRevision: bill.money.revision, netBillPaise: "100000", eligibleBillPaise: "100000", nonPayablePaise: "0", verifiedPatientLiabilityPaise: status === "PARTIAL" ? "60000" : "100000", sourceReference: "Synthetic reviewed response" } });
      }
      const workId = crypto.randomUUID(), beforeWork = await insurance.getInsuranceCase(context(clerk), c.id), open = context(clerk);
      await insurance.recordInsuranceFollowup(open, { caseId: c.id, expectedCaseVersion: beforeWork.case.version, requestId: open.requestId, workId, kind: "APPEAL", status: "OPEN", reference: "FIX1-INDEPENDENT", reason: "Human explicitly retained follow-up" });
      const prior = await insurance.getInsuranceCase(context(clerk), c.id), priorCash = (await runtime.query("select * from hims.receipts where admission_id=$1 order by id", [a.admissionId])).rows, convert = context(f.admin);
      await insurance.convertToSelfPay(convert, { caseId: c.id, expectedCaseVersion: prior.case.version, requestId: convert.requestId, reason: "Verified self-pay conversion after external response", decisionReference: "FIX1-CONVERSION", verifiedBy: "External human", verifiedAt: new Date().toISOString(), allocation: { billRevision: prior.money.revision, netBillPaise: "100000", retainedInsurerLiabilityPaise: "40000", verifiedPatientLiabilityPaise: "60000", sourceReference: "Every paise explicitly resolved" } });
      const own = await getStaffWorklist(context(clerk)), obsolete = new Set(["MISSING_PAPERWORK", "PAYER_DECISION", "PAPERWORK_REVIEW", "INSURER_LIMIT", "INSURANCE_TRANSFER"]);
      expect(own.alerts.filter(a => a.caseId === c.id && obsolete.has(a.kind))).toHaveLength(0);
      expect(own.episodes.some(e => e.id === a.admissionId)).toBe(true);
      expect(own.alerts.find(a => a.id === `INSURANCE_FOLLOWUP:${c.id}:${workId}`)).toMatchObject({ ownerRole: "INSURANCE", href: `/insurance?caseId=${c.id}` });
      expect(own.financial.find(e => e.admissionId === a.admissionId)).toMatchObject({ netPaise: "100000", insurerCashPaise: "40000", insurerDuePaise: "0", patientDuePaise: "60000", allocationCurrent: true });
      const admin = await getOverview(context(f.admin), { asOf: new Date() });
      expect(admin.alerts.filter(a => a.caseId === c.id && obsolete.has(a.kind))).toHaveLength(0);
      expect((await getStaffWorklist(context(f.cashier))).alerts.find(alert => alert.admissionId === a.admissionId && alert.kind === "PATIENT_SETTLEMENT" && alert.caseId === c.id)).toMatchObject({ amountPaise: "60000", ownerRole: "BILLING" });
      const retained = await insurance.getInsuranceCase(context(clerk), c.id);
      expect(retained.episode.paymentRoute).toBe("SELF_PAY");
      expect(retained.decisions).toEqual(prior.decisions);
      expect(retained.events).toEqual(prior.events);
      expect((await runtime.query("select * from hims.receipts where admission_id=$1 order by id", [a.admissionId])).rows).toEqual(priorCash);
      const complete = context(clerk);
      await insurance.recordInsuranceFollowup(complete, { caseId: c.id, expectedCaseVersion: retained.case.version, requestId: complete.requestId, workId, kind: "APPEAL", status: "COMPLETED", reference: "FIX1-OUTCOME", reason: "Human completed retained follow-up" });
      expect((await getStaffWorklist(context(clerk))).alerts.some(a => a.id === `INSURANCE_FOLLOWUP:${c.id}:${workId}`)).toBe(false);
    }
  }));

  it("keeps independent latest manual preauth enhancement and appeal work across unrelated changes, clearing only completed or revoked work", async () => withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture(), clerk = await insuranceClerk(f.ah), insurance = await import("../../src/server/insurance/commands"), { getStaffWorklist, getOverview } = await import("../../src/server/overview");
    const a = await f.episode("INSURED"), create = context(f.admin);
    const c = await insurance.createInsuranceCase(create, { admissionId: a.admissionId, assignedStaffId: clerk.id, reason: "Current follow-up case", requestId: create.requestId });
    const p = context(clerk);
    await insurance.recordPolicyVerification(p, { caseId: c.id, expectedCaseVersion: 1, requestId: p.requestId, insurer: "Synthetic external payer", tpa: "", policyNumber: "FIX1-POL", memberNumber: "FIX1-MEM", validFrom: "2026-01-01", validTo: "2099-12-31", verifiedBy: "External human", verifiedAt: new Date().toISOString(), reference: "FIX1-VERIFY", documentIds: [] });
    const d = context(clerk);
    await insurance.recordPayerDecision(d, { caseId: c.id, expectedCaseVersion: 2, requestId: d.requestId, status: "APPROVED", kind: "PREAUTH", verifiedBy: "External human", verifiedAt: new Date().toISOString(), reference: "FIX1-AUTH", reason: "External approval with complete zero posted allocation", approvedPaise: "100000", coPayBps: 0, documentIds: [], allocation: { billRevision: 1, netBillPaise: "0", eligibleBillPaise: "0", nonPayablePaise: "0", sourceReference: "Current zero posted bill" } });
    const { attachCaseDocument } = await import("../../src/server/insurance/documents"), file = context(clerk);
    process.env.HIMS_INSURANCE_STORAGE = "synthetic";
    await attachCaseDocument(file, { caseId: c.id, expectedCaseVersion: 3, requestId: file.requestId, file: new File(["%PDF-1.4\nSynthetic follow-up evidence only\n%%EOF"], "fix1-evidence.pdf", { type: "application/pdf" }) });
    const items = (["PREAUTH", "ENHANCEMENT", "APPEAL"] as const).map(kind => ({ kind, workId: crypto.randomUUID() }));
    for (const item of items) {
      const review = await insurance.getInsuranceCase(context(clerk), c.id), open = context(clerk);
      await insurance.recordInsuranceFollowup(open, { caseId: c.id, expectedCaseVersion: review.case.version, requestId: open.requestId, ...item, status: "OPEN", reference: `FIX1-${item.kind}`, reason: `Explicit ${item.kind} human follow-up` });
    }
    const review = await insurance.getInsuranceCase(context(clerk), c.id), assign = context(f.admin);
    await insurance.assignInsuranceCase(assign, { caseId: c.id, expectedCaseVersion: review.case.version, requestId: assign.requestId, assignedStaffId: clerk.id, reason: "Unrelated current assignment reaffirmed" });
    const effects = async () => (await runtime.query("select (select count(*) from hims.insurance_events) events,(select count(*) from hims.insurance_cases) cases,(select count(*) from hims.paperwork_runs) runs,(select count(*) from hims.audit_events) audit,(select count(*) from hims.care_tasks) tasks,(select count(*) from hims.charges) charges,(select count(*) from hims.receipts) receipts,(select count(*) from hims.clearance_invalidations) invalidations")).rows;
    const before = await effects(), ids = items.map(item => `INSURANCE_FOLLOWUP:${c.id}:${item.workId}`).sort();
    for (let i = 0; i < 2; i++) {
      const work = await getStaffWorklist(context(clerk));
      expect(work.alerts.map(a => a.id).sort()).toEqual(ids);
      expect(work.alerts.every(a => a.ownerRole === "INSURANCE" && a.href === `/insurance?caseId=${c.id}`)).toBe(true);
      const admin = await getOverview(context(f.admin), { asOf: new Date() });
      expect(admin.alerts.map(a => a.id).sort()).toEqual(ids);
      expect(admin.metrics.needsAttention).toBe(3);
    }
    expect(await effects()).toEqual(before);
    const current = await insurance.getInsuranceCase(context(clerk), c.id), revoke = context(f.admin);
    await insurance.assignInsuranceCase(revoke, { caseId: c.id, expectedCaseVersion: current.case.version, requestId: revoke.requestId, assignedStaffId: null, reason: "Current assignment revoked" });
    const revoked = await getStaffWorklist(context(clerk));
    expect(revoked.episodes).toHaveLength(0); expect(revoked.alerts).toHaveLength(0);
    const unassigned = await insurance.getInsuranceCase(context(f.admin), c.id), restore = context(f.admin);
    await insurance.assignInsuranceCase(restore, { caseId: c.id, expectedCaseVersion: unassigned.case.version, requestId: restore.requestId, assignedStaffId: clerk.id, reason: "Assignment explicitly restored" });
    expect((await getStaffWorklist(context(clerk))).alerts.map(a => a.id).sort()).toEqual(ids);
    for (let i = 0; i < items.length; i++) {
      const current = await insurance.getInsuranceCase(context(clerk), c.id), complete = context(clerk);
      await insurance.recordInsuranceFollowup(complete, { caseId: c.id, expectedCaseVersion: current.case.version, requestId: complete.requestId, ...items[i], status: "COMPLETED", reference: `FIX1-${items[i].kind}-DONE`, reason: "Human attributable follow-up outcome" });
      expect((await getStaffWorklist(context(clerk))).alerts.map(a => a.id).sort()).toEqual(items.slice(i + 1).map(item => `INSURANCE_FOLLOWUP:${c.id}:${item.workId}`).sort());
      expect((await getOverview(context(f.admin), { asOf: new Date() })).metrics.needsAttention).toBe(items.length - i - 1);
    }
    const history = await insurance.getInsuranceCase(context(clerk), c.id);
    expect(history.events.filter(e => e.kind === "FOLLOWUP")).toHaveLength(6);
  }));

  it("counts actual bed states, scopes roles and reads without effects or clinical-chart leakage", async () => withTestDatabase(async ({ runtime, owner }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture();
    const { getOverview, getStaffWorklist } = await import("../../src/server/overview");
    const pending = await f.episode();
    let overview = await getOverview(context(f.admin), { asOf: new Date() });
    expect(overview.metrics).toMatchObject({ activeAdmissions: 0, pendingAdmissions: 1, reservedBeds: 1, occupiedBeds: 0 });
    expect(overview.metrics).toMatchObject({ totalBeds: 1 });
    expect(overview.bedOccupancy).toEqual([{ code: "GENERAL", name: "Synthetic General", total: 1, occupied: 0, reserved: 1, cleaning: 0, ready: 0, disabled: 0 }]);
    expect(overview.physicalBeds).toEqual([{ id: expect.any(String), category: "GENERAL", occupied: false, reserved: true, cleaning: false, ready: false, disabled: false }]);
    expect(overview.configuration.stockThresholds).toBe("NO_STOCK");
    await expect(getOverview(context(f.doctor), { asOf: new Date() })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const unsupported = { asOf: new Date(), wardId: "invented" };
    await expect(getOverview(context(f.admin), unsupported)).rejects.toThrow();
    await expect(getOverview(context(f.admin), { asOf: new Date(), bedCategory: "UNKNOWN" })).rejects.toMatchObject({ code: "VALIDATION" });
    await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
    const a = f.deskCtx();
    await (await import("../../src/server/admissions/commands")).activateAdmission(a, { admissionId: pending.admissionId, arrivedAt: new Date().toISOString(), expectedVersion: 1, requestId: a.requestId });
    overview = await getOverview(context(f.admin), { asOf: new Date(), bedCategory: "GENERAL" });
    expect(overview.metrics).toMatchObject({ activeAdmissions: 1, pendingAdmissions: 0, occupiedBeds: 1, reservedBeds: 0 });
    expect(overview.bedOccupancy).toEqual([{ code: "GENERAL", name: "Synthetic General", total: 1, occupied: 1, reserved: 0, cleaning: 0, ready: 0, disabled: 0 }]);
    expect(overview.physicalBeds).toEqual([{ id: expect.any(String), category: "GENERAL", occupied: true, reserved: false, cleaning: false, ready: false, disabled: false }]);
    const before = (await runtime.query("select (select count(*) from hims.audit_events) audit,(select count(*) from hims.clearance_invalidations) invalidations,(select count(*) from hims.care_tasks) tasks,(select count(*) from hims.charges) charges")).rows;
    const first = await getStaffWorklist(context(f.admin));
    const second = await getStaffWorklist(context(f.admin));
    expect(first.alerts.map(a => a.id)).toEqual(second.alerts.map(a => a.id));
    expect(new Set(first.alerts.map(a => a.id)).size).toBe(first.alerts.length);
    expect((await runtime.query("select (select count(*) from hims.audit_events) audit,(select count(*) from hims.clearance_invalidations) invalidations,(select count(*) from hims.care_tasks) tasks,(select count(*) from hims.charges) charges")).rows).toEqual(before);
    expect(JSON.stringify(first)).not.toContain("Synthetic complaint");
    expect((await getStaffWorklist(context(f.nurse))).episodes).toHaveLength(0);
    const n = await import("../../src/server/nursing/commands");
    const assignment = await n.assignNurse(context(f.admin), { admissionId: pending.admissionId, nurseId: f.nurse.id, authority: "Synthetic owner", reason: "Synthetic current assignment" });
    expect((await getStaffWorklist(context(f.nurse))).episodes).toHaveLength(1);
    await n.revokeNurseAssignment(context(f.admin), { assignmentId: assignment.id, authority: "Synthetic owner", reason: "Synthetic handoff complete" });
    expect((await getStaffWorklist(context(f.nurse))).episodes).toHaveLength(0);
    await owner.query("update hims.staff_user set banned=true where id=$1", [f.doctor.id]);
    await expect(getStaffWorklist(context(f.doctor))).rejects.toMatchObject({ code: "FORBIDDEN" });
  }));

  it("keeps overdue prescribed observations and MAR across handover, clearing recorded/stopped work", async () => withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture();
    const care = await import("../../src/server/clinical/commands"), n = await import("../../src/server/nursing/commands");
    const { getStaffWorklist } = await import("../../src/server/overview");
    await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
    const a = await f.episode(), start = new Date(), ac = f.deskCtx();
    await (await import("../../src/server/admissions/commands")).activateAdmission(ac, { admissionId: a.admissionId, arrivedAt: start.toISOString(), expectedVersion: 1, requestId: ac.requestId });
    await n.assignNurse(context(f.admin), { admissionId: a.admissionId, nurseId: f.nurse.id, authority: "Synthetic owner", reason: "Synthetic current assignment" });
    const dc = context(f.doctor);
    await care.recordRound(dc, { admissionId: a.admissionId, notes: "PRIVATE clinical content must never enter admin worklist", orders: [
      { kind: "VITALS", requestedItem: "Prescribed observations", schedule: { startsAt: start.toISOString(), intervalMinutes: 1, occurrences: 2 } },
      { kind: "MEDICINE", requestedItem: "Unresolved medicine", dose: "1", doseUnit: "mg", route: "oral", frequency: "explicit schedule", durationDays: 1, medicationPurpose: "WARD", schedule: { startsAt: start.toISOString(), intervalMinutes: 1, occurrences: 2 } },
    ], requestId: dc.requestId });
    const asOf = new Date(start.getTime() + 120000);
    const work = await getStaffWorklist(context(f.nurse), { asOf });
    expect(work.alerts.filter(a => a.kind === "OVERDUE_OBSERVATION")).toHaveLength(2);
    expect(work.alerts.filter(a => a.kind === "OVERDUE_MAR")).toHaveLength(2);
    expect(work.alerts.every(a => a.ownerRole === "NURSE")).toBe(true);
    const sc = context(f.nurse), shift = await n.recordShift(sc, { admissionId: a.admissionId, startedAt: start.toISOString(), handover: "Synthetic incoming handover", requestId: sc.requestId });
    const occurrence = (await runtime.query("select c.order_id,c.scheduled_at from hims.care_occurrences c join hims.clinical_orders o on o.id=c.order_id where o.kind='VITALS' order by scheduled_at")).rows[0];
    const observation = context(f.nurse);
    await n.recordObservation(observation, { admissionId: a.admissionId, shiftId: shift.id, orderId: occurrence.order_id, scheduledFor: occurrence.scheduled_at.toISOString(), observedAt: new Date().toISOString(), values: { pulse: 78 }, requestId: observation.requestId });
    expect((await getStaffWorklist(context(f.nurse), { asOf })).alerts.filter(a => a.kind === "OVERDUE_OBSERVATION")).toHaveLength(1);
    const endedAt = new Date().toISOString();
    await n.endShift(context(f.nurse), { shiftId: shift.id, endedAt, handover: "Actual outgoing handover" });
    expect((await getStaffWorklist(context(f.nurse), { asOf })).alerts.filter(a => a.kind === "HANDOVER")).toHaveLength(1);
    const incoming = context(f.nurse);
    await n.recordShift(incoming, { admissionId: a.admissionId, startedAt: endedAt, handover: "Actual incoming handover", requestId: incoming.requestId });
    const afterHandover = await getStaffWorklist(context(f.nurse), { asOf });
    expect(afterHandover.alerts.filter(a => a.kind === "HANDOVER")).toHaveLength(0);
    expect(afterHandover.alerts.filter(a => a.kind === "OVERDUE_OBSERVATION")).toHaveLength(1);
    const order = (await runtime.query("select id from hims.clinical_orders where kind='MEDICINE'")).rows[0].id;
    await care.stopClinicalOrder(context(f.doctor), { orderId: order, reason: "Synthetic Doctor stopped prescription" });
    expect((await getStaffWorklist(context(f.nurse), { asOf })).alerts.filter(a => a.kind === "OVERDUE_MAR")).toHaveLength(0);
    expect(JSON.stringify(await getStaffWorklist(context(f.admin)))).not.toContain("PRIVATE clinical content");
  }));

  it("uses actual ward issues and current home preparation, with configured stock thresholds only", async () => withTestDatabase(async () => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture(), care = await import("../../src/server/clinical/commands"), pharmacy = await import("../../src/server/pharmacy/commands");
    const { getStaffWorklist } = await import("../../src/server/overview");
    await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
    await f.setting({ type: "billable-item", code: "OV_MED", name: "Synthetic exact medicine", category: "medicine", department: "PHARMACY", unit: "tablet", quantityScale: 0, amount: "101", active: true });
    const a = await f.episode(), ac = f.deskCtx(), arrivedAt = new Date().toISOString();
    await (await import("../../src/server/admissions/commands")).activateAdmission(ac, { admissionId: a.admissionId, arrivedAt, expectedVersion: 1, requestId: ac.requestId });
    const dc = context(f.doctor);
    await care.recordRound(dc, { admissionId: a.admissionId, notes: "Private medicine note", orders: [{ kind: "MEDICINE", requestedItem: "Synthetic exact medicine", itemId: "OV_MED", dose: "5", doseUnit: "mg", route: "oral", frequency: "explicit schedule", durationDays: 1, medicationPurpose: "WARD", schedule: { startsAt: arrivedAt, intervalMinutes: 60, occurrences: 2 } }], requestId: dc.requestId });
    const order = (await care.getCare(context(f.doctor), a.admissionId)).orders[0];
    await f.setting({ type: "bed-category", code: "OTHER", name: "Other synthetic category", active: true });
    expect((await getStaffWorklist(context(f.pharmacy), { bedCategory: "OTHER" })).episodes).toHaveLength(0);
    const summary = await care.signClinicalSummary(context(f.doctor), { admissionId: a.admissionId, expectedVersion: 0, diagnosis: "Synthetic diagnosis", course: "Synthetic course", condition: "Stable", followUp: "Human follow up", advice: "Human advice", prescriptionOrderIds: [] });
    const pc = context(f.pharmacy);
    const stock = await pharmacy.recordStockReceipt(pc, { medicineId: "OV_MED", batchNo: "OV-STOCK", expiresOn: "2099-12-31", quantity: "2", unit: "tablet", barcode: "OV-STOCK-BARCODE", reference: "Synthetic stock-book/invoice/line1", reorderThreshold: "2", requestId: pc.requestId });
    const unconfigured = context(f.pharmacy);
    await pharmacy.recordStockReceipt(unconfigured, { medicineId: "OV_MED", batchNo: "NO-THRESHOLD", expiresOn: "2099-12-31", quantity: "1", unit: "tablet", barcode: "NO-THRESHOLD", reference: "Synthetic stock-book/invoice/line2", requestId: unconfigured.requestId });
    let work = await getStaffWorklist(context(f.pharmacy));
    expect(work.configuration.stockThresholds).toBe("PARTLY_OR_NOT_CONFIGURED");
    expect(work.alerts.filter(a => a.kind === "LOW_STOCK")).toHaveLength(1);
    expect(work.alerts.filter(a => a.kind === "PHARMACY_RECONCILIATION")).toHaveLength(1);
    const issue = context(f.pharmacy);
    await pharmacy.issueMedicine(issue, { admissionId: a.admissionId, orderId: order.id, batchId: stock.id, quantity: "1", unit: "tablet", requestId: issue.requestId });
    const prepare = context(f.pharmacy);
    await pharmacy.prepareTakeHomeMedicines(prepare, { admissionId: a.admissionId, prescriptionVersionId: summary.id, items: [], requestId: prepare.requestId });
    work = await getStaffWorklist(context(f.pharmacy));
    expect(work.alerts.filter(a => a.kind === "PHARMACY_RECONCILIATION")).toHaveLength(0);
    const receive = context(f.pharmacy);
    await pharmacy.recordStockReceipt(receive, { medicineId: "OV_MED", batchNo: "OV-STOCK", expiresOn: "2099-12-31", quantity: "4", unit: "tablet", barcode: "OV-STOCK-BARCODE", reference: "Synthetic stock-book/invoice2/line1", requestId: receive.requestId });
    expect((await getStaffWorklist(context(f.pharmacy))).alerts.filter(a => a.kind === "LOW_STOCK")).toHaveLength(0);
  }));

  it("keeps authorization separate from partial cash, with source-default/configured ratios and current case ownership", async () => withTestDatabase(async ({ runtime, owner }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture(), insurance = await import("../../src/server/insurance/commands"), billing = await import("../../src/server/billing/commands");
    const { createStaff } = await import("../../src/server/staff"), { getAuth } = await import("../../src/server/auth"), { requireStaff } = await import("../../src/server/access");
    const { getStaffWorklist } = await import("../../src/server/overview");
    await createStaff(f.ah, { name: "Synthetic insurance owner", email: "insurance@billing.invalid", password: "SyntheticBillingOnly123!", role: "INSURANCE", reason: "Synthetic case purpose" });
    const login = await getAuth().api.signInEmail({ asResponse: true, body: { email: "insurance@billing.invalid", password: "SyntheticBillingOnly123!" } });
    const clerk = await requireStaff(new Headers({ cookie: login.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") }));
    const a = await f.episode("INSURED"), create = context(f.admin);
    const c = await insurance.createInsuranceCase(create, { admissionId: a.admissionId, assignedStaffId: clerk.id, reason: "Current assigned case", requestId: create.requestId });
    let work = await getStaffWorklist(context(clerk));
    expect(work.alerts.filter(a => a.kind === "MISSING_PAPERWORK")).toHaveLength(1);
    expect(work.financial[0].insurerDuePaise).toBeNull();
    expect(work.alerts.filter(a => a.kind === "INSURER_LIMIT")).toHaveLength(0);
    const p = context(clerk);
    await insurance.recordPolicyVerification(p, { caseId: c.id, expectedCaseVersion: 1, requestId: p.requestId, insurer: "Synthetic payer", tpa: "", policyNumber: "OV-POL", memberNumber: "OV-MEM", validFrom: "2026-01-01", validTo: "2027-01-01", verifiedBy: "External staff", verifiedAt: new Date().toISOString(), reference: "OV-VERIFY", documentIds: [] });
    await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) values($1,'overview-insured-bill','synthetic','room','GENERAL','Synthetic bill','1','hour',$2,100000,100000,'FINAL','staff',$3)", [a.admissionId, f.room.id, f.cashier.id]);
    const d = context(clerk);
    await insurance.recordPayerDecision(d, { caseId: c.id, expectedCaseVersion: 2, requestId: d.requestId, status: "APPROVED", kind: "PREAUTH", verifiedBy: "External staff", verifiedAt: new Date().toISOString(), reference: "OV-AUTH", reason: "Staff recorded external decision", approvedPaise: "90000", coPayBps: 0, documentIds: [], allocation: { billRevision: 1, netBillPaise: "100000", eligibleBillPaise: "90000", nonPayablePaise: "10000", sourceReference: "Synthetic reviewed bill" } });
    const deposit = context(f.cashier);
    await billing.recordReceipt(deposit, { admissionId: a.admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "10000", mode: "CASH", channel: "Synthetic deposit book", sourceReference: "OV-DEP", reference: "Actual patient deposit", requestId: deposit.requestId });
    work = await getStaffWorklist(context(clerk));
    expect(work.alerts.filter(a => a.kind === "INSURER_LIMIT")).toHaveLength(1);
    expect(work.configuration.insurerThreshold).toMatchObject({ percent: 80, configured: false });
    expect(work.alerts.filter(a => a.kind === "DEPOSIT_THRESHOLD")).toHaveLength(1);
    expect(work.financial[0]).toMatchObject({ insurerDuePaise: "90000", insurerCashPaise: "0", authorizedPaise: "90000" });
    const partial = context(f.cashier);
    await billing.recordReceipt(partial, { admissionId: a.admissionId, party: "INSURER", kind: "PAYMENT", amountPaise: "30000", mode: "BANK", channel: "Synthetic bank", sourceReference: "OV-PART", reference: "Actual partial payer cash", requestId: partial.requestId });
    expect((await getStaffWorklist(context(f.cashier))).alerts.find(a => a.kind === "INSURER_RECEIPT")?.amountPaise).toBe("60000");
    const rest = context(f.cashier);
    await billing.recordReceipt(rest, { admissionId: a.admissionId, party: "INSURER", kind: "PAYMENT", amountPaise: "60000", mode: "BANK", channel: "Synthetic bank", sourceReference: "OV-REST", reference: "Actual remaining payer cash", requestId: rest.requestId });
    expect((await getStaffWorklist(context(f.cashier))).alerts.filter(a => a.kind === "INSURER_RECEIPT")).toHaveLength(0);
    await f.setting({ type: "alert", basis: "insurer-limit", percent: 100 });
    expect((await getStaffWorklist(context(clerk))).configuration.insurerThreshold).toMatchObject({ percent: 100, configured: true });
    await owner.query("update hims.insurance_cases set assigned_staff_id=null,version=version+1 where id=$1", [c.id]);
    expect((await getStaffWorklist(context(clerk))).episodes).toHaveLength(0);
  }));

  it("rejects stale rendered hospital zones, invalid dates and DST ambiguity before timestamp effects", async () => withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture(), { hospitalFormInstant } = await import("../../src/server/hospital-time");
    expect(await hospitalFormInstant("2026-10-10T00:00:00.123", "Asia/Kolkata")).toBe("2026-10-09T18:30:00.123Z");
    await f.setting({ type: "hospital", name: "Synthetic clock hospital", address: "Synthetic address", timezone: "America/New_York" });
    const before = (await runtime.query("select (select count(*) from hims.admissions) episodes,(select count(*) from hims.nursing_shifts) shifts,(select count(*) from hims.audit_events) audit")).rows;
    await expect(hospitalFormInstant("2026-10-10T00:00:00.123", "Asia/Kolkata")).rejects.toMatchObject({ code: "CONFLICT" });
    for (const local of ["2026-03-08T02:30", "2026-11-01T01:30", "2026-02-30T09:00"])
      await expect(hospitalFormInstant(local, "America/New_York")).rejects.toMatchObject({ code: "VALIDATION" });
    expect((await runtime.query("select (select count(*) from hims.admissions) episodes,(select count(*) from hims.nursing_shifts) shifts,(select count(*) from hims.audit_events) audit")).rows).toEqual(before);
  }));

  it("classifies actual diagnostic collection, processing, stopped reports and dispositions", async () => withTestDatabase(async () => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture(), care = await import("../../src/server/clinical/commands"), lab = await import("../../src/server/lab/commands");
    const { getStaffWorklist } = await import("../../src/server/overview");
    await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
    await f.setting({ type: "billable-item", code: "OV_LAB", name: "Synthetic diagnostic", category: "lab", department: "LAB", unit: "test", quantityScale: 0, amount: "10", active: true });
    const a = await f.episode(), arrival = f.deskCtx();
    await (await import("../../src/server/admissions/commands")).activateAdmission(arrival, { admissionId: a.admissionId, arrivedAt: new Date().toISOString(), expectedVersion: 1, requestId: arrival.requestId });
    const orderContext = context(f.doctor);
    await care.recordRound(orderContext, { admissionId: a.admissionId, notes: "Private diagnostic note", orders: [{ kind: "VITALS", requestedItem: "Prescribed observation", schedule: { startsAt: new Date().toISOString(), intervalMinutes: 60, occurrences: 1 } }, { kind: "LAB", requestedItem: "Synthetic diagnostic", itemId: "OV_LAB", quantity: "1", unit: "test" }], requestId: orderContext.requestId });
    const o = (await care.getCare(context(f.doctor), a.admissionId)).orders.find(o => o.kind === "LAB")!;
    expect((await getStaffWorklist(context(f.lab))).episodes[0].href).toBe(`/lab?orderId=${o.id}`);
    expect((await getStaffWorklist(context(f.lab))).alerts.find(a => a.kind === "DIAGNOSTIC_WORK")?.action).toBe("Collect sample / start radiology");
    const collect = context(f.lab), sample = await lab.collectSample(collect, { orderId: o.id, requestId: collect.requestId });
    expect((await getStaffWorklist(context(f.lab))).alerts.find(a => a.kind === "DIAGNOSTIC_WORK")?.action).toBe("Record diagnostic processing");
    const processing = context(f.lab);
    await lab.startLabProcessing(processing, { orderId: o.id, barcode: sample.barcode, requestId: processing.requestId });
    await care.stopClinicalOrder(context(f.doctor), { orderId: o.id, reason: "Doctor stops further work after processing" });
    expect((await getStaffWorklist(context(f.lab))).alerts.find(a => a.kind === "DIAGNOSTIC_DISPOSITION")?.action).toBe("Complete already-started diagnostic report");
    const report = context(f.lab);
    await lab.recordLabReport(report, { orderId: o.id, barcode: sample.barcode, result: "Human signed synthetic finding", requestId: report.requestId });
    expect((await getStaffWorklist(context(f.lab))).alerts.filter(a => a.kind.startsWith("DIAGNOSTIC"))).toHaveLength(0);
  }));

  it("evaluates stale source-bound seals without mutation while the existing command still invalidates them", async () => withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture(), care = await import("../../src/server/clinical/commands"), discharge = await import("../../src/server/discharge/commands");
    const { getOverview } = await import("../../src/server/overview");
    await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
    const a = await f.episode(), arrival = f.deskCtx();
    await (await import("../../src/server/admissions/commands")).activateAdmission(arrival, { admissionId: a.admissionId, arrivedAt: new Date().toISOString(), expectedVersion: 1, requestId: arrival.requestId });
    await care.signClinicalSummary(context(f.doctor), { admissionId: a.admissionId, expectedVersion: 0, diagnosis: "Synthetic diagnosis", course: "Synthetic course", condition: "Stable", followUp: "Human review", advice: "Human advice", prescriptionOrderIds: [] });
    // Deliberately stale synthetic stored candidate exercises the source/hash check itself.
    await runtime.query("insert into hims.clearance_seals(admission_id,gate,role,review_hash,inputs,reason,signed_by) values($1,'DOCTOR','DOCTOR','stale-synthetic-source','{}','Synthetic legacy stale candidate',$2)", [a.admissionId, f.doctor.id]);
    const effects = async () => (await runtime.query("select (select count(*) from hims.clearance_seals) seals,(select count(*) from hims.clearance_invalidations) invalidations,(select count(*) from hims.charges) charges,(select count(*) from hims.audit_events) audit")).rows;
    const before = await effects();
    for (let i = 0; i < 2; i++) {
      const work = await getOverview(context(f.admin), { asOf: new Date() });
      expect(work.discharge[0].ownerRole).toBe("DOCTOR");
      expect(work.alerts.find(a => a.kind === "PENDING_SEAL")?.ownerRole).toBe("DOCTOR");
    }
    expect(await effects()).toEqual(before);
    await discharge.getClearanceReview(context(f.doctor), a.admissionId, "DOCTOR");
    expect((await runtime.query("select count(*)::int n from hims.clearance_invalidations")).rows[0].n).toBe(1);
  }));
});
