import { afterEach,describe, expect, it } from "vitest";
import { mvpActionInput,getMvpEpisode,recordMvpAction,recordInsurerReceivableReceipt,recordPatientMedicineCharge,recordExceptionalReceivableReceipt } from "../../src/server/mvp/commands";
import { withTestDatabase,waitForTestDatabaseIdle } from "../../scripts/test-database";
import { loadLocalEnvironment } from "../../scripts/migrate";
import { getTestDatabaseConfig } from "../../scripts/test-database-guard";
import { billingFixture } from "../support/billing-fixture";
import { createStaff } from "../../src/server/staff";
import { prepareMvpBrowserFixtures } from "../support/mvp-workflow-fixture";
import { downloadDischargeDocument,verifyDocument } from "../../src/server/documents/commands";
import { createMvpDocument } from "../../src/server/documents/mvp";
import { recordMvpException } from "../../src/server/mvp/exceptions";
import { completeBedTurnover } from "../../src/server/discharge/commands";
import { rename } from "node:fs/promises";
import { resolve } from "node:path";
import { protectedStorageDirectory } from "../../src/server/protected-storage";
import { authorizeException,applyPostDischargeCorrection } from "../../src/server/discharge/exceptions";
import { getInsuranceCase,createInsuranceCase,recordPolicyVerification } from "../../src/server/insurance/commands";
import { createAdmission,createBed,activateAdmission } from "../../src/server/admissions/commands";
import { assignNurse,recordShift } from "../../src/server/nursing/commands";
import { staffContext } from "../../src/server/access";
loadLocalEnvironment();
const ordinary=process.env.DATABASE_URL;
const envKeys=["HIMS_SYNTHETIC_TEST_RUN","HIMS_DOCUMENT_STORAGE","HIMS_INSURANCE_STORAGE","BETTER_AUTH_URL","BETTER_AUTH_SECRET"] as const;
const originalEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
afterEach(async()=>{await waitForTestDatabaseIdle();process.env.DATABASE_URL=ordinary;for(const key of envKeys){if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key];}});

