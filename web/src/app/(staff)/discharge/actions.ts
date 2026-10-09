"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { DomainError } from "@/server/contracts";
import { issueClearance, recordRoomVacated, recordDeparture, completeBedTurnover } from "@/server/discharge/commands";
import { refundReceipt, cancelAllocation, reviewSelfPayResponsibility } from "@/server/billing/commands";
import { formatINR, parseINR } from "@/server/billing/money";
import type { CareState } from "@/components/care-forms";
type Binding = { admissionId:string; requestId:string; gate:string; reviewHash:string; billVersion:number };
const field=(f:FormData,key:string)=>String(f.get(key)??"");
const at=(f:FormData,key:string)=>new Date(`${field(f,key)}Z`).toISOString();
export async function dischargeAction(action:string,b:Binding,_previous:CareState,form:FormData):Promise<CareState>{
  try{
    const ctx={...staffContext(await requireStaff(),"discharge-form"),requestId:b.requestId};
    let message="Record saved. Review the current clearance state.";
    const expected={expectedReviewHash:b.reviewHash,expectedBillVersion:b.billVersion};
    if(action==="seal")await issueClearance(ctx,{admissionId:b.admissionId,gate:b.gate,...expected,reviewNote:field(form,"reviewNote")});
    else if(action==="vacate")await recordRoomVacated(ctx,{admissionId:b.admissionId,shiftId:field(form,"shiftId"),vacatedAt:at(form,"vacatedAt"),waitingLocation:field(form,"waitingLocation"),handover:field(form,"handover"),requestId:b.requestId});
    else if(action==="depart"){
      const result=await recordDeparture(ctx,{admissionId:b.admissionId,departedAt:at(form,"departedAt"),expectedBillVersion:b.billVersion,requestId:b.requestId});
      message=result.status==="DISCHARGED"?"Hospital departure recorded. Bed released for housekeeping.":`Review required. Current posted bill ${formatINR(result.netPaise!)}. Refresh, settle the current bill and obtain affected human approvals; no hospital departure was recorded.`;
    }
    else if(action==="refund")await refundReceipt(ctx,{receiptId:field(form,"receiptId"),amountPaise:parseINR(field(form,"amount")).toString(),reason:field(form,"reason"),mode:field(form,"mode"),channel:field(form,"channel"),sourceReference:field(form,"sourceReference"),evidence:field(form,"evidence"),refundedAt:at(form,"refundedAt"),...expected,requestId:b.requestId});
    else if(action==="cancel-allocation")await cancelAllocation(ctx,{allocationId:field(form,"allocationId"),reason:field(form,"reason"),...expected,requestId:b.requestId});
    else if(action==="self-pay")await reviewSelfPayResponsibility(ctx,{admissionId:b.admissionId,expectedBillVersion:b.billVersion,reason:field(form,"reason"),requestId:b.requestId});
    else if(action==="turnover")await completeBedTurnover(ctx,{turnoverId:field(form,"turnoverId"),completedAt:at(form,"completedAt"),evidence:field(form,"evidence"),requestId:b.requestId});
    else throw new DomainError("VALIDATION","Unknown discharge action");
    for(const path of ["/discharge","/billing","/admissions","/clinical","/nursing","/pharmacy","/insurance","/admin/beds"])revalidatePath(path);
    return {message};
  }catch(error){return {error:true,message:error instanceof DomainError?error.message:error instanceof ZodError||error instanceof RangeError?"Check the required fields and actual times.":"Unable to save. Refresh and try again."};}
}
