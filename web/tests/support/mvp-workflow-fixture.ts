import { inArray } from "drizzle-orm";
import { db } from "../../src/server/db";
import { user } from "../../src/server/schema/auth";
import { requireStaff, staffContext, type Staff } from "../../src/server/access";
import { saveSetting,listSettings } from "../../src/server/settings";
import { saveDoctor } from "../../src/server/mvp/staff";
import { createAdmission,createBed,activateAdmission } from "../../src/server/admissions/commands";
import { assignNurse,recordShift } from "../../src/server/nursing/commands";
import { getMvpEpisode,recordMvpAction,recordPatientMedicineCharge,acceptPatientMedicineReturn,type MvpActionInput } from "../../src/server/mvp/commands";
import { recordReceipt,allocateDeposit,refundReceipt,getBill } from "../../src/server/billing/commands";
import { createInsuranceCase,recordPolicyVerification,recordPayerDecision } from "../../src/server/insurance/commands";
import { createMvpDocument } from "../../src/server/documents/mvp";

/** Commands only: caller owns synthetic setup/reset and fixture serialization. Never use on ordinary data. */
export async function prepareMvpBrowserFixtures(adminHeaders:Headers,emailDomain="e2e.fixture.invalid") {
  if(process.env.HIMS_SYNTHETIC_TEST_RUN!=="1")throw Error("Synthetic MVP fixture requires explicit isolation");
  const admin=await requireStaff(adminHeaders);
  const rows=await db.select().from(user).where(inArray(user.email,["admission","billing","nurse","pharmacy","insurance"].map(r=>`${r}@${emailDomain}`)));
  const staff=(role:string)=>{const row=rows.find(r=>r.role===role);if(!row)throw Error(`Synthetic ${role} staff missing`);return {id:row.id,role:row.role,name:row.name,email:row.email} as Staff;};
  const nurse=staff("NURSE"),cashier=staff("BILLING"),pharmacy=staff("PHARMACY"),insurance=staff("INSURANCE"),desk=staff("ADMISSION");
  const ac=()=>staffContext(admin,"synthetic-mvp"),nc=()=>staffContext(nurse,"synthetic-mvp"),bc=()=>staffContext(cashier,"synthetic-mvp"),pc=()=>staffContext(pharmacy,"synthetic-mvp"),ic=()=>staffContext(insurance,"synthetic-mvp");
  async function setting(value:Record<string,unknown>){const kind=["tariff","billable-item"].includes(String(value.type))?"tariff":"rule",settings=await listSettings(adminHeaders),version=Math.max(0,...settings.versions.filter(v=>v.kind===kind).map(v=>v.version));return saveSetting(adminHeaders,{value,expectedVersion:version,reason:"Synthetic MVP acceptance policy; not hospital policy"});}
  await setting({type:"bed-category",code:"MVP_GENERAL",name:"Synthetic MVP General",active:true});
  await setting({type:"tariff",category:"MVP_GENERAL",amount:"0",basis:"hour",rounding:"exact",graceMinutes:0});
  for(const route of ["self-pay","insured"])await setting({type:"deposit",category:"MVP_GENERAL",route,requirement:"not-required",amount:"0"});
  const dctx=ac(),doctor=await saveDoctor(dctx,{name:"Synthetic external Doctor",active:true,expectedVersion:0,reason:"Synthetic external clinical identity",requestId:dctx.requestId});
  async function admission(route:"SELF_PAY"|"INSURED",name:string){
    const bed=await createBed(ac(),{label:`MVP ${crypto.randomUUID()}`,category:"MVP_GENERAL",reason:"Synthetic MVP bed"}),ctx=staffContext(desk,"synthetic-mvp");
    const created=await createAdmission(ctx,{externalDoctorId:doctor.id,patientDetails:{name,ageYearsAtRegistration:54,sex:"FEMALE"},bedId:bed.id,paymentRoute:route,expectedStayDays:2,requestId:ctx.requestId});
    const activate=staffContext(desk,"synthetic-mvp");await activateAdmission(activate,{admissionId:created.admissionId,arrivedAt:new Date().toISOString(),expectedVersion:1,requestId:activate.requestId});
    await assignNurse(ac(),{admissionId:created.admissionId,nurseId:nurse.id,reason:"Synthetic assigned ward coordinator",authority:"Synthetic roster"});
    const shiftCtx=nc(),shift=await recordShift(shiftCtx,{admissionId:created.admissionId,startedAt:new Date().toISOString(),handover:"Synthetic waiting-care responsibility",requestId:shiftCtx.requestId});
    return {...created,shiftId:shift.id};
  }
  const meera=await admission("INSURED","Meera Shah"),selfPay=await admission("SELF_PAY","Synthetic self-pay patient");
  const projection=()=>getMvpEpisode(ac(),meera.admissionId);
  async function action(ctx:ReturnType<typeof ac>,value:Omit<MvpActionInput,"admissionId"|"requestId"|"expectedReviewHash">){const current=await projection();return recordMvpAction(ctx,{...value,admissionId:meera.admissionId,requestId:ctx.requestId,expectedReviewHash:current.reviewHash});}
  await action(nc(),{action:"doctor-approval",authorizerName:doctor.name,authorizerId:doctor.id,sourceTime:new Date().toISOString(),evidence:"Synthetic signed external Doctor instruction",clinicalSummary:"Synthetic recovery and external discharge instruction",prescription:"External Doctor supplies prescription; no medicines prescribed by recorder",followUp:"External Doctor follow-up supplied"} as Parameters<typeof action>[1]);
  const clinical=await createMvpDocument(nc(),{admissionId:meera.admissionId,kind:"CLINICAL",expectedReviewHash:(await projection()).reviewHash});
  await action(nc(),{action:"deliver",kind:"CLINICAL",documentId:clinical.documentId,recipient:"Meera Shah",deliveredAt:new Date().toISOString(),evidence:"Synthetic clinical papers delivered before final finance"} as Parameters<typeof action>[1]);
  await action(nc(),{action:"checklist",items:["Physical handover documented","Patient instructions prepared"],proposedNa:["DIAGNOSTICS"],remarks:"Synthetic published readiness checklist"} as Parameters<typeof action>[1]);
  const rate=await setting({type:"billable-item",code:"MVP_MED",name:"Synthetic medicine patient charge",category:"medicine",department:"PHARMACY",unit:"pack",quantityScale:0,amount:"5000",active:true}),chargeCtx=pc();
  await recordPatientMedicineCharge(chargeCtx,{admissionId:meera.admissionId,itemId:"MVP_MED",quantity:"24",unit:"pack",expectedTariffVersionId:rate.id,sourceReference:"MVP-MEERA-MEDICINE",evidence:"Synthetic patient medicine bill",requestId:chargeCtx.requestId});
  const bill=await getBill(bc(),meera.admissionId),returnCtx=pc();
  await acceptPatientMedicineReturn(returnCtx,{admissionId:meera.admissionId,originalChargeId:bill.charges.find(c=>c.itemId==="MVP_MED")!.id,quantity:"1",reason:"Synthetic unused pack accepted",evidence:"Synthetic Pharmacy acceptance",expectedBillVersion:bill.revision,requestId:returnCtx.requestId});
  const caseCtx=ac(),caseRecord=await createInsuranceCase(caseCtx,{admissionId:meera.admissionId,assignedStaffId:insurance.id,reason:"Synthetic externally verified case",requestId:caseCtx.requestId});
  const policyCtx=ic();await recordPolicyVerification(policyCtx,{caseId:caseRecord.id,expectedCaseVersion:1,requestId:policyCtx.requestId,insurer:"Synthetic external insurer",tpa:"",policyNumber:"MVP-SYNTHETIC",memberNumber:"MEERA-SYNTHETIC",validFrom:"2026-01-01",validTo:"2027-12-31",verifiedBy:"Synthetic external policy desk",verifiedAt:new Date().toISOString(),reference:"Synthetic external verification",documentIds:[]});
  const currentBill=await getBill(bc(),meera.admissionId),decisionCtx=ic();await recordPayerDecision(decisionCtx,{caseId:caseRecord.id,expectedCaseVersion:2,requestId:decisionCtx.requestId,verifiedBy:"Synthetic insurer decision desk",verifiedAt:new Date().toISOString(),reference:"MVP-ACCEPTED-CREDIT",status:"APPROVED",kind:"PREAUTH",reason:"Synthetic accepted external responsibility",approvedPaise:"9000000",coPayBps:0,allocation:{billRevision:currentBill.revision,netBillPaise:"11500000",eligibleBillPaise:"9000000",nonPayablePaise:"2500000",sourceReference:"Synthetic complete responsibility"},documentIds:[]});
  await action(nc(),{action:"check",check:"NURSING",status:"COMPLETE",remarks:"Synthetic current physical readiness"} as Parameters<typeof action>[1]);
  await action(pc(),{action:"check",check:"PHARMACY",status:"COMPLETE",remarks:"Synthetic original-price medicine return reconciled"} as Parameters<typeof action>[1]);
  await action(ic(),{action:"check",check:"INSURANCE",status:"COMPLETE",remarks:"Synthetic accepted responsibility reviewed"} as Parameters<typeof action>[1]);
  await action(ac(),{action:"n-a",check:"DIAGNOSTICS",reason:"No diagnostic services or pending work in this synthetic episode"} as Parameters<typeof action>[1]);
  await action(nc(),{action:"vacancy",shiftId:meera.shiftId,vacatedAt:new Date().toISOString(),waitingLocation:"Synthetic supervised waiting lounge",handover:"Assigned Nurse retains care while bed remains held"} as Parameters<typeof action>[1]);
  const depositCtx=bc(),deposit=await recordReceipt(depositCtx,{admissionId:meera.admissionId,party:"PATIENT",kind:"DEPOSIT",amountPaise:"3000000",mode:"CASH",channel:"Synthetic cashier book",sourceReference:`MVP-MEERA-DEPOSIT:${meera.admissionId}`,reference:"Actual synthetic deposit record",requestId:depositCtx.requestId});
  const allocationCtx=bc();await allocateDeposit(allocationCtx,{receiptId:deposit.id,amountPaise:"2500000",reason:"Allocate existing patient deposit",requestId:allocationCtx.requestId});
  const reviewed=await projection(),refundCtx=bc();await refundReceipt(refundCtx,{receiptId:deposit.id,amountPaise:"500000",reason:"Return actual excess patient deposit",requestId:refundCtx.requestId,expectedReviewHash:reviewed.reviewHash,expectedBillVersion:reviewed.episode.billRevision,mode:"CASH",channel:"Synthetic cashier book",sourceReference:`MVP-MEERA-REFUND:${meera.admissionId}`,evidence:"Synthetic actual cashier refund evidence",refundedAt:new Date().toISOString()});
  await action(bc(),{action:"finance",reason:"Patient settled; accepted insurer credit retained as receivable"} as Parameters<typeof action>[1]);
  const final=await createMvpDocument(nc(),{admissionId:meera.admissionId,kind:"FINAL",expectedReviewHash:(await projection()).reviewHash});
  return {meeraAdmissionId:meera.admissionId,meeraShiftId:meera.shiftId,meeraFinalDocumentId:final.documentId,selfPayAdmissionId:selfPay.admissionId,selfPayShiftId:selfPay.shiftId,caseId:caseRecord.id,admin,nurse,cashier,pharmacy,insurance,desk,projection,ac,nc,bc,pc,ic};
}
