import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { withTestDatabase, waitForTestDatabaseIdle } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { staffContext } from "../../src/server/access";
import { billingFixture } from "../support/billing-fixture";
import { activateAdmission, createAdmission, createBed } from "../../src/server/admissions/commands";
import * as care from "../../src/server/clinical/commands";
import * as nursing from "../../src/server/nursing/commands";
import * as discharge from "../../src/server/discharge/commands";
import * as exceptions from "../../src/server/discharge/exceptions";
import * as billing from "../../src/server/billing/commands";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, appendFile, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/server/schema";
import { sql } from "drizzle-orm";

loadLocalEnvironment();
// Observe the pinned renderer's real layout in tests, without a production PDF
// parser or a second rendering path. Text-line advance exposes narrow overflow.
type LayoutNode = { type: string; box: { left: number; top: number; width: number; height: number }; props: { fixed?: boolean }; lines?: { box: { x: number; width: number }; runs?: { glyphs?: { codePoints: number[] }[] }[] }[]; children?: LayoutNode[] };
const layoutEvidence = vi.hoisted(() => ({ active: false, value: null as LayoutNode | null }));
vi.mock("@react-pdf/renderer", async importOriginal => {
  const renderer = await importOriginal<typeof import("@react-pdf/renderer")>(), { cloneElement } = await import("react");
  return { ...renderer, renderToBuffer: (document: Parameters<typeof renderer.renderToBuffer>[0]) => renderer.renderToBuffer(layoutEvidence.active ? cloneElement(document, { onRender: (value: unknown) => { layoutEvidence.value = (value as { _INTERNAL__LAYOUT__DATA_: LayoutNode })._INTERNAL__LAYOUT__DATA_; } }) : document) };
});
function expectCompleteLayout() {
  expect(layoutEvidence.value).not.toBeNull();
  for (const page of layoutEvidence.value!.children!) {
    for (const child of page.children!.filter(c => !c.props.fixed)) {
      expect(child.box.top).toBeGreaterThanOrEqual(65);
      expect(child.box.top + child.box.height).toBeLessThanOrEqual(page.box.height - 111);
      const visit = (node: LayoutNode) => {
        for (const line of node.lines ?? []) expect(line.box.x + line.box.width).toBeLessThanOrEqual(node.box.width + 1);
        for (const c of node.children ?? []) visit(c);
      }; if (child.type === "VIEW") visit(child);
    }
  }
}
function paragraphGlyphText() {
  // Read the actual laid-out glyphs, including any inserted line-end hyphen.
  // Only fold whitespace; never remove identifier punctuation or hyphens.
  return layoutEvidence.value!.children!.flatMap(page => page.children!.filter(c => c.type === "TEXT" && !c.props.fixed).flatMap(c => c.lines ?? []))
    .flatMap(line => line.runs ?? []).flatMap(run => run.glyphs ?? []).map(g => String.fromCodePoint(...g.codePoints)).join("").replace(/\s/gu, "");
}
const ordinaryUrl = process.env.DATABASE_URL;
const testUrl = getTestDatabaseConfig().runtimeUrl;
afterEach(async () => { await waitForTestDatabaseIdle(); process.env.DATABASE_URL = ordinaryUrl; delete process.env.HIMS_DOCUMENT_STORAGE; vi.useRealTimers(); layoutEvidence.active = false; layoutEvidence.value = null; }, 60000);
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticDocumentsOnlySecretAtLeast32Characters12345";

