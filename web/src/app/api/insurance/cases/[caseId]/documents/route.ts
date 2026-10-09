import { requireStaff, staffContext } from "@/server/access";
import { apiError, sameOrigin } from "@/server/http";
import { attachCaseDocument, documentSizeLimit, downloadCaseDocument } from "@/server/insurance/documents";
import { insuranceCaseSource } from "@/server/insurance/commands";
import { withTransaction } from "@/server/db";
import { DomainError } from "@/server/contracts";
export const runtime="nodejs";
export async function POST(request:Request,{params}:{params:Promise<{caseId:string}>}){
  try{
    sameOrigin(request);const staff=await requireStaff(request.headers),{caseId}=await params,ctx=staffContext(staff,"insurance-upload-http");
    await withTransaction(tx=>insuranceCaseSource(tx,ctx,caseId));
    const limit=documentSizeLimit()+65536;
    if(Number(request.headers.get("content-length")??0)>limit)return Response.json({error:"Document size exceeds the configured limit"},{status:413});
    const chunks:Uint8Array[]=[];let total=0;const reader=request.body?.getReader();if(!reader)throw new DomainError("VALIDATION","Document body required");
    try{while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit){await reader.cancel();return Response.json({error:"Document size exceeds the configured limit"},{status:413});}chunks.push(value);}}finally{reader.releaseLock();}
    const form=await new Response(Buffer.concat(chunks),{headers:{"content-type":request.headers.get("content-type")??""}}).formData();
    const requestId=String(form.get("requestId")??""),replace=String(form.get("replacesDocumentId")??"");
    const result=await attachCaseDocument({...ctx,requestId},{caseId,file:form.get("file"),expectedCaseVersion:Number(form.get("expectedCaseVersion")),requestId,...(replace?{replacesDocumentId:replace}:{})});
    return Response.json(result,{status:201,headers:{"Cache-Control":"private, no-store"}});
  }catch(e){return apiError(e);}
}
export async function GET(request:Request,{params}:{params:Promise<{caseId:string}>}){
  try{const staff=await requireStaff(request.headers),{caseId}=await params,doc=await downloadCaseDocument(staffContext(staff,"insurance-download-http"),caseId,new URL(request.url).searchParams.get("documentId")??"");
    return new Response(new Uint8Array(doc.bytes),{headers:{"Content-Type":doc.mime,"Content-Length":String(doc.bytes.length),"Content-Disposition":`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.name)}`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox; default-src 'none'"}});
  }catch(e){return apiError(e);}
}