describe("MVP workflow command boundary", () => {
  it("requires clinical authorizer and source separately from the authenticated recorder", () => {
    expect(mvpActionInput.safeParse({ action: "doctor-approval", admissionId: crypto.randomUUID(), requestId: crypto.randomUUID(), expectedReviewHash: "a".repeat(64), evidence: "Written instruction" }).success).toBe(false);
  });
  it("does not permit mandatory readiness or finance to become N/A", () => {
    for (const check of ["NURSING", "FINANCE", "DOCTOR"]) expect(mvpActionInput.safeParse({ action: "n-a", admissionId: crypto.randomUUID(), requestId: crypto.randomUUID(), expectedReviewHash: "a".repeat(64), check, reason: "No relevant work" }).success).toBe(false);
  });
  it("retains accepted insurer credit at ordinary Nurse exit and later settles cash without rewriting documents",async()=>withTestDatabase(async({runtime})=>{
    process.env.DATABASE_URL=getTestDatabaseConfig().runtimeUrl;process.env.HIMS_SYNTHETIC_TEST_RUN="1";process.env.HIMS_DOCUMENT_STORAGE="synthetic";process.env.HIMS_INSURANCE_STORAGE="synthetic";
    process.env.BETTER_AUTH_URL="http://127.0.0.1:3100";process.env.BETTER_AUTH_SECRET="SyntheticMvpSecretOnlyAtLeast32Characters12345";
    const f=await billingFixture();
    await createStaff(f.ah,{name:"Synthetic Insurance",email:"insurance@billing.invalid",password:"SyntheticBillingOnly123!",role:"INSURANCE",reason:"Synthetic MVP responsible case staff"});
    const m=await prepareMvpBrowserFixtures(f.ah,"billing.invalid"),before=await m.projection();
    const caseBefore=await getInsuranceCase(m.ic(),m.caseId);
    expect((await runtime.query("select hims.mvp_economic_basis($1) basis",[m.meeraAdmissionId])).rows[0].basis).toBe(caseBefore.money.allocationBasis);
    expect((await runtime.query("select hims.mvp_current_responsibility($1) financial",[m.meeraAdmissionId])).rows[0].financial.responsibility).toEqual(before.financial?.responsibility);
    async function correct(admissionId:string,sourceId:string,kind:"REVERSE_CHARGE"|"INSURANCE_DECISION",data:Record<string,unknown>,ctx=m.bc()){
      const authority=await authorizeException(m.ac(),{admissionId,type:"POST_DISCHARGE_CORRECTION",disposition:"AMEND",sourceId,correctionKind:kind,authority:"Synthetic hospital correction authority",reason:"Retain the original exit while correcting its exact economic source",evidence:"Synthetic original source correction evidence",evidenceIds:[],followUpOwnerId:m.cashier.id});
      return applyPostDischargeCorrection(ctx,{admissionId,exceptionId:authority.id,kind,sourceId,data:{...data,...(kind==="INSURANCE_DECISION"?{requestId:ctx.requestId}:{})}});
    }
    async function nativeCollectionDenied(admissionId:string,party:"PATIENT"|"INSURER",amount:string,financeId:string|null,exceptionAuthorityId:string|null,message:RegExp,allocationAmendmentId:string|null=null){
      await runtime.query("begin");
      try{
        const id=crypto.randomUUID();
        await runtime.query("insert into hims.receipts(id,hospital_id,admission_id,party,kind,amount_paise,mode,channel,source_reference,reference,evidence_id,identity_payload,actor_type,actor_id) select $1::uuid,hospital_id,$2::uuid,$3::text,'PAYMENT',$4::bigint,'BANK','Synthetic native collection',$1::text,'Synthetic exact native source-bound cash','Synthetic receipt evidence',$1::text,'staff',$5::text from hims.receipts where admission_id=$6::uuid limit 1",[id,admissionId,party,amount,m.cashier.id,m.meeraAdmissionId]);
        await runtime.query("insert into hims.mvp_receivable_receipts(admission_id,finance_id,exception_authority_id,receipt_id,recorded_by,allocation_amendment_id) values($1,$2,$3,$4,$5,$6)",[admissionId,financeId,exceptionAuthorityId,id,m.cashier.id,allocationAmendmentId]);
        await expect(runtime.query("set constraints all immediate")).rejects.toMatchObject({code:"23514",message:expect.stringMatching(message)});
      }finally{await runtime.query("rollback");}
    }
    expect(before.episode.workflowVersion).toBe(2);
    expect(before.bill).toMatchObject({netPaise:"11500000",patientCashPaise:"2500000",insurerCashPaise:"0",refundedPaise:"500000"});
    expect(before.financial?.responsibility).toMatchObject({patientOutstandingPaise:"0",insurerOutstandingPaise:"9000000",allocationComplete:true});
    expect(before.finance).not.toBeNull();expect(before.departure).toBeNull();
    const nurseView=await getMvpEpisode(m.nc(),m.meeraAdmissionId);expect(nurseView.bill).toBeNull();expect(nurseView.financial).toBeNull();
    const denied=m.ac();await expect(recordMvpAction(denied,{action:"exit",admissionId:m.meeraAdmissionId,shiftId:m.meeraShiftId,departedAt:new Date().toISOString(),expectedReviewHash:before.reviewHash,requestId:denied.requestId})).rejects.toMatchObject({code:"FORBIDDEN"});
    const noDelivery=m.nc();await expect(recordMvpAction(noDelivery,{action:"exit",admissionId:m.meeraAdmissionId,shiftId:m.meeraShiftId,departedAt:new Date().toISOString(),expectedReviewHash:before.reviewHash,requestId:noDelivery.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    // Native insertion cannot impersonate Admin as the external Doctor recorder.
    await expect(runtime.query("insert into hims.mvp_events(admission_id,action,payload,review_hash,bill_version,recorded_by) values($1,'doctor-approval',$2,$3,$4,$5)",[m.meeraAdmissionId,{authorizerName:"External Doctor",sourceTime:new Date().toISOString(),evidence:"Synthetic instruction"},before.reviewHash,before.episode.billRevision,m.admin.id])).rejects.toMatchObject({code:"23514"});
    const delivery=m.nc(),deliveryValue={action:"deliver",admissionId:m.meeraAdmissionId,kind:"FINAL",documentId:m.meeraFinalDocumentId,recipient:"Meera Shah",deliveredAt:new Date().toISOString(),evidence:"Synthetic actual final-paper handover",expectedReviewHash:before.reviewHash,requestId:delivery.requestId};
    const delivered=await recordMvpAction(delivery,deliveryValue);expect(await recordMvpAction(delivery,deliveryValue)).toEqual(delivered);
    const current=await m.projection(),exit=m.nc(),exitValue={action:"exit",admissionId:m.meeraAdmissionId,shiftId:m.meeraShiftId,departedAt:new Date().toISOString(),expectedReviewHash:current.reviewHash,requestId:exit.requestId};
    const departure=await recordMvpAction(exit,exitValue);expect(await recordMvpAction(exit,exitValue)).toEqual(departure);
    const document=await downloadDischargeDocument(m.nc(),m.meeraFinalDocumentId),pinned=(await runtime.query("select row_to_json(d) pinned from hims.departures d where id=$1",[departure.id])).rows[0].pinned;
    const originalMedicine=before.bill!.charges.find(c=>c.category==="medicine")!;
    await correct(m.meeraAdmissionId,originalMedicine.id,"REVERSE_CHARGE",{amountPaise:"1000000",reason:"Synthetic linked post-exit source correction",expectedBillVersion:(await m.projection()).episode.billRevision});
    const staleReceipt=m.bc();await expect(recordInsurerReceivableReceipt(staleReceipt,{admissionId:m.meeraAdmissionId,party:"INSURER",kind:"PAYMENT",amountPaise:"1",mode:"BANK",channel:"Synthetic insurer receipt book",sourceReference:"MVP-STALE-ALLOCATION",reference:"Must reverify current party responsibility",evidenceId:"Synthetic bank receipt evidence",requestId:staleReceipt.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    await nativeCollectionDenied(m.meeraAdmissionId,"INSURER","1",before.finance!.id,null,/Current verified complete/);
    const caseCorrected=await getInsuranceCase(m.ic(),m.caseId);
    const meeraAllocationAmendment=await correct(m.meeraAdmissionId,m.caseId,"INSURANCE_DECISION",{caseId:m.caseId,expectedCaseVersion:caseCorrected.case.version,verifiedBy:"Synthetic external insurer",verifiedAt:new Date().toISOString(),reference:"Synthetic corrected external accepted responsibility",status:"PARTIAL",kind:"ENHANCEMENT",reason:"External source matches corrected exact bill",approvedPaise:"8000000",coPayBps:0,allocation:{billRevision:caseCorrected.money.revision,netBillPaise:"10500000",eligibleBillPaise:"8000000",nonPayablePaise:"2500000",sourceReference:"Synthetic current corrected allocation"},documentIds:[]},m.ic());
    const receipt=m.bc(),value={admissionId:m.meeraAdmissionId,party:"INSURER",kind:"PAYMENT",amountPaise:"8000000",mode:"BANK",channel:"Synthetic insurer receipt book",sourceReference:"MVP-LATE-INSURER-RECEIPT",reference:"Synthetic ordinary receivable settlement",evidenceId:"Synthetic bank receipt evidence",requestId:receipt.requestId};
    const oldCeiling=m.bc();await expect(recordInsurerReceivableReceipt(oldCeiling,{...value,amountPaise:"9000000",sourceReference:"MVP-OLD-INSURER-CEILING",requestId:oldCeiling.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    await nativeCollectionDenied(m.meeraAdmissionId,"INSURER","9000000",before.finance!.id,null,/original party obligation/);
    const settled=await recordInsurerReceivableReceipt(receipt,value);expect(await recordInsurerReceivableReceipt(receipt,value)).toEqual(settled);
    const after=await m.projection();expect(after.financial?.responsibility?.insurerOutstandingPaise).toBe("0");
    expect((await runtime.query("select row_to_json(d) pinned from hims.departures d where id=$1",[departure.id])).rows[0].pinned).toEqual(pinned);
    expect((await downloadDischargeDocument(m.nc(),m.meeraFinalDocumentId)).bytes).toEqual(document.bytes);
    expect((await verifyDocument(m.nc(),m.meeraFinalDocumentId)).status).toBe("CURRENT");
    expect((await runtime.query("select count(*)::int n from hims.clearance_seals where admission_id=$1",[m.meeraAdmissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.bed_holds where admission_id=$1",[m.meeraAdmissionId])).rows[0].n).toBe(0);
    expect((await runtime.query("select count(*)::int n from hims.bed_turnovers where admission_id=$1",[m.meeraAdmissionId])).rows[0].n).toBe(1);
    // The independent self-pay episode exercises external return authority and an explicit debt-retaining exit.
    const self=()=>getMvpEpisode(m.ac(),m.selfPayAdmissionId);
    async function ordinaryAction(ctx:ReturnType<typeof m.nc>,value:Record<string,unknown>){return recordMvpAction(ctx,{...value,admissionId:m.selfPayAdmissionId,requestId:ctx.requestId,expectedReviewHash:(await self()).reviewHash});}
    async function exceptionAction(ctx:ReturnType<typeof m.nc>,value:Record<string,unknown>){return recordMvpException(ctx,{...value,admissionId:m.selfPayAdmissionId,requestId:ctx.requestId,expectedReviewHash:(await self()).reviewHash});}
    await expect(runtime.query("insert into hims.exception_evidence(admission_id,kind,role,actual_at,notes,signed_by) values($1,'PLANNED_EXIT','DOCTOR',$2,'Native Doctor cannot enter a login-free MVP disposition',$3)",[m.selfPayAdmissionId,new Date(),f.doctor.id])).rejects.toMatchObject({code:"23514"});
    await expect(runtime.query("insert into hims.clinical_rounds(admission_id,notes,signed_by) values($1,'Native full chart cannot enter MVP workflow',$2)",[m.selfPayAdmissionId,f.doctor.id])).rejects.toMatchObject({code:"23514"});
    await ordinaryAction(m.nc(),{action:"doctor-approval",authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"External signed source",clinicalSummary:"Synthetic external recovery instruction",prescription:"Explicit external no-medicine instruction",followUp:"Synthetic Doctor follow-up"});
    await ordinaryAction(m.nc(),{action:"checklist",items:["Synthetic readiness"],proposedNa:["PHARMACY","INSURANCE","DIAGNOSTICS"],remarks:"Synthetic optional absence checks"});
    await ordinaryAction(m.nc(),{action:"check",check:"NURSING",status:"COMPLETE",remarks:"Nursing physical readiness recorded"});
    for(const check of ["PHARMACY","INSURANCE","DIAGNOSTICS"])await ordinaryAction(m.ac(),{action:"n-a",check,reason:"No relevant service or pending work"});
    await ordinaryAction(m.nc(),{action:"vacancy",shiftId:m.selfPayShiftId,vacatedAt:new Date().toISOString(),waitingLocation:"Supervised waiting chairs",handover:"Nurse continues waiting care; bed remains held"});
    const vacancy=(await self()).vacancy!;
    const returnInstruction=await exceptionAction(m.nc(),{action:"clinical",type:"RETURN_TO_BED",sourceId:vacancy.id,authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"Written external return instruction",notes:"External Doctor requests continued bed care"});
    await expect(exceptionAction(m.nc(),{action:"clinical",type:"RETURN_TO_BED",sourceId:vacancy.id,authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"Duplicate pending return instruction",notes:"Cannot create two unconsumed current return obligations"})).rejects.toMatchObject({code:"PRECONDITION"});
    const returnAuthority=await exceptionAction(m.ac(),{action:"authorize",type:"RETURN_TO_BED",clinicalId:returnInstruction.id,authority:"Synthetic operational routing authority",reason:"Route actual external return to the held bed",evidence:"Original external instruction retained",followUpOwnerId:m.nurse.id});
    await expect(exceptionAction(m.nc(),{action:"return",authorityId:returnAuthority.id,shiftId:m.selfPayShiftId,returnedAt:new Date().toISOString(),handover:"Attempt before completed turnover"})).rejects.toMatchObject({code:"PRECONDITION"});
    await expect(ordinaryAction(m.nc(),{action:"doctor-approval",authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"Cannot bypass pending original return",clinicalSummary:"Synthetic attempted new exit",prescription:"No external change",followUp:"Retain pending return"})).rejects.toThrow();
    const turnover=(await runtime.query("select id from hims.bed_turnovers where stay_id=$1",[vacancy.stayId])).rows[0];
    const cleaningCtx=m.ac();await completeBedTurnover(cleaningCtx,{turnoverId:turnover.id,completedAt:new Date().toISOString(),evidence:"Synthetic actual authorized turnover completed",requestId:cleaningCtx.requestId});
    const returned=await exceptionAction(m.nc(),{action:"return",authorityId:returnAuthority.id,shiftId:m.selfPayShiftId,returnedAt:new Date().toISOString(),handover:"Actual assigned-Nurse return with care handover"});
    expect(returned.id).toBeTruthy();expect((await self()).vacancy).toBeNull();expect((await self()).clinical).toBeNull();
    await expect(exceptionAction(m.nc(),{action:"clinical",type:"RETURN_CANCELLED",sourceId:returnInstruction.id,authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"Cannot cancel a completed movement",notes:"Actual returned stay must remain historical"})).rejects.toMatchObject({code:"PRECONDITION"});
    const roomRows=(await runtime.query("select id,started_at,ended_at from hims.room_stays where admission_id=$1 order by started_at",[m.selfPayAdmissionId])).rows;
    expect(roomRows).toHaveLength(2);expect(roomRows[1].started_at.getTime()).toBeGreaterThanOrEqual(roomRows[0].ended_at.getTime());
    const rate=(await runtime.query("select id from hims.setting_versions where payload->>'code'='MVP_MED' order by version desc limit 1")).rows[0],patientCharge=m.pc();
    await recordPatientMedicineCharge(patientCharge,{admissionId:m.selfPayAdmissionId,itemId:"MVP_MED",quantity:"1",unit:"pack",expectedTariffVersionId:rate.id,sourceReference:"MVP-SELF-PAY-MEDICINE",evidence:"Synthetic original patient charge",requestId:patientCharge.requestId});
    let planned=await exceptionAction(m.nc(),{action:"clinical",type:"PLANNED_EXIT",authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"New external clinical exit instruction after actual return",notes:"New externally authorized planned exit"});
    const beforeVacancy=await self();
    await expect(runtime.query("insert into hims.mvp_exception_events(admission_id,action,type,source_id,payload,bill_version,recorded_by) values($1,'VACANCY','PLANNED_EXIT',$2,$3,$4,$5)",[m.selfPayAdmissionId,planned.id,{clinicalId:planned.id,shiftId:m.selfPayShiftId,stayId:roomRows[1].id},beforeVacancy.episode.billRevision,m.nurse.id])).rejects.toMatchObject({code:"23514"});
    await exceptionAction(m.nc(),{action:"vacancy",clinicalId:planned.id,shiftId:m.selfPayShiftId,vacatedAt:new Date().toISOString(),waitingLocation:"Supervised financial waiting care",handover:"Factual bed use ended; debt and care retained"});
    const secondVacancy=(await self()).vacancy!,reconsidered=await exceptionAction(m.nc(),{action:"clinical",type:"RETURN_TO_BED",sourceId:secondVacancy.id,authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"Synthetic later proposed return",notes:"External instruction before explicit reconsideration"});
    await exceptionAction(m.nc(),{action:"clinical",type:"RETURN_CANCELLED",sourceId:reconsidered.id,authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"External source-bound reconsideration",notes:"External Doctor explicitly withdraws the unperformed return"});
    await expect(exceptionAction(m.nc(),{action:"clinical",type:"RETURN_CANCELLED",sourceId:reconsidered.id,authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"Duplicate reconsideration",notes:"Prior cancellation must remain exact"})).rejects.toMatchObject({code:"PRECONDITION"});
    planned=await exceptionAction(m.nc(),{action:"clinical",type:"PLANNED_EXIT",authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"Fresh planned exit after source-bound reconsideration",notes:"External planned clinical exit remains current"});
    const beforeCredit=await self(),forgedBill={...beforeCredit.bill,netPaise:"0"};
    await expect(runtime.query("insert into hims.mvp_exception_events(admission_id,action,type,source_id,payload,bill_version,recorded_by) values($1,'AUTHORITY','CREDIT',$2,$3,$4,$5)",[m.selfPayAdmissionId,planned.id,{clinicalId:planned.id,authority:"Synthetic hospital authority",reason:"Native actor cannot replace unpaid ledger money with zero",evidence:"Synthetic authority source",followUpOwnerId:m.cashier.id,bill:forgedBill,financial:beforeCredit.financial},beforeCredit.episode.billRevision,m.admin.id])).rejects.toMatchObject({code:"23514"});
    const fabricatedFinancial={...beforeCredit.financial,responsibility:{...beforeCredit.financial!.responsibility,patientPaise:"0",insurerPaise:"0",patientOutstandingPaise:"0",allocationComplete:true}};
    await expect(runtime.query("insert into hims.mvp_exception_events(admission_id,action,type,source_id,payload,bill_version,recorded_by) values($1,'AUTHORITY','CREDIT',$2,$3,$4,$5)",[m.selfPayAdmissionId,planned.id,{clinicalId:planned.id,authority:"Synthetic hospital authority",reason:"Correct ledger cannot conceal fabricated zero responsibility",evidence:"Synthetic authority source",followUpOwnerId:m.cashier.id,bill:beforeCredit.bill,financial:fabricatedFinancial,outstandingObligations:[]},beforeCredit.episode.billRevision,m.admin.id])).rejects.toMatchObject({code:"23514"});
    const retainedNative=(await runtime.query("insert into hims.mvp_exception_events(admission_id,action,type,source_id,payload,bill_version,recorded_by) values($1,'AUTHORITY','CREDIT',$2,$3,$4,$5) returning payload",[m.selfPayAdmissionId,planned.id,{clinicalId:planned.id,authority:"Synthetic hospital authority",reason:"Native obligations cannot be omitted from an otherwise valid authority",evidence:"Synthetic authority source",followUpOwnerId:m.cashier.id,bill:beforeCredit.bill,financial:beforeCredit.financial,outstandingObligations:[]},beforeCredit.episode.billRevision,m.admin.id])).rows[0].payload;
    expect(retainedNative.outstandingObligations).toContain("Patient outstanding paise: 500000");expect(retainedNative.outstandingObligations.length).toBeGreaterThan(1);
    const credit=await exceptionAction(m.ac(),{action:"authorize",type:"CREDIT",clinicalId:planned.id,authority:"Synthetic explicit hospital credit authority",reason:"Retain outstanding patient debt with named follow-up",evidence:"Synthetic signed credit instruction",followUpOwnerId:m.cashier.id});
    const selfState=await self();expect(selfState.financial?.responsibility?.patientOutstandingPaise).toBe("500000");
    const exceptionPaper=await createMvpDocument(m.nc(),{admissionId:m.selfPayAdmissionId,kind:"FINAL",expectedReviewHash:selfState.reviewHash});
    const storage=(await runtime.query("select storage_key from hims.discharge_documents where id=$1",[exceptionPaper.documentId])).rows[0],pdfPath=resolve(protectedStorageDirectory("discharge"),`${storage.storage_key}.pdf`);
    await rename(pdfPath,`${pdfPath}.missing`);
    try{await expect(exceptionAction(m.nc(),{action:"deliver",authorityId:credit.id,documentId:exceptionPaper.documentId,recipient:"Synthetic self-pay patient",deliveredAt:new Date().toISOString(),evidence:"Missing PDF cannot be recorded as delivered"})).rejects.toMatchObject({code:"PRECONDITION"});}finally{await rename(`${pdfPath}.missing`,pdfPath);}
    await exceptionAction(m.nc(),{action:"deliver",authorityId:credit.id,documentId:exceptionPaper.documentId,recipient:"Synthetic self-pay patient",deliveredAt:new Date().toISOString(),evidence:"Actual authorized exception papers supplied"});
    const exceptional=await exceptionAction(m.nc(),{action:"exit",authorityId:credit.id,shiftId:m.selfPayShiftId,departedAt:new Date().toISOString()});
    const ended=await self();expect(ended.episode.status).toBe("DISCHARGED");expect(ended.exceptionalDeparture?.id).toBe(exceptional.id);expect(ended.financial?.responsibility?.patientOutstandingPaise).toBe("500000");
    expect((await verifyDocument(m.nc(),exceptionPaper.documentId)).status).toBe("CURRENT");
    const exceptionSnapshot=(await runtime.query("select row_to_json(d) snapshot from hims.mvp_exceptional_departures d where id=$1",[exceptional.id])).rows[0].snapshot,exceptionBytes=(await downloadDischargeDocument(m.nc(),exceptionPaper.documentId)).bytes;
    const selfMedicine=ended.bill!.charges.find(c=>c.category==="medicine")!;
    await correct(m.selfPayAdmissionId,selfMedicine.id,"REVERSE_CHARGE",{amountPaise:"100000",reason:"Synthetic linked reduction of original credit obligation",expectedBillVersion:(await self()).episode.billRevision});
    const patientReceipt=m.bc(),partial={admissionId:m.selfPayAdmissionId,party:"PATIENT",kind:"PAYMENT",amountPaise:"200000",mode:"CASH",channel:"Synthetic original credit receivable book",sourceReference:"MVP-LATE-PATIENT-PARTIAL",reference:"Actual partial patient debt collection",evidenceId:"Synthetic cashier receipt",requestId:patientReceipt.requestId};
    const oldPatientCeiling=m.bc();await expect(recordExceptionalReceivableReceipt(oldPatientCeiling,{...partial,amountPaise:"500000",sourceReference:"MVP-OLD-PATIENT-CEILING",requestId:oldPatientCeiling.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    await nativeCollectionDenied(m.selfPayAdmissionId,"PATIENT","500000",null,credit.id,/original party obligation/);
    const firstPartial=await recordExceptionalReceivableReceipt(patientReceipt,partial);expect(await recordExceptionalReceivableReceipt(patientReceipt,partial)).toEqual(firstPartial);
    expect((await self()).financial?.responsibility?.patientOutstandingPaise).toBe("200000");
    const lastPatient=m.bc();await recordExceptionalReceivableReceipt(lastPatient,{...partial,amountPaise:"200000",sourceReference:"MVP-LATE-PATIENT-FINAL",requestId:lastPatient.requestId});
    expect((await self()).financial?.responsibility?.patientOutstandingPaise).toBe("0");
    const excessive=m.bc();await expect(recordExceptionalReceivableReceipt(excessive,{...partial,amountPaise:"1",sourceReference:"MVP-EXCESS-PATIENT",requestId:excessive.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    expect((await runtime.query("select row_to_json(d) snapshot from hims.mvp_exceptional_departures d where id=$1",[exceptional.id])).rows[0].snapshot).toEqual(exceptionSnapshot);
    expect((await downloadDischargeDocument(m.nc(),exceptionPaper.documentId)).bytes).toEqual(exceptionBytes);expect((await verifyDocument(m.nc(),exceptionPaper.documentId)).status).toBe("CURRENT");
    // An originally unresolved insurance-delay exit can collect only after an exact later Admin-authorized allocation amendment.
    const doctorId=(await runtime.query("select external_doctor_id from hims.admissions where id=$1",[m.meeraAdmissionId])).rows[0].external_doctor_id;
    const delayBed=await createBed(m.ac(),{label:`Synthetic delay ${crypto.randomUUID()}`,category:"MVP_GENERAL",reason:"Synthetic unresolved-insurance follow-up"}),delayIntake=staffContext(m.desk,"synthetic-mvp"),delay=await createAdmission(delayIntake,{externalDoctorId:doctorId,patientDetails:{name:"Synthetic delayed insurance patient",ageYearsAtRegistration:51,sex:"FEMALE"},bedId:delayBed.id,paymentRoute:"INSURED",expectedStayDays:1,requestId:delayIntake.requestId});
    const arrival=staffContext(m.desk,"synthetic-mvp");await activateAdmission(arrival,{admissionId:delay.admissionId,arrivedAt:new Date().toISOString(),expectedVersion:1,requestId:arrival.requestId});
    await assignNurse(m.ac(),{admissionId:delay.admissionId,nurseId:m.nurse.id,reason:"Synthetic delay assigned care",authority:"Synthetic roster"});
    const delayShiftCtx=m.nc(),delayShift=await recordShift(delayShiftCtx,{admissionId:delay.admissionId,startedAt:new Date().toISOString(),handover:"Synthetic delay waiting-care attendance",requestId:delayShiftCtx.requestId});
    const delayState=()=>getMvpEpisode(m.ac(),delay.admissionId);
    async function delayAction(ctx:ReturnType<typeof m.ac>,value:Record<string,unknown>){return recordMvpException(ctx,{...value,admissionId:delay.admissionId,requestId:ctx.requestId,expectedReviewHash:(await delayState()).reviewHash});}
    const delayChargeCtx=m.pc();await recordPatientMedicineCharge(delayChargeCtx,{admissionId:delay.admissionId,itemId:"MVP_MED",quantity:"1",unit:"pack",expectedTariffVersionId:rate.id,sourceReference:"MVP-DELAY-MEDICINE",evidence:"Synthetic original pending-insurance bill",requestId:delayChargeCtx.requestId});
    const delayCaseCtx=m.ac(),delayCase=await createInsuranceCase(delayCaseCtx,{admissionId:delay.admissionId,assignedStaffId:m.insurance.id,reason:"Synthetic external decision remains pending",requestId:delayCaseCtx.requestId});
    const delayPolicy=m.ic();await recordPolicyVerification(delayPolicy,{caseId:delayCase.id,expectedCaseVersion:1,requestId:delayPolicy.requestId,insurer:"Synthetic delayed external insurer",tpa:"",policyNumber:"MVP-DELAY-POLICY",memberNumber:"MVP-DELAY-MEMBER",validFrom:"2026-01-01",validTo:"2027-12-31",verifiedBy:"Synthetic external policy desk",verifiedAt:new Date().toISOString(),reference:"Synthetic verified policy with pending allocation",documentIds:[]});
    const delayClinical=await delayAction(m.nc(),{action:"clinical",type:"PLANNED_EXIT",authorizerName:"Synthetic external Doctor",sourceTime:new Date().toISOString(),evidence:"External clinical authorization despite pending insurance",notes:"External Doctor authorizes planned hospital exit"});
    await delayAction(m.nc(),{action:"vacancy",clinicalId:delayClinical.id,shiftId:delayShift.id,vacatedAt:new Date().toISOString(),waitingLocation:"Synthetic supervised delay waiting area",handover:"Actual room use ended and care retained pending authorized exit"});
    const delayAuthority=await delayAction(m.ac(),{action:"authorize",type:"INSURANCE_DELAY",clinicalId:delayClinical.id,sourceId:delayCase.id,authority:"Synthetic explicit hospital delayed-insurance authority",reason:"Retain unknown allocation and original bill for later external decision",evidence:"Synthetic hospital authority and external pending case",followUpOwnerId:m.insurance.id});
    const delayPaper=await createMvpDocument(m.nc(),{admissionId:delay.admissionId,kind:"FINAL",expectedReviewHash:(await delayState()).reviewHash});
    await delayAction(m.nc(),{action:"deliver",authorityId:delayAuthority.id,documentId:delayPaper.documentId,recipient:"Synthetic delayed insurance patient",deliveredAt:new Date().toISOString(),evidence:"Actual unknown-allocation papers delivered"});
    const delayExit=await delayAction(m.nc(),{action:"exit",authorityId:delayAuthority.id,shiftId:delayShift.id,departedAt:new Date().toISOString()});
    const originalDelay=(await runtime.query("select row_to_json(d) snapshot from hims.mvp_exceptional_departures d where id=$1",[delayExit.id])).rows[0].snapshot,delayBytes=(await downloadDischargeDocument(m.nc(),delayPaper.documentId)).bytes;
    expect((await delayState()).collectionAuthority).toMatchObject({eligible:false,allocationAmendmentId:null});
    const delayReceiptValue={admissionId:delay.admissionId,party:"INSURER",kind:"PAYMENT",amountPaise:"100000",mode:"BANK",channel:"Synthetic delayed allocation collection",sourceReference:"MVP-DELAY-PARTIAL",reference:"Actual later externally accepted receivable",evidenceId:"Synthetic later bank receipt"};
    const noAllocation=m.bc();await expect(recordExceptionalReceivableReceipt(noAllocation,{...delayReceiptValue,requestId:noAllocation.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    async function acceptDelay(net:string,insurer:string){const current=await getInsuranceCase(m.ic(),delayCase.id);return correct(delay.admissionId,delayCase.id,"INSURANCE_DECISION",{caseId:delayCase.id,expectedCaseVersion:current.case.version,verifiedBy:"Synthetic external insurer allocation desk",verifiedAt:new Date().toISOString(),reference:"Synthetic later external accepted allocation",status:"PARTIAL",kind:"ENHANCEMENT",reason:"Current complete external allocation after original pending exit",approvedPaise:insurer,coPayBps:0,allocation:{billRevision:current.money.revision,netBillPaise:net,eligibleBillPaise:insurer,nonPayablePaise:"100000",sourceReference:"Synthetic later exact allocation source"},documentIds:[]},m.ic());}
    const firstDelayAllocation=await acceptDelay("500000","400000");
    expect((await delayState()).collectionAuthority).toMatchObject({eligible:true,allocationAmendmentId:firstDelayAllocation.id,patientRemainingPaise:"100000",insurerRemainingPaise:"400000",totalRemainingPaise:"500000"});
    expect((await getMvpEpisode(m.nc(),delay.admissionId)).collectionAuthority).toBeNull();
    await nativeCollectionDenied(delay.admissionId,"INSURER","1",null,delayAuthority.id,/Exact current Admin-authorized/,meeraAllocationAmendment.id);
    const delayCharge=(await delayState()).bill!.charges.find(c=>c.category==="medicine")!;
    await correct(delay.admissionId,delayCharge.id,"REVERSE_CHARGE",{amountPaise:"100000",reason:"Synthetic source correction requires fresh external allocation",expectedBillVersion:(await delayState()).episode.billRevision});
    const staleDelay=m.bc();await expect(recordExceptionalReceivableReceipt(staleDelay,{...delayReceiptValue,requestId:staleDelay.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    await nativeCollectionDenied(delay.admissionId,"INSURER","1",null,delayAuthority.id,/Current verified complete/,firstDelayAllocation.id);
    const currentDelayAllocation=await acceptDelay("400000","300000");
    await nativeCollectionDenied(delay.admissionId,"INSURER","1",null,delayAuthority.id,/Exact current Admin-authorized/,firstDelayAllocation.id);
    await nativeCollectionDenied(delay.admissionId,"INSURER","400000",null,delayAuthority.id,/original party obligation/,currentDelayAllocation.id);
    const delayPartial=m.bc(),delayPartialValue={...delayReceiptValue,requestId:delayPartial.requestId};
    const delayReceived=await recordExceptionalReceivableReceipt(delayPartial,delayPartialValue);expect(await recordExceptionalReceivableReceipt(delayPartial,delayPartialValue)).toEqual(delayReceived);
    const delayFinal=m.bc();await recordExceptionalReceivableReceipt(delayFinal,{...delayReceiptValue,amountPaise:"200000",sourceReference:"MVP-DELAY-INSURER-FINAL",requestId:delayFinal.requestId});
    const delayPatient=m.bc();await recordExceptionalReceivableReceipt(delayPatient,{...delayReceiptValue,party:"PATIENT",sourceReference:"MVP-DELAY-PATIENT-FINAL",requestId:delayPatient.requestId});
    expect((await delayState()).collectionAuthority).toMatchObject({eligible:true,patientRemainingPaise:"0",insurerRemainingPaise:"0",totalRemainingPaise:"0"});
    const delayExcess=m.bc();await expect(recordExceptionalReceivableReceipt(delayExcess,{...delayReceiptValue,amountPaise:"1",sourceReference:"MVP-DELAY-EXCESS",requestId:delayExcess.requestId})).rejects.toMatchObject({code:"PRECONDITION"});
    expect((await runtime.query("select row_to_json(d) snapshot from hims.mvp_exceptional_departures d where id=$1",[delayExit.id])).rows[0].snapshot).toEqual(originalDelay);
    expect((await downloadDischargeDocument(m.nc(),delayPaper.documentId)).bytes).toEqual(delayBytes);expect((await verifyDocument(m.nc(),delayPaper.documentId)).status).toBe("CURRENT");
  }),90000);
});
