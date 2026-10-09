"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireStaff, staffContext } from "@/server/access";
import { adjustStock, issueMedicine, prepareTakeHomeMedicines, recordStockReceipt, returnMedicine } from "@/server/pharmacy/commands";
import { DomainError } from "@/server/contracts";
import type { CareState } from "@/components/care-forms";
const field=(form:FormData,name:string)=>String(form.get(name)??"");
export async function savePharmacy(admissionId:string,requestId:string,operation:"receipt"|"issue"|"return"|"prepare"|"adjust",targetId:string,_previous:CareState,form:FormData):Promise<CareState> {
  try {
    const ctx={...staffContext(await requireStaff(),"pharmacy-form"),requestId};
    let message="";
    if(operation==="receipt") {
      const [medicineId,unit]=field(form,"medicine").split("|");
      await recordStockReceipt(ctx,{medicineId,unit,batchNo:field(form,"batchNo"),expiresOn:field(form,"expiresOn"),quantity:field(form,"quantity"),barcode:field(form,"barcode"),reference:field(form,"reference"),...(field(form,"reorderThreshold") ? {reorderThreshold:field(form,"reorderThreshold")} : {}),requestId});
      message="Stock receipt recorded with batch and barcode identity.";
    } else if(operation==="issue") {
      const [batchId,unit]=field(form,"batch").split("|");
      await issueMedicine(ctx,{admissionId,orderId:targetId,batchId,unit,quantity:field(form,"quantity"),...(field(form,"barcode") ? {barcode:field(form,"barcode")} : {}),requestId});
      message="Ward stock issued and charged once. Administration remains a separate nursing record.";
    } else if(operation==="return") {
      await returnMedicine(ctx,{issueId:targetId,quantity:field(form,"quantity"),reason:field(form,"reason"),requestId});
      message="Return recorded against the original issue, stock and original-price bill adjustment.";
    } else if(operation==="adjust") {
      await adjustStock(ctx,{batchId:field(form,"batchId"),quantity:field(form,"quantity"),direction:field(form,"direction"),reason:field(form,"reason"),requestId});
      message="Authorized stock adjustment recorded. Original movements retained.";
    } else {
      const items=form.getAll("orderId").map(id=>{
        const orderId=String(id),[batchId,unit]=field(form,`batch:${orderId}`).split("|");
        const scan=field(form,`barcode:${orderId}`);
        return {orderId,batchId,unit,quantity:field(form,`quantity:${orderId}`),...(scan ? {barcode:scan} : {})};
      });
      await prepareTakeHomeMedicines(ctx,{admissionId,prescriptionVersionId:targetId,items,requestId});
      message="Take-home stock issued/prepared against the current prescription. Collection and pharmacy seal remain separate.";
    }
    revalidatePath("/pharmacy");revalidatePath("/billing");
    return {message};
  } catch(error) {
    if(error instanceof DomainError)return {message:error.message,error:true};
    if(error instanceof ZodError)return {message:"Review the medicine identity, exact quantity/unit and required fields.",error:true};
    const cause=(error as {cause?:{code?:string}})?.cause;
    if(cause?.code==="23505")return {message:"This receipt source, batch or barcode already exists. Review the recorded receipt and stock identity.",error:true};
    console.error("Pharmacy operation failed");
    return {message:"The pharmacy change was not saved. Try again or contact your administrator.",error:true};
  }
}
