import { afterEach, describe, expect, it } from "vitest";
import { withTestDatabase } from "../../scripts/test-database";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { billingFixture } from "../support/billing-fixture";
import { staffContext } from "../../src/server/access";
import * as discharge from "../../src/server/discharge/commands";
import * as care from "../../src/server/clinical/commands";
import * as nursing from "../../src/server/nursing/commands";
import * as billing from "../../src/server/billing/commands";
import { activateAdmission } from "../../src/server/admissions/commands";
import * as insurance from "../../src/server/insurance/commands";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/server/schema";
import { sql } from "drizzle-orm";
import { reconcileRoomChargesInTransaction } from "../../src/server/billing/room-charges";

loadLocalEnvironment();
const ordinaryUrl = process.env.DATABASE_URL;
const testUrl = getTestDatabaseConfig().runtimeUrl;
afterEach(() => { process.env.DATABASE_URL = ordinaryUrl; });
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticDischargeOnlySecretAtLeast32Characters12345";

async function fixture(route: "SELF_PAY" | "INSURED" = "SELF_PAY", hourly = "0") {
  process.env.DATABASE_URL = testUrl;
  const f = await billingFixture();
  await f.setting({ type: "tariff", category: "GENERAL", amount: hourly, basis: "hour", rounding: "exact", graceMinutes: 0 });
  await f.setting({ type: "deposit", category: "GENERAL", route: route === "SELF_PAY" ? "self-pay" : "insured", requirement: "not-required", amount: "0" });
  const { admissionId } = await f.episode(route);
  const ac = f.deskCtx(), arrivedAt = new Date().toISOString();
  await activateAdmission(ac, { admissionId, arrivedAt, expectedVersion: 1, requestId: ac.requestId });
  const dc = () => staffContext(f.doctor, "synthetic-discharge");
  const nc = () => staffContext(f.nurse, "synthetic-discharge");
  const pc = () => staffContext(f.pharmacy, "synthetic-discharge");
  await nursing.assignNurse(staffContext(f.admin, "synthetic-discharge"), { admissionId, nurseId: f.nurse.id, reason: "Synthetic current ward assignment", authority: "Synthetic roster" });
  const shiftCtx = nc();
  const shift = await nursing.recordShift(shiftCtx, { admissionId, startedAt: new Date().toISOString(), handover: "Synthetic active monitoring", requestId: shiftCtx.requestId });
  await care.signClinicalSummary(dc(), { admissionId, expectedVersion: 0, diagnosis: "Synthetic diagnosis", course: "Synthetic completed care", condition: "Reviewed by Doctor", followUp: "Doctor follow-up", advice: "Human advice", prescriptionOrderIds: [] });
  return { ...f, admissionId, arrivedAt, dc, nc, pc, shift };
}

