"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { assignInsuranceCase, convertToSelfPay, createInsuranceCase, recordInsuranceFollowup, recordPayerDecision, recordPolicyVerification, resolveTransferInsuranceTask } from "@/server/insurance/commands";
import { DomainError } from "@/server/contracts";
import { parseINR } from "@/server/billing/money";
import type { CareState } from "@/components/care-forms";
export async function saveInsurance(caseId:string,version:number,requestId:string,operation:"create"|"assign"|"policy"|"decision"|"followup"|"transfer"|"convert",_prior:CareState,form:FormData):Promise<CareState>{
  const field=(name:string)=>String(form.get(name)??"");const amount=(name:string)=>parseINR(field(name)).toString();
  try{
    const ctx={...staffContext(await requireStaff(),"insurance-staff-form"),requestId},base={caseId,expectedCaseVersion:version,requestId},provenance={verifiedBy:field("verifiedBy"),verifiedAt:field("verifiedAt")?new Date(`${field("verifiedAt")}Z`).toISOString():"",reference:field("reference")};
    if(operation==="create")await createInsuranceCase(ctx,{admissionId:field("admissionId"),assignedStaffId:field("assignedStaffId")||null,reason:field("reason"),requestId});
    else if(operation==="assign")await assignInsuranceCase(ctx,{...base,assignedStaffId:field("assignedStaffId")||null,reason:field("reason")});
    else if(operation==="policy")await recordPolicyVerification(ctx,{...base,...provenance,insurer:field("insurer"),tpa:field("tpa"),policyNumber:field("policyNumber"),memberNumber:field("memberNumber"),validFrom:field("validFrom"),validTo:field("validTo"),documentIds:form.getAll("documentIds").map(String)});
    else if(operation==="decision")await recordPayerDecision(ctx,{...base,...provenance,kind:field("kind"),status:field("status"),reason:field("reason"),approvedPaise:amount("approved"),coPayBps:Number(parseINR(field("coPayPercent"))),documentIds:form.getAll("documentIds").map(String),allocation:{billRevision:Number(field("billRevision")),netBillPaise:field("netBillPaise"),eligibleBillPaise:amount("eligible"),nonPayablePaise:amount("nonPayable"),...(field("patient")?{verifiedPatientLiabilityPaise:amount("patient")} : {}),sourceReference:field("sourceReference")}});
    else if(operation==="followup")await recordInsuranceFollowup(ctx,{...base,workId:field("workId")||requestId,kind:field("kind"),status:field("status"),reference:field("reference"),reason:field("reason")});
    else if(operation==="transfer")await resolveTransferInsuranceTask(ctx,{...base,...provenance,taskId:field("taskId"),decisionId:field("decisionId"),reason:field("reason")});
    else if(operation==="convert")await convertToSelfPay(ctx,{...base,reason:field("reason"),decisionReference:field("reference"),verifiedBy:provenance.verifiedBy,verifiedAt:provenance.verifiedAt,allocation:{billRevision:Number(field("billRevision")),netBillPaise:field("netBillPaise"),verifiedPatientLiabilityPaise:amount("patient"),retainedInsurerLiabilityPaise:amount("insurer"),sourceReference:field("sourceReference")}});
    else throw new DomainError("VALIDATION","Unknown insurance action");
    for(const path of ["/insurance","/billing","/clinical","/nursing"])revalidatePath(path);
    return {message:"Staff record saved. Review the current case and its separate receipt position."};
  }catch(e){return {error:true,message:e instanceof DomainError?e.message:e instanceof ZodError||e instanceof RangeError?"Check the fields, verification date and current case version.":"Unable to save insurance record. Reload and retry."};}
}
