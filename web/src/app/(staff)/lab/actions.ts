"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { addLabReportAddendum, collectSample, disposeUnperformedLabOrder, recordLabReport, resolveLabBilling, startLabProcessing } from "@/server/lab/commands";
import { DomainError } from "@/server/contracts";
import type { CareState } from "@/components/care-forms";
export async function saveLab(orderId:string,requestId:string,operation:"collect"|"process"|"report"|"addendum"|"resolve"|"dispose",reportId:string,_previous:CareState,form:FormData):Promise<CareState>{
  const field=(name:string)=>String(form.get(name)??"");
  try{
    const ctx={...staffContext(await requireStaff(),"lab-form"),requestId},value={orderId,requestId};
    const scanned=field("barcode")?{barcode:field("barcode")}:{},reason=field("reason");
    if(operation==="collect")await collectSample(ctx,value);
    else if(operation==="process")await startLabProcessing(ctx,{...value,...scanned});
    else if(operation==="report")await recordLabReport(ctx,{...value,...scanned,result:field("result")});
    else if(operation==="addendum")await addLabReportAddendum(ctx,{...value,reportId,text:field("text"),reason});
    else if(operation==="resolve")await resolveLabBilling(ctx,{...value,reason});
    else await disposeUnperformedLabOrder(ctx,{...value,reason});
    revalidatePath("/lab");revalidatePath("/clinical");revalidatePath("/billing");
    return {message:{collect:"Sample collection recorded. Print its patient/order label.",process:"Actual sample/order matched. Processing recorded.",report:"Human report signed. Review its separate fee status.",addendum:"Reasoned addendum signed; original report retained.",resolve:"Original diagnostic fee reconciled once.",dispose:"Unperformed work disposition recorded; original pending fee reversed."}[operation]};
  }catch(error){return {error:true,message:error instanceof DomainError?error.message:error instanceof ZodError?"Check the fields and scan the actual sample label.":"Unable to record diagnostic work. Review the worklist and retry."};}
}