async function documents() { return import("../../src/server/documents/commands"); }
async function preparedPublication(ctx: import("../../src/server/contracts").CommandContext, value: unknown) {
  const d = await documents(), { withTransaction } = await import("../../src/server/db"), { renderDischargePDF } = await import("../../src/server/documents/pdf");
  const prepared = await withTransaction(tx => d.prepareDischargeDocumentInTransaction(tx, ctx, value));
  const bytes = prepared.existing ? null : await renderDischargePDF(prepared.snapshot, prepared.hash);
  return (tx: import("../../src/server/db").Transaction) => d.publishDischargeDocumentInTransaction(tx, ctx, prepared, bytes);
}
async function fixture(exceptional = false, temporary = false, medicine = false, route: "SELF_PAY" | "INSURED" = "SELF_PAY", capacity?: { runtime: Client }, receiptReference?: string, medicineFrequency?: string) {
  process.env.DATABASE_URL = testUrl;
  process.env.HIMS_DOCUMENT_STORAGE = "synthetic";
  const f = await billingFixture();
  await f.setting({ type: "tariff", category: "GENERAL", amount: capacity ? "60" : "0", basis: "hour", rounding: "exact", graceMinutes: 0 });
  await f.setting({ type: "deposit", category: "GENERAL", route: route === "SELF_PAY" ? "self-pay" : "insured", requirement: "not-required", amount: "0" });
  let admissionId: string, urgentId: string | undefined;
  if (temporary) {
    const bed = await createBed(staffContext(f.admin, "synthetic-documents"), { label: randomUUID(), category: "GENERAL", reason: "Synthetic urgent identity bed" }), c = f.deskCtx();
    const created = await createAdmission(c, { patientDetails: { identityStatus: "TEMPORARY", identityProvenance: "Unknown actual identity and age", sex: "UNKNOWN" }, admittingDoctorId: f.doctor.id, clinicianAssessment: { clinicianId: f.doctor.id, assessedAt: new Date().toISOString(), chiefComplaint: "Actual urgent complaint", vitals: "Actual assessment", triage: "Urgent actual route", destinationCategory: "GENERAL" }, bedId: bed.id, paymentRoute: "SELF_PAY", expectedStayDays: 1, requestId: c.requestId });
    admissionId = created.admissionId;
    urgentId = (await exceptions.authorizeException(staffContext(f.admin, "synthetic-documents"), { admissionId, type: "URGENT_ADMISSION", disposition: "ACTIVATE", authority: "Administrator actual urgent route", reason: "Urgent unknown identity", evidenceIds: [], evidence: "Actual intake provenance", followUpOwnerId: f.desk.id })).id;
  } else admissionId = (await f.episode(route)).admissionId;
  let arrivedAt = new Date().toISOString();
  if (capacity) {
    // Historical native fixture setup only, before activation or clinical history.
    arrivedAt = new Date(Date.now() - 7 * 86400000 - 20000).toISOString();
    await capacity.runtime.query("update hims.admissions set registered_at=$2 where id=$1", [admissionId, arrivedAt]);
    const hold = (await capacity.runtime.query("delete from hims.bed_holds where admission_id=$1 returning bed_id", [admissionId])).rows[0];
    await capacity.runtime.query("insert into hims.bed_holds(bed_id,admission_id,held_at) values($1,$2,$3)", [hold.bed_id, admissionId, arrivedAt]);
  }
  const ac = f.deskCtx();
  await activateAdmission(ac, { admissionId, arrivedAt, expectedVersion: 1, requestId: ac.requestId, ...(urgentId ? { exceptionId: urgentId } : {}) });
  const dc = () => staffContext(f.doctor, "synthetic-documents"), nc = () => staffContext(f.nurse, "synthetic-documents"), pc = () => staffContext(f.pharmacy, "synthetic-documents"), admin = () => staffContext(f.admin, "synthetic-documents");
  await nursing.assignNurse(admin(), { admissionId, nurseId: f.nurse.id, reason: "Synthetic ward assignment", authority: "Synthetic roster" });
  const n = nc(), shift = await nursing.recordShift(n, { admissionId, startedAt: capacity ? arrivedAt : new Date().toISOString(), handover: "Synthetic clinical attendance", requestId: n.requestId });
  let exceptionId: string | undefined;
  if (exceptional) {
    await f.setting({ type: "billable-item", code: "DOC_EXCEPTION", name: "Actual charged clinical attendance", category: "consultation", department: "DOCTOR", unit: "session", quantityScale: 0, amount: "1200.40", active: true });
    const round = dc(); await care.recordRound(round, { admissionId, notes: "Actual initial findings; full departure summary unavailable", orders: [], feeScheduleId: "DOC_EXCEPTION", feeUnit: "session", requestId: round.requestId });
    const evidence = await exceptions.recordExceptionEvidence(nc(), { admissionId, kind: "PHYSICAL_EXIT", shiftId: shift.id, vacatedAt: new Date().toISOString(), actualAt: new Date().toISOString(), notes: "Nurse witnessed abrupt actual exit" });
    const authority = await exceptions.authorizeException(admin(), { admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator recorded actual route", reason: "Abrupt early exit before clinical review", evidenceIds: [evidence.id], evidence: "Actual Nurse signed physical exit", followUpOwnerId: f.doctor.id });
    exceptionId = authority.id;
    await exceptions.recordExceptionalDeparture(admin(), { admissionId, exceptionId, physicalEvidenceId: evidence.id });
  } else {
    if (capacity) await (await import("../support/documents-long-stay")).sevenDayRoomHistory(capacity.runtime, f, admissionId, shift.id);
    if (receiptReference) await f.setting({ type: "billable-item", code: "DOC_ROW", name: "Actual row-layout clinical charge", category: "consultation", department: "DOCTOR", unit: "session", quantityScale: 0, amount: "1234.56", active: true });
    const round = dc(); await care.recordRound(round, { admissionId, notes: "Original signed clinical findings", orders: [], ...(capacity ? { feeScheduleId: "DOC_LONG_FEE", feeUnit: "session" } : receiptReference ? { feeScheduleId: "DOC_ROW", feeUnit: "session" } : {}), requestId: round.requestId });
    const prescriptionOrderIds: string[] = [];
    if (medicine) {
      const pharmacy = await import("../../src/server/pharmacy/commands");
      await f.setting({ type: "billable-item", code: "DOC_MED", name: "Actual take-home medicine", category: "medicine", department: "PHARMACY", unit: "tablet", quantityScale: 0, amount: "1", active: true });
      const c = dc(); await care.recordRound(c, { admissionId, notes: "Original actual prescription order", orders: [{ kind: "MEDICINE", requestedItem: "Actual take-home medicine", itemId: "DOC_MED", dose: "1", doseUnit: "tablet", route: "oral", frequency: medicineFrequency ?? "daily", durationDays: 2, medicationPurpose: "TAKE_HOME", dispensingQuantity: "2", dispensingUnit: "tablet" }], requestId: c.requestId });
      const chart = await care.getCare(dc(), admissionId); prescriptionOrderIds.push(chart.orders[0].id);
      const rx = await care.signClinicalSummary(dc(), { admissionId, expectedVersion: 0, diagnosis: "Actual historical medicine departure", course: "Human course", condition: "Reviewed", followUp: "Actual human follow-up", advice: "Original advice", prescriptionOrderIds }), stock = pc();
      const expiresOn = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      const batch = await pharmacy.recordStockReceipt(stock, { medicineId: "DOC_MED", batchNo: "TODAY-DOC", expiresOn, quantity: "2", unit: "tablet", barcode: "DOC-MED-BATCH", reference: "Synthetic actual stock receipt", requestId: stock.requestId });
      const prepare = pc(); await pharmacy.prepareTakeHomeMedicines(prepare, { admissionId, prescriptionVersionId: rx.id, items: [{ orderId: prescriptionOrderIds[0], batchId: batch.id, quantity: "2", unit: "tablet" }], requestId: prepare.requestId });
    } else await care.signClinicalSummary(dc(), { admissionId, expectedVersion: 0, diagnosis: "Pneumonia José - सावधानी", course: "Actual completed care", condition: "Stable after human review", followUp: "Doctor follow-up in seven days", advice: "आराम करें", prescriptionOrderIds });
    for (const [gate, ctx] of [["DOCTOR", dc], ["PHARMACY", pc], ["NURSING", nc]] as const) {
      const r = await discharge.getClearanceReview(ctx(), admissionId, gate);
      await discharge.issueClearance(ctx(), { admissionId, gate, expectedReviewHash: r.reviewHash });
    }
    const v = nc(); await discharge.recordRoomVacated(v, { admissionId, shiftId: shift.id, vacatedAt: new Date().toISOString(), waitingLocation: "Actual supervised discharge chairs", handover: "Continue human monitoring", requestId: v.requestId });
    const bill = await billing.getBill(f.ctx(), admissionId);
    if (bill.netPaise > 0n) { const cash = f.ctx(); await billing.recordReceipt(cash, { admissionId, party: "PATIENT", kind: "PAYMENT", amountPaise: bill.netPaise.toString(), mode: "CASH", channel: "Synthetic discharge book", sourceReference: randomUUID(), reference: receiptReference ?? "Actual final money received", requestId: cash.requestId }); }
    const review = await discharge.getClearanceReview(f.ctx(), admissionId, "BILLING");
    await discharge.issueClearance(f.ctx(), { admissionId, gate: "BILLING", expectedReviewHash: review.reviewHash, expectedBillVersion: review.billVersion });
    const exit = f.ctx(); await discharge.recordDeparture(exit, { admissionId, departedAt: new Date().toISOString(), expectedBillVersion: review.billVersion, requestId: exit.requestId });
  }
  return { ...f, admissionId, dc, nc, pc, admin, exceptionId, urgentId, shift };
}

async function heldSource<T>(runtime: Client, first: (tx: import("../../src/server/db").Transaction) => Promise<T>, second: (client: Client) => Promise<unknown>) {
  const writer = new Client({ connectionString: testUrl }), challenger = new Client({ connectionString: testUrl }); await Promise.all([writer.connect(), challenger.connect()]);
  const pid = (await writer.query("select pg_backend_pid() pid")).rows[0].pid;
  let release = () => {}, ready = () => {};
  const held = new Promise<void>(r => release = r), acquired = new Promise<void>(r => ready = r);
  let left: Promise<T> | undefined, right: Promise<unknown> | undefined;
  try {
    left = drizzle(writer, { schema }).transaction(async tx => { const result = await first(tx); ready(); await held; return result; });
    await Promise.race([acquired, left.then(() => {})]);
    right = second(challenger).catch(e => e);
    let blockedPid: number | undefined;
    for (let i = 0; i < 100; i++) {
      const observed = await runtime.query("select pid from pg_stat_activity where $1::int=any(pg_blocking_pids(pid)) and usename=current_user", [pid]);
      if (observed.rows.length) { blockedPid = observed.rows[0].pid; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    expect(blockedPid).toBeDefined(); expect(blockedPid).not.toBe(pid);
    await mkdir(resolve("../tmp/task13"), { recursive: true });
    await appendFile(resolve("../tmp/task13/contention.jsonl"), JSON.stringify({ test: expect.getState().currentTestName, writerPid: pid, readerPid: blockedPid, observed: true }) + "\n");
    release(); return { written: await left, result: await right };
  } finally { release(); await Promise.allSettled([left, right]); await Promise.all([writer.end(), challenger.end()]); }
}

describe("immutable protected discharge documents", () => {
  it.each([
    ["multiline", "x\n".repeat(90) + "END"],
    ["unbroken", "W".repeat(197) + "END"],
    ["wide", "क्ष".repeat(60) + "END"],
  ])("publishes complete %s receipt source without oversize-row layout warnings", async (name, reference) => withTestDatabase(async () => {
    const f = await fixture(false, false, false, "SELF_PAY", undefined, reference), d = await documents(), review = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    const warnings = vi.spyOn(console, "warn");
    layoutEvidence.active = true;
    try {
      const created = await d.createDischargeDocument(f.ctx(), review.input), doc = await d.getDischargeDocument(f.ctx(), created.documentId), downloaded = await d.downloadDischargeDocument(f.ctx(), created.documentId);
      expect(doc.snapshot.money.bill.receipts[0].reference).toBe(reference);
      expect(doc.snapshot.money.bill.netPaise).toBe("123456");
      await mkdir(resolve("../tmp/task13/fix-rows"), { recursive: true });
      await writeFile(resolve(`../tmp/task13/fix-rows/${name}.pdf`), downloaded.bytes);
      await writeFile(resolve(`../tmp/task13/fix-rows/${name}.json`), JSON.stringify({ reference, snapshot: doc.snapshot, hash: doc.hash, pdfHash: doc.pdfHash }));
      expect(warnings.mock.calls.filter(c => String(c[0]).includes("bigger than available page height"))).toEqual([]);
      expectCompleteLayout();
    } finally { warnings.mockRestore(); }
  }));
  it.each([
    ["narrow-unbroken", "W".repeat(1100) + "END"],
    ["narrow-multiline", "x\n".repeat(90) + "END"],
  ])("publishes complete %s prescription text in the narrow column", async (name, frequency) => withTestDatabase(async () => {
    const f = await fixture(false, false, true, "SELF_PAY", undefined, undefined, frequency), d = await documents();
    // A legitimate short signer name places the following recorded hash near
    // a prose line boundary, exercising identifier protection in the real copy.
    await (await import("../../src/server/staff")).updateStaff(f.ah, { id: f.cashier.id, name: "Billing staff who recorded the actual final review", role: "BILLING", active: true, reason: "Synthetic recorded signer display name" });
    const review = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), warnings = vi.spyOn(console, "warn");
    layoutEvidence.active = true;
    try {
      const created = await d.createDischargeDocument(f.ctx(), review.input), doc = await d.getDischargeDocument(f.ctx(), created.documentId), downloaded = await d.downloadDischargeDocument(f.ctx(), created.documentId);
      expect(doc.snapshot.clinical.summary!.prescription[0].frequency).toBe(frequency);
      await mkdir(resolve("../tmp/task13/fix-rows"), { recursive: true });
      await writeFile(resolve(`../tmp/task13/fix-rows/${name}.pdf`), downloaded.bytes);
      await writeFile(resolve(`../tmp/task13/fix-rows/${name}.json`), JSON.stringify({ frequency, snapshot: doc.snapshot, hash: doc.hash, pdfHash: doc.pdfHash }));
      expect(warnings.mock.calls.filter(c => String(c[0]).includes("bigger than available page height"))).toEqual([]);
      expectCompleteLayout();
      const glyphs = paragraphGlyphText();
      for (const { gate, seal } of doc.snapshot.seals) if (seal) expect(glyphs, `${gate} original review hash`).toContain(seal.reviewHash);
      expect(glyphs).toContain(doc.snapshot.patient!.uhid);
      expect(glyphs).toContain(doc.snapshot.documentId);
      expect(glyphs).toContain(doc.snapshot.sourceHash);
    } finally { warnings.mockRestore(); }
  }));
  it("exports a complete seven-day minute ledger with transfer and cutoff correction as exact itemized room groups", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(false, false, false, "SELF_PAY", { runtime }), d = await documents(), { withTransaction } = await import("../../src/server/db"), { renderDischargePDF } = await import("../../src/server/documents/pdf");
    const review = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), original = await withTransaction(tx => d.prepareDischargeDocumentInTransaction(tx, f.ctx(), review.input));
    if (original.existing) throw Error("Fresh seven-day source already has a copy");
    const initial = original.snapshot, gross = BigInt(initial.money.bill.grossPaise);
    expect(initial.money.bill.charges).toHaveLength(10082); // 10080 minute deltas, final partial delta and one department fee.
    expect(initial.money.statement.lines).toHaveLength(3);
    expect(initial.money.statement.lines.filter(l => l.kind === "ROOM").map(l => l.postingCount)).toEqual([5040, 5041]);
    expect(initial.money.statement).toMatchObject({ grossPaise: gross.toString(), reversedPaise: "0", netPaise: gross.toString() });
    expect(initial.seals.every(s => !s.seal || !("inputs" in s.seal))).toBe(true);
    const stay = initial.stays.at(-1)!;
    async function correct(actualAt: string, reason: string) {
      const authority = await exceptions.authorizeException(f.admin(), { admissionId: f.admissionId, type: "ROOM_CUTOFF_CORRECTION", disposition: "AMEND", sourceId: stay.id, authority: "Administrator factual source review", reason, evidenceIds: [], evidence: "Actual original Nurse physical-source witness", followUpOwnerId: f.nurse.id });
      const evidence = await exceptions.recordExceptionEvidence(f.nc(), { admissionId: f.admissionId, exceptionId: authority.id, kind: "ROOM_CUTOFF", sourceId: stay.id, shiftId: f.shift.id, actualAt, notes: reason });
      return exceptions.correctRoomCutoff(f.admin(), { admissionId: f.admissionId, exceptionId: authority.id, evidenceId: evidence.id });
    }
    await correct(new Date(Date.parse(stay.endedAt!) - 60000).toISOString(), "Nurse corrects final physical cutoff by one minute");
    const reduced = await billing.getBill(f.ctx(), f.admissionId);
    expect(reduced.grossPaise).toBe(gross); expect(reduced.reversedPaise).toBe(200n); expect(reduced.netPaise).toBe(gross - 200n);
    await correct(stay.endedAt!, "Later Nurse evidence restores the original actual physical cutoff");
    const current = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    const captureStart = performance.now(), prepared = await withTransaction(tx => d.prepareDischargeDocumentInTransaction(tx, f.ctx(), current.input)), captureMilliseconds = performance.now() - captureStart;
    if (prepared.existing) throw Error("Corrected source unexpectedly reused an older document");
    const renderStart = performance.now(), bytes = await renderDischargePDF(prepared.snapshot, prepared.hash), renderMilliseconds = performance.now() - renderStart;
    const publishStart = performance.now(), third = await withTransaction(tx => d.publishDischargeDocumentInTransaction(tx, f.ctx(), prepared, bytes)), publishMilliseconds = performance.now() - publishStart;
    const final = await d.getDischargeDocument(f.ctx(), third.documentId), statement = final.snapshot.money.statement;
    expect(statement.lines).toHaveLength(4); expect(statement.rawChargeCount).toBe(10083);
    expect(statement).toMatchObject({ grossPaise: (gross + 200n).toString(), reversedPaise: "200", netPaise: gross.toString() });
    expect(statement.lines.filter(l => l.kind === "ROOM" && l.amendmentId)).toHaveLength(1);
    expect(statement.lines.flatMap(l => l.chargeIds).sort()).toEqual(final.snapshot.money.bill.charges.map(c => c.id).sort());
    expect(final.snapshot.money.bill.reversals.length).toBeGreaterThan(0);
    const file = await d.downloadDischargeDocument(f.ctx(), third.documentId);
    await mkdir(resolve("../tmp/task13"), { recursive: true }); await writeFile(resolve("../tmp/task13/seven-day.pdf"), file.bytes);
    await writeFile(resolve("../tmp/task13/seven-day.json"), JSON.stringify({ rawChargeCount: statement.rawChargeCount, statementLines: statement.lines.length, sourceCharacters: JSON.stringify(final.snapshot).length, pdfBytes: file.bytes.length, captureMilliseconds, renderMilliseconds, publishMilliseconds, grossPaise: statement.grossPaise, reversedPaise: statement.reversedPaise, netPaise: statement.netPaise, sourceHash: final.sourceHash, sha256: final.pdfHash }, null, 2));
  }), 60000); // 10,083 entries and multiple source captures; individual SQL remains bounded.
  it("appends a current version when a mutable physical source reverts to older superseded content", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), first = await d.createDischargeDocument(f.ctx(), r.input);
    const bed = (await runtime.query("select b.id,b.label from hims.beds b join hims.admissions a on a.bed_id=b.id where a.id=$1", [f.admissionId])).rows[0];
    await runtime.query("update hims.beds set label=$2 where id=$1", [bed.id, `Later label ${randomUUID()}`]);
    const changed = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), second = await d.createDischargeDocument(f.ctx(), changed.input);
    await runtime.query("update hims.beds set label=$2 where id=$1", [bed.id, bed.label]);
    const reverted = await d.getDischargeDocumentReview(f.ctx(), f.admissionId); expect(reverted.input.expectedSourceHash).toBe(r.input.expectedSourceHash);
    const third = await d.createDischargeDocument(f.ctx(), reverted.input); expect(third.version).toBe(3);
    expect((await d.getDischargeDocument(f.ctx(), third.documentId)).replacesDocumentId).toBe(second.documentId);
    expect(await d.verifyDocument(f.ctx(), first.documentId)).toMatchObject({ status: "SUPERSEDED" });
    expect(await d.verifyDocument(f.ctx(), third.documentId)).toMatchObject({ status: "CURRENT" });
    expect(await d.createDischargeDocument(f.ctx(), reverted.input)).toEqual(third);
  }));
  it("converges concurrent same-source creators on one immutable published version", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    const copies = await Promise.all([d.createDischargeDocument(f.ctx(), r.input), d.createDischargeDocument(f.ctx(), r.input)]);
    expect(copies[0]).toEqual(copies[1]);
    expect((await runtime.query("select count(*)::int n from hims.discharge_documents where admission_id=$1", [f.admissionId])).rows[0].n).toBe(1);
  }));
  it("prepares locally and refuses source changes or role revocation before final publication", async () => withTestDatabase(async ({ runtime, owner }) => {
    const f = await fixture(), d = await documents();
    expect(d).toHaveProperty("prepareDischargeDocumentInTransaction");
    const { withTransaction } = await import("../../src/server/db"), { renderDischargePDF } = await import("../../src/server/documents/pdf");
    const review = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    const prepared = await withTransaction(tx => d.prepareDischargeDocumentInTransaction(tx, f.ctx(), review.input));
    if (prepared.existing) throw Error("Fresh fixture unexpectedly has a document");
    // The real renderer consumes the captured snapshot outside DB ownership.
    const bytes = await renderDischargePDF(prepared.snapshot, prepared.hash);
    const note = (await runtime.query("select id from hims.clinical_rounds where admission_id=$1", [f.admissionId])).rows[0].id;
    await runtime.query("insert into hims.clinical_addenda(note_id,text,reason,signed_by) values($1,'Change during local rendering','Exact original linked note',$2)", [note, f.doctor.id]);
    await expect(withTransaction(tx => d.publishDischargeDocumentInTransaction(tx, f.ctx(), prepared, bytes))).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await runtime.query("select count(*)::int n from hims.discharge_documents")).rows[0].n).toBe(0);
    const latest = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), next = await withTransaction(tx => d.prepareDischargeDocumentInTransaction(tx, f.ctx(), latest.input));
    if (next.existing) throw Error("Failed publication created a document");
    const nextBytes = await renderDischargePDF(next.snapshot, next.hash);
    const fabricated = structuredClone(next); fabricated.snapshot.clinical.summary!.advice = "Fabricated unrelated prepared advice";
    await expect(withTransaction(tx => d.publishDischargeDocumentInTransaction(tx, f.ctx(), fabricated, nextBytes))).rejects.toMatchObject({ code: "PRECONDITION" });
    await owner.query("update hims.staff_user set role='LAB' where id=$1", [f.cashier.id]);
    await expect(withTransaction(tx => d.publishDischargeDocumentInTransaction(tx, f.ctx(), next, nextBytes))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await runtime.query("select count(*)::int n from hims.discharge_documents")).rows[0].n).toBe(0);
  }));
  it("provides the protected versioned discharge creation operation", async () => {
    // A missing feature fails an explicit assertion rather than hiding an import error.
    const operations = await documents().catch(() => null);
    expect(operations?.createDischargeDocument).toBeTypeOf("function");
  });
  it("publishes one ordinary immutable snapshot and distinct verified PDF byte hash", async () => withTestDatabase(async ({ runtime, owner }) => {
    const f = await fixture(), d = await documents(), review = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    const created = await d.createDischargeDocument(f.ctx(), review.input);
    const old = await d.getDischargeDocument(f.ctx(), created.documentId);
    expect(old.snapshot.clinical.summary).toMatchObject({ diagnosis: "Pneumonia José - सावधानी", advice: "आराम करें" });
    expect(old.snapshot.seals.filter(s => s.seal)).toHaveLength(4);
    const historical = (await runtime.query("select id,gate,review_hash,inputs from hims.clearance_seals where admission_id=$1", [f.admissionId])).rows;
    expect(old.snapshot.seals.every(s => s.seal?.reviewHash === historical.find(h => h.id === s.seal?.id)?.review_hash)).toBe(true);
    expect(old.snapshot.money.totals).toContainEqual({ label: "Actual insurer payment received", paise: "0" });
    expect(old.snapshot.money.totals).toContainEqual({ label: "Insurer authorization (not money received)", paise: "0" });
    const file = await d.downloadDischargeDocument(f.ctx(), created.documentId);
    expect(file.bytes.subarray(0,5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(file.bytes).digest("hex")).toBe(old.pdfHash);
    expect(old.pdfHash).not.toBe(created.hash);
    expect(await d.createDischargeDocument(f.ctx(), review.input)).toEqual(created);
    expect(await d.verifyDocument(f.ctx(), created.documentId)).toMatchObject({ status: "CURRENT", version: 1, hash: created.hash, pdfHash: old.pdfHash });
    await expect(owner.query("update hims.discharge_documents set version=2 where id=$1", [created.documentId])).rejects.toMatchObject({ code: "P0001" });
    await expect(runtime.query("delete from hims.discharge_documents where id=$1", [created.documentId])).rejects.toMatchObject({ code: "42501" });
    await mkdir(resolve("../tmp/task13"), { recursive: true }); await writeFile(resolve("../tmp/task13/ordinary.pdf"), file.bytes);
    await writeFile(resolve("../tmp/task13/ordinary-snapshot.json"), JSON.stringify(old.snapshot));
    const readback = historical.map(h => ({ gate: h.gate, sealId: h.id, recordedReviewHash: h.review_hash, reEncodedJSONBHash: billing.fingerprint(h.inputs), retainedDocumentReviewHash: old.snapshot.seals.find(s => s.seal?.id === h.id)?.seal?.reviewHash, readbackKeys: Object.keys(h.inputs) }));
    expect(readback.some(r => r.recordedReviewHash !== r.reEncodedJSONBHash)).toBe(true);
    await writeFile(resolve("../tmp/task13/historical-hash-readback.json"), JSON.stringify(readback, null, 2));
  }));
  it("denies guessed references and revalidates current final-copy purpose on every operation", async () => withTestDatabase(async ({ owner }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), created = await d.createDischargeDocument(f.ctx(), r.input);
    for (const ctx of [f.dc(), f.nc(), f.pc(), f.deskCtx()]) {
      await expect(d.getDischargeDocument(ctx, created.documentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(d.downloadDischargeDocument(ctx, created.documentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(d.verifyDocument(ctx, created.documentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(d.createDischargeDocument(ctx, r.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(d.verifyDocument(f.ctx(), randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const verified = await d.verifyDocument(f.ctx(), created.documentId);
    expect(JSON.stringify(verified)).not.toMatch(/Pneumonia|patient|insurer|Synthetic billing/);
    await owner.query("update hims.staff_user set role='LAB' where id=$1", [f.cashier.id]);
    await expect(d.downloadDischargeDocument(f.ctx(), created.documentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(d.createDischargeDocument(f.ctx(), r.input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  }));
  it("rejects mismatched bill and seal versions before publishing effects", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    await expect(d.createDischargeDocument(f.ctx(), { ...r.input, billVersion: r.input.billVersion + 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(d.createDischargeDocument(f.ctx(), { ...r.input, clearanceVersions: { ...r.input.clearanceVersions, DOCTOR: randomUUID() } })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await runtime.query("select count(*)::int n from hims.discharge_documents")).rows[0].n).toBe(0);
  }));
  it("retains the original clinical source, old bytes and seals after an attributable amendment", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), first = await d.createDischargeDocument(f.ctx(), r.input), original = await d.downloadDischargeDocument(f.ctx(), first.documentId);
    const source = (await runtime.query("select id from hims.clinical_rounds where admission_id=$1", [f.admissionId])).rows[0].id;
    const authority = await exceptions.authorizeException(f.admin(), { admissionId: f.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", sourceId: source, correctionKind: "CLINICAL_ADDENDUM", authority: "Administrator named correction", reason: "Correct original findings with Doctor addendum", evidence: "Exact original signed note", evidenceIds: [], followUpOwnerId: f.doctor.id });
    await exceptions.applyPostDischargeCorrection(f.dc(), { admissionId: f.admissionId, exceptionId: authority.id, kind: "CLINICAL_ADDENDUM", sourceId: source, data: { text: "Later Doctor correction - no invented new seal", reason: "Correct original source" } });
    expect(await d.verifyDocument(f.ctx(), first.documentId)).toMatchObject({ status: "SOURCE_CHANGED" });
    const now = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), second = await d.createDischargeDocument(f.ctx(), now.input), amended = await d.getDischargeDocument(f.ctx(), second.documentId);
    expect(second.version).toBe(2); expect(amended.replacesDocumentId).toBe(first.documentId);
    expect(JSON.stringify(amended.snapshot.clinical.addenda)).toContain("Later Doctor correction");
    expect(amended.snapshot.seals.filter(s => s.seal)).toHaveLength(4);
    expect(await d.verifyDocument(f.ctx(), first.documentId)).toMatchObject({ status: "SUPERSEDED" });
    expect((await d.downloadDischargeDocument(f.ctx(), first.documentId)).bytes).toEqual(original.bytes);
    expect((await d.getDischargeDocument(f.ctx(), first.documentId)).snapshot.clinical.addenda).toEqual([]);
  }));
  it("publishes an exceptional exit truthfully with absent ordinary seals and unreviewed clinical facts", async () => withTestDatabase(async () => {
    const f = await fixture(true), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), created = await d.createDischargeDocument(f.ctx(), r.input), doc = await d.getDischargeDocument(f.ctx(), created.documentId);
    expect(doc.snapshot.departure.kind).toBe("EXCEPTIONAL");
    expect(doc.snapshot.departure.exception).toMatchObject({ id: f.exceptionId, type: "EARLY_EXIT" });
    expect(doc.snapshot.clinical.summary).toBeNull();
    expect(doc.snapshot.seals.every(s => s.seal === null)).toBe(true);
    expect(JSON.stringify(doc.snapshot)).toContain("UNREVIEWED_EARLY_EXIT");
    expect(doc.snapshot.money.totals).toContainEqual({ label: "Patient amount remaining", paise: "120040" });
    expect(doc.snapshot.money.totals).toContainEqual({ label: "Actual insurer payment received", paise: "0" });
  }));
  it("versions attributable exception rerouting and rejects a follow-up change during unlocked rendering", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(true), d = await documents(), initial = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), a = await d.createDischargeDocument(f.ctx(), initial.input), old = await d.downloadDischargeDocument(f.ctx(), a.documentId);
    const reroute = await exceptions.recordExceptionFollowup(f.admin(), { exceptionId: f.exceptionId, ownerId: f.nurse.id, note: "Administrator routes actual later follow-up to Nurse B" });
    expect(await d.verifyDocument(f.ctx(), a.documentId)).toMatchObject({ status: "SOURCE_CHANGED" });
    const review = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), b = await d.createDischargeDocument(f.ctx(), review.input), doc = await d.getDischargeDocument(f.ctx(), b.documentId);
    expect(b.version).toBe(2); expect(doc.replacesDocumentId).toBe(a.documentId);
    expect(doc.snapshot.departure.exception).toMatchObject({ followUpOwnerId: f.doctor.id, currentFollowUpOwnerId: f.nurse.id });
    expect(doc.snapshot.provenance.followups).toContainEqual(expect.objectContaining({ id: reroute.id, owner_id: f.nurse.id, signed_by: doc.snapshot.departure.exception!.signedBy }));
    const { documentSections } = await import("../../src/server/documents/model"), words = JSON.stringify(documentSections(doc.snapshot));
    expect(words).toContain(`Original authority follow-up owner: ${f.doctor.name} (${f.doctor.id})`);
    expect(words).toContain(`Current recorded follow-up owner: ${f.nurse.name} (${f.nurse.id})`);
    expect(await d.verifyDocument(f.ctx(), b.documentId)).toMatchObject({ status: "CURRENT" });
    expect((await d.downloadDischargeDocument(f.ctx(), a.documentId)).bytes).toEqual(old.bytes);
    await mkdir(resolve("../tmp/task13/fix-rows"), { recursive: true });
    await writeFile(resolve("../tmp/task13/fix-rows/exception-rerouted.pdf"), (await d.downloadDischargeDocument(f.ctx(), b.documentId)).bytes);
    await writeFile(resolve("../tmp/task13/fix-rows/exception-rerouted.json"), JSON.stringify({ snapshot: doc.snapshot, hash: doc.hash, pdfHash: doc.pdfHash }));
    const { withTransaction } = await import("../../src/server/db"), { renderDischargePDF } = await import("../../src/server/documents/pdf");
    await exceptions.recordExceptionFollowup(f.admin(), { exceptionId: f.exceptionId, ownerId: f.cashier.id, note: "Actual next accountable Billing owner C" });
    const next = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), prepared = await withTransaction(tx => d.prepareDischargeDocumentInTransaction(tx, f.ctx(), next.input));
    if (prepared.existing) throw Error("Rerouted source must require a new copy");
    const bytes = await renderDischargePDF(prepared.snapshot, prepared.hash);
    await exceptions.recordExceptionFollowup(f.admin(), { exceptionId: f.exceptionId, ownerId: f.doctor.id, note: "Actual follow-up changes during local rendering" });
    await expect(withTransaction(tx => d.publishDischargeDocumentInTransaction(tx, f.ctx(), prepared, bytes))).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await runtime.query("select count(*)::int n from hims.discharge_documents where admission_id=$1", [f.admissionId])).rows[0].n).toBe(2);
  }));
  it("prints unknown payer allocation and authorization truthfully on an unpaid insured exceptional exit", async () => withTestDatabase(async () => {
    const f = await fixture(true, false, false, "INSURED"), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), created = await d.createDischargeDocument(f.ctx(), r.input), doc = await d.getDischargeDocument(f.ctx(), created.documentId);
    expect(doc.snapshot.money.totals).toContainEqual({ label: "Insurer authorization (not money received)", paise: null });
    expect(doc.snapshot.money.totals).toContainEqual({ label: "Patient amount remaining", paise: null });
    expect(doc.snapshot.money.totals).toContainEqual({ label: "Insurer amount remaining", paise: null });
    expect(doc.snapshot.money.totals).toContainEqual({ label: "Outstanding posted bill", paise: "120040" });
    expect(doc.snapshot.money.totals).toContainEqual({ label: "Actual insurer payment received", paise: "0" });
  }));
  it("refuses changed or unavailable protected bytes without losing the immutable record", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), created = await d.createDischargeDocument(f.ctx(), r.input), doc = await d.getDischargeDocument(f.ctx(), created.documentId);
    const path = resolve(d.documentStorageDirectory(), `${doc.storageKey}.pdf`), bytes = await readFile(path);
    await writeFile(path, Buffer.from("%PDF-corrupted"));
    await expect(d.downloadDischargeDocument(f.ctx(), created.documentId)).rejects.toMatchObject({ code: "PRECONDITION" });
    expect(await d.verifyDocument(f.ctx(), created.documentId)).toMatchObject({ status: "FILE_UNAVAILABLE" });
    await writeFile(path, bytes);
    expect(await d.verifyDocument(f.ctx(), created.documentId)).toMatchObject({ status: "CURRENT" });
    expect((await runtime.query("select count(*)::int n from hims.discharge_documents")).rows[0].n).toBe(1);
  }));
  it("refuses unsafe storage configuration before publication and supports a clean retry", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    delete process.env.HIMS_DOCUMENT_STORAGE;
    await expect(d.createDischargeDocument(f.ctx(), r.input)).rejects.toMatchObject({ code: "PRECONDITION" });
    expect((await runtime.query("select count(*)::int n from hims.discharge_documents")).rows[0].n).toBe(0);
    process.env.HIMS_DOCUMENT_STORAGE = "synthetic";
    expect((await d.createDischargeDocument(f.ctx(), r.input)).version).toBe(1);
  }));
  it("fails closed on an actual filesystem obstruction and retries after storage recovery", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), directory = d.documentStorageDirectory(), recovery = `${directory}-${randomUUID()}`;
    await mkdir(directory, { recursive: true }); await rename(directory, recovery);
    try {
      await writeFile(directory, "Synthetic regular-file obstruction", { flag: "wx" });
      await expect(d.createDischargeDocument(f.ctx(), r.input)).rejects.toThrow();
      expect((await runtime.query("select count(*)::int n from hims.discharge_documents")).rows[0].n).toBe(0);
    } finally { await unlink(directory); await rename(recovery, directory); }
    expect((await d.createDischargeDocument(f.ctx(), r.input)).version).toBe(1);
  }));
  it("rejects unsupported glyphs and indivisible oversize rows instead of dropping source content", async () => withTestDatabase(async () => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), { withTransaction } = await import("../../src/server/db"), { renderDischargePDF } = await import("../../src/server/documents/pdf");
    const prepared = await withTransaction(tx => d.prepareDischargeDocumentInTransaction(tx, f.ctx(), r.input));
    if (prepared.existing) throw Error("Fresh fixture already has a copy");
    const unsupported = structuredClone(prepared.snapshot); unsupported.clinical.summary!.advice = "Recorded unsupported 🚀";
    await expect(renderDischargePDF(unsupported, prepared.hash)).rejects.toMatchObject({ code: "PRECONDITION", message: expect.stringContaining("U+1F680") });
    const oversized = structuredClone(prepared.snapshot); oversized.stays[0].bedLabel = "X".repeat(1601);
    await expect(renderDischargePDF(oversized, prepared.hash)).rejects.toMatchObject({ code: "PRECONDITION", message: expect.stringContaining("1600") });
    const excessivePages = structuredClone(prepared.snapshot);
    excessivePages.money.statement.lines = Array.from({ length: 2001 }, (_, i) => ({ kind: "CHARGE" as const, description: `Unpublished renderer-limit record ${i}: ` + "Original separate department text ".repeat(4), status: "FINAL", quantity: "1", unit: "piece", amountPaise: "100", ratePaise: "100", tariffVersionId: randomUUID(), chargeIds: [randomUUID()], postingCount: 1 }));
    await expect(renderDischargePDF(excessivePages, prepared.hash)).rejects.toMatchObject({ code: "PRECONDITION", message: expect.stringContaining("200 pages") });
  }));
  it("serializes native source changes through actual file publication and preserves old bytes", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    const source = (await runtime.query("select id from hims.clinical_rounds where admission_id=$1", [f.admissionId])).rows[0].id;
    const raced = await heldSource(runtime, await preparedPublication(f.ctx(), r.input), client => client.query("insert into hims.clinical_addenda(note_id,text,reason,signed_by) values($1,'Concurrent native correction','Exact linked original note',$2)", [source, f.doctor.id]));
    expect(raced.result).not.toHaveProperty("code");
    expect(await d.verifyDocument(f.ctx(), raced.written.documentId)).toMatchObject({ status: "SOURCE_CHANGED" });
    expect((await d.getDischargeDocument(f.ctx(), raced.written.documentId)).snapshot.clinical.addenda).toEqual([]);
    await expect(d.createDischargeDocument(f.ctx(), r.input)).rejects.toMatchObject({ code: "CONFLICT" });
    const next = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), version = await d.createDischargeDocument(f.ctx(), next.input);
    expect(version.version).toBe(2); expect((await d.downloadDischargeDocument(f.ctx(), raced.written.documentId)).bytes.subarray(0,5).toString()).toBe("%PDF-");
  }));
  it("serializes mutable physical bed labels through document publication", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    const bed = (await runtime.query("select b.id,b.label from hims.beds b join hims.admissions a on a.bed_id=b.id where a.id=$1", [f.admissionId])).rows[0];
    const race = await heldSource(runtime, await preparedPublication(f.ctx(), r.input), client => client.query("update hims.beds set label=$2 where id=$1", [bed.id, `Changed actual bed ${randomUUID()}`]));
    expect(race.result).not.toHaveProperty("code");
    expect((await d.getDischargeDocument(f.ctx(), race.written.documentId)).snapshot.stays[0].bedLabel).toBe(bed.label);
    expect(await d.verifyDocument(f.ctx(), race.written.documentId)).toMatchObject({ status: "SOURCE_CHANGED" });
  }));
  it("retains a recovery manifest after metadata failure and publishes no false valid copy", async () => withTestDatabase(async ({ runtime, owner }) => {
    const f = await fixture(), d = await documents(), r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), directory = d.documentStorageDirectory();
    await mkdir(directory, { recursive: true }); const before = new Set(await readdir(directory));
    await owner.query("create function hims.synthetic_document_failure() returns trigger language plpgsql as $$ begin raise exception 'Synthetic metadata failure'; end $$; create trigger synthetic_document_failure before insert on hims.discharge_documents for each row execute function hims.synthetic_document_failure()");
    try {
      await expect(d.createDischargeDocument(f.ctx(), r.input)).rejects.toThrow("Failed query");
      expect((await runtime.query("select count(*)::int n from hims.discharge_documents")).rows[0].n).toBe(0);
      const orphan = (await readdir(directory)).find(p => !before.has(p) && p.endsWith(".manifest.json"))!;
      expect(orphan).toBeTruthy(); const manifest = JSON.parse(await readFile(resolve(directory, orphan), "utf8"));
      expect(manifest).toMatchObject({ admissionId: f.admissionId, version: 1, sourceHash: r.input.expectedSourceHash });
      expect(createHash("sha256").update(await readFile(resolve(directory, `${manifest.storageKey}.pdf`))).digest("hex")).toBe(manifest.pdfHash);
      await expect(d.verifyDocument(f.ctx(), manifest.documentId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally { await owner.query("drop trigger synthetic_document_failure on hims.discharge_documents; drop function hims.synthetic_document_failure()"); }
    expect((await d.createDischargeDocument(f.ctx(), r.input)).version).toBe(1);
  }));
  it("keeps a safe historical medicine departure printable after the batch expires on a later hospital date", async () => withTestDatabase(async () => {
    const f = await fixture(false, false, true), d = await documents();
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.now() + 3 * 86400000));
    const r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), copy = await d.createDischargeDocument(f.ctx(), r.input);
    expect(await d.verifyDocument(f.ctx(), copy.documentId)).toMatchObject({ status: "CURRENT" });
    expect((await d.getDischargeDocument(f.ctx(), copy.documentId)).snapshot.clinical.summary?.prescription[0]).toMatchObject({ requestedItem: "Actual take-home medicine", dispensingQuantity: "2" });
    expect((await d.downloadDischargeDocument(f.ctx(), copy.documentId)).bytes.subarray(0,5).toString()).toBe("%PDF-");
  }));
  it("serializes a patient-wide native identity correction across two episodes and rereads after waiting", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture(true, true), d = await documents();
    const patientId = (await runtime.query("select patient_id from hims.admissions where id=$1", [f.admissionId])).rows[0].patient_id;
    const bed = await createBed(f.admin(), { label: randomUUID(), category: "GENERAL", reason: "Second episode of same patient" }), desk = f.deskCtx();
    const second = await createAdmission(desk, { patientId, admittingDoctorId: f.doctor.id, clinicianAssessment: { clinicianId: f.doctor.id, assessedAt: new Date().toISOString(), chiefComplaint: "Actual later assessment", vitals: "Actual vitals", triage: "Actual urgent routing", destinationCategory: "GENERAL" }, bedId: bed.id, paymentRoute: "SELF_PAY", expectedStayDays: 1, requestId: desk.requestId });
    const urgent = await exceptions.authorizeException(f.admin(), { admissionId: second.admissionId, type: "URGENT_ADMISSION", disposition: "ACTIVATE", authority: "Administrator second urgent routing", reason: "Same temporary patient later episode", evidenceIds: [], evidence: "Actual original temporary identity", followUpOwnerId: f.desk.id });
    const r = await d.getDischargeDocumentReview(f.ctx(), f.admissionId);
    const race = await heldSource(runtime, await preparedPublication(f.ctx(), r.input), client => client.query("insert into hims.patient_identifications(patient_id,admission_id,exception_id,version,name,date_of_birth,sex,evidence,reason,signed_by) values($1,$2,$3,1,'Actual verified patient identity','1980-01-01','FEMALE','Original identity inspected','Later actual identification',$4)", [patientId, second.admissionId, urgent.id, f.desk.id]));
    expect(race.result).not.toHaveProperty("code");
    expect(await d.verifyDocument(f.ctx(), race.written.documentId)).toMatchObject({ status: "SOURCE_CHANGED" });
    expect((await d.getDischargeDocument(f.ctx(), race.written.documentId)).snapshot.patient?.identityStatus).toBe("TEMPORARY");
    const observed = await heldSource(runtime, tx => tx.execute(sql`insert into hims.patient_identifications(patient_id,admission_id,exception_id,version,name,date_of_birth,sex,evidence,reason,signed_by) values(${patientId}::uuid,${second.admissionId}::uuid,${urgent.id}::uuid,2,'Second verified global identity','1980-01-01','FEMALE','Actual later identity evidence','Later current identity',${f.desk.id})`), () => d.getDischargeDocumentReview(f.ctx(), f.admissionId));
    expect(observed.result).toMatchObject({ name: "Second verified global identity" });
    const next = await d.getDischargeDocumentReview(f.ctx(), f.admissionId), amended = await d.createDischargeDocument(f.ctx(), next.input);
    expect(amended.version).toBe(2); expect((await d.getDischargeDocument(f.ctx(), amended.documentId)).snapshot.patient?.name).toBe("Second verified global identity");
    // A native writer in episode one owns the patient-wide source. The application writer
    // in episode two must wait BEFORE reading its expected current identity version.
    const stale = await heldSource(runtime, tx => tx.execute(sql`insert into hims.patient_identifications(patient_id,admission_id,exception_id,version,name,date_of_birth,sex,evidence,reason,signed_by) values(${patientId}::uuid,${f.admissionId}::uuid,${f.urgentId}::uuid,3,'Third current global identity','1980-01-01','FEMALE','Actual original identity evidence','Later current identity',${f.desk.id})`), () => exceptions.identifyTemporaryPatient(f.deskCtx(), { admissionId: second.admissionId, exceptionId: urgent.id, expectedVersion: 2, name: "Stale proposed identity", dateOfBirth: "1980-01-01", sex: "FEMALE", evidence: "Actual reviewed original identification", reason: "Current factual identification" }));
    expect(stale.result).toMatchObject({ code: "CONFLICT" });
  }));
});
