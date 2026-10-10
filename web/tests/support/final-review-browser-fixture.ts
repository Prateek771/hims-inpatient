import { db } from "../../src/server/db";
import { user } from "../../src/server/schema/auth";
import { listSettings, saveSetting } from "../../src/server/settings";
import { activateAdmission, cancelAdmission, createAdmission, createBed } from "../../src/server/admissions/commands";
import { assignNurse, recordShift } from "../../src/server/nursing/commands";
import { orderTransfer, recordRound, signClinicalSummary } from "../../src/server/clinical/commands";
import { getClearanceReview, issueClearance } from "../../src/server/discharge/commands";
import { authorizeException, recordExceptionEvidence, recordExceptionalDeparture } from "../../src/server/discharge/exceptions";
import { recordReceipt } from "../../src/server/billing/commands";
import { sql } from "drizzle-orm";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

export async function prepareFinalReviewBrowserFixture(adminHeaders: Headers) {
  const staff=await db.select({id:user.id,email:user.email}).from(user), id=(role:string)=>staff.find(s=>s.email===`${role.toLowerCase()}@e2e.fixture.invalid`)!.id;
  const ctx=(role:string)=>({actor:{type:"staff" as const,staffId:id(role)},source:"synthetic-final-review-browser",requestId:crypto.randomUUID()});
  async function setting(value:Record<string,unknown>) {
    const s=await listSettings(adminHeaders),kind=["tariff","billable-item"].includes(String(value.type))?"tariff":"rule";
    return saveSetting(adminHeaders,{value,expectedVersion:Math.max(0,...s.versions.filter(v=>v.kind===kind).map(v=>v.version)),reason:"Independent final-review synthetic policy"});
  }
  for(const v of [
    {type:"bed-category",code:"FINAL_REVIEW",name:"Synthetic final review",active:true},
    {type:"deposit",category:"FINAL_REVIEW",route:"self-pay",requirement:"not-required",amount:"0"},
    {type:"tariff",category:"FINAL_REVIEW",amount:"0",basis:"hour",rounding:"exact",graceMinutes:0},
    {type:"billable-item",code:"FINAL_BROWSER_PRICED",name:"Original browser consultation",category:"consultation",department:"DOCTOR",unit:"visit",quantityScale:0,amount:"100",active:true},
  ]) await setting(v);
  async function episode(name:string,active=true) {
    const bed=await createBed(ctx("ADMIN"),{label:`Synthetic final review ${crypto.randomUUID()}`,category:"FINAL_REVIEW",reason:"Independent browser bed"}),c=ctx("ADMISSION");
    const a=await createAdmission(c,{patientDetails:{name,ageYearsAtRegistration:45,sex:"FEMALE"},admittingDoctorId:id("DOCTOR"),clinicianAssessment:{clinicianId:id("DOCTOR"),assessedAt:new Date().toISOString(),chiefComplaint:"Synthetic complaint",vitals:"Actual synthetic assessment",triage:"Synthetic destination",destinationCategory:"FINAL_REVIEW"},bedId:bed.id,paymentRoute:"SELF_PAY",expectedStayDays:1,requestId:c.requestId});
    if(active) {
      const ac=ctx("ADMISSION");await activateAdmission(ac,{admissionId:a.admissionId,expectedVersion:1,arrivedAt:new Date().toISOString(),requestId:ac.requestId});
      await assignNurse(ctx("ADMIN"),{admissionId:a.admissionId,nurseId:id("NURSE"),authority:"Synthetic roster",reason:"Current browser attendance"});
    }
    return a.admissionId;
  }
  const transferId=await episode("Synthetic final withdrawal patient"),o=ctx("DOCTOR");
  await orderTransfer(o,{admissionId:transferId,destinationCategory:"FINAL_REVIEW",reason:"Original current transfer instruction",requestId:o.requestId});
  const summaryId=await episode("Synthetic final empty prescription patient");
  await signClinicalSummary(ctx("DOCTOR"),{admissionId:summaryId,expectedVersion:0,diagnosis:"Synthetic reviewed diagnosis",course:"Actual reviewed course",condition:"Stable",followUp:"Human follow-up",advice:"Human advice",prescriptionOrderIds:[]});
  const review=await getClearanceReview(ctx("DOCTOR"),summaryId,"DOCTOR");await issueClearance(ctx("DOCTOR"),{admissionId:summaryId,gate:"DOCTOR",expectedReviewHash:review.reviewHash});
  const closedId=await episode("Synthetic final closed financial patient"),n=ctx("NURSE"),shift=await recordShift(n,{admissionId:closedId,startedAt:new Date().toISOString(),handover:"Actual ward attendance",requestId:n.requestId});
  const priced=ctx("DOCTOR");await recordRound(priced,{admissionId:closedId,notes:"Original priced actual consultation",orders:[],feeScheduleId:"FINAL_BROWSER_PRICED",feeUnit:"visit",requestId:priced.requestId});
  const missingCode=`FINAL_${crypto.randomUUID().replaceAll("-","").slice(0,20).toUpperCase()}`,unpriced=ctx("DOCTOR"),source=await recordRound(unpriced,{admissionId:closedId,notes:"Original retained actual missing-price consultation",orders:[],feeScheduleId:missingCode,feeUnit:"visit",requestId:unpriced.requestId});
  const at=new Date().toISOString(),physical=await recordExceptionEvidence(ctx("NURSE"),{admissionId:closedId,kind:"PHYSICAL_EXIT",shiftId:shift.id,actualAt:at,vacatedAt:at,notes:"Actual unplanned exit"});
  const a=await authorizeException(ctx("ADMIN"),{admissionId:closedId,type:"EARLY_EXIT",disposition:"EXCEPTIONAL_EXIT",authority:"Synthetic actual Admin routing",reason:"Record actual exit and retain liabilities",evidence:"Actual assigned Nurse witness",evidenceIds:[physical.id],followUpOwnerId:id("DOCTOR")});
  await recordExceptionalDeparture(ctx("ADMIN"),{admissionId:closedId,exceptionId:a.id,physicalEvidenceId:physical.id});
  await setting({type:"billable-item",code:missingCode,name:"Original missing-price consultation",category:"consultation",department:"DOCTOR",unit:"visit",quantityScale:0,amount:"100",active:true});
  const charge=(await db.execute(sql`select id from hims.charges where admission_id=${closedId} and item_id='FINAL_BROWSER_PRICED'`)).rows[0];
  const cancelledId=await episode("Synthetic final cancelled deposit patient",false),cash=ctx("BILLING");
  await recordReceipt(cash,{admissionId:cancelledId,party:"PATIENT",kind:"DEPOSIT",amountPaise:"5000",mode:"CASH",channel:"Synthetic final cashbook",sourceReference:crypto.randomUUID(),reference:"Actual initial synthetic deposit",requestId:cash.requestId});
  await cancelAdmission(ctx("ADMISSION"),{admissionId:cancelledId,reason:"Patient did not arrive"});
  writeFileSync(resolve("tmp/e2e-final-review.json"),JSON.stringify({transferId,summaryId,closedId,chargeId:charge.id,careSourceId:source.id,cancelledId,doctorId:id("DOCTOR"),cashierId:id("BILLING")}));
}
