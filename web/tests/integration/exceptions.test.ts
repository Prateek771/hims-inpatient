import { afterEach, describe, expect, it } from "vitest";
import { withTestDatabase } from "../../scripts/test-database";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { billingFixture } from "../support/billing-fixture";
import { staffContext } from "../../src/server/access";
import * as exceptions from "../../src/server/discharge/exceptions";
import { exceptionWorkspace } from "../../src/server/discharge/exception-workspace";
import { activateAdmission, createBed, cancelAdmission, createAdmission, getAdmission } from "../../src/server/admissions/commands";
import * as clinical from "../../src/server/clinical/commands";
import * as discharge from "../../src/server/discharge/commands";
import * as nursing from "../../src/server/nursing/commands";
import * as billing from "../../src/server/billing/commands";
import { Client } from "pg";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../../src/server/schema";
import { sql } from "drizzle-orm";
async function reviewedVacancy(f: Awaited<ReturnType<typeof activeFixture>>) {
  await clinical.signClinicalSummary(f.doctorCtx(), { admissionId: f.admissionId, expectedVersion: 0, diagnosis: "Synthetic reviewed diagnosis", course: "Completed care review", condition: "Stable waiting", followUp: "Doctor follow-up", advice: "Continue monitoring", prescriptionOrderIds: [] });
  for (const [gate, ctx] of [["DOCTOR", f.doctorCtx], ["PHARMACY", () => staffContext(f.pharmacy, "synthetic-exception")], ["NURSING", f.nurseCtx]] as const) {
    const r = await discharge.getClearanceReview(ctx(), f.admissionId, gate);
    await discharge.issueClearance(ctx(), { admissionId: f.admissionId, gate, expectedReviewHash: r.reviewHash });
  }
  const c = f.nurseCtx();
  return discharge.recordRoomVacated(c, { admissionId: f.admissionId, shiftId: f.shift.id, vacatedAt: new Date().toISOString(), waitingLocation: "Actual supervised waiting area", handover: "Actual physical vacancy", requestId: c.requestId });
}
async function observedReaderRace<T>(runtime: Client, writer: NodePgDatabase<typeof schema>, writerPid: number, write: Parameters<typeof writer.transaction<T>>[0], read: () => Promise<unknown>) {
  let release = () => {}, ready = () => {};
  const held = new Promise<void>(r => release = r), acquired = new Promise<void>(r => ready = r);
  let first: Promise<T> | undefined, second: Promise<unknown> | undefined;
  try {
    first = writer.transaction(async tx => { const result = await write(tx); ready(); await held; return result; });
    await Promise.race([acquired, first.then(() => {})]);
    second = read().catch(e => e);
    let readerPid: number | undefined;
    for (let i = 0; i < 100; i++) {
      const blocked = await runtime.query("select pid from pg_stat_activity where $1::int=any(pg_blocking_pids(pid)) and usename=current_user", [writerPid]);
      if (blocked.rows.length) { readerPid = blocked.rows[0].pid; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    expect(readerPid).toBeDefined();
    expect(readerPid).not.toBe(writerPid);
    console.info("Task12 admission contention", { writerPid, readerPid, blockingObserved: true });
    const contentionPath = resolve(process.cwd(), "../tmp/review/task12-fix1-contention.jsonl");
    mkdirSync(dirname(contentionPath), { recursive: true });
    appendFileSync(contentionPath, JSON.stringify({ at: new Date().toISOString(), test: expect.getState().currentTestName, writerPid, readerPid, blockingObserved: true }) + "\n");
    release();
    return { result: await second, written: await first };
  } finally { release(); await Promise.allSettled([first, second]); }
}
async function activeFixture(route: "SELF_PAY" | "INSURED" = "SELF_PAY") {
  process.env.DATABASE_URL = testUrl;
  const f = await billingFixture();
  await f.setting({
    type: "deposit", category: "GENERAL", route: route === "INSURED" ? "insured" : "self-pay", requirement: "not-required", amount: "0"
  });
  await f.setting({
    type: "tariff", category: "GENERAL", amount: "3600", basis: "hour", rounding: "exact", graceMinutes: 0
  });
  const { admissionId } = await f.episode(route), ac = f.deskCtx();
  await activateAdmission(ac, {
    admissionId, arrivedAt: new Date().toISOString(), expectedVersion: 1, requestId: ac.requestId
  });
  const adminCtx = () => staffContext(f.admin, "synthetic-exception"), nurseCtx = () => staffContext(f.nurse, "synthetic-exception"), doctorCtx = () => staffContext(f.doctor, "synthetic-exception");
  await nursing.assignNurse(adminCtx(), {
    admissionId, nurseId: f.nurse.id, authority: "Synthetic roster", reason: "Actual assigned ward attendance"
  });
  const sc = nurseCtx();
  const shift = await nursing.recordShift(sc, {
    admissionId, startedAt: new Date().toISOString(), handover: "Actual ward attendance", requestId: sc.requestId
  });
  return {
    ...f, admissionId, adminCtx, nurseCtx, doctorCtx, shift
  };
}
loadLocalEnvironment();
const ordinaryUrl = process.env.DATABASE_URL;
const testUrl = getTestDatabaseConfig().runtimeUrl;
afterEach(() => {
  process.env.DATABASE_URL = ordinaryUrl;
});
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticExceptionsOnlySecretAtLeast32Characters12345";
describe("accountable administrator exceptions", () => {
  it.each(["amend-before-end", "end-before-amend", "native-end-before-amend"] as const)("attributes supported final cutoff to its later actual Nurse witness: %s", async order => withTestDatabase(async ({ runtime, owner }) => {
    const f = await activeFixture(), vacation = await reviewedVacancy(f);
    const original = (await runtime.query("select * from hims.room_vacations where id=$1", [vacation.id])).rows[0];
    await nursing.endShift(f.nurseCtx(), { shiftId: f.shift.id, endedAt: new Date().toISOString(), handover: "Original earlier attendance ends" });
    const start = f.nurseCtx(), later = await nursing.recordShift(start, { admissionId: f.admissionId, startedAt: new Date().toISOString(), handover: "Actual distinct later attendance", requestId: start.requestId });
    const authority = await exceptions.authorizeException(f.adminCtx(), { admissionId: f.admissionId, type: "ROOM_CUTOFF_CORRECTION", disposition: "AMEND", sourceId: original.stay_id, authority: "Administrator factual correction", reason: "Later Nurse verifies the final physical cutoff", evidenceIds: [], evidence: "Original cutoff superseded with retained later witness", followUpOwnerId: f.nurse.id });
    const cutoff = new Date().toISOString(), evidence = await exceptions.recordExceptionEvidence(f.nurseCtx(), { admissionId: f.admissionId, exceptionId: authority.id, kind: "ROOM_CUTOFF", sourceId: original.stay_id, shiftId: later.id, actualAt: cutoff, notes: "Actual final vacancy witnessed during later attendance" });
    const end = () => nursing.endShift(f.nurseCtx(), { shiftId: later.id, endedAt: new Date().toISOString(), handover: "Actual later shift handover" });
    if (order !== "amend-before-end") await end();
    let amendmentId: string;
    if (order.startsWith("native")) {
      amendmentId = (await owner.query("insert into hims.stay_boundary_amendments(admission_id,stay_id,exception_id,evidence_id,version,started_at,ended_at,reason,signed_by) select $1,s.id,$2,$3,1,s.started_at,$4,'Actual final cutoff correction',$5 from hims.room_stays s where s.id=$6 returning id", [f.admissionId, authority.id, evidence.id, cutoff, f.admin.id, original.stay_id])).rows[0].id;
    } else amendmentId = (await exceptions.correctRoomCutoff(f.adminCtx(), { admissionId: f.admissionId, exceptionId: authority.id, evidenceId: evidence.id })).id;
    if (order === "amend-before-end") await end();
    const fact = (await runtime.query("select * from hims.effective_vacation_facts where id=$1", [vacation.id])).rows[0];
    const witness = (await runtime.query("select * from hims.exception_evidence where id=$1", [evidence.id])).rows[0];
    expect(fact).toMatchObject({ shift_id: later.id, signed_by: witness.signed_by, signed_at: witness.signed_at, handover: witness.notes, amendment_id: amendmentId, evidence_id: evidence.id, original_shift_id: original.shift_id, original_signed_at: original.signed_at, original_vacated_at: original.vacated_at });
    expect(fact.vacated_at.toISOString()).toBe(cutoff);
    expect((await runtime.query("select * from hims.room_vacations where id=$1", [vacation.id])).rows[0]).toEqual(original);
    expect((await runtime.query("select shift_id,signed_at from hims.effective_room_vacations where id=$1", [vacation.id])).rows[0]).toMatchObject({ shift_id: later.id, signed_at: witness.signed_at });
    const review = await discharge.getClearanceReview(f.nurseCtx(), f.admissionId, "NURSING");
    expect(JSON.stringify(review.inputs)).toContain(evidence.id);
    expect(review.current).toBe(false);
  }));
  it("denies selected notes after a committed assignment revocation waiting on the admission", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture();
    await exceptions.recordExceptionEvidence(f.doctorCtx(), { admissionId: f.admissionId, kind: "PLANNED_EXIT", actualAt: new Date().toISOString(), notes: "Sensitive professional review for currently assigned staff" });
    await nursing.endShift(f.nurseCtx(), { shiftId: f.shift.id, endedAt: new Date().toISOString(), handover: "Actual signed handover before revocation" });
    const grant = (await runtime.query("select id from hims.nurse_assignments where admission_id=$1", [f.admissionId])).rows[0];
    const client = new Client({ connectionString: testUrl }); await client.connect();
    try {
      const pid = (await client.query("select pg_backend_pid() pid")).rows[0].pid;
      const race = await observedReaderRace(runtime, drizzle(client, { schema }), pid, tx => nursing.revokeNurseAssignmentInTransaction(tx, f.adminCtx(), { assignmentId: grant.id, authority: "Administrator actual reassignment", reason: "Remove completed staff assignment" }), () => exceptionWorkspace(f.nurseCtx(), f.admissionId));
      expect(race.result).toMatchObject({ code: "FORBIDDEN" });
      expect((await runtime.query("select count(*)::int n from hims.nurse_assignment_revocations where assignment_id=$1", [grant.id])).rows[0].n).toBe(1);
    } finally { await client.end(); }
  }));
  it("native Doctor exception evidence changes clinical source hashes and invalidates old professional seals", async () => withTestDatabase(async ({ runtime, owner }) => {
    const f = await activeFixture(), vacation = await reviewedVacancy(f), before = await discharge.getClearanceReview(f.doctorCtx(), f.admissionId, "DOCTOR");
    const native = (await owner.query("insert into hims.exception_evidence(admission_id,kind,role,source_id,actual_at,notes,signed_by) values($1,'RETURN_TO_BED','DOCTOR',$2,clock_timestamp(),'Doctor native source-bound continued bed care',$3) returning id", [f.admissionId, vacation.id, f.doctor.id])).rows[0];
    expect((await runtime.query("select count(*)::int n from hims.clearance_invalidations i join hims.clearance_seals s on s.id=i.seal_id where s.admission_id=$1 and s.gate in ('DOCTOR','PHARMACY','NURSING')", [f.admissionId])).rows[0].n).toBe(3);
    const after = await discharge.getClearanceReview(f.doctorCtx(), f.admissionId, "DOCTOR");
    expect(after.reviewHash).not.toBe(before.reviewHash);
    expect(JSON.stringify(after.inputs)).toContain(native.id);
    await expect(discharge.issueClearance(f.doctorCtx(), { admissionId: f.admissionId, gate: "DOCTOR", expectedReviewHash: before.reviewHash })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.query("insert into hims.clearance_seals(admission_id,gate,role,review_hash,inputs,reason,signed_by) values($1,'DOCTOR','DOCTOR',$2,'{}','Bypass missing reconsideration',$3)", [f.admissionId, before.reviewHash, f.doctor.id])).rejects.toMatchObject({ code: "23514" });
  }));
  it("preserves the original earlier vacancy witness for an unchanged cutoff and rejects a changed cutoff outside the later exit witness attendance", async () => withTestDatabase(async ({ runtime, owner }) => {
    const f = await activeFixture(), vacancy = await reviewedVacancy(f), original = (await runtime.query("select * from hims.room_vacations where id=$1", [vacancy.id])).rows[0];
    await nursing.endShift(f.nurseCtx(), { shiftId: f.shift.id, endedAt: new Date().toISOString(), handover: "Original vacancy witness ends attendance" });
    const c = f.nurseCtx(), later = await nursing.recordShift(c, { admissionId: f.admissionId, startedAt: new Date().toISOString(), handover: "Later hospital-exit witness begins", requestId: c.requestId });
    const physical = await exceptions.recordExceptionEvidence(f.nurseCtx(), { admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: later.id, actualAt: new Date().toISOString(), vacatedAt: original.vacated_at.toISOString(), notes: "Later hospital exit; original earlier bed-vacancy witness is retained" });
    const authority = await exceptions.authorizeException(f.adminCtx(), { admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator actual exit routing", reason: "Separate later hospital exit and retained earlier bed vacancy", evidenceIds: [physical.id], evidence: "Both original vacancy and later door-exit witness retained", followUpOwnerId: f.doctor.id });
    await owner.query("insert into hims.stay_boundary_amendments(admission_id,stay_id,exception_id,evidence_id,version,started_at,ended_at,reason,signed_by) select $1,s.id,$2,$3,1,s.started_at,$4,'Retain actual witnessed cutoff',$5 from hims.room_stays s where s.id=$6", [f.admissionId, authority.id, physical.id, original.vacated_at, f.admin.id, original.stay_id]);
    const fact = (await runtime.query("select * from hims.effective_vacation_facts where id=$1", [vacancy.id])).rows[0];
    expect(fact).toMatchObject({ shift_id: f.shift.id, signed_at: original.signed_at, handover: original.handover, waiting_location: original.waiting_location });
    const clean = await runtime.query("insert into hims.bed_turnovers(admission_id,bed_id,stay_id,vacated_at,reason,signed_by) select $1,s.bed_id,s.id,$2,'Actual original vacancy cleaning source',$3 from hims.room_stays s where s.id=$4 returning id", [f.admissionId, original.vacated_at, f.admin.id, original.stay_id]);
    const turnover = (await runtime.query("select * from hims.effective_bed_turnovers where id=$1", [clean.rows[0].id])).rows[0];
    expect(turnover).toMatchObject({ cutoff_shift_id: f.shift.id, cutoff_signed_at: original.signed_at });
    const changed = new Date(original.vacated_at.getTime() - 1);
    const wrong = await exceptions.recordExceptionEvidence(f.nurseCtx(), { admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: later.id, actualAt: new Date().toISOString(), vacatedAt: changed.toISOString(), notes: "Exit witness cannot attest changed cutoff before their actual shift" });
    const wrongAuthority = await exceptions.authorizeException(f.adminCtx(), { admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator attempted correction", reason: "Changed cutoff lacks in-attendance professional witness", evidenceIds: [wrong.id], evidence: "Later exit evidence only", followUpOwnerId: f.doctor.id });
    await expect(owner.query("insert into hims.stay_boundary_amendments(admission_id,stay_id,exception_id,evidence_id,version,started_at,ended_at,reason,signed_by) select $1,s.id,$2,$3,2,s.started_at,$4,'Invalid changed bed cutoff',$5 from hims.room_stays s where s.id=$6", [f.admissionId, wrongAuthority.id, wrong.id, changed, f.admin.id, original.stay_id])).rejects.toMatchObject({ code: "23514" });
  }));
  it.each(["amend-before-end", "end-before-amend", "repeatable-end-before-amend"] as const)("serializes native corrected final cutoff and later-witness attendance on actual backends: %s", async order => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture(), vacancy = await reviewedVacancy(f);
    const raw = (await runtime.query("select * from hims.room_vacations where id=$1", [vacancy.id])).rows[0];
    await nursing.endShift(f.nurseCtx(), { shiftId: f.shift.id, endedAt: new Date().toISOString(), handover: "Original distinct earlier attendance ends" });
    const nc = f.nurseCtx(), later = await nursing.recordShift(nc, { admissionId: f.admissionId, startedAt: new Date().toISOString(), handover: "Later actual witness attends", requestId: nc.requestId });
    const authority = await exceptions.authorizeException(f.adminCtx(), { admissionId: f.admissionId, type: "ROOM_CUTOFF_CORRECTION", disposition: "AMEND", sourceId: raw.stay_id, authority: "Administrator source review", reason: "Correct factual final cutoff with later witness", evidenceIds: [], evidence: "Retained later professional evidence", followUpOwnerId: f.nurse.id });
    const cutoff = new Date().toISOString(), evidence = await exceptions.recordExceptionEvidence(f.nurseCtx(), { admissionId: f.admissionId, kind: "ROOM_CUTOFF", exceptionId: authority.id, sourceId: raw.stay_id, shiftId: later.id, actualAt: cutoff, notes: "Actual later cutoff witness for concurrency" });
    const one = new Client({ connectionString: testUrl }), two = new Client({ connectionString: testUrl }); await Promise.all([one.connect(), two.connect()]);
    try {
      const pid = (await one.query("select pg_backend_pid() pid")).rows[0].pid, first = drizzle(one, { schema }), second = drizzle(two, { schema });
      const amend = async (tx: Parameters<Parameters<typeof first.transaction>[0]>[0]) => (await tx.execute(sql`insert into hims.stay_boundary_amendments(admission_id,stay_id,exception_id,evidence_id,version,started_at,ended_at,reason,signed_by) select ${f.admissionId}::uuid,s.id,${authority.id}::uuid,${evidence.id}::uuid,1,s.started_at,${cutoff}::timestamptz,'Actual concurrent final cutoff',${f.admin.id} from hims.room_stays s where s.id=${raw.stay_id}::uuid returning id`)).rows[0];
      const end = (tx: Parameters<Parameters<typeof first.transaction>[0]>[0]) => nursing.endShiftInTransaction(tx, f.nurseCtx(), { shiftId: later.id, endedAt: new Date().toISOString(), handover: "Actual later attendance ends after its cutoff" });
      let race;
      if (order === "amend-before-end") race = await observedReaderRace(runtime, first, pid, amend, () => second.transaction(end));
      else race = await observedReaderRace(runtime, first, pid, end, () => second.transaction(async tx => { if (order.startsWith("repeatable")) { await tx.execute(sql`set transaction isolation level repeatable read`); await tx.execute(sql`select version from hims.admissions where id=${f.admissionId}::uuid`); } return amend(tx); }));
      if (order.startsWith("repeatable")) {
        expect(race.result).toMatchObject({ cause: { code: "40001" } });
        await second.transaction(amend);
      } else expect(race.result).toHaveProperty("id");
      const fact = (await runtime.query("select * from hims.effective_vacation_facts where id=$1", [vacancy.id])).rows[0];
      expect(fact.shift_id).toBe(later.id); expect(fact.vacated_at.toISOString()).toBe(cutoff);
      expect(fact.original_shift_id).toBe(f.shift.id);
    } finally { await Promise.all([one.end(), two.end()]); }
  }));
  it("rereads the selected physical bed after a committed actual transfer waiting on the admission", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture(), target = await createBed(f.adminCtx(), { label: "ACTUAL-SELECTED-TARGET", category: "GENERAL", reason: "Actual configured destination" });
    const c = f.doctorCtx(), order = await clinical.orderTransfer(c, { admissionId: f.admissionId, destinationCategory: "GENERAL", reason: "Actual current Doctor transfer", requestId: c.requestId });
    const client = new Client({ connectionString: testUrl }); await client.connect();
    try {
      const pid = (await client.query("select pg_backend_pid() pid")).rows[0].pid, nc = f.nurseCtx();
      const { transferAdmissionInTransaction } = await import("../../src/server/admissions/commands");
      const race = await observedReaderRace(runtime, drizzle(client, { schema }), pid, tx => transferAdmissionInTransaction(tx, nc, { admissionId: f.admissionId, transferOrderId: order.id, targetBedId: target.id, transferredAt: new Date().toISOString(), handover: { shiftId: f.shift.id, notes: "Actual handover to current target" }, requestId: nc.requestId }), () => exceptionWorkspace(f.nurseCtx(), f.admissionId));
      expect(race.result).toMatchObject({ selected: { episode: { bedLabel: "ACTUAL-SELECTED-TARGET" } } });
    } finally { await client.end(); }
  }));
  it("requires Admin authority and activates urgent occupancy without pretending the deposit was received", async () => withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture();
    await f.setting({
      type: "deposit", category: "GENERAL", route: "self-pay", requirement: "required", amount: "50000"
    });
    const { admissionId } = await f.episode();
    const input = {
      admissionId, type: "URGENT_ADMISSION", authority: "On-call hospital administrator", reason: "Urgent assessed admission before family can pay", evidenceIds: [], evidence: "Recorded intake clinician assessment", disposition: "ACTIVATE", followUpOwnerId: f.admin.id
    };
    await expect(exceptions.authorizeException(f.deskCtx(), input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ctx = staffContext(f.admin, "synthetic-exception");
    const authorized = await exceptions.authorizeException(ctx, input);
    expect(await exceptions.authorizeException(ctx, input)).toEqual(authorized);
    const activate = f.deskCtx();
    await activateAdmission(activate, {
      admissionId, arrivedAt: new Date().toISOString(), expectedVersion: 1, exceptionId: authorized.id, requestId: activate.requestId
    });
    expect((await runtime.query("select status from hims.admissions where id=$1", [admissionId])).rows[0].status).toBe("ADMITTED");
    expect((await runtime.query("select count(*)::int n from hims.receipts where admission_id=$1", [admissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.clearance_seals where admission_id=$1", [admissionId])).rows[0].n).toBe(0);
    let current = await exceptions.getExceptionReview(staffContext(f.admin, "synthetic-exception"), admissionId);
    expect(current.obligations.deposit).toMatchObject({ requiredPaise: "5000000", outstandingPaise: "5000000" });
    await f.setting({
      type: "deposit", category: "GENERAL", route: "self-pay", requirement: "required", amount: "90000"
    });
    const paid = f.ctx();
    await billing.recordReceipt(paid, {
      admissionId, party: "PATIENT", kind: "TOP_UP", amountPaise: "2000000", mode: "CASH", channel: "Actual urgent deposit book", sourceReference: "URGENT-LATER", reference: "Family paid part of original deferred deposit", requestId: paid.requestId
    });
    current = await exceptions.getExceptionReview(staffContext(f.admin, "synthetic-exception"), admissionId);
    expect(current.obligations.deposit).toMatchObject({ requiredPaise: "5000000", outstandingPaise: "3000000" });
    expect(current.exceptions[0].snapshot.deposit).toMatchObject({ outstandingPaise: "5000000" });
  }));
  it("records factual early exit without fake seals, retains debt and collects later cash under source-bound authority", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture();
    const T = new Date().toISOString();
    const witness = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Patient left the hospital before the Doctor could review"
    });
    const authority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "On-call administrator", reason: "Actual early departure witnessed by assigned Nurse", evidenceIds: [witness.id], evidence: "Doctor follow-up remains required", followUpOwnerId: f.doctor.id
    });
    const c = f.adminCtx(), v = {
      admissionId: f.admissionId, exceptionId: authority.id, physicalEvidenceId: witness.id
    };
    const exit = await exceptions.recordExceptionalDeparture(c, v);
    expect(exit.status).toBe("DISCHARGED");
    expect(await exceptions.recordExceptionalDeparture(c, v)).toEqual(exit);
    expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1", [f.admissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.bed_turnovers where admission_id=$1", [f.admissionId])).rows[0].n).toBe(1);
    expect((await runtime.query("select count(*)::int n from hims.clearance_seals where admission_id=$1", [f.admissionId])).rows[0].n).toBe(0);
    const b = await billing.getBill(f.ctx(), f.admissionId);
    expect(b.netPaise).toBeGreaterThan(0n);
    const plain = f.ctx();
    const cash = {
      admissionId: f.admissionId, party: "PATIENT", kind: "PAYMENT", amountPaise: b.netPaise.toString(), mode: "CASH", channel: "Later actual cashier book", sourceReference: "LATER-1", reference: "Actual collection after early exit", requestId: plain.requestId
    };
    await expect(billing.recordReceipt(plain, cash)).rejects.toMatchObject({ code: "PRECONDITION" });
    const amendment = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correctionKind: "RECEIPT", sourceId: exit.id, authority: "Administrator collection review", reason: "Record actual later cash against outstanding balance", evidenceIds: [], evidence: "Cash book actual receipt", followUpOwnerId: f.cashier.id
    });
    const collect = f.ctx();
    await exceptions.applyPostDischargeCorrection(collect, {
      admissionId: f.admissionId, exceptionId: amendment.id, kind: "RECEIPT", sourceId: exit.id, data: { ...cash, requestId: collect.requestId }
    });
    expect((await billing.getBill(f.ctx(), f.admissionId)).outstandingPaise).toBe(0n);
    expect((await runtime.query("select count(*)::int n from hims.bed_turnovers where admission_id=$1", [f.admissionId])).rows[0].n).toBe(1);
    await nursing.endShift(f.nurseCtx(), {
      shiftId: f.shift.id, endedAt: T, handover: "Actual original Nurse closes recorded attendance after exit"
    });
    expect((await exceptions.getExceptionReview(f.adminCtx(), f.admissionId)).obligations.professionalFollowUp).toMatchObject({ status: "PENDING_DOCTOR" });
    const professional = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correctionKind: "DISPOSITION_REVIEW", sourceId: exit.id, authority: "Administrator missing professional follow-up", reason: "Doctor now available to review actual early exit", evidenceIds: [], evidence: "Original unreviewed departure retained", followUpOwnerId: f.doctor.id
    });
    await exceptions.applyPostDischargeCorrection(f.doctorCtx(), {
      admissionId: f.admissionId, exceptionId: professional.id, kind: "DISPOSITION_REVIEW", sourceId: exit.id, data: { text: "Doctor reviewed the original early departure today; advice was unavailable at exit", reason: "Actual later professional follow-up" }
    });
    expect((await exceptions.getExceptionReview(f.adminCtx(), f.admissionId)).obligations.professionalFollowUp).toMatchObject({ status: "REVIEWED" });
    expect((await runtime.query("select snapshot from hims.exceptional_departures where id=$1", [exit.id])).rows[0].snapshot.clinicalStatus).toBe("UNREVIEWED_EARLY_EXIT");
    await exceptions.recordExceptionFollowup(f.doctorCtx(), {
      exceptionId: professional.id, ownerId: f.doctor.id, note: "Actual later professional discussion recorded; original exit status retained"
    });
  }));
  it("retains the factual early cutoff behind a posted cursor with original-rate linked correction", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture();
    const T = new Date().toISOString();
    const witness = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Actual witnessed earlier departure entered before financial catch-up"
    });
    await new Promise(resolve => setTimeout(resolve, 40));
    const rc = f.ctx();
    await billing.reconcileBill(rc, { admissionId: f.admissionId, cutoff: new Date().toISOString() });
    const before = (await runtime.query("select * from hims.room_stays where admission_id=$1", [f.admissionId])).rows[0];
    expect(before.last_reconciled_at.getTime()).toBeGreaterThan(new Date(T).getTime());
    await f.setting({
      type: "tariff", category: "GENERAL", amount: "9999", basis: "hour", rounding: "exact", graceMinutes: 0
    });
    const authority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator factual correction review", reason: "Worker posted beyond witnessed actual departure", evidenceIds: [witness.id], evidence: "Original Nurse witness time retained", followUpOwnerId: f.doctor.id
    });
    await exceptions.recordExceptionalDeparture(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: authority.id, physicalEvidenceId: witness.id
    });
    const original = (await runtime.query("select * from hims.room_stays where id=$1", [before.id])).rows[0];
    expect(original).toEqual(before);
    const effective = (await runtime.query("select * from hims.effective_room_stays where id=$1", [before.id])).rows[0];
    expect(effective.ended_at.toISOString()).toBe(T);
    const bill = await billing.getBill(f.ctx(), f.admissionId);
    const elapsed = BigInt(new Date(T).getTime() - before.started_at.getTime());
    expect(bill.netPaise).toBe((elapsed * 360000n + 1800000n) / 3600000n);
    expect(bill.reversals.length).toBeGreaterThan(0);
    expect(bill.unpostedRoomPaise).toBe(0n);
    expect(bill.charges.every(c => c.tariffVersionId === before.tariff_version_id)).toBe(true);
  }));
  it("records delayed actual transfer at T, retains original pinned overcharge correction and continues charging the new bed", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture();
    await f.setting({
      type: "bed-category", code: "ICU", name: "Synthetic ICU", active: true
    });
    const rate = await f.setting({
      type: "tariff", category: "ICU", amount: "7200", basis: "hour", rounding: "exact", graceMinutes: 0
    });
    const target = await createBed(f.adminCtx(), {
      label: "Late actual ICU", category: "ICU", reason: "Synthetic actual target"
    });
    const dc = f.doctorCtx(), order = await clinical.orderTransfer(dc, {
      admissionId: f.admissionId, destinationCategory: "ICU", reason: "Doctor selected ICU", requestId: dc.requestId
    });
    const T = new Date().toISOString();
    const witness = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "TRANSFER_HANDOVER", shiftId: f.shift.id, sourceId: order.id, actualAt: T, notes: "Actual physical transfer handover to ICU"
    });
    await new Promise(resolve => setTimeout(resolve, 40));
    await billing.reconcileBill(f.ctx(), { admissionId: f.admissionId, cutoff: new Date().toISOString() });
    const original = (await runtime.query("select * from hims.room_stays where admission_id=$1", [f.admissionId])).rows[0];
    await f.setting({
      type: "tariff", category: "ICU", amount: "9999", basis: "hour", rounding: "exact", graceMinutes: 0
    });
    const authority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "DELAYED_TRANSFER", disposition: "TRANSFER", authority: "Administrator retrospective recording review", reason: "Factual nursing move predates worker catch-up", evidenceIds: [witness.id], evidence: "Original Doctor order and assigned Nurse witness", followUpOwnerId: f.admin.id
    });
    const result = await exceptions.applyDelayedTransfer(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: authority.id, evidenceId: witness.id, targetBedId: target.id
    });
    expect(result.oldStayId).toBe(original.id);
    expect((await runtime.query("select * from hims.room_stays where id=$1", [original.id])).rows[0]).toEqual(original);
    const next = (await runtime.query("select * from hims.effective_room_stays where id=$1", [result.newStayId])).rows[0];
    expect(next.started_at.toISOString()).toBe(T);
    expect(next.tariff_version_id).toBe(rate.id);
    const first = await billing.getBill(f.ctx(), f.admissionId);
    await new Promise(resolve => setTimeout(resolve, 40));
    await billing.reconcileBill(f.ctx(), { admissionId: f.admissionId, cutoff: new Date().toISOString() });
    const after = await billing.getBill(f.ctx(), f.admissionId);
    expect(after.netPaise).toBeGreaterThan(first.netPaise);
    expect(after.reversals.length).toBeGreaterThan(0);
    const use = await nursing.recordConsumable(f.nurseCtx(), {
      admissionId: f.admissionId, shiftId: f.shift.id, usedAt: new Date().toISOString(), itemId: "WARD_ITEM", quantity: "1", unit: "piece", reason: "Actual new-unit use after delayed correction"
    });
    expect((await runtime.query("select stay_id,bed_id from hims.nursing_consumables where id=$1", [use.id])).rows[0]).toEqual({ stay_id: result.newStayId, bed_id: target.id });
    const correction = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "ROOM_CUTOFF_CORRECTION", disposition: "AMEND", sourceId: original.id, authority: "Administrator factual history review", reason: "Attempted one-sided intermediate boundary correction", evidenceIds: [], evidence: "Both adjacent sources would need coordinated amendment", followUpOwnerId: f.admin.id
    });
    const cutoff = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "ROOM_CUTOFF", exceptionId: correction.id, sourceId: original.id, shiftId: f.shift.id, actualAt: T, notes: "Retained original intermediate boundary witness"
    });
    const historyBefore = (await runtime.query("select * from hims.stay_boundary_amendments where admission_id=$1", [f.admissionId])).rows;
    const moneyBefore = await billing.getBill(f.ctx(), f.admissionId);
    await expect(exceptions.correctRoomCutoff(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: correction.id, evidenceId: cutoff.id
    })).rejects.toMatchObject({ code: "PRECONDITION" });
    expect((await runtime.query("select * from hims.stay_boundary_amendments where admission_id=$1", [f.admissionId])).rows).toEqual(historyBefore);
    const moneyAfter = await billing.getBill(f.ctx(), f.admissionId);
    expect(moneyAfter.charges).toEqual(moneyBefore.charges);
    expect(moneyAfter.reversals).toEqual(moneyBefore.reversals);
    expect(moneyAfter.receipts).toEqual(moneyBefore.receipts);
    await expect(nursing.endShift(f.nurseCtx(), {
      shiftId: f.shift.id, endedAt: new Date(new Date(T).getTime() - 1).toISOString(), handover: "Illegal early attendance end"
    })).rejects.toMatchObject({ code: "VALIDATION" });
  }));
  it("returns an active off-bed patient to a freshly priced cleaned bed and explicitly supersedes the old vacancy", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture();
    await clinical.signClinicalSummary(f.doctorCtx(), {
      admissionId: f.admissionId, expectedVersion: 0, diagnosis: "Synthetic reviewed diagnosis", course: "Actual completed review", condition: "Stable off-bed waiting", followUp: "Doctor follow-up", advice: "Monitoring continues", prescriptionOrderIds: []
    });
    for (const [gate, ctx] of [["DOCTOR", f.doctorCtx], ["PHARMACY", () => staffContext(f.pharmacy, "synthetic-exception")], ["NURSING", f.nurseCtx]] as const) {
      const review = await discharge.getClearanceReview(ctx(), f.admissionId, gate);
      await discharge.issueClearance(ctx(), {
        admissionId: f.admissionId, gate, expectedReviewHash: review.reviewHash
      });
    }
    const vc = f.nurseCtx(), vacation = await discharge.recordRoomVacated(vc, {
      admissionId: f.admissionId, shiftId: f.shift.id, vacatedAt: new Date().toISOString(), waitingLocation: "Supervised waiting chairs", handover: "Actual room vacancy with active monitoring", requestId: vc.requestId
    });
    const doctor = await exceptions.recordExceptionEvidence(f.doctorCtx(), {
      admissionId: f.admissionId, kind: "RETURN_TO_BED", sourceId: vacation.id, actualAt: new Date().toISOString(), notes: "Doctor instructs return to the same reserved General bed"
    });
    const authority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "RETURN_TO_BED", disposition: "RETURN_TO_BED", authority: "Administrator bed return routing", reason: "Fresh clinical instruction for continued bed care", evidenceIds: [doctor.id], evidence: "Doctor return instruction", followUpOwnerId: f.admin.id
    });
    const [turnover] = (await runtime.query("select id from hims.bed_turnovers where admission_id=$1", [f.admissionId])).rows;
    const clean = f.adminCtx();
    await discharge.completeBedTurnover(clean, {
      turnoverId: turnover.id, completedAt: new Date().toISOString(), evidence: "Actual cleaning before bed return", requestId: clean.requestId
    });
    const rate = await f.setting({
      type: "tariff", category: "GENERAL", amount: "7200", basis: "hour", rounding: "exact", graceMinutes: 0
    });
    const witness = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "RETURN_HANDOVER", sourceId: vacation.id, shiftId: f.shift.id, actualAt: new Date().toISOString(), notes: "Actual patient return after Doctor instruction and cleaning"
    });
    await expect(exceptions.recordExceptionEvidence(f.doctorCtx(), { admissionId: f.admissionId, kind: "RETURN_CANCELLED", sourceId: doctor.id, actualAt: new Date().toISOString(), notes: "Cannot erase already witnessed physical return" })).rejects.toMatchObject({ code: "PRECONDITION" });
    await expect(runtime.query("insert into hims.exception_evidence(admission_id,kind,role,source_id,actual_at,notes,signed_by) values($1,'RETURN_CANCELLED','DOCTOR',$2,clock_timestamp(),'Cannot erase already witnessed return',$3)", [f.admissionId, doctor.id, f.doctor.id])).rejects.toMatchObject({ code: "23514" });
    const returned = await exceptions.returnToBed(f.nurseCtx(), {
      admissionId: f.admissionId, exceptionId: authority.id, doctorEvidenceId: doctor.id, nurseEvidenceId: witness.id
    });
    const stay = (await runtime.query("select * from hims.effective_room_stays where id=$1", [returned.id])).rows[0];
    expect(stay.tariff_version_id).toBe(rate.id);
    expect((await runtime.query("select count(*)::int n from hims.room_vacations where admission_id=$1", [f.admissionId])).rows[0].n).toBe(1);
    expect((await runtime.query("select count(*)::int n from hims.effective_room_vacations where admission_id=$1", [f.admissionId])).rows[0].n).toBe(0);
    const review = await discharge.getClearanceReview(f.ctx(), f.admissionId, "BILLING");
    expect(review.physicalBedUse).toBeUndefined();
    expect(review.gates.some(g => !g.current)).toBe(true);
    await billing.reconcileBill(f.ctx(), { admissionId: f.admissionId, cutoff: new Date().toISOString() });
    expect((await billing.getBill(f.ctx(), f.admissionId)).charges.some(c => c.tariffVersionId === rate.id)).toBe(true);
    for (const [gate, ctx] of [["DOCTOR", f.doctorCtx], ["PHARMACY", () => staffContext(f.pharmacy, "synthetic-exception")], ["NURSING", f.nurseCtx]] as const) {
      const r = await discharge.getClearanceReview(ctx(), f.admissionId, gate);
      await discharge.issueClearance(ctx(), {
        admissionId: f.admissionId, gate, expectedReviewHash: r.reviewHash
      });
    }
    const secondVacancyCtx = f.nurseCtx(), secondVacancy = await discharge.recordRoomVacated(secondVacancyCtx, {
      admissionId: f.admissionId, shiftId: f.shift.id, vacatedAt: new Date().toISOString(), waitingLocation: "Second actual waiting period", handover: "Actual second room vacancy", requestId: secondVacancyCtx.requestId
    });
    const secondDoctor = await exceptions.recordExceptionEvidence(f.doctorCtx(), {
      admissionId: f.admissionId, kind: "RETURN_TO_BED", sourceId: secondVacancy.id, actualAt: new Date().toISOString(), notes: "New Doctor instruction for second actual return"
    });
    const secondAuthority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "RETURN_TO_BED", disposition: "RETURN_TO_BED", authority: "Administrator second return routing", reason: "Second fresh clinical instruction after second vacancy", evidenceIds: [secondDoctor.id], evidence: "Second original Doctor instruction", followUpOwnerId: f.admin.id
    });
    const secondTurnover = (await runtime.query("select id from hims.bed_turnovers where stay_id=$1", [returned.id])).rows[0], secondClean = f.adminCtx();
    await discharge.completeBedTurnover(secondClean, {
      turnoverId: secondTurnover.id, completedAt: new Date().toISOString(), evidence: "Second actual cleaning before return", requestId: secondClean.requestId
    });
    const secondNurse = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "RETURN_HANDOVER", sourceId: secondVacancy.id, shiftId: f.shift.id, actualAt: new Date().toISOString(), notes: "Second actual cleaned bed return handover"
    });
    const secondReturn = await exceptions.returnToBed(f.nurseCtx(), {
      admissionId: f.admissionId, exceptionId: secondAuthority.id, doctorEvidenceId: secondDoctor.id, nurseEvidenceId: secondNurse.id
    });
    expect(secondReturn.id).not.toBe(returned.id);
    expect((await runtime.query("select count(*)::int n from hims.room_vacations where admission_id=$1", [f.admissionId])).rows[0].n).toBe(2);
    expect((await runtime.query("select count(*)::int n from hims.effective_room_vacations where admission_id=$1", [f.admissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.effective_room_stays where admission_id=$1 and ended_at is null", [f.admissionId])).rows[0].n).toBe(1);
  }));
  it("preserves a proposed return cleaning source when the patient instead completes ordinary departure", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture();
    await clinical.signClinicalSummary(f.doctorCtx(), {
      admissionId: f.admissionId, expectedVersion: 0, diagnosis: "Synthetic reviewed diagnosis", course: "Actual completed review", condition: "Stable off-bed waiting", followUp: "Doctor follow-up", advice: "Monitoring continues", prescriptionOrderIds: []
    });
    for (const [gate, ctx] of [["DOCTOR", f.doctorCtx], ["PHARMACY", () => staffContext(f.pharmacy, "synthetic-exception")], ["NURSING", f.nurseCtx]] as const) {
      const review = await discharge.getClearanceReview(ctx(), f.admissionId, gate);
      await discharge.issueClearance(ctx(), {
        admissionId: f.admissionId, gate, expectedReviewHash: review.reviewHash
      });
    }
    const vc = f.nurseCtx(), vacation = await discharge.recordRoomVacated(vc, {
      admissionId: f.admissionId, shiftId: f.shift.id, vacatedAt: new Date().toISOString(), waitingLocation: "Supervised waiting chairs", handover: "Actual room vacancy with active monitoring", requestId: vc.requestId
    });
    const oldReview = await discharge.getClearanceReview(f.doctorCtx(), f.admissionId, "DOCTOR");
    const doctor = await exceptions.recordExceptionEvidence(f.doctorCtx(), {
      admissionId: f.admissionId, kind: "RETURN_TO_BED", sourceId: vacation.id, actualAt: new Date().toISOString(), notes: "Doctor instructs return to the same reserved General bed"
    });
    const changed = await discharge.getClearanceReview(f.doctorCtx(), f.admissionId, "DOCTOR");
    expect(changed.gates.slice(0, 3).every(g => !g.current)).toBe(true);
    expect(changed.blockers.join(" ")).toContain("return instruction");
    expect(changed.reviewHash).not.toBe(oldReview.reviewHash);
    await expect(discharge.issueClearance(f.doctorCtx(), { admissionId: f.admissionId, gate: "DOCTOR", expectedReviewHash: oldReview.reviewHash })).rejects.toMatchObject({ code: "CONFLICT" });
    const authority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "RETURN_TO_BED", disposition: "RETURN_TO_BED", authority: "Administrator bed return routing", reason: "Fresh clinical instruction for continued bed care", evidenceIds: [doctor.id], evidence: "Doctor return instruction", followUpOwnerId: f.admin.id
    });
    const [turnover] = (await runtime.query("select id from hims.bed_turnovers where admission_id=$1", [f.admissionId])).rows;
    const originalTurnover = (await runtime.query("select * from hims.bed_turnovers where id=$1", [turnover.id])).rows[0];
    // A revised clinical decision is explicit and source-bound; paying cannot cancel bed care.
    await exceptions.recordExceptionEvidence(f.doctorCtx(), {
      admissionId: f.admissionId, kind: "RETURN_CANCELLED", sourceId: doctor.id, actualAt: new Date().toISOString(), notes: "Doctor re-reviewed the patient: bed care is no longer required; ordinary discharge review may proceed"
    });
    await expect(exceptions.recordExceptionEvidence(f.nurseCtx(), { admissionId: f.admissionId, kind: "RETURN_HANDOVER", sourceId: vacation.id, shiftId: f.shift.id, actualAt: new Date().toISOString(), notes: "Superseded instruction cannot authorize new physical return" })).rejects.toMatchObject({ code: "PRECONDITION" });
    for (const [gate, ctx] of [["DOCTOR", f.doctorCtx], ["PHARMACY", () => staffContext(f.pharmacy, "synthetic-exception")], ["NURSING", f.nurseCtx]] as const) {
      const review = await discharge.getClearanceReview(ctx(), f.admissionId, gate);
      await discharge.issueClearance(ctx(), { admissionId: f.admissionId, gate, expectedReviewHash: review.reviewHash });
    }
    await exceptions.recordExceptionFollowup(f.adminCtx(), { exceptionId: authority.id, ownerId: f.admin.id, note: "Administrative financial follow-up leaves clinical decision unchanged" });
    expect((await discharge.getClearanceReview(f.doctorCtx(), f.admissionId, "DOCTOR")).gates.slice(0, 3).every(g => g.current)).toBe(true);
    const bill = await billing.getBill(f.ctx(), f.admissionId), cash = f.ctx();
    expect(bill.netPaise).toBeGreaterThan(0n);
    await billing.recordReceipt(cash, {
      admissionId: f.admissionId, party: "PATIENT", kind: "PAYMENT", amountPaise: bill.netPaise.toString(), mode: "CASH", channel: "Actual ordinary cashier", sourceReference: "PROPOSED-RETURN-EXIT", reference: "Actual final settlement", requestId: cash.requestId
    });
    const final = await discharge.getClearanceReview(f.ctx(), f.admissionId, "BILLING");
    await discharge.issueClearance(f.ctx(), {
      admissionId: f.admissionId, gate: "BILLING", expectedReviewHash: final.reviewHash, expectedBillVersion: final.billVersion
    });
    const exit = f.ctx(), input = {
      admissionId: f.admissionId, departedAt: new Date().toISOString(), expectedBillVersion: final.billVersion, requestId: exit.requestId
    };
    expect(await discharge.recordDeparture(exit, input)).toMatchObject({ status: "DISCHARGED" });
    expect(await discharge.recordDeparture(exit, input)).toMatchObject({ status: "DISCHARGED" });
    expect((await runtime.query("select * from hims.bed_turnovers where admission_id=$1", [f.admissionId])).rows).toEqual([originalTurnover]);
    expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1", [f.admissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.room_returns where admission_id=$1", [f.admissionId])).rows[0].n).toBe(0);
  }));
  it("returns real cancelled never-occupied deposits without seals, fabricated fees or duplicate refunds", async () => withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture(), { admissionId } = await f.episode();
    const c = f.deskCtx(), receipt = await billing.recordReceipt(c, {
      admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "5000", mode: "CASH", channel: "Actual cancelled receipt book", sourceReference: "CANCEL-1", reference: "Actual received deposit", requestId: c.requestId
    });
    await cancelAdmission(f.deskCtx(), { admissionId, reason: "Patient cancelled before occupancy" });
    const authority = await exceptions.authorizeException(staffContext(f.admin, "synthetic-exception"), {
      admissionId, type: "CANCELLED_DEPOSIT", disposition: "RETURN_DEPOSIT", sourceId: receipt.id, authority: "Administrator cancelled deposit review", reason: "Return actual held cash after reservation cancellation", evidenceIds: [], evidence: "Original cashier receipt and actual cancellation", followUpOwnerId: f.cashier.id
    });
    const refund = f.ctx(), v = {
      admissionId, exceptionId: authority.id, receiptId: receipt.id, amountPaise: "5000", reason: "Actual full deposit return", mode: "CASH", channel: "Actual cancellation returns", sourceReference: "REFUND-CANCEL-1", evidence: "Signed manual return receipt", refundedAt: new Date().toISOString(), expectedBillVersion: 2, requestId: refund.requestId
    };
    const result = await exceptions.returnCancelledDeposit(refund, v);
    expect(await exceptions.returnCancelledDeposit(refund, v)).toEqual(result);
    expect((await billing.getBill(f.ctx(), admissionId)).retainedPaise).toBe(0n);
    expect((await runtime.query("select (select count(*) from hims.clearance_seals)::int seals,(select count(*) from hims.room_stays)::int stays,(select count(*) from hims.charges)::int charges")).rows[0]).toEqual({
      seals: 0, stays: 0, charges: 0
    });
  }));
  it.each(["AGAINST_ADVICE", "EXTERNAL_TRANSFER", "DEATH"] as const)("requires actual Doctor evidence for %s and still retains real money", async (type) => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture(), v = {
      admissionId: f.admissionId, type, disposition: "EXCEPTIONAL_EXIT", authority: "Administrator case routing", reason: "Retain actual professional disposition", evidenceIds: [] as string[], evidence: "Clinical record required", followUpOwnerId: f.doctor.id
    };
    await expect(exceptions.authorizeException(f.adminCtx(), v)).rejects.toMatchObject({ code: "PRECONDITION" });
    await expect(exceptions.recordExceptionEvidence(f.adminCtx(), {
      admissionId: f.admissionId, kind: type, actualAt: new Date().toISOString(), notes: "Administrator cannot sign clinical disposition"
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const doctor = await exceptions.recordExceptionEvidence(f.doctorCtx(), {
      admissionId: f.admissionId, kind: type, actualAt: new Date().toISOString(), notes: "Actual responsible Doctor signed disposition and clinical details"
    });
    const T = new Date().toISOString(), nurse = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Nurse actual physical departure handover"
    });
    const authority = await exceptions.authorizeException(f.adminCtx(), { ...v, evidenceIds: [doctor.id, nurse.id] });
    await exceptions.recordExceptionalDeparture(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: authority.id, physicalEvidenceId: nurse.id
    });
    expect((await billing.getBill(f.ctx(), f.admissionId)).outstandingPaise).toBeGreaterThan(0n);
    expect((await runtime.query("select count(*)::int n from hims.clearance_seals")).rows[0].n).toBe(0);
  }));
  it("closes an unavailable Nurse's actual attendance as an Admin fact without manufacturing a handover signature", async () => withTestDatabase(async ({ runtime, owner }) => {
    const f = await activeFixture(), T = new Date().toISOString();
    const authority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "UNAVAILABLE_APPROVER", disposition: "CLOSE_ATTENDANCE", sourceId: f.shift.id, authority: "Administrator staffing incident review", reason: "Original Nurse unavailable after witnessed shift end", evidenceIds: [], evidence: "Attendance book and ward coordinator witness", followUpOwnerId: f.admin.id
    });
    const future = new Date(Date.now() + 3600000).toISOString();
    await expect(nursing.recordConsumable(f.nurseCtx(), {admissionId:f.admissionId,shiftId:f.shift.id,usedAt:future,itemId:"FUTURE_USE",quantity:"1",unit:"piece",reason:"Future ordinary factual use must fail"})).rejects.toMatchObject({code:"VALIDATION"});
    await expect(owner.query("insert into hims.administrative_shift_ends(admission_id,shift_id,exception_id,ended_at,evidence,signed_by,signed_at) values($1,$2,$3,$4,'Future operational fact rejected',$5,clock_timestamp())",[f.admissionId,f.shift.id,authority.id,future,f.admin.id])).rejects.toMatchObject({code:"23514"});
    await expect(owner.query("insert into hims.exception_evidence(admission_id,kind,role,shift_id,actual_at,vacated_at,notes,signed_by,signed_at) values($1,'PHYSICAL_EXIT','NURSE',$2,$3,$3,'Future physical witness rejected',$4,$3)",[f.admissionId,f.shift.id,future,f.nurse.id])).rejects.toMatchObject({code:"23514"});
    await exceptions.closeUnavailableAttendance(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: authority.id, shiftId: f.shift.id, endedAt: T, evidence: "Actual attendance confirmed from ward roster and witness"
    });
    expect((await runtime.query("select count(*)::int n from hims.nursing_shift_ends where shift_id=$1", [f.shift.id])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.administrative_shift_ends where shift_id=$1", [f.shift.id])).rows[0].n).toBe(1);
  }));
  it("keeps urgent unknown identity truthful and later identification attributable without rewriting original evidence", async () => withTestDatabase(async ({ runtime }) => {
    process.env.DATABASE_URL = testUrl;
    const f = await billingFixture();
    await f.setting({
      type: "deposit", category: "GENERAL", route: "self-pay", requirement: "required", amount: "500"
    });
    const bed = await createBed(staffContext(f.admin, "synthetic"), {
      label: "Unknown urgent", category: "GENERAL", reason: "Urgent intake bed"
    }), c = f.deskCtx();
    const created = await createAdmission(c, {
      patientDetails: {
        identityStatus: "TEMPORARY", identityProvenance: "Brought by ambulance; identity and age unknown", sex: "UNKNOWN"
      }, admittingDoctorId: f.doctor.id, clinicianAssessment: {
        clinicianId: f.doctor.id, assessedAt: new Date().toISOString(), chiefComplaint: "Recorded clinician complaint", vitals: "Recorded actual vitals", triage: "Urgent clinical routing", destinationCategory: "GENERAL"
      }, bedId: bed.id, paymentRoute: "SELF_PAY", expectedStayDays: 1, requestId: c.requestId
    });
    const raw = (await runtime.query("select * from hims.patients where id=$1", [created.patientId])).rows[0];
    expect(raw.name).toMatch(/^Unidentified /);
    expect(raw.date_of_birth).toBeNull();
    expect(raw.age_years_at_registration).toBeNull();
    const authority = await exceptions.authorizeException(staffContext(f.admin, "synthetic"), {
      admissionId: created.admissionId, type: "URGENT_ADMISSION", disposition: "ACTIVATE", authority: "On-call administrator", reason: "Urgent assessed unknown identity", evidenceIds: [], evidence: "Original ambulance provenance retained", followUpOwnerId: f.desk.id
    });
    const ac = f.deskCtx();
    await activateAdmission(ac, {
      admissionId: created.admissionId, exceptionId: authority.id, arrivedAt: new Date().toISOString(), expectedVersion: 1, requestId: ac.requestId
    });
    const identificationClient = new Client({ connectionString: testUrl }); await identificationClient.connect();
    try {
      const pid = (await identificationClient.query("select pg_backend_pid() pid")).rows[0].pid;
      const race = await observedReaderRace(runtime, drizzle(identificationClient, { schema }), pid, tx => tx.execute(sql`insert into hims.patient_identifications(patient_id,admission_id,exception_id,version,name,date_of_birth,sex,evidence,reason,signed_by) values(${created.patientId}::uuid,${created.admissionId}::uuid,${authority.id}::uuid,1,'Verified interim synthetic identity','1980-01-01','FEMALE','Actual family identification evidence','Current factual identification',${f.desk.id})`), () => exceptionWorkspace(f.deskCtx(), created.admissionId));
      expect(race.result).toMatchObject({ selected: { episode: { name: "Verified interim synthetic identity", identityStatus: "KNOWN", identityProvenance: "Actual family identification evidence" } } });
    } finally { await identificationClient.end(); }
    await exceptions.identifyTemporaryPatient(f.deskCtx(), {
      admissionId: created.admissionId, exceptionId: authority.id, expectedVersion: 1, name: "Verified synthetic identity", dateOfBirth: "1980-01-01", sex: "FEMALE", evidence: "Family and original identity document inspected", reason: "Actual later identification"
    });
    expect((await getAdmission(f.deskCtx(), created.admissionId)).name).toBe("Verified synthetic identity");
    expect((await runtime.query("select * from hims.patients where id=$1", [created.patientId])).rows[0]).toEqual(raw);
  }));
  it("amends closed professional records with proper current roles and reports only already-processed diagnostic work at its original price", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture(), lab = await import("../../src/server/lab/commands");
    await f.setting({
      type: "billable-item", code: "LAB_LATE", name: "Actual diagnostic work", category: "lab", department: "LAB", unit: "test", quantityScale: 0, active: true, amount: "125"
    });
    const dc = f.doctorCtx(), round = await clinical.recordRound(dc, {
      admissionId: f.admissionId, notes: "Actual original clinical note", orders: [{
          kind: "LAB", requestedItem: "Actual late report test", itemId: "LAB_LATE", quantity: "1", unit: "test"
        }], requestId: dc.requestId
    });
    const chart = await clinical.getCare(f.doctorCtx(), f.admissionId), order = chart.orders[0], lc = () => staffContext(f.lab, "synthetic-exception");
    const sc = lc(), sample = await lab.collectSample(sc, { orderId: order.id, requestId: sc.requestId }), pc = lc();
    await lab.startLabProcessing(pc, {
      orderId: order.id, barcode: sample.barcode, requestId: pc.requestId
    });
    const T = new Date().toISOString(), w = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Actual early exit before diagnostic report"
    });
    const exitAuth = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator early departure review", reason: "Actual physical exit with unfinished reporting", evidenceIds: [w.id], evidence: "Ward witnessed actual departure", followUpOwnerId: f.doctor.id
    });
    await exceptions.recordExceptionalDeparture(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: exitAuth.id, physicalEvidenceId: w.id
    });
    async function amendment(kind: string, sourceId: string, ctx: ReturnType<typeof f.doctorCtx>, data: Record<string, unknown>) {
      const a = await exceptions.authorizeException(f.adminCtx(), {
        admissionId: f.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correctionKind: kind, sourceId, authority: "Administrator attributable amendment review", reason: "Correct retained source after actual exit", evidenceIds: [], evidence: "Original professional source retained", followUpOwnerId: f.doctor.id
      });
      return exceptions.applyPostDischargeCorrection(ctx, {
        admissionId: f.admissionId, exceptionId: a.id, kind, sourceId, data
      });
    }
    await amendment("CLINICAL_ADDENDUM", round.id, f.doctorCtx(), { text: "Actual Doctor correction", reason: "Clarify original clinical note" });
    await amendment("NURSING_ADDENDUM", f.shift.id, f.nurseCtx(), {
      recordType: "SHIFT", text: "Actual Nurse factual addition", reason: "Clarify original handover"
    });
    await f.setting({
      type: "billable-item", code: "LAB_LATE", name: "Actual diagnostic work", category: "lab", department: "LAB", unit: "test", quantityScale: 0, active: true, amount: "999"
    });
    const rc = lc();
    await amendment("LAB_REPORT", order.id, rc, {
      orderId: order.id, barcode: sample.barcode, result: "Human signed result for work performed before departure", requestId: rc.requestId
    });
    const reported = await lab.getLabOrder(lc(), order.id);
    expect(reported.billingState).toBe("FINAL");
    await amendment("LAB_ADDENDUM", reported.report!.id, lc(), { text: "Actual Lab correction", reason: "Clarify original units" });
    expect((await runtime.query("select amount_paise from hims.charges where category='lab'")).rows).toEqual([{ amount_paise: "12500" }]);
    expect((await runtime.query("select count(*)::int n from hims.post_discharge_amendments")).rows[0].n).toBe(4);
    expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1", [f.admissionId])).rows[0].n).toBe(0);
  }));
  it("keeps closed cash allocation, cancellation and real excess refund linked to original receipts", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture(), c = f.ctx();
    const receipt = await billing.recordReceipt(c, {
      admissionId: f.admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "100000", mode: "CASH", channel: "Actual hospital cashier", sourceReference: "CLOSED-DEPOSIT", reference: "Actual pre-exit cash", requestId: c.requestId
    });
    const T = new Date().toISOString(), w = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Actual witnessed early exit"
    });
    const a = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator review", reason: "Actual departure before settlement", evidenceIds: [w.id], evidence: "Nurse departure evidence", followUpOwnerId: f.cashier.id
    });
    await exceptions.recordExceptionalDeparture(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: a.id, physicalEvidenceId: w.id
    });
    async function amend(kind: string, sourceId: string, data: Record<string, unknown>) {
      const authority = await exceptions.authorizeException(f.adminCtx(), {
        admissionId: f.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correctionKind: kind, sourceId, authority: "Administrator actual cash correction", reason: "Retain original cash and linked settlement history", evidenceIds: [], evidence: "Original receipt reviewed", followUpOwnerId: f.cashier.id
      });
      return exceptions.applyPostDischargeCorrection(f.ctx(), {
        admissionId: f.admissionId, exceptionId: authority.id, kind, sourceId, data
      });
    }
    let b = await billing.getBill(f.ctx(), f.admissionId);
    await amend("ALLOCATE", receipt.id, { amountPaise: b.netPaise.toString(), reason: "Apply held original deposit" });
    const allocation = (await runtime.query("select id from hims.receipt_allocations where receipt_id=$1", [receipt.id])).rows[0];
    b = await billing.getBill(f.ctx(), f.admissionId);
    await amend("CANCEL_ALLOCATION", allocation.id, { reason: "Correct mistaken allocation record", expectedBillVersion: b.revision });
    await amend("ALLOCATE", receipt.id, { amountPaise: b.netPaise.toString(), reason: "Correctly apply original deposit" });
    b = await billing.getBill(f.ctx(), f.admissionId);
    await amend("REFUND", receipt.id, {
      amountPaise: (100000n - b.netPaise).toString(), reason: "Actual excess returned", expectedBillVersion: b.revision, mode: "CASH", channel: "Actual hospital return book", sourceReference: "CLOSED-REFUND", evidence: "Signed actual cash return", refundedAt: new Date().toISOString()
    });
    b = await billing.getBill(f.ctx(), f.admissionId);
    expect(b.retainedPaise).toBe(b.netPaise);
    expect(b.outstandingPaise).toBe(0n);
    expect(b.refunds).toHaveLength(1);
    expect(b.cancellations).toHaveLength(1);
  }));
  it("corrects a closed final room cutoff through retained Nurse evidence, derives linked original-rate money and never restores occupancy", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture();
    await new Promise(r => setTimeout(r, 70));
    const corrected = new Date().toISOString();
    await new Promise(r => setTimeout(r, 70));
    const T = new Date().toISOString(), w = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Actual hospital exit with originally entered vacancy"
    });
    const a = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator actual exit", reason: "Actual early hospital departure", evidenceIds: [w.id], evidence: "Original handover recorded", followUpOwnerId: f.admin.id
    });
    await exceptions.recordExceptionalDeparture(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: a.id, physicalEvidenceId: w.id
    });
    const old = (await runtime.query("select * from hims.room_stays where admission_id=$1", [f.admissionId])).rows[0], bill = await billing.getBill(f.ctx(), f.admissionId);
    const authority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "ROOM_CUTOFF_CORRECTION", disposition: "AMEND", sourceId: old.id, authority: "Administrator correction review", reason: "Original room vacancy time was recorded as hospital exit", evidenceIds: [], evidence: "Nurse retained actual ward vacancy evidence", followUpOwnerId: f.cashier.id
    });
    const evidence = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, exceptionId: authority.id, kind: "ROOM_CUTOFF", sourceId: old.id, shiftId: f.shift.id, actualAt: corrected, notes: "Actual original ward vacancy before hospital exit"
    });
    await exceptions.correctRoomCutoff(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: authority.id, evidenceId: evidence.id
    });
    expect((await runtime.query("select * from hims.room_stays where id=$1", [old.id])).rows[0]).toEqual(old);
    const b = await billing.getBill(f.ctx(), f.admissionId);
    expect(b.netPaise).toBeLessThan(bill.netPaise);
    expect(b.reversals.length).toBeGreaterThan(0);
    expect(b.unpostedRoomPaise).toBe(0n);
    expect((await runtime.query("select vacated_at from hims.effective_bed_turnovers where stay_id=$1", [old.id])).rows[0].vacated_at.toISOString()).toBe(corrected);
    expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1", [f.admissionId])).rows[0].n).toBe(0);
  }));
  it.each(["CREDIT", "INSURANCE_DELAY", "INSURANCE_DENIAL"] as const)("routes %s against its proper original sources and keeps real obligations after actual exit", async (type) => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture(type === "CREDIT" ? "SELF_PAY" : "INSURED"), insurance = await import("../../src/server/insurance/commands");
    let sourceId: string | undefined;
    if (type !== "CREDIT") {
      const c = f.adminCtx(), created = await insurance.createInsuranceCase(c, {
        admissionId: f.admissionId, assignedStaffId: null, reason: "Actual external case follow-up", requestId: c.requestId
      });
      sourceId = created.id;
      const pc = f.adminCtx();
      await insurance.recordPolicyVerification(pc, {
        caseId: created.id, expectedCaseVersion: 1, requestId: pc.requestId, insurer: "Synthetic external insurer", tpa: "", policyNumber: "SYN-P", memberNumber: "SYN-M", validFrom: "2026-01-01", validTo: "2026-12-31", verifiedBy: "Actual external desk", verifiedAt: new Date().toISOString(), reference: "POL-1", documentIds: []
      });
      if (type === "INSURANCE_DENIAL") {
        const b = await billing.getBill(f.ctx(), f.admissionId), dc = f.adminCtx();
        await insurance.recordPayerDecision(dc, {
          caseId: created.id, expectedCaseVersion: 2, requestId: dc.requestId, status: "REJECTED", kind: "PREAUTH", reason: "Actual external denial pending liability review", approvedPaise: "0", coPayBps: 0, verifiedBy: "Actual external desk", verifiedAt: new Date().toISOString(), reference: "DENIED-1", allocation: {
            billRevision: b.revision, netBillPaise: b.netPaise.toString(), eligibleBillPaise: b.netPaise.toString(), nonPayablePaise: "0", sourceReference: "Original posted bill"
          }, documentIds: []
        });
      }
    }
    const v = {
      admissionId: f.admissionId, type, disposition: "EXCEPTIONAL_EXIT", sourceId, authority: "Administrator accountable settlement exception", reason: "Actual planned exit with money follow-up retained", evidenceIds: [] as string[], evidence: "Actual professional and financial sources required", followUpOwnerId: f.cashier.id
    };
    await expect(exceptions.authorizeException(f.adminCtx(), v)).rejects.toMatchObject({ code: "PRECONDITION" });
    const d = await exceptions.recordExceptionEvidence(f.doctorCtx(), {
      admissionId: f.admissionId, kind: "PLANNED_EXIT", actualAt: new Date().toISOString(), notes: "Responsible Doctor's actual planned discharge disposition"
    });
    const T = new Date().toISOString(), w = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Actual Nurse-witnessed planned departure"
    });
    const a = await exceptions.authorizeException(f.adminCtx(), { ...v, evidenceIds: [d.id, w.id] }), exit = await exceptions.recordExceptionalDeparture(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: a.id, physicalEvidenceId: w.id
    });
    const b = await billing.getBill(f.ctx(), f.admissionId);
    expect(b.netPaise).toBeGreaterThan(0n);
    expect(b.retainedPaise).toBe(0n);
    if (type !== "CREDIT") {
      expect((await exceptions.getExceptionReview(f.adminCtx(), f.admissionId)).obligations.insurerOutstandingPaise).toBeNull();
      const authority = await exceptions.authorizeException(f.adminCtx(), {
        admissionId: f.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correctionKind: "INSURANCE_DECISION", sourceId, authority: "Administrator later external decision routing", reason: "Actual later payer evidence and current allocation", evidenceIds: [], evidence: "Later external final approval received", followUpOwnerId: f.cashier.id
      });
      const workspace = await exceptionWorkspace(f.adminCtx(), f.admissionId, authority.id);
      expect(workspace.selected!.payer!.money.netPaise.toString()).toBe(workspace.selected!.obligations!.netPaise);
      expect(workspace.selected!.payer!.money.revision).toBe(workspace.selected!.obligations!.billVersion);
      const review = workspace.selected!.payer!, ctx = f.adminCtx();
      await exceptions.applyPostDischargeCorrection(ctx, {
        admissionId: f.admissionId, exceptionId: authority.id, kind: "INSURANCE_DECISION", sourceId, data: {
          caseId: sourceId, expectedCaseVersion: review.case.version, requestId: ctx.requestId, status: "APPROVED", kind: "APPEAL", reason: "Actual final external review", approvedPaise: b.netPaise.toString(), coPayBps: 0, verifiedBy: "Actual external desk", verifiedAt: new Date().toISOString(), reference: "LATE-APPROVED", allocation: {
            billRevision: b.revision, netBillPaise: b.netPaise.toString(), eligibleBillPaise: b.netPaise.toString(), nonPayablePaise: "0", sourceReference: "Current actual final bill"
          }, documentIds: []
        }
      });
      expect((await exceptions.getExceptionReview(f.adminCtx(), f.admissionId)).obligations.insurerOutstandingPaise).toBe(b.netPaise.toString());
    }
    expect(exit.status).toBe("DISCHARGED");
    expect((await runtime.query("select count(*)::int n from hims.clearance_seals")).rows[0].n).toBe(0);
  }));
  it("serializes authority retries, actual exit and later cash on observed distinct PostgreSQL backends", async () => withTestDatabase(async ({ runtime, owner }) => {
    const f = await activeFixture(), T = new Date().toISOString();
    const witness = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Actual departure before concurrent routing"
    });
    const input = {
      admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator concurrent routing", reason: "Actual witnessed exit retains missing advice", evidenceIds: [witness.id], evidence: "Assigned Nurse witnessed physical exit", followUpOwnerId: f.doctor.id
    };
    const one = new Client({ connectionString: testUrl }), two = new Client({ connectionString: testUrl });
    await Promise.all([one.connect(), two.connect()]);
    const pid1 = (await one.query("select pg_backend_pid() pid")).rows[0].pid, pid2 = (await two.query("select pg_backend_pid() pid")).rows[0].pid;
    expect(pid1).not.toBe(pid2);
    const db1 = drizzle(one, { schema }), db2 = drizzle(two, { schema });
    async function contest<A, B>(firstWork: Parameters<typeof db1.transaction<A>>[0], secondWork: Parameters<typeof db2.transaction<B>>[0]) {
      let release = () => {
      }, ready = () => {
      };
      const hold = new Promise<void>(r => release = r), locked = new Promise<void>(r => ready = r);
      let first: Promise<A> | undefined, second: Promise<B | unknown> | undefined;
      try {
        first = db1.transaction(async (tx) => {
          const result = await firstWork(tx);
          ready();
          await hold;
          return result;
        });
        await Promise.race([locked, first.then(() => {
          })]);
        second = db2.transaction(secondWork).catch(e => e);
        let blocked = false;
        for (let i = 0; i < 100; i++) {
          if ((await runtime.query("select $1::int=any(pg_blocking_pids($2)) blocked", [pid1, pid2])).rows[0].blocked) {
            blocked = true;
            break;
          }
          await new Promise(r => setTimeout(r, 10));
        }
        expect(blocked).toBe(true);
        release();
        return [await first, await second] as const;
      }
      finally {
        release();
        await Promise.allSettled([first, second]);
      }
    }
    try {
      const ctx = f.adminCtx();
      const [authority, retry] = await contest(tx => exceptions.authorizeExceptionInTransaction(tx, ctx, input), tx => exceptions.authorizeExceptionInTransaction(tx, ctx, input));
      expect(retry).toEqual(authority);
      const exitInput = {
        admissionId: f.admissionId, exceptionId: authority.id, physicalEvidenceId: witness.id
      }, pay = f.ctx();
      const [exit, denied] = await contest(tx => exceptions.recordExceptionalDepartureInTransaction(tx, f.adminCtx(), exitInput), tx => billing.recordReceiptInTransaction(tx, pay, {
        admissionId: f.admissionId, party: "PATIENT", kind: "PAYMENT", amountPaise: "1", mode: "CASH", channel: "Synthetic actual cashbook", sourceReference: "RACE-CASH", reference: "Ordinary cash cannot follow closed exit", requestId: pay.requestId
      }));
      expect(denied).toMatchObject({ code: "PRECONDITION" });
      expect(exit.status).toBe("DISCHARGED");
      const authorityCash = await exceptions.authorizeException(f.adminCtx(), {
        admissionId: f.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correctionKind: "RECEIPT", sourceId: exit.id, authority: "Actual later collection authority", reason: "Record actual cash after exit", evidenceIds: [], evidence: "Retained cash book source", followUpOwnerId: f.cashier.id
      });
      const bill = await billing.getBill(f.ctx(), f.admissionId), cash = f.ctx();
      const correction = {
        admissionId: f.admissionId, exceptionId: authorityCash.id, kind: "RECEIPT", sourceId: exit.id, data: {
          admissionId: f.admissionId, party: "PATIENT", kind: "PAYMENT", amountPaise: bill.netPaise.toString(), mode: "CASH", channel: "Synthetic actual cashbook", sourceReference: "RACE-CASH", reference: "Actual later cash", requestId: cash.requestId
        }
      };
      const [paid, replayed] = await contest(tx => exceptions.applyPostDischargeCorrectionInTransaction(tx, cash, correction), tx => exceptions.applyPostDischargeCorrectionInTransaction(tx, cash, correction));
      expect(replayed).toEqual(paid);
      expect((await runtime.query("select count(*)::int n from hims.receipts where admission_id=$1", [f.admissionId])).rows[0].n).toBe(1);
      expect((await runtime.query("select count(*)::int n from hims.post_discharge_amendments where admission_id=$1", [f.admissionId])).rows[0].n).toBe(1);
      await expect(owner.query("insert into hims.post_discharge_amendments (admission_id,exception_id,kind,source_id,result_id,before_snapshot,after_snapshot,signed_by,signed_at) values ($1,$2,'RECEIPT',$3,$4,'{}','{}',$5,clock_timestamp())", [f.admissionId, authorityCash.id, exit.id, witness.id, f.admin.id])).rejects.toMatchObject({ code: "23514" });
      await runtime.query("update hims.staff_user set banned=true where id=$1", [f.cashier.id]);
      await expect(exceptions.applyPostDischargeCorrection(cash, correction)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.query("update hims.admin_exceptions set reason='Forged replacement' where id=$1", [authority.id])).rejects.toMatchObject({ code: "P0001" });
      await expect(owner.query("delete from hims.exceptional_departures where id=$1", [exit.id])).rejects.toMatchObject({ code: "P0001" });
    }
    finally {
      await Promise.all([one.end(), two.end()]);
    }
  }));
  it("denies a delayed transfer into a bed occupied at T even when now free and cleaned, preserving original history and cash", async () => withTestDatabase(async ({ runtime, owner }) => {
    const f = await activeFixture();
    const other = await f.episode(), arrival = f.deskCtx();
    await activateAdmission(arrival, {
      admissionId: other.admissionId, expectedVersion: 1, arrivedAt: new Date().toISOString(), requestId: arrival.requestId
    });
    const target = (await runtime.query("select bed_id from hims.admissions where id=$1", [other.admissionId])).rows[0].bed_id;
    const dc = f.doctorCtx(), order = await clinical.orderTransfer(dc, {
      admissionId: f.admissionId, destinationCategory: "GENERAL", reason: "Doctor requested another General bed", requestId: dc.requestId
    });
    const T = new Date().toISOString();
    const handover = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "TRANSFER_HANDOVER", sourceId: order.id, shiftId: f.shift.id, actualAt: T, notes: "Proposed retrospective physical handover conflicts with retained target history"
    });
    await nursing.assignNurse(f.adminCtx(), {
      admissionId: other.admissionId, nurseId: f.nurse.id, authority: "Synthetic roster", reason: "Other episode actual Nurse attendance"
    });
    const sc = f.nurseCtx(), shift = await nursing.recordShift(sc, {
      admissionId: other.admissionId, startedAt: new Date().toISOString(), handover: "Other bed attendance", requestId: sc.requestId
    });
    const departedAt = new Date().toISOString(), witness = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: other.admissionId, kind: "PHYSICAL_EXIT", shiftId: shift.id, actualAt: departedAt, vacatedAt: departedAt, notes: "Other occupant actually leaves after proposed earlier transfer"
    });
    const exitAuthority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: other.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator actual exit routing", reason: "Other occupant physically departed", evidenceIds: [witness.id], evidence: "Actual other occupant Nurse witness", followUpOwnerId: f.doctor.id
    });
    await exceptions.recordExceptionalDeparture(f.adminCtx(), {
      admissionId: other.admissionId, exceptionId: exitAuthority.id, physicalEvidenceId: witness.id
    });
    const turnover = (await runtime.query("select id from hims.bed_turnovers where admission_id=$1", [other.admissionId])).rows[0], clean = f.adminCtx();
    await discharge.completeBedTurnover(clean, {
      turnoverId: turnover.id, completedAt: new Date().toISOString(), evidence: "Actual later cleaning completed", requestId: clean.requestId
    });
    const authority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "DELAYED_TRANSFER", disposition: "TRANSFER", authority: "Administrator retrospective review", reason: "Verify target at true physical handover time", evidenceIds: [handover.id], evidence: "Retained actual Doctor and Nurse source", followUpOwnerId: f.admin.id
    });
    const before = (await runtime.query("select * from hims.room_stays order by id")).rows, bill = await billing.getBill(f.ctx(), f.admissionId);
    await expect(exceptions.applyDelayedTransfer(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: authority.id, evidenceId: handover.id, targetBedId: target
    })).rejects.toMatchObject({ code: "CONFLICT", message: "Target was occupied or not cleaned at the actual physical time" });
    expect((await runtime.query("select * from hims.room_stays order by id")).rows).toEqual(before);
    expect((await runtime.query("select count(*)::int n from hims.stay_boundary_amendments")).rows[0].n).toBe(0);
    const after = await billing.getBill(f.ctx(), f.admissionId);
    expect(after.charges).toEqual(bill.charges);
    expect(after.reversals).toEqual(bill.reversals);
    expect(after.receipts).toEqual(bill.receipts);
    const original = before.find(s => s.admission_id === f.admissionId)!;
    await expect(owner.query("insert into hims.room_stays (admission_id,bed_id,tariff_version_id,started_at,last_reconciled_at) values ($1,$2,$3,clock_timestamp(),clock_timestamp())", [f.admissionId, original.bed_id, original.tariff_version_id])).rejects.toMatchObject({ code: "23P01" });
  }));
  it("resolves an originally missing diagnostic price after exit through its performed source and current Lab authority", async () => withTestDatabase(async ({ runtime }) => {
    const f = await activeFixture(), lab = await import("../../src/server/lab/commands"), lc = () => staffContext(f.lab, "synthetic-exception");
    const dc = f.doctorCtx();
    await clinical.recordRound(dc, {
      admissionId: f.admissionId, notes: "Original unpriced diagnostic request", orders: [{
          kind: "RADIOLOGY", requestedItem: "Actual imaging work", itemId: "MISSING_PRICE", quantity: "1", unit: "test"
        }], requestId: dc.requestId
    });
    const order = (await clinical.getCare(f.doctorCtx(), f.admissionId)).orders[0], pc = lc();
    await lab.startLabProcessing(pc, { orderId: order.id, requestId: pc.requestId });
    const T = new Date().toISOString(), w = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Actual exit after diagnostic processing"
    });
    const a = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator actual exit", reason: "Actual witnessed early departure", evidenceIds: [w.id], evidence: "Original Nursing evidence", followUpOwnerId: f.doctor.id
    });
    await exceptions.recordExceptionalDeparture(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: a.id, physicalEvidenceId: w.id
    });
    async function authority(kind: string) {
      return exceptions.authorizeException(f.adminCtx(), {
        admissionId: f.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correctionKind: kind, sourceId: order.id, authority: "Administrator actual performed-source review", reason: "Resolve retained diagnostic work after actual exit", evidenceIds: [], evidence: "Original processed diagnostic source", followUpOwnerId: f.lab.id
      });
    }
    const reportAuthority = await authority("LAB_REPORT"), reportCtx = lc();
    await exceptions.applyPostDischargeCorrection(reportCtx, {
      admissionId: f.admissionId, exceptionId: reportAuthority.id, kind: "LAB_REPORT", sourceId: order.id, data: {
        orderId: order.id, result: "Human imaging report for already performed work", requestId: reportCtx.requestId
      }
    });
    await f.setting({
      type: "billable-item", code: "MISSING_PRICE", name: "Actual imaging fee", category: "radiology", department: "LAB", unit: "test", quantityScale: 0, amount: "80", active: true
    });
    const ordinary = lc();
    await expect(lab.resolveLabBilling(ordinary, {
      orderId: order.id, reason: "Requires closed source authority", requestId: ordinary.requestId
    })).rejects.toMatchObject({ code: "PRECONDITION" });
    const billingAuthority = await authority("LAB_BILLING"), ctx = lc();
    await exceptions.applyPostDischargeCorrection(ctx, {
      admissionId: f.admissionId, exceptionId: billingAuthority.id, kind: "LAB_BILLING", sourceId: order.id, data: {
        orderId: order.id, reason: "Configured the originally missing diagnostic price", requestId: ctx.requestId
      }
    });
    expect((await lab.getLabOrder(lc(), order.id)).billingState).toBe("FINAL");
    expect((await runtime.query("select amount_paise from hims.charges where category='radiology'")).rows).toEqual([{ amount_paise: "8000" }]);
  }));
  it("renews converted self-pay responsibility after the final exit bill changes without erasing prior insurer cash", async () => withTestDatabase(async () => {
    const f = await activeFixture("INSURED"), insurance = await import("../../src/server/insurance/commands");
    const c = f.adminCtx(), caseRecord = await insurance.createInsuranceCase(c, {
      admissionId: f.admissionId, assignedStaffId: null, reason: "Actual insurance case before conversion", requestId: c.requestId
    });
    const bill = await billing.getBill(f.ctx(), f.admissionId), convert = f.adminCtx();
    const conversion = await insurance.convertToSelfPay(convert, {
      caseId: caseRecord.id, expectedCaseVersion: 1, requestId: convert.requestId, reason: "Actual externally verified self-pay conversion", decisionReference: "Actual conversion reference", verifiedBy: "External human verifier", verifiedAt: new Date().toISOString(), allocation: {
        billRevision: bill.revision, netBillPaise: bill.netPaise.toString(), verifiedPatientLiabilityPaise: bill.netPaise.toString(), retainedInsurerLiabilityPaise: "0", sourceReference: "Actual reviewed bill at conversion"
      }
    });
    const T = new Date().toISOString(), w = await exceptions.recordExceptionEvidence(f.nurseCtx(), {
      admissionId: f.admissionId, kind: "PHYSICAL_EXIT", shiftId: f.shift.id, actualAt: T, vacatedAt: T, notes: "Actual departure after original self-pay conversion"
    });
    const a = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "EARLY_EXIT", disposition: "EXCEPTIONAL_EXIT", authority: "Administrator actual departure routing", reason: "Actual exit before final responsibility review", evidenceIds: [w.id], evidence: "Actual Nursing witness", followUpOwnerId: f.cashier.id
    });
    await exceptions.recordExceptionalDeparture(f.adminCtx(), {
      admissionId: f.admissionId, exceptionId: a.id, physicalEvidenceId: w.id
    });
    expect((await exceptions.getExceptionReview(f.adminCtx(), f.admissionId)).obligations.responsibilityStatus).toBe("UNKNOWN_OR_STALE");
    const authority = await exceptions.authorizeException(f.adminCtx(), {
      admissionId: f.admissionId, type: "POST_DISCHARGE_CORRECTION", disposition: "AMEND", correctionKind: "SELF_PAY_REVIEW", sourceId: conversion.id, authority: "Administrator final financial review", reason: "Renew deterministic converted self-pay responsibility", evidenceIds: [], evidence: "Original conversion and actual final bill", followUpOwnerId: f.cashier.id
    });
    const finalBill = await billing.getBill(f.ctx(), f.admissionId), ctx = f.ctx();
    await exceptions.applyPostDischargeCorrection(ctx, {
      admissionId: f.admissionId, exceptionId: authority.id, kind: "SELF_PAY_REVIEW", sourceId: conversion.id, data: {
        admissionId: f.admissionId, expectedBillVersion: finalBill.revision, reason: "Review final corrected bill against retained conversion", requestId: ctx.requestId
      }
    });
    const current = await exceptions.getExceptionReview(f.adminCtx(), f.admissionId);
    expect(current.obligations.responsibilityStatus).toBe("REVIEWED");
    expect(current.obligations.patientOutstandingPaise).toBe(finalBill.netPaise.toString());
  }));
});
