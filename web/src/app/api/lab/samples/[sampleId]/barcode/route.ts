import bwipjs from "bwip-js/node";
import { requireStaff,staffContext } from "@/server/access";
import { getSampleLabel } from "@/server/lab/commands";
import { apiError } from "@/server/http";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{sampleId:string}>}){
  try{
    const {sampleId}=await params,label=await getSampleLabel(staffContext(await requireStaff(request.headers),"sample-barcode"),sampleId);
    const png=await bwipjs.toBuffer({bcid:"code128",text:label.sample.barcode,scale:3,height:12,includetext:true,textxalign:"center",padding:12,backgroundcolor:"FFFFFF"});
    return new Response(new Uint8Array(png),{headers:{"Content-Type":"image/png","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch(error){return apiError(error);}
}
