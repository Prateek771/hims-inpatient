import { afterEach, expect, it } from "vitest";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { withTestDatabase } from "../../scripts/test-database";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { billingFixture } from "../support/billing-fixture";
import { activateAdmission } from "../../src/server/admissions/commands";
loadLocalEnvironment(); const ordinary=process.env.DATABASE_URL;
afterEach(()=>{process.env.DATABASE_URL=ordinary;});
process.env.BETTER_AUTH_URL="http://127.0.0.1:3100";
process.env.BETTER_AUTH_SECRET="SyntheticNativeFinalReviewSecretAtLeast32Characters";
it("native departure rejects a selected actual Doctor disposition after witnessed exit",async()=>withTestDatabase(async({runtime})=>{
  process.env.DATABASE_URL=getTestDatabaseConfig().runtimeUrl;
  const f=await billingFixture();await f.setting({type:"deposit",category:"GENERAL",route:"self-pay",requirement:"not-required",amount:"0"});
  const {admissionId}=await f.episode(),ctx=f.deskCtx();await activateAdmission(ctx,{admissionId,arrivedAt:new Date().toISOString(),expectedVersion:1,requestId:ctx.requestId});
  const start=new Date().toISOString(),shift=(await runtime.query("insert into hims.nursing_shifts(admission_id,nurse_id,started_at,handover,signed_by) values($1,$2,$3,'Synthetic native attendance',$2) returning id",[admissionId,f.nurse.id,start])).rows[0].id;
  await runtime.query("insert into hims.nurse_assignments(admission_id,nurse_id,authority,reason,signed_by) values($1,$2,'Synthetic roster','Actual native assignment',$3)",[admissionId,f.nurse.id,f.admin.id]);
  const at=new Date().toISOString();
  const physical=(await runtime.query("insert into hims.exception_evidence(admission_id,kind,role,shift_id,actual_at,vacated_at,notes,signed_by) values($1,'PHYSICAL_EXIT','NURSE',$2,$4,$4,'Native actual exit',$3) returning id,actual_at,vacated_at",[admissionId,shift,f.nurse.id,at])).rows[0];
  const doctor=(await runtime.query("insert into hims.exception_evidence(admission_id,kind,role,actual_at,notes,signed_by) values($1,'DEATH','DOCTOR',clock_timestamp(),'Actual Doctor fact after exit',$2) returning id",[admissionId,f.doctor.id])).rows[0].id;
  const authority=(await runtime.query("insert into hims.admin_exceptions(admission_id,type,disposition,authority,reason,evidence,evidence_ids,follow_up_owner_id,snapshot,signed_by) values($1,'DEATH','EXCEPTIONAL_EXIT','Synthetic authority','Native source test','Retained facts',$2,$3,'{}',$4) returning id",[admissionId,JSON.stringify([physical.id,doctor]),f.doctor.id,f.admin.id])).rows[0].id;
  await runtime.query("begin");try{
    const stay=(await runtime.query("update hims.room_stays set ended_at=$2 where admission_id=$1 returning id",[admissionId,physical.vacated_at])).rows[0].id;
    await expect(runtime.query("insert into hims.exceptional_departures(admission_id,exception_id,physical_evidence_id,stay_id,departed_at,snapshot,signed_by) values($1,$2,$3,$4,$5,'{}',$6)",[admissionId,authority,physical.id,stay,physical.actual_at,f.admin.id])).rejects.toMatchObject({code:"23514"});
  }finally{await runtime.query("rollback");}
}));
it("native room reversal requires a source-bound physical amendment rather than a generic financial credit",async()=>withTestDatabase(async({runtime})=>{
  process.env.DATABASE_URL=getTestDatabaseConfig().runtimeUrl;const f=await billingFixture(),{admissionId}=await f.episode();
  const charge=(await runtime.query("insert into hims.charges(admission_id,source_event_id,source_payload,category,item_id,description,quantity,unit,tariff_version_id,rate_paise,amount_paise,initial_status,actor_type,actor_id) values($1,'room:00000000-0000-0000-0000-000000000001:100','Synthetic native source','room','GENERAL','Synthetic occupied time','1','hour',$2,100,100,'FINAL','staff',$3) returning id",[admissionId,f.room.id,f.cashier.id])).rows[0].id;
  await expect(runtime.query("insert into hims.charge_reversals(charge_id,amount_paise,reason,actor_type,actor_id) values($1,1,'Generic room waiver','staff',$2)",[charge,f.cashier.id])).rejects.toMatchObject({code:"23514"});
}));