describe("human discharge gates", () => {
  it("preserves recorded vacancy attendance when its nurse closes the shift later", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture("SELF_PAY", "3600");
    for (const [gate, ctx] of [["DOCTOR", f.dc], ["PHARMACY", f.pc], ["NURSING", f.nc]] as const) {
      const review = await discharge.getClearanceReview(ctx(), f.admissionId, gate);
      await discharge.issueClearance(ctx(), { admissionId: f.admissionId, gate, expectedReviewHash: review.reviewHash });
    }
    const vacancy = f.nc(), vacatedAt = new Date();
    await discharge.recordRoomVacated(vacancy, { admissionId: f.admissionId, shiftId: f.shift.id, vacatedAt: vacatedAt.toISOString(), waitingLocation: "Actual off-bed waiting chairs", handover: "Continued care remains assigned", requestId: vacancy.requestId });
    const earlier = new Date(vacatedAt.getTime() - 1);
    expect(earlier.getTime()).toBeGreaterThan((await runtime.query("select started_at from hims.nursing_shifts where id=$1", [f.shift.id])).rows[0].started_at.getTime());
    async function effects() {
      return (await runtime.query(`select
        (select count(*) from hims.nursing_shift_ends) ends,
        (select count(*) from hims.clearance_invalidations) invalidations,
        (select count(*) from hims.clearance_seals) seals,
        (select count(*) from hims.billing_requests) requests,
        (select count(*) from hims.audit_events) audits,
        (select count(*) from hims.room_vacations) vacancies,
        (select count(*) from hims.departures) departures,
        (select count(*) from hims.bed_turnovers) turnovers,
        (select count(*) from hims.bed_holds) holds,
        (select count(*) from hims.charges) charges,
        (select count(*) from hims.receipts) receipts,
        (select row_to_json(s) from hims.room_stays s where admission_id=$1) stay,
        (select row_to_json(a) from hims.admissions a where id=$1) admission`, [f.admissionId])).rows[0];
    }
    const before = await effects();
    const billBeforeClose = await billing.getBill(f.ctx(), f.admissionId);
    await expect(nursing.endShift(f.nc(), { shiftId: f.shift.id, endedAt: earlier.toISOString(), handover: "Retrospective end before recorded vacancy" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await effects()).toEqual(before);
    // Equality is lawful attendance. A real end reopens Nursing/Billing, and renewal
    // and ordinary departure can proceed only with the original factual vacancy intact.
    await nursing.endShift(f.nc(), { shiftId: f.shift.id, endedAt: vacatedAt.toISOString(), handover: "Actual attendance ended at bed handover" });
    const nursingReview = await discharge.getClearanceReview(f.nc(), f.admissionId, "NURSING");
    expect(nursingReview.gates.map(g => g.current)).toEqual([true, true, false, false]);
    await discharge.issueClearance(f.nc(), { admissionId: f.admissionId, gate: "NURSING", expectedReviewHash: nursingReview.reviewHash });
    const bill = await billing.getBill(f.ctx(), f.admissionId), cash = f.ctx();
    expect({ revision: bill.revision, net: bill.netPaise, paid: bill.billPaidPaise, retained: bill.retainedPaise }).toEqual({ revision: billBeforeClose.revision, net: billBeforeClose.netPaise, paid: billBeforeClose.billPaidPaise, retained: billBeforeClose.retainedPaise });
    expect(bill.netPaise).toBeGreaterThan(0n);
    await billing.recordReceipt(cash, { admissionId: f.admissionId, party: "PATIENT", kind: "PAYMENT", amountPaise: bill.netPaise.toString(), mode: "CASH", channel: "Attendance regression cashier", sourceReference: "ATTENDANCE-EQUAL", reference: "Actual occupied amount", requestId: cash.requestId });
    const final = await discharge.getClearanceReview(f.ctx(), f.admissionId, "BILLING");
    await discharge.issueClearance(f.ctx(), { admissionId: f.admissionId, gate: "BILLING", expectedReviewHash: final.reviewHash, expectedBillVersion: final.billVersion });
    const exit = f.ctx();
    expect(await discharge.recordDeparture(exit, { admissionId: f.admissionId, departedAt: new Date().toISOString(), expectedBillVersion: final.billVersion, requestId: exit.requestId })).toMatchObject({ status: "DISCHARGED" });
    expect((await runtime.query("select v.vacated_at=e.ended_at equal from hims.room_vacations v join hims.nursing_shift_ends e on e.shift_id=v.shift_id where v.admission_id=$1", [f.admissionId])).rows).toEqual([{ equal: true }]);
  }));
  it("natively rejects a later shift end before an immutable bed vacancy", async () => withTestDatabase(async ({ runtime }) => {
    const f = await fixture();
    for (const [gate, ctx] of [["DOCTOR", f.dc], ["PHARMACY", f.pc], ["NURSING", f.nc]] as const) {
      const review = await discharge.getClearanceReview(ctx(), f.admissionId, gate);
      await discharge.issueClearance(ctx(), { admissionId: f.admissionId, gate, expectedReviewHash: review.reviewHash });
    }
    const ctx = f.nc(), vacatedAt = new Date();
    await discharge.recordRoomVacated(ctx, { admissionId: f.admissionId, shiftId: f.shift.id, vacatedAt: vacatedAt.toISOString(), waitingLocation: "Actual waiting chairs", handover: "Native attendance evidence", requestId: ctx.requestId });
    const before = (await runtime.query("select bill_revision,version,(select count(*) from hims.clearance_invalidations) invalidations,(select count(*) from hims.clearance_seals) seals,(select count(*) from hims.charges) charges from hims.admissions where id=$1", [f.admissionId])).rows[0];
    await expect(runtime.query("insert into hims.nursing_shift_ends(shift_id,ended_at,handover,signed_by) values($1,$2,'Native early end',$3)", [f.shift.id, new Date(vacatedAt.getTime() - 1), f.nurse.id])).rejects.toMatchObject({ code: "23514" });
    expect((await runtime.query("select bill_revision,version,(select count(*) from hims.clearance_invalidations) invalidations,(select count(*) from hims.clearance_seals) seals,(select count(*) from hims.charges) charges from hims.admissions where id=$1", [f.admissionId])).rows[0]).toEqual(before);
    expect((await runtime.query("select count(*)::int n from hims.nursing_shift_ends where shift_id=$1", [f.shift.id])).rows[0].n).toBe(0);
    await runtime.query("insert into hims.nursing_shift_ends(shift_id,ended_at,handover,signed_by) values($1,$2,'Native equal end',$3)", [f.shift.id, vacatedAt, f.nurse.id]);
  }));
  it.each([
    ["vacancy", "read committed"], ["vacancy", "repeatable read"], ["vacancy", "serializable"],
    ["shift end", "read committed"], ["shift end", "repeatable read"], ["shift end", "serializable"],
  ] as const)("serializes attendance with %s first at %s on separate PostgreSQL connections", async (first, isolation) => withTestDatabase(async ({ runtime }) => {
    const f = await fixture("SELF_PAY", "3600");
    for (const [gate, ctx] of [["DOCTOR", f.dc], ["PHARMACY", f.pc], ["NURSING", f.nc]] as const) {
      const review = await discharge.getClearanceReview(ctx(), f.admissionId, gate);
      await discharge.issueClearance(ctx(), { admissionId: f.admissionId, gate, expectedReviewHash: review.reviewHash });
    }
    const earlier = new Date();
    await new Promise(resolve => setTimeout(resolve, 20));
    const one = new Client({ connectionString: testUrl }), two = new Client({ connectionString: testUrl });
    await Promise.all([one.connect(), two.connect()]);
    let pending: Promise<unknown> | undefined;
    try {
      const pid1 = (await one.query("select pg_backend_pid() pid")).rows[0].pid, pid2 = (await two.query("select pg_backend_pid() pid")).rows[0].pid;
      expect(pid1).not.toBe(pid2);
      await two.query(`begin isolation level ${isolation}`);
      const before = (await two.query("select bill_revision,version from hims.admissions where id=$1", [f.admissionId])).rows[0];
      await one.query("begin");
      const tx = drizzle(one, { schema }) as unknown as Parameters<typeof discharge.recordRoomVacatedInTransaction>[0];
      if (first === "vacancy") {
        const ctx = f.nc();
        await discharge.recordRoomVacatedInTransaction(tx, ctx, { admissionId: f.admissionId, shiftId: f.shift.id, vacatedAt: new Date().toISOString(), waitingLocation: "Actual off-bed waiting area", handover: "Concurrent factual vacancy", requestId: ctx.requestId });
        // Raw INSERT proves the native guard independently serializes a writer that
        // does not call endShift's application validation or lock helper.
        pending = two.query("insert into hims.nursing_shift_ends(shift_id,ended_at,handover,signed_by) values($1,$2,'Concurrent native early end',$3)", [f.shift.id, earlier, f.nurse.id]).catch(error => error);
      } else {
        await nursing.endShiftInTransaction(tx, f.nc(), { shiftId: f.shift.id, endedAt: earlier.toISOString(), handover: "Actual end committed before attempted vacancy" });
        const [episode] = await tx.select().from(schema.admissions).where(sql`${schema.admissions.id}=${f.admissionId}`);
        const review = (await discharge.clearanceStateInTransaction(tx, episode)).reviews[2];
        await discharge.issueClearanceInTransaction(tx, f.nc(), { admissionId: f.admissionId, gate: "NURSING", expectedReviewHash: review.reviewHash });
        const after = (await one.query("select bill_revision,version from hims.admissions where id=$1", [f.admissionId])).rows[0];
        expect(after).toEqual(before); // Serialization does not advance logical versions or money.
        const ctx = f.nc();
        pending = discharge.recordRoomVacatedInTransaction(drizzle(two, { schema }) as unknown as typeof tx, ctx, { admissionId: f.admissionId, shiftId: f.shift.id, vacatedAt: new Date().toISOString(), waitingLocation: "Actual waiting area", handover: "Cannot attribute vacancy after attendance ended", requestId: ctx.requestId }).catch(error => error);
      }
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt++) {
        blocked = (await runtime.query("select $1::int=any(pg_blocking_pids($2)) blocked", [pid1, pid2])).rows[0].blocked;
        if (!blocked) await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await one.query("commit");
      const result = await pending;
      if (isolation === "read committed") expect(result).toMatchObject({ code: first === "vacancy" ? "23514" : "VALIDATION" });
      else {
        // Drizzle preserves the underlying PostgreSQL serialization error as cause.
        const error = result as { code?: string; cause?: { code?: string } };
        expect(error.code ?? error.cause?.code).toBe("40001");
      }
      await two.query("rollback");
      expect((await runtime.query("select count(*)::int n from hims.room_vacations v join hims.nursing_shift_ends e on e.shift_id=v.shift_id where e.ended_at<v.vacated_at")).rows[0].n).toBe(0);
      expect((await runtime.query("select count(*)::int n from hims.nursing_shift_ends where shift_id=$1", [f.shift.id])).rows[0].n).toBe(first === "vacancy" ? 0 : 1);
      expect((await runtime.query("select count(*)::int n from hims.room_vacations where admission_id=$1", [f.admissionId])).rows[0].n).toBe(first === "vacancy" ? 1 : 0);
      expect((await runtime.query("select count(*)::int n from hims.departures")).rows[0].n).toBe(0);
      expect((await runtime.query("select count(*)::int n from hims.bed_turnovers")).rows[0].n).toBe(0);
      expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1", [f.admissionId])).rows[0].n).toBe(1);
      const review = await discharge.getClearanceReview(f.ctx(), f.admissionId, "BILLING");
      expect(review.gates.slice(0, 3).every(g => g.current)).toBe(true);
      expect(review.blockers.length).toBeGreaterThan(0);
      await expect(discharge.issueClearance(f.ctx(), { admissionId: f.admissionId, gate: "BILLING", expectedReviewHash: review.reviewHash, expectedBillVersion: review.billVersion })).rejects.toMatchObject({ code: "PRECONDITION" });
    } finally {
      await one.query("rollback");
      await pending;
      await two.query("rollback");
      await Promise.all([one.end(), two.end()]);
    }
  }));
  it("rejects disconnected physical bed vacancy evidence in PostgreSQL",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture();
    const r=await discharge.getClearanceReview(f.dc(),f.admissionId,"DOCTOR"),doctor=await discharge.issueClearance(f.dc(),{admissionId:f.admissionId,gate:"DOCTOR",expectedReviewHash:r.reviewHash});
    await expect(runtime.query("insert into hims.room_vacations(admission_id,stay_id,nursing_seal_id,shift_id,vacated_at,waiting_location,handover,signed_by) select admission_id,id,$2,$3,clock_timestamp(),'Synthetic chairs','Synthetic handover',$4 from hims.room_stays where admission_id=$1",[f.admissionId,doctor.id,crypto.randomUUID(),f.nurse.id])).rejects.toBeTruthy();
  }));
  it("serializes actual receipt changes and room worker cutoff against departure on separate connections",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture("SELF_PAY","3600");
    for(const [gate,c] of [["DOCTOR",f.dc],["PHARMACY",f.pc],["NURSING",f.nc]] as const){const r=await discharge.getClearanceReview(c(),f.admissionId,gate);await discharge.issueClearance(c(),{admissionId:f.admissionId,gate,expectedReviewHash:r.reviewHash});}
    const v=f.nc(),vacatedAt=new Date();await discharge.recordRoomVacated(v,{admissionId:f.admissionId,shiftId:f.shift.id,vacatedAt:vacatedAt.toISOString(),waitingLocation:"Synthetic waiting chairs",handover:"Ongoing observations",requestId:v.requestId});
    const b=await billing.getBill(f.ctx(),f.admissionId),pay=f.ctx();await billing.recordReceipt(pay,{admissionId:f.admissionId,party:"PATIENT",kind:"PAYMENT",amountPaise:b.netPaise.toString(),mode:"CASH",channel:"Race cashier book",sourceReference:"RACE-PAID",reference:"Actual amount received",requestId:pay.requestId});
    let review=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");await discharge.issueClearance(f.ctx(),{admissionId:f.admissionId,gate:"BILLING",expectedReviewHash:review.reviewHash,expectedBillVersion:review.billVersion});
    const one=new Client({connectionString:testUrl}),two=new Client({connectionString:testUrl});await Promise.all([one.connect(),two.connect()]);
    const pid1=(await one.query("select pg_backend_pid() pid")).rows[0].pid,pid2=(await two.query("select pg_backend_pid() pid")).rows[0].pid;expect(pid1).not.toBe(pid2);
    async function blocked(){for(let i=0;i<100;i++){if((await runtime.query("select $1::int=any(pg_blocking_pids($2)) blocked",[pid1,pid2])).rows[0].blocked)return true;await new Promise(r=>setTimeout(r,10));}return false;}
    let pending:Promise<unknown>|undefined;
    try{
      await one.query("begin");await one.query("select pg_advisory_xact_lock_shared(729104211)");await one.query("select id from hims.admissions where id=$1 for update",[f.admissionId]);
      // The receipt source trigger must invalidate Billing even when a source writer is concurrent.
      const receipt=(await one.query("insert into hims.receipts(hospital_id,admission_id,party,kind,amount_paise,mode,channel,source_reference,reference,identity_payload,actor_type,actor_id) select hospital_id,id,'PATIENT','PAYMENT',100,'CASH','Race cashier book','RACE-EXTRA','Actual additional receipt','synthetic','staff',$2 from hims.admissions where id=$1 returning id",[f.admissionId,f.cashier.id])).rows[0];
      await one.query("update hims.admissions set bill_revision=bill_revision+1 where id=$1",[f.admissionId]);
      const exit=f.ctx();pending=drizzle(two,{schema}).transaction(tx=>discharge.recordDepartureInTransaction(tx,exit,{admissionId:f.admissionId,departedAt:new Date().toISOString(),expectedBillVersion:review.billVersion,requestId:exit.requestId}));
      expect(await blocked()).toBe(true);await one.query("commit");expect(await pending).toMatchObject({status:"REVIEW_REQUIRED"});
      review=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");expect(review.gates.map(g=>g.current)).toEqual([true,true,true,false]);
      expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1",[f.admissionId])).rows[0].n).toBe(1);
      const refund=f.ctx();await billing.refundReceipt(refund,{receiptId:receipt.id,amountPaise:"100",mode:"CASH",channel:"Race refund book",sourceReference:"RACE-RETURN",evidence:"Signed synthetic receipt",refundedAt:new Date().toISOString(),reason:"Return actual excess",expectedReviewHash:review.reviewHash,expectedBillVersion:review.billVersion,requestId:refund.requestId});
      review=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");await discharge.issueClearance(f.ctx(),{admissionId:f.admissionId,gate:"BILLING",expectedReviewHash:review.reviewHash,expectedBillVersion:review.billVersion});
      await one.query("begin");const final=f.ctx();const result=await discharge.recordDepartureInTransaction(drizzle(one,{schema}) as unknown as Parameters<typeof discharge.recordDepartureInTransaction>[0],final,{admissionId:f.admissionId,departedAt:new Date().toISOString(),expectedBillVersion:review.billVersion,requestId:final.requestId});expect(result.status).toBe("DISCHARGED");
      pending=drizzle(two,{schema}).transaction(async tx=>{await tx.execute(sql`select id from hims.admissions where id=${f.admissionId} for update`);return reconcileRoomChargesInTransaction(tx,{admissionId:f.admissionId,cutoff:new Date(),actorContext:{actor:{type:"system",systemId:"room-charge"},source:"room-worker",requestId:crypto.randomUUID()}});});
      expect(await blocked()).toBe(true);await one.query("commit");expect(await pending).toBe(0n);
      const stay=(await runtime.query("select * from hims.room_stays where admission_id=$1",[f.admissionId])).rows[0];expect(stay.ended_at.toISOString()).toBe(vacatedAt.toISOString());expect(stay.last_reconciled_at.toISOString()).toBe(vacatedAt.toISOString());expect(BigInt(stay.posted_paise)).toBe((BigInt(vacatedAt.getTime()-Date.parse(f.arrivedAt))+5n)/10n);
      expect((await billing.getBill(f.ctx(),f.admissionId)).netPaise).toBe(b.netPaise);
      expect((await runtime.query("select count(*)::int n from hims.bed_turnovers where admission_id=$1",[f.admissionId])).rows[0].n).toBe(1);
    }finally{await one.query("rollback");await pending;await Promise.all([one.end(),two.end()]);}
  }));
  it("requires final financial disposition even for a zero-value pending source",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture();
    await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) values($1,'pending-zero','synthetic','lab','SYN-ZERO','Synthetic zero-price pending work','1','test',$2,0,0,'PENDING','staff',$3)",[f.admissionId,f.room.id,f.lab.id]);
    for(const [gate,c] of [["DOCTOR",f.dc],["PHARMACY",f.pc],["NURSING",f.nc]] as const){const r=await discharge.getClearanceReview(c(),f.admissionId,gate);await discharge.issueClearance(c(),{admissionId:f.admissionId,gate,expectedReviewHash:r.reviewHash});}
    const v=f.nc();await discharge.recordRoomVacated(v,{admissionId:f.admissionId,shiftId:f.shift.id,vacatedAt:new Date().toISOString(),waitingLocation:"Synthetic waiting chairs",handover:"Ongoing observations",requestId:v.requestId});
    const r=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");
    expect(r.blockers).toContain("Department work has unresolved or pending financial sources.");
    await expect(discharge.issueClearance(f.ctx(),{admissionId:f.admissionId,gate:"BILLING",expectedReviewHash:r.reviewHash,expectedBillVersion:r.billVersion})).rejects.toMatchObject({code:"PRECONDITION"});
    const peer=new Client({connectionString:testUrl});await peer.connect();let pending:Promise<unknown>|undefined;
    try{
      const pid1=(await runtime.query("select pg_backend_pid() pid")).rows[0].pid,pid2=(await peer.query("select pg_backend_pid() pid")).rows[0].pid;expect(pid1).not.toBe(pid2);
      await runtime.query("begin");await runtime.query("select id from hims.admissions where id=$1 for update",[f.admissionId]);
      await runtime.query("insert into hims.charge_finalizations(charge_id,actor_type,actor_id) select id,'staff',$2 from hims.charges where admission_id=$1 and source_event_id='pending-zero'",[f.admissionId,f.lab.id]);
      pending=drizzle(peer,{schema}).transaction(tx=>discharge.issueClearanceInTransaction(tx,f.ctx(),{admissionId:f.admissionId,gate:"BILLING",expectedReviewHash:r.reviewHash,expectedBillVersion:r.billVersion})).catch(e=>e);
      let blocked=false;for(let i=0;i<100;i++){if((await runtime.query("select $1::int=any(pg_blocking_pids($2)) blocked",[pid1,pid2])).rows[0].blocked){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}expect(blocked).toBe(true);
      await runtime.query("commit");expect(await pending).toMatchObject({code:"CONFLICT"});
      const refreshed=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");expect(refreshed.blockers).toEqual([]);expect(refreshed.gates.slice(0,3).every(g=>g.current)).toBe(true);
    }finally{await runtime.query("rollback");await pending;await peer.end();}
  }));
  it("rechecks actual prepared stock safety at current hospital date without changing physical clocks or repeating fulfillment",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture(),p=await import("../../src/server/pharmacy/commands");
    await f.setting({type:"hospital",name:"Synthetic date-safety hospital",address:"Synthetic address",timezone:"Etc/GMT+12"});
    await f.setting({type:"billable-item",code:"DIS_HOME",name:"Synthetic home medicine",category:"medicine",department:"PHARMACY",unit:"tablet",quantityScale:0,amount:"5",active:true});
    const dc=f.dc();await care.recordRound(dc,{admissionId:f.admissionId,notes:"Human take-home instruction",orders:[{kind:"MEDICINE",requestedItem:"Synthetic home medicine",itemId:"DIS_HOME",dose:"5",doseUnit:"mg",route:"oral",frequency:"Human prescription",durationDays:1,medicationPurpose:"TAKE_HOME",dispensingQuantity:"2",dispensingUnit:"tablet"}],requestId:dc.requestId});
    const order=(await care.getCare(f.dc(),f.admissionId)).orders[0];
    const rx=await care.signClinicalSummary(f.dc(),{admissionId:f.admissionId,expectedVersion:1,diagnosis:"Human diagnosis",course:"Human course",condition:"Reviewed",followUp:"Human follow-up",advice:"Human advice",prescriptionOrderIds:[order.id]});
    const expiresOn=p.hospitalDate(new Date(),"Etc/GMT+12"),stock=f.pc(),batch=await p.recordStockReceipt(stock,{medicineId:"DIS_HOME",batchNo:"TODAY",expiresOn,quantity:"10",unit:"tablet",barcode:"DIS-TODAY",reference:"Vendor document line TODAY",requestId:stock.requestId});
    const prepare=f.pc(),input={admissionId:f.admissionId,prescriptionVersionId:rx.id,items:[{orderId:order.id,batchId:batch.id,quantity:"2",unit:"tablet"}],requestId:prepare.requestId};await p.prepareTakeHomeMedicines(prepare,input);
    for(const [gate,c] of [["DOCTOR",f.dc],["PHARMACY",f.pc]] as const){const r=await discharge.getClearanceReview(c(),f.admissionId,gate);await discharge.issueClearance(c(),{admissionId:f.admissionId,gate,expectedReviewHash:r.reviewHash});}
    const before=await discharge.getClearanceReview(f.pc(),f.admissionId,"PHARMACY");expect(before.current).toBe(true);
    await f.setting({type:"hospital",name:"Synthetic date-safety hospital",address:"Synthetic address",timezone:"Pacific/Kiritimati"});
    expect(p.hospitalDate(new Date(),"Pacific/Kiritimati")>expiresOn).toBe(true);
    const after=await discharge.getClearanceReview(f.pc(),f.admissionId,"PHARMACY");expect(after.current).toBe(false);expect(after.blockers.some(b=>b.includes("expired"))).toBe(true);expect(after.gates[0].current).toBe(true);
    await expect(discharge.issueClearance(f.pc(),{admissionId:f.admissionId,gate:"PHARMACY",expectedReviewHash:before.reviewHash})).rejects.toMatchObject({code:"CONFLICT"});
    await p.prepareTakeHomeMedicines(prepare,input);expect((await runtime.query("select count(*)::int n from hims.pharmacy_movements where kind='ISSUE'")).rows[0].n).toBe(1);
  }));
  it("renews converted self-pay responsibility after new charges while retaining insurer cash and history",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture("INSURED"),admin=()=>staffContext(f.admin,"synthetic-converted");
    await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) values($1,'converted-initial','synthetic','room','GENERAL','Synthetic initial bill','1','hour',$2,100000,100000,'FINAL','staff',$3)",[f.admissionId,f.room.id,f.cashier.id]);
    const c=admin(),caseRow=await insurance.createInsuranceCase(c,{admissionId:f.admissionId,assignedStaffId:null,reason:"Synthetic conversion",requestId:c.requestId});
    const cash=f.ctx();await billing.recordReceipt(cash,{admissionId:f.admissionId,party:"INSURER",kind:"PAYMENT",amountPaise:"40000",mode:"BANK",channel:"Converted insurer",sourceReference:"CONV-1",reference:"Actual insurer cash retained",requestId:cash.requestId});
    const b=await billing.getBill(f.ctx(),f.admissionId),convert=admin();await insurance.convertToSelfPay(convert,{caseId:caseRow.id,expectedCaseVersion:1,reason:"Externally resolved conversion",decisionReference:"CONV-DECISION",verifiedBy:"External desk",verifiedAt:new Date().toISOString(),allocation:{billRevision:b.revision,netBillPaise:"100000",retainedInsurerLiabilityPaise:"40000",verifiedPatientLiabilityPaise:"60000",sourceReference:"Verified whole bill resolution"},requestId:convert.requestId});
    await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) values($1,'converted-later','synthetic','room','GENERAL','Actual later synthetic charge','1','hour',$2,50000,50000,'FINAL','staff',$3)",[f.admissionId,f.room.id,f.cashier.id]);
    expect((await insurance.getInsuranceCase(admin(),caseRow.id)).responsibility?.stale).toBe(true);
    const latest=await billing.getBill(f.ctx(),f.admissionId),renew=f.ctx();await billing.reviewSelfPayResponsibility(renew,{admissionId:f.admissionId,expectedBillVersion:latest.revision,reason:"Reviewed new self-pay charges and preserved insurer receipt",requestId:renew.requestId});
    expect((await insurance.getInsuranceCase(admin(),caseRow.id)).responsibility).toMatchObject({stale:false,allocationComplete:true,insurerPaise:40000n,patientPaise:110000n,insurerOutstandingPaise:0n,patientOutstandingPaise:110000n});
    expect((await runtime.query("select count(*)::int n from hims.insurance_conversions")).rows[0].n).toBe(1);
  }));
  it("does not reinstate refunded insurer liability when converted self-pay later incurs a new charge",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture("INSURED"),admin=()=>staffContext(f.admin,"synthetic-refunded-conversion");
    await f.setting({type:"billable-item",code:"CONVERSION_CONSULT",name:"Actual conversion consultation",category:"consultation",department:"DOCTOR",unit:"visit",quantityScale:0,amount:"1000",active:true});
    const round=f.dc();await care.recordRound(round,{admissionId:f.admissionId,notes:"Actual performed consultation before conversion",orders:[],feeScheduleId:"CONVERSION_CONSULT",feeUnit:"visit",requestId:round.requestId});
    const charge=(await runtime.query("select id from hims.charges where admission_id=$1 and item_id='CONVERSION_CONSULT'",[f.admissionId])).rows[0];
    const c=admin(),insuranceCase=await insurance.createInsuranceCase(c,{admissionId:f.admissionId,assignedStaffId:null,reason:"Synthetic actual conversion",requestId:c.requestId});
    const receipts=[];for(const [party,amountPaise] of [["INSURER","90000"],["PATIENT","10000"]]){const ctx=f.ctx();receipts.push(await billing.recordReceipt(ctx,{admissionId:f.admissionId,party,kind:"PAYMENT",amountPaise,mode:"BANK",channel:"Converted cash",sourceReference:party,reference:"Actual original payment",requestId:ctx.requestId}));}
    const b=await billing.getBill(f.ctx(),f.admissionId),convert=admin();await insurance.convertToSelfPay(convert,{caseId:insuranceCase.id,expectedCaseVersion:1,reason:"Externally resolved conversion",decisionReference:"CONV-REFUND",verifiedBy:"External desk",verifiedAt:new Date().toISOString(),allocation:{billRevision:b.revision,netBillPaise:"100000",retainedInsurerLiabilityPaise:"90000",verifiedPatientLiabilityPaise:"10000",sourceReference:"Verified full bill resolution"},requestId:convert.requestId});
    for(const [gate,ctx] of [["DOCTOR",f.dc],["PHARMACY",f.pc],["NURSING",f.nc]] as const){const r=await discharge.getClearanceReview(ctx(),f.admissionId,gate);await discharge.issueClearance(ctx(),{admissionId:f.admissionId,gate,expectedReviewHash:r.reviewHash});}
    const reverse=f.ctx();await billing.reverseCharge(reverse,{chargeId:charge.id,amountPaise:"40000",reason:"Actual linked bill correction",requestId:reverse.requestId});
    async function reviewCurrent(){const bill=await billing.getBill(f.ctx(),f.admissionId),r=f.ctx();return billing.reviewSelfPayResponsibility(r,{admissionId:f.admissionId,expectedBillVersion:bill.revision,reason:"Review current self-pay money and retained insurer cash",requestId:r.requestId});}
    await reviewCurrent();
    for(const [index,amountPaise] of [[0,"30000"],[1,"10000"]] as const){const r=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING"),ctx=f.ctx();await billing.refundReceipt(ctx,{receiptId:receipts[index].id,amountPaise,mode:"BANK",channel:"Conversion refunds",sourceReference:`REF-${index}`,evidence:"Actual bank refund evidence",refundedAt:new Date().toISOString(),reason:"Return actual party excess",expectedReviewHash:r.reviewHash,expectedBillVersion:r.billVersion,requestId:ctx.requestId});}
    expect(await billing.getBill(f.ctx(),f.admissionId)).toMatchObject({netPaise:60000n,insurerCashPaise:60000n,patientCashPaise:0n,refundedPaise:40000n});
    await f.setting({type:"billable-item",code:"CONVERSION_CONSULT",name:"Actual later consultation",category:"consultation",department:"DOCTOR",unit:"visit",quantityScale:0,amount:"100",active:true});
    const later=f.dc();await care.recordRound(later,{admissionId:f.admissionId,notes:"Actual later performed self-pay consultation",orders:[],feeScheduleId:"CONVERSION_CONSULT",feeUnit:"visit",requestId:later.requestId});
    await reviewCurrent();expect((await insurance.getInsuranceCase(admin(),insuranceCase.id)).responsibility).toMatchObject({stale:false,allocationComplete:true,insurerPaise:60000n,patientPaise:10000n,insurerOutstandingPaise:0n,patientOutstandingPaise:10000n,insurerExcessPaise:0n,patientExcessPaise:0n});
    expect((await runtime.query("select count(*)::int n from hims.insurance_conversions")).rows[0].n).toBe(1);expect((await runtime.query("select count(*)::int n from hims.receipt_refunds")).rows[0].n).toBe(2);
  }));
  it("continues actual monitoring after nursing clearance and reopens only Nursing and its dependent Billing review",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture(),scheduledFor=new Date().toISOString(),r=f.dc();
    await care.recordRound(r,{admissionId:f.admissionId,notes:"Doctor continues monitoring",orders:[{kind:"VITALS",requestedItem:"Human ordered observations",schedule:{startsAt:scheduledFor,intervalMinutes:60,occurrences:2}}],requestId:r.requestId});
    for(const [gate,context] of [["DOCTOR",f.dc],["PHARMACY",f.pc],["NURSING",f.nc]] as const){const review=await discharge.getClearanceReview(context(),f.admissionId,gate);await discharge.issueClearance(context(),{admissionId:f.admissionId,gate,expectedReviewHash:review.reviewHash});}
    const before=await discharge.getClearanceReview(f.nc(),f.admissionId,"NURSING");
    const again=await discharge.getClearanceReview(f.nc(),f.admissionId,"NURSING");expect(again.reviewHash).toBe(before.reviewHash);
    const n=f.nc();await nursing.recordObservation(n,{admissionId:f.admissionId,shiftId:f.shift.id,scheduledFor,observedAt:new Date().toISOString(),values:{pulse:72},requestId:n.requestId});
    const after=await discharge.getClearanceReview(f.nc(),f.admissionId,"NURSING");expect(after.current).toBe(false);expect(after.gates.slice(0,2).map(g=>g.current)).toEqual([true,true]);
    expect((await runtime.query("select count(*)::int n from hims.nursing_shift_ends where shift_id=$1",[f.shift.id])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.nursing_observations where admission_id=$1",[f.admissionId])).rows[0].n).toBe(1);
    await expect(discharge.issueClearance(f.nc(),{admissionId:f.admissionId,gate:"NURSING",expectedReviewHash:before.reviewHash})).rejects.toMatchObject({code:"CONFLICT"});
  }));
  it("commits delayed occupied-room catch-up and returns the actual new due without recording departure",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture("SELF_PAY","3600"),before=await billing.getBill(f.ctx(),f.admissionId);
    const original=(await runtime.query("select s.*,v.payload from hims.room_stays s join hims.setting_versions v on v.id=s.tariff_version_id where s.admission_id=$1",[f.admissionId])).rows[0];
    expect(original.payload).toMatchObject({amount:"360000",basis:"hour",rounding:"exact",graceMinutes:0});
    await new Promise(r=>setTimeout(r,1100));
    const ctx=f.ctx(),cutoff=new Date(),out=await discharge.recordDeparture(ctx,{admissionId:f.admissionId,departedAt:cutoff.toISOString(),expectedBillVersion:before.revision,requestId:ctx.requestId});
    expect(out.status).toBe("REVIEW_REQUIRED");
    const after=await billing.getBill(f.ctx(),f.admissionId),duration=BigInt(cutoff.getTime()-Date.parse(f.arrivedAt));
    expect(after.netPaise).toBe((duration+5n)/10n);expect(after.netPaise).toBeGreaterThan(before.netPaise);expect(after.outstandingPaise).toBe(after.netPaise);
    const posted=(await runtime.query("select * from hims.room_stays where id=$1",[original.id])).rows[0];expect(posted.tariff_version_id).toBe(original.tariff_version_id);expect(posted.last_reconciled_at.toISOString()).toBe(cutoff.toISOString());expect(posted.ended_at).toBeNull();expect(BigInt(posted.posted_paise)).toBe((duration+5n)/10n);
    expect((await runtime.query("select rate_paise,tariff_version_id,amount_paise from hims.charges where admission_id=$1 and category='room'",[f.admissionId])).rows.every(c=>BigInt(c.rate_paise)===360000n&&c.tariff_version_id===original.tariff_version_id)).toBe(true);
    expect((await runtime.query("select count(*)::int n from hims.bed_turnovers where admission_id=$1",[f.admissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1",[f.admissionId])).rows[0].n).toBe(1);
    expect((await runtime.query("select count(*)::int n from hims.departures")).rows[0].n).toBe(0);
  }));
  it("serializes real source changes against a human signature on separate connections and rechecks revoked role",async()=>withTestDatabase(async({owner,runtime})=>{
    const f=await fixture(),review=await discharge.getClearanceReview(f.dc(),f.admissionId,"DOCTOR");
    const one=new Client({connectionString:testUrl}),two=new Client({connectionString:testUrl});await Promise.all([one.connect(),two.connect()]);
    const pid1=(await one.query("select pg_backend_pid() pid")).rows[0].pid,pid2=(await two.query("select pg_backend_pid() pid")).rows[0].pid;expect(pid1).not.toBe(pid2);
    let pending:Promise<unknown>|undefined;
    try{
      await one.query("begin");await one.query("select pg_advisory_xact_lock_shared(729104211)");await one.query("select id from hims.admissions where id=$1 for update",[f.admissionId]);
      await one.query("insert into hims.clinical_rounds(admission_id,notes,signed_by,signed_at) values($1,'Actual new synthetic clinical findings',$2,clock_timestamp())",[f.admissionId,f.doctor.id]);
      pending=drizzle(two,{schema}).transaction(tx=>discharge.issueClearanceInTransaction(tx,f.dc(),{admissionId:f.admissionId,gate:"DOCTOR",expectedReviewHash:review.reviewHash})).catch(e=>e);
      let blocked=false;for(let i=0;i<100;i++){if((await runtime.query("select $1::int=any(pg_blocking_pids($2)) blocked",[pid1,pid2])).rows[0].blocked){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}expect(blocked).toBe(true);
      await one.query("commit");expect(await pending).toMatchObject({code:"CONFLICT"});
    }finally{await one.query("rollback");await pending;await Promise.all([one.end(),two.end()]);}
    const latest=await discharge.getClearanceReview(f.dc(),f.admissionId,"DOCTOR"),ctx=f.dc(),input={admissionId:f.admissionId,gate:"DOCTOR",expectedReviewHash:latest.reviewHash};await discharge.issueClearance(ctx,input);
    await owner.query("update hims.staff_user set role='NURSE' where id=$1",[f.doctor.id]);await expect(discharge.issueClearance(ctx,input)).rejects.toMatchObject({code:"FORBIDDEN"});
  }));
  it("cancels allocations append-only, caps refunds at actual excess and cannot allocate refunded deposit",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture();
    await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) values($1,'refund-corrected-bill','synthetic','room','GENERAL','Synthetic posted amount','1','hour',$2,100000,100000,'FINAL','staff',$3)",[f.admissionId,f.room.id,f.cashier.id]);
    const cash=f.ctx(),receipt=await billing.recordReceipt(cash,{admissionId:f.admissionId,party:"PATIENT",kind:"DEPOSIT",amountPaise:"200000",mode:"CASH",channel:"Refund bounds",sourceReference:"DEP-BOUND",reference:"Actual held cash",requestId:cash.requestId});
    const a=f.ctx(),allocation=await billing.allocateDeposit(a,{receiptId:receipt.id,amountPaise:"100000",reason:"Original allocation",requestId:a.requestId});
    for(const [gate,c] of [["DOCTOR",f.dc],["PHARMACY",f.pc],["NURSING",f.nc]] as const){const r=await discharge.getClearanceReview(c(),f.admissionId,gate);await discharge.issueClearance(c(),{admissionId:f.admissionId,gate,expectedReviewHash:r.reviewHash});}
    let r=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");const cancel=f.ctx(),cancelInput={allocationId:allocation.id,reason:"Correct original deposit use before refund",expectedReviewHash:r.reviewHash,expectedBillVersion:r.billVersion,requestId:cancel.requestId};const cancelled=await billing.cancelAllocation(cancel,cancelInput);
    r=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");const bad=f.ctx(),v={receiptId:receipt.id,amountPaise:"100001",mode:"CASH",channel:"Refund bounds",sourceReference:"REF-BOUND",evidence:"Signed receipt",reason:"Return real excess",refundedAt:new Date().toISOString(),expectedReviewHash:r.reviewHash,expectedBillVersion:r.billVersion,requestId:bad.requestId};
    await expect(billing.refundReceipt(bad,v)).rejects.toMatchObject({code:"PRECONDITION"});
    const ok=f.ctx();await billing.refundReceipt(ok,{...v,amountPaise:"100000",requestId:ok.requestId});
    const over=f.ctx();await expect(billing.allocateDeposit(over,{receiptId:receipt.id,amountPaise:"100001",reason:"Cannot allocate returned cash",requestId:over.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    const corrected=f.ctx();await billing.allocateDeposit(corrected,{receiptId:receipt.id,amountPaise:"100000",reason:"Apply only retained cash",requestId:corrected.requestId});
    expect(await billing.getBill(f.ctx(),f.admissionId)).toMatchObject({retainedPaise:100000n,billPaidPaise:100000n,outstandingPaise:0n,unallocatedDepositPaise:0n});
    expect((await runtime.query("select count(*)::int n from hims.receipt_allocations")).rows[0].n).toBe(2);
    const vacate=f.nc();await discharge.recordRoomVacated(vacate,{admissionId:f.admissionId,shiftId:f.shift.id,vacatedAt:new Date().toISOString(),waitingLocation:"Synthetic discharge chairs",handover:"Continue actual care",requestId:vacate.requestId});
    r=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");await discharge.issueClearance(f.ctx(),{admissionId:f.admissionId,gate:"BILLING",expectedReviewHash:r.reviewHash,expectedBillVersion:r.billVersion});const exit=f.ctx();await discharge.recordDeparture(exit,{admissionId:f.admissionId,departedAt:new Date().toISOString(),expectedBillVersion:r.billVersion,requestId:exit.requestId});
    expect(await billing.cancelAllocation(cancel,cancelInput)).toEqual(cancelled);
  }));
  it("settles a true nonzero hourly cutoff before human final signature and releases one bed only at actual departure", async () => withTestDatabase(async ({runtime}) => {
    const f=await fixture("SELF_PAY","3600");
    for(const [gate,context] of [["DOCTOR",f.dc],["PHARMACY",f.pc],["NURSING",f.nc]] as const){const r=await discharge.getClearanceReview(context(),f.admissionId,gate);await discharge.issueClearance(context(),{admissionId:f.admissionId,gate,expectedReviewHash:r.reviewHash});}
    const vacate=f.nc(),vacatedAt=new Date().toISOString();
    const vacancyInput={admissionId:f.admissionId,shiftId:f.shift.id,vacatedAt,waitingLocation:"Discharge waiting chairs, no bed use",handover:"Continue prescribed observations while cashier settles",requestId:vacate.requestId};
    const vacancyResult=await discharge.recordRoomVacated(vacate,vacancyInput);
    const before=await billing.getBill(f.ctx(),f.admissionId);expect(before.netPaise).toBe((BigInt(Date.parse(vacatedAt)-Date.parse(f.arrivedAt))+5n)/10n);
    const frozen=(await runtime.query("select s.*,v.payload from hims.room_stays s join hims.setting_versions v on v.id=s.tariff_version_id where s.admission_id=$1",[f.admissionId])).rows[0];expect(frozen.payload).toMatchObject({amount:"360000",basis:"hour",rounding:"exact",graceMinutes:0});expect(frozen.last_reconciled_at.toISOString()).toBe(vacatedAt);expect(BigInt(frozen.posted_paise)).toBe(before.netPaise);expect(before.netPaise).toBeGreaterThan(0n);
    await new Promise(r=>setTimeout(r,1200));
    const receipt=f.ctx();await billing.recordReceipt(receipt,{admissionId:f.admissionId,party:"PATIENT",kind:"PAYMENT",amountPaise:before.netPaise.toString(),mode:"CASH",channel:"Synthetic discharge book",sourceReference:"OUT-1",reference:"Actual final room amount received",requestId:receipt.requestId});
    const after=await billing.getBill(f.ctx(),f.admissionId);expect(after.netPaise).toBe(before.netPaise);expect(after.unpostedRoomPaise).toBe(0n);
    const review=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");
    expect(JSON.stringify(review.inputs)).not.toContain("Continue prescribed observations while cashier settles");
    expect(review).toHaveProperty("bill.revision",review.billVersion);
    expect(review).toHaveProperty("bill.netPaise",before.netPaise);
    const sealCtx=f.ctx(),sealInput={admissionId:f.admissionId,gate:"BILLING",expectedReviewHash:review.reviewHash,expectedBillVersion:review.billVersion};
    const signed=await discharge.issueClearance(sealCtx,sealInput);
    expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1",[f.admissionId])).rows[0].n).toBe(1);
    const exit=f.ctx(),input={admissionId:f.admissionId,departedAt:new Date().toISOString(),expectedBillVersion:review.billVersion,requestId:exit.requestId};
    const done=await discharge.recordDeparture(exit,input);expect(done.status).toBe("DISCHARGED");
    expect(await discharge.recordDeparture(exit,input)).toEqual(done);
    expect(await discharge.recordRoomVacated(vacate,vacancyInput)).toEqual(vacancyResult);
    expect((await discharge.issueClearance(sealCtx,sealInput)).id).toBe(signed.id);
    const collision={...input,requestId:sealCtx.requestId};await expect(discharge.recordDeparture(sealCtx,collision)).rejects.toMatchObject({code:"CONFLICT"});
    const newVacate=f.nc();await expect(discharge.recordRoomVacated(newVacate,{...vacancyInput,requestId:newVacate.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1",[f.admissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.bed_turnovers where admission_id=$1",[f.admissionId])).rows[0].n).toBe(1);
    expect((await runtime.query("select ended_at from hims.room_stays where admission_id=$1",[f.admissionId])).rows[0].ended_at.toISOString()).toBe(vacatedAt);
    const t=(await runtime.query("select id,bed_id from hims.bed_turnovers where admission_id=$1",[f.admissionId])).rows[0];
    const {createAdmission}=await import("../../src/server/admissions/commands");
    const fresh=f.deskCtx(),newAdmission={patientDetails:{name:"Synthetic next patient",ageYearsAtRegistration:40,sex:"FEMALE"},admittingDoctorId:f.doctor.id,clinicianAssessment:{clinicianId:f.doctor.id,assessedAt:new Date().toISOString(),chiefComplaint:"Synthetic complaint",vitals:"Synthetic vitals",triage:"Synthetic route",destinationCategory:"GENERAL"},bedId:t.bed_id,paymentRoute:"SELF_PAY",expectedStayDays:1,requestId:fresh.requestId};
    await expect(createAdmission(fresh,newAdmission)).rejects.toMatchObject({code:"CONFLICT"});
    const clean=staffContext(f.admin,"synthetic-cleaning");await discharge.completeBedTurnover(clean,{turnoverId:t.id,completedAt:new Date().toISOString(),evidence:"Housekeeping staff confirmed cleaned bed",requestId:clean.requestId});
    expect((await createAdmission(fresh,newAdmission)).admissionId).toBeTruthy();
  }));
  it("retains the approved 11500000 paise sample, with insurer cash and the actual linked 500000 refund", async () => withTestDatabase(async ({ runtime,owner }) => {
    const f = await fixture("INSURED");
    const tariff = await f.setting({ type: "billable-item", code: "DISCHARGE_FEE", name: "Synthetic consultation", category: "consultation", department: "DOCTOR", unit: "consultation", quantityScale: 0, amount: "115000", active: true });
    // Isolated synthetic money source; professional and cash effects below use real commands.
    await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) values($1,'sample-bill','synthetic','consultation','DISCHARGE_FEE','Synthetic accepted financial sample','1','consultation',$2,11500000,11500000,'FINAL','staff',$3)", [f.admissionId, tariff.id, f.doctor.id]);
    const admin = () => staffContext(f.admin, "synthetic-discharge-insurance");
    const c = admin(), caseRow = await insurance.createInsuranceCase(c, { admissionId: f.admissionId, assignedStaffId: null, reason: "Synthetic case", requestId: c.requestId });
    const p = admin(); await insurance.recordPolicyVerification(p, { caseId: caseRow.id, expectedCaseVersion: 1, requestId: p.requestId, insurer: "Synthetic insurer", tpa: "", policyNumber: "SYN-POL", memberNumber: "SYN-MEM", validFrom: "2026-01-01", validTo: "2027-01-01", verifiedBy: "External staff", verifiedAt: new Date().toISOString(), reference: "SYN-VERIFY", documentIds: [] });
    const bill = await billing.getBill(f.ctx(), f.admissionId), d = admin();
    await insurance.recordPayerDecision(d, { caseId: caseRow.id, expectedCaseVersion: 2, requestId: d.requestId, status: "APPROVED", kind: "PREAUTH", approvedPaise: "9000000", coPayBps: 1000, reason: "Externally verified", verifiedBy: "External staff", verifiedAt: new Date().toISOString(), reference: "SYN-AUTH", documentIds: [], allocation: { billRevision: bill.revision, netBillPaise: "11500000", eligibleBillPaise: "10000000", nonPayablePaise: "1500000", sourceReference: "Reviewed sample bill" } });
    const deposit = f.ctx(); const receipt = await billing.recordReceipt(deposit, { admissionId: f.admissionId, party: "PATIENT", kind: "DEPOSIT", amountPaise: "3000000", mode: "CASH", channel: "Synthetic cashbook", sourceReference: "DEP-1", reference: "Actual patient deposit", requestId: deposit.requestId });
    const allocation = f.ctx(); await billing.allocateDeposit(allocation, { receiptId: receipt.id, amountPaise: "2500000", reason: "Apply patient responsibility", requestId: allocation.requestId });
    for (const [gate, context] of [["DOCTOR", f.dc], ["PHARMACY", f.pc], ["NURSING", f.nc]] as const) {
      const review = await discharge.getClearanceReview(context(), f.admissionId, gate);
      await discharge.issueClearance(context(), { admissionId: f.admissionId, gate, expectedReviewHash: review.reviewHash });
    }
    const waiting = await discharge.getClearanceReview(f.ctx(), f.admissionId, "BILLING");
    await expect(discharge.issueClearance(f.ctx(), { admissionId: f.admissionId, gate: "BILLING", expectedReviewHash: waiting.reviewHash, expectedBillVersion: waiting.billVersion })).rejects.toMatchObject({ code: "PRECONDITION" });
    const cash = f.ctx(); await billing.recordReceipt(cash, { admissionId: f.admissionId, party: "INSURER", kind: "PAYMENT", amountPaise: "9000000", mode: "BANK", channel: "Synthetic insurer account", sourceReference: "INS-1", reference: "Actual insurer funds", evidenceId: "Bank entry evidence", requestId: cash.requestId });
    const review = await discharge.getClearanceReview(f.ctx(), f.admissionId, "BILLING"), refund = f.ctx();
    const input = { receiptId: receipt.id, amountPaise: "500000", reason: "Return actual patient excess", mode: "CASH", channel: "Synthetic refund book", sourceReference: "REF-1", evidence: "Signed patient refund receipt", refundedAt: new Date().toISOString(), expectedReviewHash: review.reviewHash, expectedBillVersion: review.billVersion, requestId: refund.requestId };
    const refunded=await billing.refundReceipt(refund, input);
    const final = await billing.getBill(f.ctx(), f.admissionId);
    expect(final).toMatchObject({ netPaise: 11500000n, patientReceivedPaise:3000000n, insurerReceivedPaise:9000000n, refundedPaise:500000n, retainedPaise:11500000n, patientCashPaise: 2500000n, insurerCashPaise: 9000000n, unallocatedDepositPaise: 0n, billPaidPaise: 11500000n, outstandingPaise: 0n });
    expect((await insurance.getInsuranceCase(admin(), caseRow.id)).responsibility).toMatchObject({ allocationComplete: true, patientOutstandingPaise: 0n, insurerOutstandingPaise: 0n });
    const repeat = f.ctx(); await billing.refundReceipt(repeat, { ...input, requestId: repeat.requestId });
    const vacate=f.nc();await discharge.recordRoomVacated(vacate,{admissionId:f.admissionId,shiftId:f.shift.id,vacatedAt:new Date().toISOString(),waitingLocation:"Synthetic discharge waiting chairs",handover:"Continue prescribed care",requestId:vacate.requestId});
    const settled=await discharge.getClearanceReview(f.ctx(),f.admissionId,"BILLING");await discharge.issueClearance(f.ctx(),{admissionId:f.admissionId,gate:"BILLING",expectedReviewHash:settled.reviewHash,expectedBillVersion:settled.billVersion});
    const exit=f.ctx();await discharge.recordDeparture(exit,{admissionId:f.admissionId,departedAt:new Date().toISOString(),expectedBillVersion:settled.billVersion,requestId:exit.requestId});
    expect(await billing.refundReceipt(refund,input)).toEqual(refunded);
    const newRefund=f.ctx();await expect(billing.refundReceipt(newRefund,{...input,sourceReference:"NEW-AFTER-EXIT",requestId:newRefund.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    expect((await runtime.query("select count(*)::int n from hims.receipt_refunds")).rows[0].n).toBe(1);
    await owner.query("update hims.staff_user set banned=true where id=$1",[f.cashier.id]);await expect(billing.refundReceipt(refund,input)).rejects.toMatchObject({code:"FORBIDDEN"});
  }));
  it("requires the real signer and preceding current seal, and preserves Doctor approval after a receipt", async () => withTestDatabase(async () => {
    const f = await fixture();
    const review = await discharge.getClearanceReview(f.dc(), f.admissionId, "DOCTOR");
    expect(review).not.toHaveProperty("bill");
    await expect(discharge.issueClearance(f.ctx(), { admissionId: f.admissionId, gate: "DOCTOR", expectedReviewHash: review.reviewHash })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const pharmacy = await discharge.getClearanceReview(f.pc(), f.admissionId, "PHARMACY");
    await expect(discharge.issueClearance(f.pc(), { admissionId: f.admissionId, gate: "PHARMACY", expectedReviewHash: pharmacy.reviewHash })).rejects.toMatchObject({ code: "PRECONDITION" });
    await discharge.issueClearance(f.dc(), { admissionId: f.admissionId, gate: "DOCTOR", expectedReviewHash: review.reviewHash });
    const payment = f.ctx();
    await billing.recordReceipt(payment, { admissionId: f.admissionId, party: "PATIENT", kind: "PAYMENT", amountPaise: "100", mode: "CASH", channel: "Synthetic cashbook", sourceReference: "D-1", reference: "Actual synthetic receipt", requestId: payment.requestId });
    expect((await discharge.getClearanceReview(f.dc(), f.admissionId, "DOCTOR")).current).toBe(true);
    const stale = await discharge.getClearanceReview(f.dc(), f.admissionId, "DOCTOR");
    await care.signClinicalSummary(f.dc(), { admissionId: f.admissionId, expectedVersion: 1, diagnosis: "Revised diagnosis", course: "Updated human review", condition: "Reviewed", followUp: "Follow-up", advice: "Human advice", prescriptionOrderIds: [] });
    await expect(discharge.issueClearance(f.dc(), { admissionId: f.admissionId, gate: "DOCTOR", expectedReviewHash: stale.reviewHash })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await discharge.getClearanceReview(f.dc(), f.admissionId, "DOCTOR")).current).toBe(false);
  }));
});
