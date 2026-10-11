import { afterEach, expect, it, vi } from "vitest";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { withTestDatabase, waitForTestDatabaseIdle } from "../../scripts/test-database";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { billingFixture } from "../support/billing-fixture";
import { staffContext } from "../../src/server/access";
import * as schema from "../../src/server/schema";
import * as care from "../../src/server/clinical/commands";
import * as nursing from "../../src/server/nursing/commands";
import * as billing from "../../src/server/billing/commands";
import * as exceptions from "../../src/server/discharge/exceptions";
import * as discharge from "../../src/server/discharge/commands";
import { activateAdmission, createBed, transferAdmission } from "../../src/server/admissions/commands";
import { reconcileRoomChargesInTransaction } from "../../src/server/billing/room-charges";
import * as database from "../../src/server/db";
import { getStaffWorklist } from "../../src/server/overview";
loadLocalEnvironment();
const ordinary = process.env.DATABASE_URL, testUrl = getTestDatabaseConfig().runtimeUrl;
afterEach(async () => { await waitForTestDatabaseIdle(); process.env.DATABASE_URL = ordinary; delete process.env.HIMS_DOCUMENT_STORAGE; vi.restoreAllMocks(); });
process.env.BETTER_AUTH_URL = "http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET = "SyntheticFinalReviewSecretAtLeast32Characters12345";
async function active() {
  process.env.DATABASE_URL = testUrl;
  const f = await billingFixture();
  await f.setting({ type: "deposit", category: "GENERAL", route: "self-pay", requirement: "not-required", amount: "0" });
  await f.setting({ type: "tariff", category: "GENERAL", amount: "3600", basis: "hour", rounding: "exact", graceMinutes: 0 });
  const { admissionId } = await f.episode(), arrived = new Date(), ac = f.deskCtx();
  await activateAdmission(ac, { admissionId, arrivedAt: arrived.toISOString(), expectedVersion: 1, requestId: ac.requestId });
  const dc = () => staffContext(f.doctor,"synthetic-final-review"), nc = () => staffContext(f.nurse,"synthetic-final-review"), admin = () => staffContext(f.admin,"synthetic-final-review");
  await nursing.assignNurse(admin(), { admissionId, nurseId: f.nurse.id, authority: "Synthetic roster", reason: "Current assigned attendance" });
  const sc = nc(), shift = await nursing.recordShift(sc, { admissionId, startedAt: arrived.toISOString(), handover: "Synthetic actual attendance", requestId: sc.requestId });
  return { ...f, admissionId, arrived, dc, nc, admin, shift };
}
async function vacancy(f: Awaited<ReturnType<typeof active>>) {
  await care.signClinicalSummary(f.dc(), { admissionId:f.admissionId,expectedVersion:0,diagnosis:"Synthetic diagnosis",course:"Synthetic course",condition:"Synthetic stable condition",followUp:"Synthetic follow-up",advice:"Synthetic actual advice",prescriptionOrderIds:[] });
  for(const [gate,ctx] of [["DOCTOR",f.dc],["PHARMACY",()=>staffContext(f.pharmacy,"synthetic")],["NURSING",f.nc]] as const) {
    const r=await discharge.getClearanceReview(ctx(),f.admissionId,gate);
    await discharge.issueClearance(ctx(),{admissionId:f.admissionId,gate,expectedReviewHash:r.reviewHash});
  }
  const c=f.nc(); return discharge.recordRoomVacated(c,{admissionId:f.admissionId,shiftId:f.shift.id,vacatedAt:new Date().toISOString(),waitingLocation:"Supervised off-bed wait",handover:"Actual witnessed vacancy",requestId:c.requestId});
}
async function authority(f: Awaited<ReturnType<typeof active>>, type: string, evidenceIds: string[]) {
  return exceptions.authorizeException(f.admin(),{admissionId:f.admissionId,type,disposition:"EXCEPTIONAL_EXIT",authority:"Synthetic Admin authority",reason:"Actual exceptional route",evidence:"Retained professional sources",evidenceIds,followUpOwnerId:f.doctor.id});
}
async function earlyExit(f: Awaited<ReturnType<typeof active>>) {
  const at=new Date().toISOString(), physical=await exceptions.recordExceptionEvidence(f.nc(),{admissionId:f.admissionId,kind:"PHYSICAL_EXIT",shiftId:f.shift.id,actualAt:at,vacatedAt:at,notes:"Actual unplanned early exit"});
  const a=await authority(f,"EARLY_EXIT",[physical.id]);
  return exceptions.recordExceptionalDeparture(f.admin(),{admissionId:f.admissionId,exceptionId:a.id,physicalEvidenceId:physical.id});
}
async function correctionAuthority(f: Awaited<ReturnType<typeof active>>, kind:string, sourceId:string) {
  return exceptions.authorizeException(f.admin(),{admissionId:f.admissionId,type:"POST_DISCHARGE_CORRECTION",disposition:"AMEND",authority:"Source-bound Admin review",reason:"Correct retained original source",evidence:"Synthetic attributable reconciliation",evidenceIds:[],followUpOwnerId:f.cashier.id,sourceId,correctionKind:kind});
}
async function originalCopy(f: Awaited<ReturnType<typeof active>>) {
  process.env.HIMS_DOCUMENT_STORAGE="synthetic";
  const d=await import("../../src/server/documents/commands"), review=await d.getDischargeDocumentReview(f.ctx(),f.admissionId), original=await d.createDischargeDocument(f.ctx(),review.input);
  return {d,original,bytes:(await d.downloadDischargeDocument(f.ctx(),original.documentId)).bytes};
}
async function amendedCopy(f: Awaited<ReturnType<typeof active>>, copy: Awaited<ReturnType<typeof originalCopy>>, amendmentId:string, net:bigint) {
  const {d,original,bytes}=copy;
  expect(await d.verifyDocument(f.ctx(),original.documentId)).toMatchObject({status:"SOURCE_CHANGED"});
  const review=await d.getDischargeDocumentReview(f.ctx(),f.admissionId), created=await d.createDischargeDocument(f.ctx(),review.input), amended=await d.getDischargeDocument(f.ctx(),created.documentId);
  expect(created.version).toBe(original.version+1);expect(amended.replacesDocumentId).toBe(original.documentId);
  expect(amended.snapshot.money.bill.netPaise).toBe(net.toString());
  expect(amended.snapshot.provenance.amendments).toContainEqual(expect.objectContaining({id:amendmentId}));
  expect(await d.verifyDocument(f.ctx(),original.documentId)).toMatchObject({status:"SUPERSEDED"});
  expect(await d.verifyDocument(f.ctx(),created.documentId)).toMatchObject({status:"CURRENT"});
  expect((await d.downloadDischargeDocument(f.ctx(),original.documentId)).bytes).toEqual(bytes);
}
it("uses real stop signing after admission contention so factual pre-stop late care remains valid", async()=>withTestDatabase(async({runtime})=>{
  const f=await active(), c=f.dc(), scheduled=new Date().toISOString();
  await care.recordRound(c,{admissionId:f.admissionId,notes:"Actual observation instruction",orders:[{kind:"VITALS",requestedItem:"Actual pulse",schedule:{startsAt:scheduled,intervalMinutes:1,occurrences:2}}],requestId:c.requestId});
  const order=(await care.getCare(f.dc(),f.admissionId)).orders[0];
  const blocker=new Client({connectionString:testUrl}), signer=new Client({connectionString:testUrl});
  await Promise.all([blocker.connect(),signer.connect()]); let stopping:Promise<unknown>|undefined;
  try {
    const bpid=(await blocker.query("select pg_backend_pid() pid")).rows[0].pid, spid=(await signer.query("select pg_backend_pid() pid")).rows[0].pid;
    await blocker.query("begin"); await blocker.query("update hims.admissions set version=version where id=$1",[f.admissionId]);
    vi.spyOn(database,"withTransaction").mockImplementationOnce(fn=>drizzle(signer,{schema}).transaction(fn));
    stopping=care.stopClinicalOrder(f.dc(),{orderId:order.id,reason:"Actual Doctor stop after lock"}); void stopping.catch(()=>{});
    let blocked=false;
    for(let i=0;i<100&&!blocked;i++){blocked=(await runtime.query("select $1::int=any(pg_blocking_pids($2::int)) blocked",[bpid,spid])).rows[0].blocked;if(!blocked)await new Promise(r=>setTimeout(r,10));}
    expect(blocked).toBe(true);
    const actual=new Date().toISOString();
    // Keep the real lock held until Date's millisecond clock distinguishes the
    // factual pre-stop instant from signing after release; retain strict ordering.
    await vi.waitFor(()=>expect(Date.now()).toBeGreaterThan(Date.parse(actual)),{timeout:1000,interval:1});
    await blocker.query("commit"); await stopping;
    const stop=(await runtime.query("select signed_at from hims.clinical_task_events where order_id=$1 and status='STOPPED'",[order.id])).rows[0].signed_at as Date;
    console.info("Final review real stop barrier",{bpid,spid,blockingObserved:blocked,actual,stop:stop.toISOString()});
    expect(stop.getTime()).toBeGreaterThan(Date.parse(actual));
    const n=f.nc(); await nursing.recordObservation(n,{admissionId:f.admissionId,shiftId:f.shift.id,orderId:order.id,scheduledFor:scheduled,observedAt:actual,values:{pulse:80},requestId:n.requestId});
    const later=f.nc(); await expect(nursing.recordObservation(later,{admissionId:f.admissionId,shiftId:f.shift.id,orderId:order.id,scheduledFor:new Date(Date.parse(scheduled)+60000).toISOString(),observedAt:new Date().toISOString(),values:{pulse:80},requestId:later.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
  } finally { await blocker.query("rollback");await Promise.allSettled([stopping]);await Promise.all([blocker.end(),signer.end()]); }
}));
it("denies generic room reversals under nonzero pinned rates preserving the occupied-time basis",async()=>withTestDatabase(async({runtime})=>{
  const f=await active();
  await database.withTransaction(tx=>reconcileRoomChargesInTransaction(tx,{admissionId:f.admissionId,cutoff:new Date(),actorContext:f.ctx()}));
  const charge=(await runtime.query("select id,amount_paise from hims.charges where admission_id=$1 and source_event_id like 'room:%'",[f.admissionId])).rows[0];
  expect(BigInt(charge.amount_paise)).toBeGreaterThan(0n);
  const c=f.ctx(); await expect(billing.reverseCharge(c,{chargeId:charge.id,amountPaise:"1",reason:"Generic occupied-time waiver",requestId:c.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
  expect((await runtime.query("select count(*)::int n from hims.charge_reversals where charge_id=$1",[charge.id])).rows[0].n).toBe(0);
}));
it.each(["DEATH","EXTERNAL_TRANSFER","AGAINST_ADVICE","CREDIT"])("rejects selected Doctor actual fact after Nurse actual exit while permitting later retrospective signing: %s",async type=>withTestDatabase(async({runtime})=>{
  const f=await active(), exit=new Date().toISOString();
  const physical=await exceptions.recordExceptionEvidence(f.nc(),{admissionId:f.admissionId,kind:"PHYSICAL_EXIT",shiftId:f.shift.id,actualAt:exit,vacatedAt:exit,notes:"Actual departed event"});
  const after=new Date().toISOString();
  const doctor=await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:type==="CREDIT"?"PLANNED_EXIT":type,actualAt:after,notes:"Fact actually after supplied exit"});
  const a=await authority(f,type,[physical.id,doctor.id]);
  const before=(await runtime.query("select count(*)::int n from hims.exceptional_departures")).rows[0].n;
  await expect(exceptions.recordExceptionalDeparture(f.admin(),{admissionId:f.admissionId,exceptionId:a.id,physicalEvidenceId:physical.id})).rejects.toMatchObject({code:"PRECONDITION"});
  expect((await runtime.query("select count(*)::int n from hims.exceptional_departures")).rows[0].n).toBe(before);
  const earlier=await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:type==="CREDIT"?"PLANNED_EXIT":type,actualAt:exit,notes:"Legitimate earlier actual fact signed retrospectively"});
  expect((await runtime.query("select signed_at from hims.exception_evidence where id=$1",[earlier.id])).rows[0].signed_at.getTime()).toBeGreaterThan(Date.parse(exit));
  const valid=await authority(f,type,[physical.id,earlier.id]);
  expect((await exceptions.recordExceptionalDeparture(f.admin(),{admissionId:f.admissionId,exceptionId:valid.id,physicalEvidenceId:physical.id})).id).toBeDefined();
  expect((await runtime.query("select count(*)::int n from hims.exception_evidence where id=$1",[doctor.id])).rows[0].n).toBe(1);
}));
it("cannot use an old planned exit while an uncancelled return instruction remains current",async()=>withTestDatabase(async()=>{
  const f=await active(), plan=await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:"PLANNED_EXIT",actualAt:new Date().toISOString(),notes:"Original intended exit"});
  const v=await vacancy(f), instruction=await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:"RETURN_TO_BED",sourceId:v.id,actualAt:new Date().toISOString(),notes:"Actual later clinical return instruction"});
  await expect(authority(f,"CREDIT",[plan.id])).rejects.toMatchObject({code:"PRECONDITION"});
  await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:"RETURN_CANCELLED",sourceId:instruction.id,actualAt:new Date().toISOString(),notes:"Source-bound clinical reconsideration"});
  expect((await authority(f,"CREDIT",[plan.id])).id).toBeDefined();
}));
it("rechecks a newly pending return after Admin authority without fabricating advice for EARLY_EXIT",async()=>withTestDatabase(async({runtime})=>{
  const f=await active(),plan=await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:"PLANNED_EXIT",actualAt:new Date().toISOString(),notes:"Original intended exit"}),v=await vacancy(f);
  const original=(await runtime.query("select vacated_at from hims.room_vacations where id=$1",[v.id])).rows[0],at=new Date().toISOString(),physical=await exceptions.recordExceptionEvidence(f.nc(),{admissionId:f.admissionId,kind:"PHYSICAL_EXIT",shiftId:f.shift.id,actualAt:at,vacatedAt:original.vacated_at.toISOString(),notes:"Actual unplanned exit despite pending return"});
  const a=await authority(f,"CREDIT",[plan.id,physical.id]);
  await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:"RETURN_TO_BED",sourceId:v.id,actualAt:new Date().toISOString(),notes:"Later actual return instruction"});
  await expect(exceptions.recordExceptionalDeparture(f.admin(),{admissionId:f.admissionId,exceptionId:a.id,physicalEvidenceId:physical.id})).rejects.toMatchObject({code:"PRECONDITION"});
  const truthful=await authority(f,"EARLY_EXIT",[physical.id]);expect((await exceptions.recordExceptionalDeparture(f.admin(),{admissionId:f.admissionId,exceptionId:truthful.id,physicalEvidenceId:physical.id})).id).toBeDefined();
}));
it("requires a fresh planned exit after an actual attributable return to bed",async()=>withTestDatabase(async({runtime})=>{
  const f=await active(),plan=await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:"PLANNED_EXIT",actualAt:new Date().toISOString(),notes:"Old plan before actual return"}),v=await vacancy(f);
  const instruction=await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:"RETURN_TO_BED",sourceId:v.id,actualAt:new Date().toISOString(),notes:"Actual return instruction"});
  const a=await exceptions.authorizeException(f.admin(),{admissionId:f.admissionId,type:"RETURN_TO_BED",disposition:"RETURN_TO_BED",authority:"Actual Admin routing",reason:"Record real professional return",evidenceIds:[instruction.id],evidence:"Actual Doctor instruction",followUpOwnerId:f.nurse.id});
  const turnover=(await runtime.query("select id from hims.bed_turnovers where admission_id=$1",[f.admissionId])).rows[0],clean=f.admin();
  await discharge.completeBedTurnover(clean,{turnoverId:turnover.id,completedAt:new Date().toISOString(),evidence:"Actual cleaned bed",requestId:clean.requestId});
  const handover=await exceptions.recordExceptionEvidence(f.nc(),{admissionId:f.admissionId,kind:"RETURN_HANDOVER",sourceId:v.id,shiftId:f.shift.id,actualAt:new Date().toISOString(),notes:"Actual return to cleaned bed"});
  await exceptions.returnToBed(f.nc(),{admissionId:f.admissionId,exceptionId:a.id,doctorEvidenceId:instruction.id,nurseEvidenceId:handover.id});
  await expect(authority(f,"CREDIT",[plan.id])).rejects.toMatchObject({code:"PRECONDITION"});
  const fresh=await exceptions.recordExceptionEvidence(f.dc(),{admissionId:f.admissionId,kind:"PLANNED_EXIT",actualAt:new Date().toISOString(),notes:"Fresh appropriate review after actual return"});
  expect((await authority(f,"CREDIT",[fresh.id])).id).toBeDefined();
}));
it("cannot withdraw a retained Nurse factual transfer handover before delayed recording",async()=>withTestDatabase(async({runtime})=>{
  const f=await active(),c=f.dc(),order=await care.orderTransfer(c,{admissionId:f.admissionId,destinationCategory:"GENERAL",reason:"Current original move",requestId:c.requestId});
  await exceptions.recordExceptionEvidence(f.nc(),{admissionId:f.admissionId,kind:"TRANSFER_HANDOVER",sourceId:order.id,shiftId:f.shift.id,actualAt:new Date().toISOString(),notes:"Actual move witnessed before recording"});
  const cancel=f.dc();await expect(care.cancelTransferOrder(cancel,{admissionId:f.admissionId,transferOrderId:order.id,reason:"Cannot erase witnessed move",requestId:cancel.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
  await expect(runtime.query("insert into hims.transfer_order_cancellations(admission_id,transfer_order_id,reason,signed_by) values($1,$2,'Cannot bypass original Nurse fact',$3)",[f.admissionId,order.id,f.doctor.id])).rejects.toMatchObject({code:"23514"});
  expect((await care.getCare(f.dc(),f.admissionId)).transferOrders.find(o=>o.id===order.id)?.status).toBe("WITNESSED");
}));
it("withdraws only the current unperformed Doctor transfer with immutable reason and shared discharge state",async()=>withTestDatabase(async({runtime})=>{
  const f=await active(), c=f.dc();
  const order=await care.orderTransfer(c,{admissionId:f.admissionId,destinationCategory:"GENERAL",reason:"Actual proposed transfer",requestId:c.requestId});
  const cancel=f.dc(), input={admissionId:f.admissionId,transferOrderId:order.id,reason:"Doctor reassessed destination",requestId:cancel.requestId};
  const result=await care.cancelTransferOrder(cancel,input);
  expect(await care.cancelTransferOrder(cancel,input)).toEqual(result);
  const chart=await care.getCare(f.dc(),f.admissionId);
  expect(chart.transferOrders.find(o=>o.id===order.id)?.status).toBe("CANCELLED");
  expect(chart.transferCancellations).toHaveLength(1);
  expect(chart.transferCancellations[0]).toMatchObject({transferOrderId:order.id,signedBy:f.doctor.id,reason:input.reason});
  await care.signClinicalSummary(f.dc(),{admissionId:f.admissionId,expectedVersion:0,diagnosis:"Synthetic diagnosis",course:"Synthetic course",condition:"Stable",followUp:"Synthetic follow-up",advice:"Synthetic advice",prescriptionOrderIds:[]});
  expect((await discharge.getClearanceReview(f.dc(),f.admissionId,"DOCTOR")).blockers.some(b=>b.includes("transfer order"))).toBe(false);
  const bed=await createBed(f.admin(),{label:"Synthetic cancelled destination",category:"GENERAL",reason:"Synthetic transfer test"}), n=f.nc();
  await expect(transferAdmission(n,{admissionId:f.admissionId,transferOrderId:order.id,targetBedId:bed.id,transferredAt:new Date().toISOString(),handover:{shiftId:f.shift.id,notes:"Cannot reuse cancelled order"},requestId:n.requestId})).rejects.toMatchObject({code:"CONFLICT"});
  await expect(runtime.query("update hims.transfer_order_cancellations set reason='Silent replacement' where id=$1",[result.id])).rejects.toThrow();
}));
it("amends a closed non-room charge by bounded source reversal while retaining receipts and documents",async()=>withTestDatabase(async({runtime})=>{
  const f=await active(); await f.setting({type:"billable-item",code:"FINAL_CONSULT",name:"Original consultation",category:"consultation",department:"DOCTOR",unit:"visit",quantityScale:0,active:true,amount:"100"});
  const r=f.dc(); await care.recordRound(r,{admissionId:f.admissionId,notes:"Actual retained consultation",orders:[],feeScheduleId:"FINAL_CONSULT",feeUnit:"visit",requestId:r.requestId});
  await earlyExit(f);
  const original=(await runtime.query("select * from hims.charges where admission_id=$1 and category='consultation'",[f.admissionId])).rows[0], cash=(await runtime.query("select * from hims.receipts where admission_id=$1",[f.admissionId])).rows;
  await expect(runtime.query("insert into hims.charge_reversals(charge_id,amount_paise,reason,actor_type,actor_id) values($1,1,'Native closed financial bypass','staff',$2)",[original.id,f.cashier.id])).rejects.toMatchObject({code:"23514"});
  const a=await correctionAuthority(f,"REVERSE_CHARGE",original.id), before=await billing.getBill(f.ctx(),f.admissionId), ctx=f.ctx(), copy=await originalCopy(f);
  await runtime.query("begin");try{
    await runtime.query("insert into hims.charge_reversals(charge_id,amount_paise,reason,actor_type,actor_id,correction_exception_id) values($1,1,'Naked effect without persisted amendment','staff',$2,$3)",[original.id,f.cashier.id,a.id]);
    await expect(runtime.query("commit")).rejects.toMatchObject({code:"23514"});
  }finally{await runtime.query("rollback");}
  const v={admissionId:f.admissionId,exceptionId:a.id,kind:"REVERSE_CHARGE",sourceId:original.id,data:{amountPaise:"2500",reason:"Original overcharge review",expectedBillVersion:before.revision}};
  const amendment=await exceptions.applyPostDischargeCorrection(ctx,v); expect(await exceptions.applyPostDischargeCorrection(ctx,v)).toEqual(amendment);
  expect((await billing.getBill(f.ctx(),f.admissionId)).netPaise).toBe(before.netPaise-2500n);
  expect((await runtime.query("select * from hims.charges where id=$1",[original.id])).rows[0]).toEqual(original);
  expect((await runtime.query("select * from hims.receipts where admission_id=$1",[f.admissionId])).rows).toEqual(cash);
  await amendedCopy(f,copy,amendment.id,before.netPaise-2500n);
  await expect(exceptions.applyPostDischargeCorrection(f.dc(),v)).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(exceptions.applyPostDischargeCorrection(f.ctx(),v)).rejects.toMatchObject({code:"CONFLICT"});
  const remaining=await correctionAuthority(f,"REVERSE_CHARGE",original.id), current=await billing.getBill(f.ctx(),f.admissionId);
  await expect(exceptions.applyPostDischargeCorrection(f.ctx(),{...v,exceptionId:remaining.id,data:{...v.data,amountPaise:"7501",expectedBillVersion:current.revision}})).rejects.toMatchObject({code:"PRECONDITION"});
}));
it.each(["consultation","consumable"] as const)("prices only retained performed %s after exceptional exit with original role source and fresh authority",async category=>withTestDatabase(async({runtime})=>{
  const f=await active();
  let sourceId:string;
  if(category==="consultation") { const r=f.dc();sourceId=(await care.recordRound(r,{admissionId:f.admissionId,notes:"Actual retained consultation with missing price",orders:[],feeScheduleId:"FINAL_ITEM",feeUnit:"unit",requestId:r.requestId})).id; }
  else sourceId=(await nursing.recordConsumable(f.nc(),{admissionId:f.admissionId,shiftId:f.shift.id,usedAt:new Date().toISOString(),itemId:"FINAL_ITEM",quantity:"2",unit:"unit",reason:"Actual retained consumed units"})).id;
  await earlyExit(f);
  const price=await f.setting({type:"billable-item",code:"FINAL_ITEM",name:"Original unpriced actual work",category,department:category==="consultation"?"DOCTOR":"NURSE",unit:"unit",quantityScale:0,active:true,amount:"100"});
  const a=await correctionAuthority(f,"CARE_BILLING",sourceId), before=await billing.getBill(f.ctx(),f.admissionId), ctx=category==="consultation"?f.dc():f.nc(), wrong=category==="consultation"?f.nc():f.dc(),copy=await originalCopy(f);
  const v={admissionId:f.admissionId,exceptionId:a.id,kind:"CARE_BILLING",sourceId,data:{sourceEventId:sourceId,reason:"Resolve original retained fee",expectedBillVersion:before.revision}};
  await expect(exceptions.applyPostDischargeCorrection(wrong,v)).rejects.toMatchObject({code:"FORBIDDEN"});
  await expect(exceptions.applyPostDischargeCorrection(ctx,{...v,data:{...v.data,sourceEventId:crypto.randomUUID()}})).rejects.toMatchObject({code:"VALIDATION"});
  const properActor=category==="consultation"?f.doctor.id:f.nurse.id,wrongActor=category==="consultation"?f.nurse.id:f.doctor.id,quantity=category==="consultation"?1:2;
  for(const fault of ["quantity","role","authority","result"]) {
    await runtime.query("begin");try {
      await runtime.query("update hims.care_billing_events set tariff_version_id=$2,state='READY' where id=$1",[sourceId,price.id]);
      const units=fault==="quantity"?quantity+1:quantity;
      const insert=()=>runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id,correction_exception_id) values($1,$2,'Native original-source proof',$3,'FINAL_ITEM','Retained actual source',$4,'unit',$5,10000,$6,'FINAL','staff',$7,$8)",[f.admissionId,sourceId,category,String(units),price.id,units*10000,fault==="role"?wrongActor:properActor,fault==="authority"?null:a.id]);
      if(fault==="result") {await insert();await expect(runtime.query("commit")).rejects.toMatchObject({code:"23514"});}
      else await expect(insert()).rejects.toMatchObject({code:"23514"});
    }finally{await runtime.query("rollback");}
  }
  const amendment=await exceptions.applyPostDischargeCorrection(ctx,v);expect(await exceptions.applyPostDischargeCorrection(ctx,v)).toEqual(amendment);
  const after=await billing.getBill(f.ctx(),f.admissionId);expect(after.netPaise-before.netPaise).toBe(category==="consultation"?10000n:20000n);
  expect((await runtime.query("select quantity,state from hims.care_billing_events where id=$1",[sourceId])).rows[0]).toMatchObject({quantity:category==="consultation"?"1":"2",state:"POSTED"});
  expect((await runtime.query("select count(*)::int n from hims.charges where admission_id=$1 and source_event_id=$2",[f.admissionId,sourceId])).rows[0].n).toBe(1);
  await amendedCopy(f,copy,amendment.id,after.netPaise);
  await expect(exceptions.applyPostDischargeCorrection(category==="consultation"?f.dc():f.nc(),v)).rejects.toMatchObject({code:"CONFLICT"});
}));
it("routes a summary-only Pharmacy work row to its authorized discharge review",async()=>withTestDatabase(async()=>{
  const f=await active();
  await care.signClinicalSummary(f.dc(),{admissionId:f.admissionId,expectedVersion:0,diagnosis:"Synthetic diagnosis",course:"Synthetic course",condition:"Stable",followUp:"Synthetic follow-up",advice:"Synthetic advice",prescriptionOrderIds:[]});
  const row=(await getStaffWorklist(staffContext(f.pharmacy,"synthetic"))).episodes.find(e=>e.id===f.admissionId);
  expect(row?.href).toBe(`/discharge?admissionId=${f.admissionId}`);
  expect((await discharge.getClearanceReview(staffContext(f.pharmacy,"synthetic"),f.admissionId,"PHARMACY")).gate).toBe("PHARMACY");
  await f.setting({type:"billable-item",code:"FINAL_HOME",name:"Original take-home medicine",category:"medicine",department:"PHARMACY",unit:"tablet",quantityScale:0,amount:"10",active:true});
  const c=f.dc();await care.recordRound(c,{admissionId:f.admissionId,notes:"Actual take-home-only instruction",orders:[{kind:"MEDICINE",requestedItem:"Original take-home medicine",itemId:"FINAL_HOME",medicationPurpose:"TAKE_HOME",dose:"5",doseUnit:"mg",route:"oral",frequency:"Original human directions",durationDays:1,dispensingQuantity:"2",dispensingUnit:"tablet"}],requestId:c.requestId});
  const order=(await care.getCare(f.dc(),f.admissionId)).orders[0];await care.signClinicalSummary(f.dc(),{admissionId:f.admissionId,expectedVersion:1,diagnosis:"Synthetic diagnosis",course:"Synthetic course",condition:"Stable",followUp:"Synthetic follow-up",advice:"Synthetic advice",prescriptionOrderIds:[order.id]});
  expect((await getStaffWorklist(staffContext(f.pharmacy,"synthetic"))).episodes.find(e=>e.id===f.admissionId)?.href).toBe(`/pharmacy?admissionId=${f.admissionId}`);
  const pharmacy=await import("../../src/server/pharmacy/commands");expect((await pharmacy.getPharmacyReview(staffContext(f.pharmacy,"synthetic"),f.admissionId)).prescription?.prescription).toHaveLength(1);
}));
it("retains withdrawal but recovers only a genuinely earlier actual transfer through source-bound Admin review",async()=>withTestDatabase(async({runtime})=>{
  const f=await active(), target=await createBed(f.admin(),{label:"Synthetic late factual destination",category:"GENERAL",reason:"Actual available target"}), c=f.dc();
  const order=await care.orderTransfer(c,{admissionId:f.admissionId,destinationCategory:"GENERAL",reason:"Original transfer authority",requestId:c.requestId});
  const actual=new Date().toISOString(), cancel=f.dc();
  const withdrawn=await care.cancelTransferOrder(cancel,{admissionId:f.admissionId,transferOrderId:order.id,reason:"Doctor unaware of earlier actual move",requestId:cancel.requestId});
  await expect(exceptions.recordExceptionEvidence(f.nc(),{admissionId:f.admissionId,kind:"TRANSFER_HANDOVER",sourceId:order.id,shiftId:f.shift.id,actualAt:new Date().toISOString(),notes:"Cannot move prospectively after withdrawal"})).rejects.toMatchObject({code:"PRECONDITION"});
  const witness=await exceptions.recordExceptionEvidence(f.nc(),{admissionId:f.admissionId,kind:"TRANSFER_HANDOVER",sourceId:order.id,shiftId:f.shift.id,actualAt:actual,notes:"Actual move occurred before later withdrawal"});
  const a=await exceptions.authorizeException(f.admin(),{admissionId:f.admissionId,type:"DELAYED_TRANSFER",disposition:"TRANSFER",authority:"Source-bound Admin factual recovery",reason:"Retain real earlier move and later withdrawal",evidence:"Actual original Nurse handover",evidenceIds:[witness.id],followUpOwnerId:f.nurse.id});
  await exceptions.applyDelayedTransfer(f.admin(),{admissionId:f.admissionId,exceptionId:a.id,evidenceId:witness.id,targetBedId:target.id});
  expect((await runtime.query("select * from hims.transfer_order_cancellations where id=$1",[withdrawn.id])).rows[0]).toMatchObject({transfer_order_id:order.id});
  expect((await runtime.query("select transferred_at from hims.admission_transfers where transfer_order_id=$1",[order.id])).rows[0].transferred_at.toISOString()).toBe(actual);
  expect((await care.getCare(f.dc(),f.admissionId)).transferOrders.find(o=>o.id===order.id)?.status).toBe("COMPLETED");
}));
it.each(["withdrawal","transfer"] as const)("serializes actual transfer versus withdrawal with observed admission ownership: %s first",async winner=>withTestDatabase(async({runtime})=>{
  const f=await active(),target=await createBed(f.admin(),{label:"Synthetic contention destination",category:"GENERAL",reason:"Synthetic target"}),c=f.dc(),order=await care.orderTransfer(c,{admissionId:f.admissionId,destinationCategory:"GENERAL",reason:"Actual current transfer",requestId:c.requestId});
  const first=new Client({connectionString:testUrl}),second=new Client({connectionString:testUrl});await Promise.all([first.connect(),second.connect()]);
  let release=()=>{},ready=()=>{};const held=new Promise<void>(r=>release=r),acquired=new Promise<void>(r=>ready=r);let winning:Promise<unknown>|undefined,losing:Promise<unknown>|undefined;
  const withdraw=()=>{const ctx=f.dc();return care.cancelTransferOrder(ctx,{admissionId:f.admissionId,transferOrderId:order.id,reason:"Doctor actual reconsideration",requestId:ctx.requestId});};
  const transfer=()=>{const ctx=f.nc();return transferAdmission(ctx,{admissionId:f.admissionId,transferOrderId:order.id,targetBedId:target.id,transferredAt:new Date().toISOString(),handover:{shiftId:f.shift.id,notes:"Actual signed move"},requestId:ctx.requestId});};
  try {
    const p1=(await first.query("select pg_backend_pid() pid")).rows[0].pid,p2=(await second.query("select pg_backend_pid() pid")).rows[0].pid;
    vi.spyOn(database,"withTransaction").mockImplementationOnce(fn=>drizzle(first,{schema}).transaction(async tx=>{const result=await fn(tx);ready();await held;return result;})).mockImplementationOnce(fn=>drizzle(second,{schema}).transaction(fn));
    winning=winner==="withdrawal"?withdraw():transfer();void winning.catch(()=>ready());await acquired;
    losing=(winner==="withdrawal"?transfer():withdraw()).catch(e=>e);
    let blocked=false;for(let i=0;i<100&&!blocked;i++){blocked=(await runtime.query("select $1::int=any(pg_blocking_pids($2::int)) blocked",[p1,p2])).rows[0].blocked;if(!blocked)await new Promise(r=>setTimeout(r,10));}
    expect(blocked).toBe(true);console.info("Final transfer withdrawal contention",{winner,p1,p2,blockingObserved:blocked});release();await winning;
    expect(await losing).toMatchObject({code:winner==="withdrawal"?"CONFLICT":"PRECONDITION"});
    const counts=(await runtime.query("select (select count(*) from hims.transfer_order_cancellations where transfer_order_id=$1)::int cancellations,(select count(*) from hims.admission_transfers where transfer_order_id=$1)::int transfers",[order.id])).rows[0];
    expect(counts).toEqual(winner==="withdrawal"?{cancellations:1,transfers:0}:{cancellations:0,transfers:1});
  }finally{release();await Promise.allSettled([winning,losing]);await Promise.all([first.end(),second.end()]);}
}));
