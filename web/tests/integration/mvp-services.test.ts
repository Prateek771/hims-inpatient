import { afterEach,describe,expect,it } from "vitest";
import { withTestDatabase,waitForTestDatabaseIdle } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { billingFixture } from "../support/billing-fixture";
import { prepareMvpBrowserFixtures } from "../support/mvp-workflow-fixture";
import { createStaff } from "../../src/server/staff";
import { listSettings,saveSetting } from "../../src/server/settings";
import { getMvpEpisode,recordMvpAction } from "../../src/server/mvp/commands";
import { externalServiceCategories,recordExternalServiceCharge } from "../../src/server/mvp/services";
import { reverseCharge } from "../../src/server/billing/commands";
loadLocalEnvironment();
const envKeys=["DATABASE_URL","HIMS_SYNTHETIC_TEST_RUN","HIMS_DOCUMENT_STORAGE","HIMS_INSURANCE_STORAGE","BETTER_AUTH_URL","BETTER_AUTH_SECRET"] as const;
const saved=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));
afterEach(async()=>{await waitForTestDatabaseIdle();for(const key of envKeys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}});
describe("MVP externally performed service billing",()=>{
  it("pins configured service money to immutable evidence, rejects forged or duplicate sources, and reopens only affected checks",async()=>withTestDatabase(async({runtime})=>{
    process.env.DATABASE_URL=getTestDatabaseConfig().runtimeUrl;process.env.HIMS_SYNTHETIC_TEST_RUN="1";process.env.HIMS_DOCUMENT_STORAGE="synthetic";process.env.HIMS_INSURANCE_STORAGE="synthetic";process.env.BETTER_AUTH_URL="http://127.0.0.1:3100";process.env.BETTER_AUTH_SECRET="SyntheticMvpServicesOnlyAtLeast32Characters12345";
    const f=await billingFixture();await createStaff(f.ah,{name:"Synthetic Insurance",email:"insurance@billing.invalid",password:"SyntheticBillingOnly123!",role:"INSURANCE",reason:"Synthetic external source case reviewer"});
    const m=await prepareMvpBrowserFixtures(f.ah,"billing.invalid"),initial=await m.projection();expect(initial.finance).not.toBeNull();
    const configured=new Map<string,string>();
    for(const category of externalServiceCategories){
      const settings=await listSettings(f.ah),expectedVersion=Math.max(0,...settings.versions.filter(v=>v.kind==="tariff").map(v=>v.version));
      const rate=await saveSetting(f.ah,{value:{type:"billable-item",code:`MVP_EXT_${category.toUpperCase()}`,name:`Synthetic external ${category}`,category,department:category==="consumable"?"NURSE":["lab","radiology"].includes(category)?"LAB":"DOCTOR",unit:"service",quantityScale:1,amount:"100.01",active:true},expectedVersion,reason:"Synthetic configured external service price"});configured.set(category,rate.id);
    }
    const project=()=>getMvpEpisode(m.ac(),m.meeraAdmissionId);
    const input=(ctx:ReturnType<typeof m.ac>,category:typeof externalServiceCategories[number],billVersion:number,line=category)=>({admissionId:m.meeraAdmissionId,requestId:ctx.requestId,expectedBillVersion:billVersion,category,itemId:`MVP_EXT_${category.toUpperCase()}`,quantity:"1.5",unit:"service",expectedTariffVersionId:configured.get(category)!,performedAt:new Date().toISOString(),departmentIssuer:"Synthetic named external department issuer",externalBillReference:"MVP-EXT-BILL",externalLineReference:line,evidence:"Synthetic external performed-service bill and actual source evidence"});
    const wrong=m.nc();await expect(recordExternalServiceCharge(wrong,input(wrong,"consultation",initial.episode.billRevision))).rejects.toMatchObject({code:"FORBIDDEN"});
    const first=m.bc(),firstInput=input(first,"consultation",initial.episode.billRevision),posted=await recordExternalServiceCharge(first,firstInput);expect(await recordExternalServiceCharge(first,firstInput)).toEqual(posted);
    let state=await project();const source=state.serviceSources.find(s=>s.id===posted.id)!;const charge=state.bill!.charges.find(c=>c.id===source.chargeId)!;
    expect(charge).toMatchObject({category:"consultation",ratePaise:"10001",amountPaise:"15002",quantity:"1.5",tariffVersionId:configured.get("consultation"),status:"FINAL"});expect(source).toMatchObject({recorderName:m.cashier.name,departmentIssuer:firstInput.departmentIssuer,externalBillReference:firstInput.externalBillReference,externalLineReference:"consultation"});
    expect(state.finance).toBeNull();expect(state.clinical?.id).toBe(initial.clinical?.id);expect(state.checklist?.id).toBe(initial.checklist?.id);expect(state.checks.every(c=>c.current)).toBe(true);
    await expect(runtime.query("insert into hims.mvp_external_services(id,admission_id,charge_id,category,item_id,quantity,unit,tariff_version_id,performed_at,department_issuer,external_bill_reference,external_line_reference,evidence,recorded_by,recorder_name) select gen_random_uuid(),admission_id,charge_id,category,item_id,quantity,unit,tariff_version_id,performed_at,department_issuer,external_bill_reference,'Synthetic wrong native actor',evidence,$2,$3 from hims.mvp_external_services where id=$1",[source.id,m.nurse.id,m.nurse.name])).rejects.toMatchObject({code:"23514",message:expect.stringContaining("Admin/Billing recorder")});
    expect((await getMvpEpisode(m.nc(),m.meeraAdmissionId)).serviceSources).toEqual([]);
    const stale=m.bc();await expect(recordExternalServiceCharge(stale,input(stale,"procedure",initial.episode.billRevision))).rejects.toMatchObject({code:"CONFLICT"});
    const duplicate=m.bc();await expect(recordExternalServiceCharge(duplicate,input(duplicate,"consultation",state.episode.billRevision))).rejects.toMatchObject({code:"CONFLICT"});
    const staleRate=m.bc();await expect(recordExternalServiceCharge(staleRate,{...input(staleRate,"procedure",state.episode.billRevision),expectedTariffVersionId:configured.get("consultation")})).rejects.toMatchObject({code:"CONFLICT"});
    const concurrentA=m.bc(),concurrentB=m.bc(),concurrentBill=state.episode.billRevision;
    const concurrent=await Promise.allSettled([recordExternalServiceCharge(concurrentA,input(concurrentA,"procedure",concurrentBill)),recordExternalServiceCharge(concurrentB,input(concurrentB,"procedure",concurrentBill))]);expect(concurrent.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(concurrent.filter(r=>r.status==="rejected")).toHaveLength(1);
    state=await project();const consume=m.ac();await recordExternalServiceCharge(consume,input(consume,"consumable",state.episode.billRevision));
    state=await project();expect(state.checks.find(c=>c.check==="NURSING")?.current).toBe(false);expect(state.checks.find(c=>c.check==="PHARMACY")?.current).toBe(true);expect(state.checks.find(c=>c.check==="DIAGNOSTICS")?.current).toBe(true);
    const lab=m.bc();await recordExternalServiceCharge(lab,input(lab,"lab",state.episode.billRevision));state=await project();expect(state.checks.find(c=>c.check==="DIAGNOSTICS")?.current).toBe(false);
    const na=m.ac();await expect(recordMvpAction(na,{action:"n-a",admissionId:m.meeraAdmissionId,requestId:na.requestId,expectedReviewHash:state.reviewHash,check:"DIAGNOSTICS",reason:"Performed diagnostic work cannot become not applicable"})).rejects.toMatchObject({code:"PRECONDITION"});
    const confirm=m.nc();await recordMvpAction(confirm,{action:"check",admissionId:m.meeraAdmissionId,requestId:confirm.requestId,expectedReviewHash:state.reviewHash,check:"DIAGNOSTICS",status:"COMPLETE",remarks:"External performed diagnostic work reconciled",confirmerName:"Synthetic diagnostic department confirmer",sourceTime:new Date().toISOString(),evidence:"Synthetic external diagnostic completion evidence"});
    state=await project();expect(state.checks.find(c=>c.check==="DIAGNOSTICS")?.current).toBe(true);
    const radiology=m.bc();await recordExternalServiceCharge(radiology,input(radiology,"radiology",state.episode.billRevision));state=await project();expect(state.checks.find(c=>c.check==="DIAGNOSTICS")?.current).toBe(false);
    expect(state.serviceSources).toHaveLength(5);expect(BigInt(state.bill!.netPaise)-BigInt(initial.bill!.netPaise)).toBe(75010n);
    // A naked v2 service ledger row cannot commit without its counterpart, even with the actual Billing actor.
    await runtime.query("begin");try{
      await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) select admission_id,gen_random_uuid()::text,'Synthetic native orphan source',category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,'FINAL','staff',actor_id from hims.charges where id=$1",[charge.id]);
      await expect(runtime.query("set constraints all immediate")).rejects.toMatchObject({code:"23514",message:expect.stringContaining("atomic external")});
    }finally{await runtime.query("rollback");}
    // A source cannot certify a fabricated amount, even when all references and authorized recorder match.
    await runtime.query("begin");try{
      const forged=crypto.randomUUID(),forgedCharge=(await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) select admission_id,$2::text,'Synthetic forged source amount',category,item_id,description,quantity,unit,tariff_version_id,rate_paise,1,'FINAL','staff',actor_id from hims.charges where id=$1 returning id",[charge.id,forged])).rows[0];
      await expect(runtime.query("insert into hims.mvp_external_services(id,admission_id,charge_id,category,item_id,quantity,unit,tariff_version_id,performed_at,department_issuer,external_bill_reference,external_line_reference,evidence,recorded_by,recorder_name) select $2::uuid,admission_id,$3::uuid,category,item_id,quantity,unit,tariff_version_id,performed_at,department_issuer,external_bill_reference,'Synthetic forged native line',evidence,recorded_by,recorder_name from hims.mvp_external_services where id=$1",[source.id,forged,forgedCharge.id])).rejects.toMatchObject({code:"23514",message:expect.stringContaining("deterministic configured rate")});
    }finally{await runtime.query("rollback");}
    const credit=m.bc();await reverseCharge(credit,{chargeId:charge.id,amountPaise:"15002",reason:"Synthetic linked service billing correction",requestId:credit.requestId});
    const after=await project();expect(after.serviceSources.find(s=>s.id===source.id)).toEqual(source);expect(after.bill!.reversals.some(r=>r.chargeId===charge.id&&r.amountPaise==="15002")).toBe(true);expect(BigInt(after.bill!.netPaise)-BigInt(initial.bill!.netPaise)).toBe(60008n);
  }),90000);
});
