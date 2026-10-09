import { afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { withTestDatabase } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { billingFixture } from "../support/billing-fixture";
import { staffContext } from "../../src/server/access";
import * as schema from "../../src/server/schema";
loadLocalEnvironment();
const appUrl=process.env.DATABASE_URL, testUrl=getTestDatabaseConfig().runtimeUrl;
afterEach(()=>{process.env.DATABASE_URL=appUrl;});
process.env.BETTER_AUTH_URL="http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET="SyntheticLabOnlySecretAtLeast32Characters12345";
async function fixture(configured=true) {
  process.env.DATABASE_URL=testUrl;
  const care=await import("../../src/server/clinical/commands");
  const {activateAdmission}=await import("../../src/server/admissions/commands");
  const f=await billingFixture();
  await f.setting({type:"deposit",category:"GENERAL",route:"self-pay",requirement:"not-required",amount:"0"});
  const policy={type:"billable-item",code:"LAB_CBC",name:"Synthetic CBC",category:"lab",department:"LAB",unit:"test",quantityScale:0,active:true,amount:"100"};
  if(configured)await f.setting(policy);
  const a=await f.episode(),ac=f.deskCtx();await activateAdmission(ac,{admissionId:a.admissionId,arrivedAt:new Date().toISOString(),expectedVersion:1,requestId:ac.requestId});
  const dc=()=>staffContext(f.doctor,"synthetic-lab-doctor"),lc=()=>staffContext(f.lab,"synthetic-lab");
  async function order(kind="LAB",code="LAB_CBC") {
    const ctx=dc();await care.recordRound(ctx,{admissionId:a.admissionId,notes:"Private synthetic clinical notes",orders:[{kind,requestedItem:`Synthetic ${kind} work`,itemId:code,quantity:"1",unit:"test"}],requestId:ctx.requestId});
    return (await care.getCare(dc(),a.admissionId)).orders.at(-1)!;
  }
  return {...f,care,dc,lc,order,policy,admissionId:a.admissionId};
}
describe("human diagnostic work on PostgreSQL",()=>{
  it("binds actual sample/order/patient, preserves reports and finalizes the original price once",async()=>{
    await withTestDatabase(async({owner,runtime})=>{
      const f=await fixture(),lab=await import("../../src/server/lab/commands"),o=await f.order();
      const c=f.lc(),sample=await lab.collectSample(c,{orderId:o.id,requestId:c.requestId});
      const retry=f.lc();expect(await lab.collectSample(retry,{orderId:o.id,requestId:retry.requestId})).toEqual(sample);
      const review=await lab.getLabOrder(f.lc(),o.id);expect(review.sample?.id).toBe(sample.id);expect(review.episode).not.toHaveProperty("chiefComplaint");expect(review).not.toHaveProperty("notes");
      const other=await f.order(),oc=f.lc(),otherSample=await lab.collectSample(oc,{orderId:other.id,requestId:oc.requestId});
      const scan=f.lc();await expect(lab.startLabProcessing(scan,{orderId:o.id,barcode:otherSample.barcode,requestId:scan.requestId})).rejects.toMatchObject({code:"VALIDATION"});
      const separate=await f.episode(),arrival=f.deskCtx();await (await import("../../src/server/admissions/commands")).activateAdmission(arrival,{admissionId:separate.admissionId,arrivedAt:new Date().toISOString(),expectedVersion:1,requestId:arrival.requestId});
      const dr=f.dc();await f.care.recordRound(dr,{admissionId:separate.admissionId,notes:"Another patient's private notes",orders:[{kind:"LAB",requestedItem:"Other patient CBC",itemId:"LAB_CBC",quantity:"1",unit:"test"}],requestId:dr.requestId});
      const foreign=(await f.care.getCare(f.dc(),separate.admissionId)).orders[0],fc=f.lc(),foreignSample=await lab.collectSample(fc,{orderId:foreign.id,requestId:fc.requestId});
      const fs=f.lc();await expect(lab.startLabProcessing(fs,{orderId:o.id,barcode:foreignSample.barcode,requestId:fs.requestId})).rejects.toMatchObject({code:"VALIDATION"});
      await expect(lab.getLabOrder(f.lc(),crypto.randomUUID())).rejects.toMatchObject({code:"FORBIDDEN"});
      const report=f.lc(),input={orderId:o.id,barcode:sample.barcode,result:"Human synthetic CBC result",requestId:report.requestId};
      await expect(lab.recordLabReport(report,input)).rejects.toMatchObject({code:"PRECONDITION"});
      await expect(lab.lookupSample(f.lc(),{orderId:o.id,barcode:"UNKNOWN"})).rejects.toMatchObject({code:"VALIDATION"});
      await lab.startLabProcessing(scan,{orderId:o.id,barcode:sample.barcode,requestId:scan.requestId});
      await f.setting({...f.policy,amount:"999"});
      await f.care.stopClinicalOrder(f.dc(),{orderId:o.id,reason:"Stop further work after processing began"});
      const recorded=await lab.recordLabReport(report,input);expect(await lab.recordLabReport(report,input)).toEqual(recorded);
      const repeat=f.lc();expect(await lab.recordLabReport(repeat,{...input,requestId:repeat.requestId})).toEqual(recorded);
      const changed=f.lc();await expect(lab.recordLabReport(changed,{...input,result:"Overwrite",requestId:changed.requestId})).rejects.toMatchObject({code:"CONFLICT"});
      const attachment=f.lc();await expect(lab.recordLabReport(attachment,{...input,reportDocumentId:crypto.randomUUID(),requestId:attachment.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
      const addon=f.lc();await lab.addLabReportAddendum(addon,{orderId:o.id,reportId:recorded.id,text:"Human correction",reason:"Transcription correction",requestId:addon.requestId});
      expect((await lab.getLabOrder(f.lc(),o.id)).addenda).toHaveLength(1);
      expect((await lab.getLabOrder(f.lc(),o.id)).report!.signedAt.getTime()).toBeGreaterThanOrEqual((await lab.getLabOrder(f.lc(),o.id)).processing!.signedAt.getTime());
      const chart=await f.care.getCare(f.dc(),f.admissionId);expect(chart.diagnosticReports.find(r=>r.id===recorded.id)?.result).toBe(input.result);expect(chart.diagnosticAddenda).toHaveLength(1);
      const lines=await runtime.query("select amount_paise,initial_status from hims.charges c join hims.care_billing_events b on b.id::text=c.source_event_id where b.order_id=$1",[o.id]);expect(lines.rows).toEqual([{amount_paise:"10000",initial_status:"PENDING"}]);
      expect((await runtime.query("select count(*)::int as n from hims.charge_finalizations")).rows[0].n).toBe(1);
      await expect(runtime.query("update hims.lab_reports set result='altered' where id=$1",[recorded.id])).rejects.toThrow();
      await expect(owner.query("update hims.lab_reports set result='altered' where id=$1",[recorded.id])).rejects.toThrow(/immutable/i);
      await expect(lab.getLabOrder(f.ctx(),o.id)).rejects.toMatchObject({code:"FORBIDDEN"});
      const wrong=f.ctx();await expect(lab.collectSample(wrong,{orderId:other.id,requestId:wrong.requestId})).rejects.toMatchObject({code:"FORBIDDEN"});
      await owner.query("update hims.staff_user set banned=true where id=$1",[f.lab.id]);await expect(lab.recordLabReport(report,input)).rejects.toMatchObject({code:"FORBIDDEN"});
    });
  });
  it("retains unpriced reports, resolves once, handles radiology without specimens and rolls back composed effects",async()=>{
    await withTestDatabase(async({runtime})=>{
      const f=await fixture(false),lab=await import("../../src/server/lab/commands"),o=await f.order();
      const c=f.lc(),sample=await lab.collectSample(c,{orderId:o.id,requestId:c.requestId});const p=f.lc();await lab.startLabProcessing(p,{orderId:o.id,barcode:sample.barcode,requestId:p.requestId});
      const report=f.lc();await lab.recordLabReport(report,{orderId:o.id,barcode:sample.barcode,result:"Unpriced human report",requestId:report.requestId});
      expect((await lab.getLabOrder(f.lc(),o.id)).billingState).toBe("UNRESOLVED");expect((await runtime.query("select count(*)::int as n from hims.charges")).rows[0].n).toBe(0);
      await f.setting(f.policy);const r=f.lc();await lab.resolveLabBilling(r,{orderId:o.id,reason:"Configured missing price",requestId:r.requestId});const r2=f.lc();await lab.resolveLabBilling(r2,{orderId:o.id,reason:"Retry resolved source",requestId:r2.requestId});expect((await lab.getLabOrder(f.lc(),o.id)).billingState).toBe("FINAL");
      await f.setting({...f.policy,code:"XRAY",category:"radiology",name:"Synthetic Xray"});const x=await f.order("RADIOLOGY","XRAY"),xc=f.lc();await expect(lab.collectSample(xc,{orderId:x.id,requestId:xc.requestId})).rejects.toMatchObject({code:"VALIDATION"});
      await lab.startLabProcessing(xc,{orderId:x.id,requestId:xc.requestId});const xr=f.lc(),db=await import("../../src/server/db");
      await expect(db.withTransaction(async tx=>{await lab.recordLabReportInTransaction(tx,xr,{orderId:x.id,result:"Radiology human finding",requestId:xr.requestId});throw Error("Synthetic downstream failure");})).rejects.toThrow("Synthetic downstream failure");
      expect((await lab.getLabOrder(f.lc(),x.id)).report).toBeUndefined();expect((await runtime.query("select count(*)::int as n from hims.charge_finalizations")).rows[0].n).toBe(1);
      await lab.recordLabReport(xr,{orderId:x.id,result:"Radiology human finding",requestId:xr.requestId});expect((await lab.getLabOrder(f.lc(),x.id)).sample).toBeUndefined();
    });
  });
  it("cancels only Doctor-stopped unperformed work and nets the original pending source",async()=>{
    await withTestDatabase(async({runtime})=>{
      const f=await fixture(),lab=await import("../../src/server/lab/commands"),billing=await import("../../src/server/billing/commands"),o=await f.order();
      const d=f.lc();await expect(lab.disposeUnperformedLabOrder(d,{orderId:o.id,reason:"No test performed",requestId:d.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
      await f.care.stopClinicalOrder(f.dc(),{orderId:o.id,reason:"No longer needed before collection"});
      const disposed=await lab.disposeUnperformedLabOrder(d,{orderId:o.id,reason:"No test performed",requestId:d.requestId});
      const again=f.lc();expect(await lab.disposeUnperformedLabOrder(again,{orderId:o.id,reason:"Repeated review",requestId:again.requestId})).toEqual(disposed);
      expect((await billing.getBill(f.ctx(),f.admissionId)).pendingPaise).toBe(0n);
      expect((await runtime.query("select amount_paise from hims.charge_reversals")).rows).toEqual([{amount_paise:"10000"}]);
      expect((await runtime.query("select count(*)::int as n from hims.clinical_task_events where status='COMPLETED'")).rows[0].n).toBe(0);
      const c=f.lc();await expect(lab.collectSample(c,{orderId:o.id,requestId:c.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
      const performed=await f.order(),pc=f.lc();await lab.collectSample(pc,{orderId:performed.id,requestId:pc.requestId});await f.care.stopClinicalOrder(f.dc(),{orderId:performed.id,reason:"Stopped after actual collection"});
      const pd=f.lc();await expect(lab.disposeUnperformedLabOrder(pd,{orderId:performed.id,reason:"Must retain performed work",requestId:pd.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
      const prohibited=f.lc();await expect(lab.startLabProcessing(prohibited,{orderId:performed.id,barcode:(await lab.getLabOrder(f.lc(),performed.id)).sample!.barcode,requestId:prohibited.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
      expect((await runtime.query("select count(*)::int as n from hims.lab_processing where order_id=$1",[performed.id])).rows[0].n).toBe(0);
      expect((await billing.getBill(f.ctx(),f.admissionId)).pendingPaise).toBe(10000n);
    });
  });
  it("serializes report retries and unperformed disposition on distinct blocked PostgreSQL backends",async()=>{
    await withTestDatabase(async({runtime})=>{
      const f=await fixture(),lab=await import("../../src/server/lab/commands"),o=await f.order();
      const c=f.lc(),sample=await lab.collectSample(c,{orderId:o.id,requestId:c.requestId});const p=f.lc();await lab.startLabProcessing(p,{orderId:o.id,barcode:sample.barcode,requestId:p.requestId});
      await f.care.stopClinicalOrder(f.dc(),{orderId:o.id,reason:"Stopped after diagnostic processing began"});
      const one=new Client({connectionString:testUrl}),two=new Client({connectionString:testUrl});await Promise.all([one.connect(),two.connect()]);
      const pid1=(await one.query("select pg_backend_pid() as pid")).rows[0].pid,pid2=(await two.query("select pg_backend_pid() as pid")).rows[0].pid;expect(pid1).not.toBe(pid2);
      const db1=drizzle(one,{schema}),db2=drizzle(two,{schema});
      async function blocked() {for(let i=0;i<100;i++){const row=(await runtime.query("select $1::int=any(pg_blocking_pids($2)) as blocked",[pid1,pid2])).rows[0];if(row.blocked)return;await new Promise(r=>setTimeout(r,10));}throw Error("Competing backend did not observably block");}
      let release=()=>{},ready=()=>{};let hold=new Promise<void>(r=>release=r),locked=new Promise<void>(r=>ready=r);
      const r1=f.lc(),r2=f.lc(),v={orderId:o.id,barcode:sample.barcode,result:"Concurrent human report"};
      let first:Promise<unknown>|undefined,second:Promise<unknown>|undefined;
      try{
        first=db1.transaction(async tx=>{const result=await lab.recordLabReportInTransaction(tx,r1,{...v,requestId:r1.requestId});ready();await hold;return result;});
        await locked;
        second=db2.transaction(tx=>lab.recordLabReportInTransaction(tx,r2,{...v,requestId:r2.requestId}));await blocked();release();const [a,b]=await Promise.all([first,second]);expect(a).toEqual(b);
        expect((await runtime.query("select count(*)::int as n from hims.lab_reports where order_id=$1",[o.id])).rows[0].n).toBe(1);expect((await runtime.query("select count(*)::int as n from hims.charge_finalizations")).rows[0].n).toBe(1);
        const chronology=await lab.getLabOrder(f.lc(),o.id);expect(chronology.report!.signedAt.getTime()).toBeGreaterThanOrEqual(chronology.processing!.signedAt.getTime());
        const unperformed=await f.order();await f.care.stopClinicalOrder(f.dc(),{orderId:unperformed.id,reason:"Stopped before any collection"});
        hold=new Promise<void>(r=>release=r);locked=new Promise<void>(r=>ready=r);const d=f.lc(),completion=f.lc();
        first=db1.transaction(async tx=>{const result=await lab.disposeUnperformedLabOrderInTransaction(tx,d,{orderId:unperformed.id,reason:"Actual work checked: no collection or processing",requestId:d.requestId});ready();await hold;return result;});await locked;
        second=db2.transaction(tx=>lab.recordLabReportInTransaction(tx,completion,{orderId:unperformed.id,barcode:sample.barcode,result:"Guessed completion must fail",requestId:completion.requestId})).catch(e=>e);
        await blocked();release();await first;expect(await second).toMatchObject({code:"VALIDATION"});
        expect((await runtime.query("select count(*)::int as n from hims.lab_reports where order_id=$1",[unperformed.id])).rows[0].n).toBe(0);
        expect((await runtime.query("select count(*)::int as n from hims.charge_reversals")).rows[0].n).toBe(1);
      }finally{release();await Promise.allSettled([first,second]);await Promise.all([one.end(),two.end()]);}
    });
  });
  it("signs a report after the actual processing it waited behind, rather than transaction start",async()=>{
    await withTestDatabase(async({runtime})=>{
      const f=await fixture(),lab=await import("../../src/server/lab/commands"),o=await f.order(),c=f.lc();const sample=await lab.collectSample(c,{orderId:o.id,requestId:c.requestId});
      const one=new Client({connectionString:testUrl}),two=new Client({connectionString:testUrl});await Promise.all([one.connect(),two.connect()]);
      const pid1=(await one.query("select pg_backend_pid() as pid")).rows[0].pid,pid2=(await two.query("select pg_backend_pid() as pid")).rows[0].pid;expect(pid1).not.toBe(pid2);
      const db1=drizzle(one,{schema}),db2=drizzle(two,{schema});let release=()=>{},ready=()=>{},rejectReady=(e:unknown)=>{void e;};const hold=new Promise<void>(r=>release=r),locked=new Promise<void>((r,reject)=>{ready=r;rejectReady=reject;});
      let first:Promise<unknown>|undefined,second:Promise<unknown>|undefined,startedAt:Date|undefined;
      try{
        const p=f.lc();first=db1.transaction(async tx=>{
          // The real sample retry takes global/staff/request/admission locks in production order.
          // Hold that owning transaction before its next factual processing insert so the
          // competing report BEGIN is demonstrably earlier than the actual source evidence.
          await lab.collectSampleInTransaction(tx,p,{orderId:o.id,requestId:p.requestId});ready();await hold;
          return tx.insert(schema.labProcessing).values({orderId:o.id,admissionId:f.admissionId,sampleId:sample.id,signedBy:f.lab.id,signedAt:new Date()}).returning();
        }).catch(e=>{rejectReady(e);throw e;});await locked;
        const r=f.lc();second=db2.transaction(async tx=>{startedAt=(await two.query("select now() as at")).rows[0].at;return lab.recordLabReportInTransaction(tx,r,{orderId:o.id,barcode:sample.barcode,result:"Chronological human report",requestId:r.requestId});});
        let sawBlock=false;for(let i=0;i<100;i++){if((await runtime.query("select $1::int=any(pg_blocking_pids($2)) as blocked",[pid1,pid2])).rows[0].blocked){sawBlock=true;break;}await new Promise(r=>setTimeout(r,10));}expect(sawBlock).toBe(true);
        release();await Promise.all([first,second]);const actual=await lab.getLabOrder(f.lc(),o.id);expect(startedAt!.getTime()).toBeLessThan(actual.processing!.signedAt.getTime());expect(actual.report!.signedAt.getTime()).toBeGreaterThanOrEqual(actual.processing!.signedAt.getTime());
      }finally{release();await Promise.allSettled([first,second]);await Promise.all([one.end(),two.end()]);}
    });
  });
});
