import { afterEach, describe, expect, it } from "vitest";
import { withTestDatabase } from "../../scripts/test-database";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { billingFixture } from "../support/billing-fixture";
import { staffContext, requireStaff } from "../../src/server/access";
import { createStaff } from "../../src/server/staff";
import { getAuth } from "../../src/server/auth";
import { rename } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/server/schema";
loadLocalEnvironment();
const appUrl=process.env.DATABASE_URL,testUrl=getTestDatabaseConfig().runtimeUrl;
afterEach(()=>{process.env.DATABASE_URL=appUrl;delete process.env.HIMS_INSURANCE_MAX_BYTES;});
process.env.BETTER_AUTH_URL="http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET="SyntheticInsuranceOnlySecretAtLeast32Characters12345";
process.env.HIMS_INSURANCE_STORAGE="synthetic";
async function fixture(){
  process.env.DATABASE_URL=testUrl;
  const f=await billingFixture();await createStaff(f.ah,{name:"Synthetic insurance",email:"insurance@billing.invalid",password:"SyntheticBillingOnly123!",role:"INSURANCE",reason:"Synthetic insurance fixture"});
  const login=await getAuth().api.signInEmail({asResponse:true,body:{email:"insurance@billing.invalid",password:"SyntheticBillingOnly123!"}});
  const insurance=await requireStaff(new Headers({cookie:login.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ")}));
  const insuranceCommands=await import("../../src/server/insurance/commands");
  const e=await f.episode("INSURED"),ac=()=>staffContext(f.admin,"synthetic-insurance-admin"),ic=()=>staffContext(insurance,"synthetic-insurance");
  const c=ac(),created=await insuranceCommands.createInsuranceCase(c,{admissionId:e.admissionId,assignedStaffId:insurance.id,reason:"Insured admission staff assignment",requestId:c.requestId});
  return {...f,insurance,insuranceCommands,ac,ic,caseId:created.id,admissionId:e.admissionId};
}
describe("assigned insurance decisions and protected records",()=>{
  it("versions external provenance and responsibility, preserves authorization without cash and rejects stale bill allocations",async()=>withTestDatabase(async({owner,runtime})=>{
    const f=await fixture(),m=f.insuranceCommands;
    const p=f.ic();await m.recordPolicyVerification(p,{caseId:f.caseId,expectedCaseVersion:1,requestId:p.requestId,insurer:"Synthetic insurer",tpa:"Synthetic TPA",policyNumber:"POL-1",memberNumber:"MEM-1",validFrom:"2026-01-01",validTo:"2027-01-01",verifiedBy:"External desk",verifiedAt:new Date().toISOString(),reference:"VERIFY-1",documentIds:[]});
    // Actual performed non-room work supplies the original bill and linked correction.
    await f.setting({type:"deposit",category:"GENERAL",route:"insured",requirement:"not-required",amount:"0"});
    await f.setting({type:"tariff",category:"GENERAL",amount:"0",basis:"hour",rounding:"exact",graceMinutes:0});
    await f.setting({type:"billable-item",code:"INSURANCE_CONSULT",name:"Actual synthetic consultation",category:"consultation",department:"DOCTOR",unit:"visit",quantityScale:0,amount:"115000",active:true});
    const activation=f.deskCtx();await (await import("../../src/server/admissions/commands")).activateAdmission(activation,{admissionId:f.admissionId,arrivedAt:new Date().toISOString(),expectedVersion:1,requestId:activation.requestId});
    const care=await import("../../src/server/clinical/commands"),billing=await import("../../src/server/billing/commands");
    const round=staffContext(f.doctor,"synthetic-insurance-consult");await care.recordRound(round,{admissionId:f.admissionId,notes:"Actual consultation before payer responsibility review",orders:[],feeScheduleId:"INSURANCE_CONSULT",feeUnit:"visit",requestId:round.requestId});
    const originalCharge=(await runtime.query("select id from hims.charges where admission_id=$1 and item_id='INSURANCE_CONSULT'",[f.admissionId])).rows[0];
    const originalBill=await billing.getBill(f.ctx(),f.admissionId);
    const d=f.ic(),v={caseId:f.caseId,expectedCaseVersion:2,requestId:d.requestId,status:"APPROVED",kind:"PREAUTH",verifiedBy:"Insurer verifier",verifiedAt:new Date().toISOString(),reference:"AUTH-1",reason:"External written approval",approvedPaise:"9000000",coPayBps:1000,documentIds:[],allocation:{billRevision:originalBill.revision,netBillPaise:"11500000",eligibleBillPaise:"10000000",nonPayablePaise:"1500000",sourceReference:"Reviewed original consultation bill"}};
    const decision=await m.recordPayerDecision(d,v);expect(await m.recordPayerDecision(d,v)).toEqual(decision);
    let review=await m.getInsuranceCase(f.ic(),f.caseId);expect(review.responsibility).toMatchObject({insurerPaise:9000000n,patientPaise:2500000n,unallocatedPaise:0n,insurerOutstandingPaise:9000000n});expect(review.money.insurerCashPaise).toBe(0n);
    const stale=f.ic();await expect(m.recordPayerDecision(stale,{...v,requestId:stale.requestId})).rejects.toMatchObject({code:"CONFLICT"});
    const partial=f.ic();await m.recordPayerDecision(partial,{...v,status:"PARTIAL",kind:"ENHANCEMENT",approvedPaise:"5000000",expectedCaseVersion:3,requestId:partial.requestId});review=await m.getInsuranceCase(f.ic(),f.caseId);expect(review.responsibility?.unallocatedPaise).toBe(4000000n);expect(review.decisions).toHaveLength(2);
    await owner.query("update hims.admissions set bill_revision=bill_revision+1 where id=$1",[f.admissionId]);expect((await m.getInsuranceCase(f.ic(),f.caseId)).responsibility?.stale).toBe(false);
    // A changed source must require review even when the posted monetary total is unchanged.
    await f.setting({type:"billable-item",code:"INSURANCE_CONSULT",name:"Actual configured zero-price follow-up",category:"consultation",department:"DOCTOR",unit:"visit",quantityScale:0,amount:"0",active:true});
    const followUp=staffContext(f.doctor,"synthetic-insurance-consult");await care.recordRound(followUp,{admissionId:f.admissionId,notes:"Actual configured zero-price follow-up changes the source without changing the total",orders:[],feeScheduleId:"INSURANCE_CONSULT",feeUnit:"visit",requestId:followUp.requestId});
    const changedSource=await m.getInsuranceCase(f.ic(),f.caseId);expect(changedSource.money.netPaise).toBe(11500000n);expect(changedSource.responsibility?.stale).toBe(true);
    const correction=f.ctx();await billing.reverseCharge(correction,{chargeId:originalCharge.id,amountPaise:"1",reason:"Actual linked original non-room correction",requestId:correction.requestId});expect((await m.getInsuranceCase(f.ic(),f.caseId)).responsibility?.stale).toBe(true);
    const b=f.ic();await expect(m.recordPayerDecision(b,{...v,expectedCaseVersion:4,requestId:b.requestId})).rejects.toMatchObject({code:"CONFLICT"});
    await expect(runtime.query("update hims.insurance_decisions set reference='overwrite' where id=$1",[decision.id])).rejects.toThrow();
    const r=f.ac();await m.assignInsuranceCase(r,{caseId:f.caseId,assignedStaffId:null,expectedCaseVersion:4,reason:"Assignment revoked",requestId:r.requestId});
    await expect(m.getInsuranceCase(f.ic(),f.caseId)).rejects.toMatchObject({code:"FORBIDDEN"});await expect(m.recordPayerDecision(d,v)).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect((await import("../../src/server/billing/commands")).getBill(f.ic(),f.admissionId)).rejects.toMatchObject({code:"FORBIDDEN"});
  }));
  it("requires complete explicit conversion, retains cash and history, and rechecks roles on successful retries",async()=>withTestDatabase(async({owner})=>{
    const f=await fixture(),m=f.insuranceCommands;
    const c=f.ac(),v={caseId:f.caseId,reason:"Staff decision following external denial",decisionReference:"DENIED-1",verifiedBy:"External insurer desk",verifiedAt:new Date().toISOString(),allocation:{billRevision:1,netBillPaise:"0",verifiedPatientLiabilityPaise:"0",retainedInsurerLiabilityPaise:"0",sourceReference:"Denial and financial responsibility verified"},expectedCaseVersion:1,requestId:c.requestId};
    const result=await m.convertToSelfPay(c,v);expect(await m.convertToSelfPay(c,v)).toEqual(result);const review=await m.getInsuranceCase(f.ac(),f.caseId);expect(review.episode.paymentRoute).toBe("SELF_PAY");expect(review.conversion?.reason).toBe(v.reason);expect(review.responsibility?.unallocatedPaise).toBe(0n);expect(review.case.reviewRevision).toBe(2);
    const stale=f.ac();await expect(m.convertToSelfPay(stale,{...v,requestId:stale.requestId})).rejects.toMatchObject({code:"CONFLICT"});
    await owner.query("update hims.staff_user set role='NURSE' where id=$1",[f.admin.id]);await expect(m.convertToSelfPay(c,v)).rejects.toMatchObject({code:"FORBIDDEN"});
  }));
  it("validates protected file bytes, replacements, case access and unavailable-file retries",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture(),d=await import("../../src/server/insurance/documents");const bytes=Buffer.from("%PDF-1.4\nSynthetic only\n%%EOF");const file=new File([bytes],"policy.pdf",{type:"application/pdf"});
    const c=f.ic(),v={caseId:f.caseId,file,expectedCaseVersion:1,requestId:c.requestId};const one=await d.attachCaseDocument(c,v);expect(await d.attachCaseDocument(c,v)).toEqual(one);expect((await d.downloadCaseDocument(f.ic(),f.caseId,one.id)).bytes).toEqual(bytes);
    const other=f.ac();const otherEpisode=await f.episode("INSURED");const oc=await f.insuranceCommands.createInsuranceCase(other,{admissionId:otherEpisode.admissionId,assignedStaffId:f.insurance.id,reason:"Another synthetic case",requestId:other.requestId});await expect(d.downloadCaseDocument(f.ic(),oc.id,one.id)).rejects.toMatchObject({code:"FORBIDDEN"});
    for(const bad of [new File([bytes],"../policy.pdf",{type:"application/pdf"}),new File(["not a pdf"],"bad.pdf",{type:"application/pdf"}),new File([bytes],"bad.html",{type:"text/html"})]){const b=f.ic();await expect(d.attachCaseDocument(b,{...v,file:bad,expectedCaseVersion:2,requestId:b.requestId})).rejects.toThrow();}
    process.env.HIMS_INSURANCE_MAX_BYTES="1024";const big=f.ic();await expect(d.attachCaseDocument(big,{...v,file:new File([Buffer.alloc(1025)],"big.pdf",{type:"application/pdf"}),expectedCaseVersion:2,requestId:big.requestId})).rejects.toThrow(/size/i);delete process.env.HIMS_INSURANCE_MAX_BYTES;
    const replace=f.ic();await d.attachCaseDocument(replace,{...v,expectedCaseVersion:2,replacesDocumentId:one.id,requestId:replace.requestId});expect((await f.insuranceCommands.getInsuranceCase(f.ic(),f.caseId)).case.documentSetRevision).toBe(2);expect((await d.downloadCaseDocument(f.ic(),f.caseId,one.id)).bytes).toEqual(bytes);
    const key=(await runtime.query("select storage_key from hims.insurance_documents where id=$1",[one.id])).rows[0].storage_key,path=resolve(d.insuranceStorageDirectory(),`${key}.bin`);expect(path).toContain("insurance-test-storage");
    await rename(path,`${path}.missing`);try{await expect(d.attachCaseDocument(c,v)).rejects.toMatchObject({code:"PRECONDITION"});await expect(d.downloadCaseDocument(f.ic(),f.caseId,one.id)).rejects.toMatchObject({code:"PRECONDITION"});}finally{await rename(`${path}.missing`,path);}
    const db=await import("../../src/server/db"),failed=f.ic();await expect(db.withTransaction(async tx=>{await d.attachCaseDocumentInTransaction(tx,failed,{...v,expectedCaseVersion:3,requestId:failed.requestId});throw Error("Synthetic transaction rollback");})).rejects.toThrow("Synthetic transaction rollback");expect((await f.insuranceCommands.getInsuranceCase(f.ic(),f.caseId)).documents).toHaveLength(2);
    await d.attachCaseDocument(failed,{...v,expectedCaseVersion:3,requestId:failed.requestId});expect((await f.insuranceCommands.getInsuranceCase(f.ic(),f.caseId)).documents).toHaveLength(3);
    const revoked=f.ac();await f.insuranceCommands.assignInsuranceCase(revoked,{caseId:f.caseId,assignedStaffId:null,expectedCaseVersion:4,reason:"Revoked material access",requestId:revoked.requestId});await expect(d.attachCaseDocument(c,v)).rejects.toMatchObject({code:"FORBIDDEN"});await expect(d.downloadCaseDocument(f.ic(),f.caseId,one.id)).rejects.toMatchObject({code:"FORBIDDEN"});
    const restore=f.ac();await f.insuranceCommands.assignInsuranceCase(restore,{caseId:f.caseId,assignedStaffId:f.insurance.id,expectedCaseVersion:5,reason:"Assignment restored explicitly",requestId:restore.requestId});expect((await d.downloadCaseDocument(f.ic(),f.caseId,one.id)).bytes).toEqual(bytes);
  }));
  it("retains insurer cash on conversion and settles self-pay without invalidating the allocation merely for cash",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture(),m=f.insuranceCommands,b=await import("../../src/server/billing/commands");
    await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) values($1,'synthetic-paid-bill','synthetic','room','GENERAL','Synthetic bill','1','hour',$2,100000,100000,'FINAL','staff',$3)",[f.admissionId,f.room.id,f.cashier.id]);
    const receipt=f.ctx();await b.recordReceipt(receipt,{admissionId:f.admissionId,party:"INSURER",kind:"PAYMENT",amountPaise:"40000",mode:"BANK",channel:"Synthetic insurer book",sourceReference:"Synthetic insurer receipt 1",reference:"Actual staff-recorded cash",requestId:receipt.requestId});
    const ctx=f.ac(),value={caseId:f.caseId,expectedCaseVersion:1,requestId:ctx.requestId,reason:"Verified staff decision resolves remaining payer responsibility",decisionReference:"CONVERT-PAID-1",verifiedBy:"External decision desk",verifiedAt:new Date().toISOString(),allocation:{billRevision:2,netBillPaise:"100000",retainedInsurerLiabilityPaise:"0",verifiedPatientLiabilityPaise:"100000",sourceReference:"Complete responsibility resolution"}};
    await expect(m.convertToSelfPay(ctx,value)).rejects.toMatchObject({code:"PRECONDITION"});
    await m.convertToSelfPay(ctx,{...value,allocation:{...value.allocation,retainedInsurerLiabilityPaise:"40000",verifiedPatientLiabilityPaise:"60000"}});
    expect((await m.getInsuranceCase(f.ac(),f.caseId)).responsibility).toMatchObject({insurerPaise:40000n,patientPaise:60000n,insurerOutstandingPaise:0n,patientOutstandingPaise:60000n});
    const patient=f.ctx();await b.recordReceipt(patient,{admissionId:f.admissionId,party:"PATIENT",kind:"PAYMENT",amountPaise:"60000",mode:"CASH",channel:"Synthetic patient book",sourceReference:"Synthetic patient receipt 1",reference:"Patient settled through existing hospital channel",requestId:patient.requestId});
    const final=await m.getInsuranceCase(f.ac(),f.caseId);expect(final.responsibility).toMatchObject({stale:false,allocationComplete:true,patientOutstandingPaise:0n,insurerOutstandingPaise:0n});expect(final.money.insurerCashPaise).toBe(40000n);expect((await runtime.query("select count(*)::int n from hims.receipts where admission_id=$1",[f.admissionId])).rows[0].n).toBe(2);
  }));
  it("waits behind current assignment changes and rejects a revoked writer on a distinct PostgreSQL connection",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture(),m=f.insuranceCommands,one=new Client({connectionString:testUrl}),two=new Client({connectionString:testUrl});await Promise.all([one.connect(),two.connect()]);
    const pid1=(await one.query("select pg_backend_pid() as pid")).rows[0].pid,pid2=(await two.query("select pg_backend_pid() as pid")).rows[0].pid;expect(pid1).not.toBe(pid2);
    let result:Promise<unknown>|undefined;
    try{await one.query("begin");await one.query("select pg_advisory_xact_lock_shared(729104211)");await one.query("select id from hims.admissions where id=$1 for update",[f.admissionId]);await one.query("update hims.insurance_cases set assigned_staff_id=null,version=version+1 where id=$1",[f.caseId]);
      const c=f.ic();result=drizzle(two,{schema}).transaction(tx=>m.recordPayerDecisionInTransaction(tx,c,{caseId:f.caseId,expectedCaseVersion:1,requestId:c.requestId,status:"PENDING",kind:"PREAUTH",reason:"Waiting on current assignment",verifiedBy:"External desk",verifiedAt:new Date().toISOString(),reference:"WAIT-1",approvedPaise:"0",coPayBps:0,allocation:{billRevision:1,netBillPaise:"0",eligibleBillPaise:"0",nonPayablePaise:"0",sourceReference:"Synthetic bill"},documentIds:[]})).catch(e=>e);
      let blocked=false;for(let i=0;i<100;i++){if((await runtime.query("select $1::int=any(pg_blocking_pids($2)) as blocked",[pid1,pid2])).rows[0].blocked){blocked=true;break;}await new Promise(r=>setTimeout(r,10));}expect(blocked).toBe(true);await one.query("commit");expect(await result).toMatchObject({code:"FORBIDDEN"});expect((await runtime.query("select count(*)::int n from hims.insurance_decisions")).rows[0].n).toBe(0);
    }finally{await one.query("rollback");await result;await Promise.all([one.end(),two.end()]);}
  }));
  it("records rejected decisions and resolves actual insured-transfer work append-only in the care projection",async()=>withTestDatabase(async({runtime})=>{
    const f=await fixture(),m=f.insuranceCommands,a=await import("../../src/server/admissions/commands"),care=await import("../../src/server/clinical/commands"),nursing=await import("../../src/server/nursing/commands");
    await f.setting({type:"deposit",category:"GENERAL",route:"insured",requirement:"not-required",amount:"0"});const activation=f.deskCtx(),startedAt=new Date().toISOString();await a.activateAdmission(activation,{admissionId:f.admissionId,arrivedAt:startedAt,expectedVersion:1,requestId:activation.requestId});
    await nursing.assignNurse(f.ac(),{admissionId:f.admissionId,nurseId:f.nurse.id,reason:"Actual synthetic ward assignment",authority:"Synthetic admin authority"});const nc=()=>staffContext(f.nurse,"synthetic-insurance-transfer"),dc=()=>staffContext(f.doctor,"synthetic-insurance-transfer");const sc=nc(),shift=await nursing.recordShift(sc,{admissionId:f.admissionId,startedAt,handover:"Synthetic incoming care",requestId:sc.requestId});
    const target=await a.createBed(f.ac(),{label:`Synthetic insurance transfer ${crypto.randomUUID()}`,category:"GENERAL",reason:"Synthetic target"});const oc=dc(),order=await care.orderTransfer(oc,{admissionId:f.admissionId,destinationCategory:"GENERAL",reason:"Actual doctor transfer decision",requestId:oc.requestId});const move=nc();await a.transferAdmission(move,{admissionId:f.admissionId,transferOrderId:order.id,targetBedId:target.id,handover:{shiftId:shift.id,notes:"Actual transfer nursing handover"},transferredAt:new Date().toISOString(),requestId:move.requestId});
    expect((await care.getCare(dc(),f.admissionId)).insuranceTransferTasks).toHaveLength(1);
    const p=f.ic();await m.recordPolicyVerification(p,{caseId:f.caseId,expectedCaseVersion:1,requestId:p.requestId,insurer:"Synthetic external insurer",tpa:"",policyNumber:"TRANSFER-POL",memberNumber:"TRANSFER-MEM",validFrom:"2026-01-01",validTo:"2027-01-01",verifiedBy:"External desk",verifiedAt:new Date().toISOString(),reference:"TRANSFER-VERIFY",documentIds:[]});
    const review=await m.getInsuranceCase(f.ic(),f.caseId),d=f.ic(),decision=await m.recordPayerDecision(d,{caseId:f.caseId,expectedCaseVersion:2,requestId:d.requestId,status:"REJECTED",kind:"APPEAL",reason:"External payer denied after transfer",verifiedBy:"External transfer verifier",verifiedAt:new Date().toISOString(),reference:"DENIAL-AFTER-TRANSFER",approvedPaise:"0",coPayBps:0,documentIds:[],allocation:{billRevision:review.money.revision,netBillPaise:review.money.netPaise.toString(),eligibleBillPaise:review.money.netPaise.toString(),nonPayablePaise:"0",sourceReference:"Verified transfer bill allocation"}});
    const r=f.ic();await m.resolveTransferInsuranceTask(r,{caseId:f.caseId,expectedCaseVersion:3,requestId:r.requestId,taskId:review.pendingTransfers[0].id,decisionId:decision.id,verifiedBy:"External transfer verifier",verifiedAt:new Date().toISOString(),reference:"DENIAL-AFTER-TRANSFER",reason:"Staff recorded denial; remaining financial responsibility still separate"});
    expect((await care.getCare(dc(),f.admissionId)).insuranceTransferTasks).toHaveLength(0);expect((await runtime.query("select count(*)::int n from hims.transfer_insurance_tasks where admission_id=$1",[f.admissionId])).rows[0].n).toBe(1);expect((await m.getInsuranceCase(f.ic(),f.caseId)).alerts.some(a=>a.includes("Rejected"))).toBe(true);
    const invalid=f.ic();await expect(m.recordInsuranceFollowup(invalid,{caseId:f.caseId,expectedCaseVersion:4,requestId:invalid.requestId,workId:crypto.randomUUID(),kind:"APPEAL",status:"COMPLETED",reference:"UNKNOWN",reason:"Cannot complete invented work"})).rejects.toMatchObject({code:"PRECONDITION"});
    // Actual new room charges (not a version-only edit) invalidate the reviewed source basis.
    const beforeRoom=await m.getInsuranceCase(f.ic(),f.caseId);expect(beforeRoom.responsibility?.stale).toBe(false);
    await new Promise(r=>setTimeout(r,600));await (await import("../../src/server/billing/commands")).reconcileBill(f.ctx(),{admissionId:f.admissionId,cutoff:new Date().toISOString()});
    const afterRoom=await m.getInsuranceCase(f.ic(),f.caseId);expect(afterRoom.money.netPaise).toBeGreaterThan(beforeRoom.money.netPaise);expect(afterRoom.responsibility?.stale).toBe(true);
  }));
});
